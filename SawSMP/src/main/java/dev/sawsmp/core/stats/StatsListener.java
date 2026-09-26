package dev.sawsmp.core.stats;

import dev.sawsmp.core.SawSMPPlugin;
import dev.sawsmp.core.api.ApiClient;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.EnderCrystal;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.entity.Trident;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageByBlockEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerInteractEvent;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * PVP 戰績：記錄每位玩家最後一次被哪個玩家、用什麼方式傷害，死亡時回報擊殺。
 * 擊殺方式：crystal（末地水晶）、anchor（重生錨 / 床爆炸）、melee、mace、bow、tnt、fall、other。
 */
public final class StatsListener implements Listener {
    private record Hit(UUID attacker, String name, String method, long at) {}
    private record Trigger(UUID player, String name, Location loc, long at) {}

    private final SawSMPPlugin plugin;
    private final Map<UUID, Hit> lastHit = new ConcurrentHashMap<>();
    private final Map<UUID, Trigger> crystalOwner = new ConcurrentHashMap<>();
    private final Map<Location, Trigger> anchorTrigger = new ConcurrentHashMap<>();

    public StatsListener(SawSMPPlugin plugin) { this.plugin = plugin; }

    private long tagMillis() { return plugin.getConfig().getLong("stats.combat-tag-seconds", 10) * 1000L; }

    private static Player sourcePlayer(Entity damager) {
        if (damager instanceof Player p) return p;
        if (damager instanceof Projectile pr && pr.getShooter() instanceof Player p) return p;
        if (damager instanceof TNTPrimed tnt && tnt.getSource() instanceof Player p) return p;
        return null;
    }

    /** 誰打爆了末地水晶。 */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCrystalHit(EntityDamageByEntityEvent e) {
        if (!(e.getEntity() instanceof EnderCrystal)) return;
        Player p = sourcePlayer(e.getDamager());
        if (p != null) crystalOwner.put(e.getEntity().getUniqueId(), new Trigger(p.getUniqueId(), p.getName(), null, System.currentTimeMillis()));
    }

    /** 誰引爆了重生錨 / 床（在主世界使用重生錨、在地獄 / 終界睡床會爆炸）。 */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onAnchor(PlayerInteractEvent e) {
        if (e.getAction() != Action.RIGHT_CLICK_BLOCK || e.getClickedBlock() == null) return;
        Block b = e.getClickedBlock();
        if (b.getType() == Material.RESPAWN_ANCHOR || b.getType().name().endsWith("_BED")) {
            Player p = e.getPlayer();
            anchorTrigger.put(b.getLocation(), new Trigger(p.getUniqueId(), p.getName(), b.getLocation(), System.currentTimeMillis()));
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerHit(EntityDamageByEntityEvent e) {
        if (!(e.getEntity() instanceof Player victim)) return;
        Entity d = e.getDamager();
        long now = System.currentTimeMillis();
        if (d instanceof EnderCrystal c) {
            Trigger t = crystalOwner.get(c.getUniqueId());
            if (t != null && now - t.at() < 5000 && !t.player().equals(victim.getUniqueId())) record(victim, t.player(), t.name(), "crystal");
            return;
        }
        Player src = sourcePlayer(d);
        if (src == null || src.equals(victim)) return;
        String method;
        if (d instanceof TNTPrimed) method = "tnt";
        else if (d instanceof Trident || d instanceof Projectile) method = "bow";
        else if (src.getInventory().getItemInMainHand().getType() == Material.MACE) method = "mace";
        else method = "melee";
        record(victim, src.getUniqueId(), src.getName(), method);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockDamage(EntityDamageByBlockEvent e) {
        if (!(e.getEntity() instanceof Player victim) || e.getCause() != EntityDamageEvent.DamageCause.BLOCK_EXPLOSION) return;
        long now = System.currentTimeMillis();
        Location vl = victim.getLocation();
        Trigger best = null;
        for (Trigger t : anchorTrigger.values()) {
            if (now - t.at() > 5000 || t.loc().getWorld() != vl.getWorld()) continue;
            if (t.loc().distanceSquared(vl) <= 144 && (best == null || t.at() > best.at())) best = t;
        }
        if (best != null && !best.player().equals(victim.getUniqueId())) record(victim, best.player(), best.name(), "anchor");
    }

    private void record(Player victim, UUID attacker, String name, String method) {
        lastHit.put(victim.getUniqueId(), new Hit(attacker, name, method, System.currentTimeMillis()));
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(PlayerDeathEvent e) {
        Player victim = e.getEntity();
        Hit h = lastHit.remove(victim.getUniqueId());
        long now = System.currentTimeMillis();
        UUID killer = null; String killerName = null; String method = "other";
        if (h != null && now - h.at() <= tagMillis()) {
            killer = h.attacker(); killerName = h.name(); method = h.method();
            EntityDamageEvent last = victim.getLastDamageCause();
            if (last != null && last.getCause() == EntityDamageEvent.DamageCause.FALL && !"crystal".equals(method) && !"anchor".equals(method)) method = "fall";
        } else if (victim.getKiller() != null && !victim.getKiller().equals(victim)) {
            killer = victim.getKiller().getUniqueId(); killerName = victim.getKiller().getName(); method = "melee";
        }
        // 順便清除過期的觸發紀錄
        crystalOwner.values().removeIf(t -> now - t.at() > 30000);
        anchorTrigger.values().removeIf(t -> now - t.at() > 30000);
        if (killer == null || !plugin.getConfig().getBoolean("stats.enabled", true) || !plugin.api().configured()) return;
        plugin.api().post("/api/plugin/kill", ApiClient.obj(
                "killer", ApiClient.obj("uuid", killer.toString(), "name", killerName),
                "victim", ApiClient.obj("uuid", victim.getUniqueId().toString(), "name", victim.getName()),
                "method", method,
                // 戰績改由 PAPI 同步時，只記錄擊殺方式與連殺，不重複計算擊殺 / 死亡
                "count", !plugin.papi().active()));
    }
}
