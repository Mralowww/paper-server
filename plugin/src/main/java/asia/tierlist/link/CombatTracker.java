package asia.tierlist.link;

import com.google.gson.JsonObject;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.EnderCrystal;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityResurrectEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Records joins, quits, world changes, totem pops and deaths, working out who killed whom — including
 * crystal and respawn-anchor kills, which vanilla does not always attribute to a player.
 */
final class CombatTracker implements Listener {
    private static final long CRYSTAL_MEMORY_MS = 10_000;
    private static final long ANCHOR_WINDOW_MS = 2_000;
    private static final double ANCHOR_RADIUS_SQ = 8.0 * 8.0;

    private record AnchorUse(Location location, UUID player, long at) {}
    private record CrystalHit(UUID player, long at) {}

    private final EventQueue queue;
    private final Map<UUID, CrystalHit> crystalHits = new ConcurrentHashMap<>();
    private final Deque<AnchorUse> anchorUses = new ArrayDeque<>();
    private final Map<UUID, Integer> popsThisLife = new ConcurrentHashMap<>();

    CombatTracker(EventQueue queue) {
        this.queue = queue;
    }

    static JsonObject ref(Player p) {
        JsonObject o = new JsonObject();
        o.addProperty("uuid", p.getUniqueId().toString());
        o.addProperty("name", p.getName());
        return o;
    }

    private void simple(String type, Player p) {
        JsonObject e = new JsonObject();
        e.addProperty("type", type);
        e.add("player", ref(p));
        e.addProperty("world", p.getWorld().getName());
        queue.add(e);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        simple("join", event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        simple("quit", event.getPlayer());
        popsThisLife.remove(event.getPlayer().getUniqueId());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onWorld(PlayerChangedWorldEvent event) {
        simple("world", event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTotem(EntityResurrectEvent event) {
        if (event.getEntity() instanceof Player p) {
            popsThisLife.merge(p.getUniqueId(), 1, Integer::sum);
            simple("totem", p);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCrystalHit(EntityDamageByEntityEvent event) {
        if (!(event.getEntity() instanceof EnderCrystal)) return;
        UUID who = playerFrom(event.getDamager());
        if (who != null) crystalHits.put(event.getEntity().getUniqueId(), new CrystalHit(who, System.currentTimeMillis()));
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onAnchor(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getClickedBlock() == null
                || event.getClickedBlock().getType() != Material.RESPAWN_ANCHOR) return;
        long now = System.currentTimeMillis();
        synchronized (anchorUses) {
            anchorUses.addLast(new AnchorUse(event.getClickedBlock().getLocation(), event.getPlayer().getUniqueId(), now));
            while (anchorUses.size() > 200 || (!anchorUses.isEmpty() && now - anchorUses.peekFirst().at() > ANCHOR_WINDOW_MS * 5)) {
                anchorUses.pollFirst();
            }
        }
    }

    private UUID anchorUser(Location where) {
        long now = System.currentTimeMillis();
        synchronized (anchorUses) {
            Iterator<AnchorUse> it = anchorUses.descendingIterator();
            while (it.hasNext()) {
                AnchorUse u = it.next();
                if (now - u.at() > ANCHOR_WINDOW_MS) break;
                if (u.location().getWorld() == where.getWorld() && u.location().distanceSquared(where) <= ANCHOR_RADIUS_SQ) {
                    return u.player();
                }
            }
        }
        return null;
    }

    private static UUID playerFrom(Entity e) {
        if (e instanceof Player p) return p.getUniqueId();
        if (e instanceof Projectile proj && proj.getShooter() instanceof Player p) return p.getUniqueId();
        return null;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(PlayerDeathEvent event) {
        Player victim = event.getEntity();
        EntityDamageEvent last = victim.getLastDamageCause();
        EntityDamageEvent.DamageCause dc = last == null ? null : last.getCause();
        UUID killerId = null;
        String cause = "other";

        if (last instanceof EntityDamageByEntityEvent byEntity && byEntity.getDamager() instanceof EnderCrystal crystal) {
            cause = "crystal";
            CrystalHit hit = crystalHits.remove(crystal.getUniqueId());
            if (hit != null && System.currentTimeMillis() - hit.at() <= CRYSTAL_MEMORY_MS) killerId = hit.player();
        } else if (dc == EntityDamageEvent.DamageCause.BLOCK_EXPLOSION) {
            UUID user = anchorUser(victim.getLocation());
            if (user != null) {
                cause = "anchor";
                killerId = user;
            } else {
                cause = "explosion";
            }
        } else if (dc == EntityDamageEvent.DamageCause.ENTITY_ATTACK || dc == EntityDamageEvent.DamageCause.ENTITY_SWEEP_ATTACK) {
            cause = "melee";
        } else if (dc == EntityDamageEvent.DamageCause.PROJECTILE) {
            cause = "projectile";
        } else if (dc == EntityDamageEvent.DamageCause.ENTITY_EXPLOSION) {
            cause = "explosion";
        }
        if (killerId == null && victim.getKiller() != null) killerId = victim.getKiller().getUniqueId();
        if (killerId == null && last instanceof EntityDamageByEntityEvent byEntity) killerId = playerFrom(byEntity.getDamager());

        JsonObject e = new JsonObject();
        e.addProperty("type", "death");
        e.add("victim", ref(victim));
        e.addProperty("world", victim.getWorld().getName());
        e.addProperty("cause", cause);
        e.addProperty("victimPops", popsThisLife.getOrDefault(victim.getUniqueId(), 0));
        Player killer = killerId == null ? null : victim.getServer().getPlayer(killerId);
        if (killer != null && !killer.equals(victim)) {
            e.add("killer", ref(killer));
            e.addProperty("killerHealth", Math.round(killer.getHealth() * 10) / 10.0);
        }
        popsThisLife.remove(victim.getUniqueId());
        queue.add(e);

        long cutoff = System.currentTimeMillis() - CRYSTAL_MEMORY_MS;
        crystalHits.values().removeIf(h -> h.at() < cutoff);
    }
}
