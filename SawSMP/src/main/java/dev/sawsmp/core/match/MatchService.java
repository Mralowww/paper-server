package dev.sawsmp.core.match;

import com.google.gson.JsonObject;
import dev.sawsmp.core.SawSMPPlugin;
import dev.sawsmp.core.api.ApiClient;
import dev.sawsmp.core.util.Msg;
import dev.sawsmp.core.util.Sched;
import io.papermc.paper.threadedregions.scheduler.ScheduledTask;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;

import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

/**
 * 網頁配對：收到 match_start 後把兩名玩家傳送到地表的安全隨機位置開打。
 * 一方死亡 → 另一方勝；一方退出遊戲 → 另一方勝；超過時間 → 平手。
 */
public final class MatchService implements Listener {
    private static final Set<Material> UNSAFE = Set.of(Material.LAVA, Material.WATER, Material.MAGMA_BLOCK, Material.CACTUS,
            Material.FIRE, Material.SOUL_FIRE, Material.CAMPFIRE, Material.SOUL_CAMPFIRE, Material.POWDER_SNOW, Material.SWEET_BERRY_BUSH,
            Material.POINTED_DRIPSTONE, Material.BUBBLE_COLUMN, Material.SEAGRASS, Material.KELP, Material.KELP_PLANT, Material.ICE);

    private static final class Match {
        final long id; final UUID a, b; final String an, bn;
        final Map<UUID, Location> origin = new ConcurrentHashMap<>();
        volatile boolean live; volatile ScheduledTask timeout;
        Match(long id, UUID a, String an, UUID b, String bn) { this.id = id; this.a = a; this.an = an; this.b = b; this.bn = bn; }
        UUID other(UUID u) { return u.equals(a) ? b : a; }
        String name(UUID u) { return u.equals(a) ? an : bn; }
    }

    private final SawSMPPlugin plugin;
    private final Map<UUID, Match> byPlayer = new ConcurrentHashMap<>();
    private final Map<UUID, Location> returnOnRespawn = new ConcurrentHashMap<>();

    public MatchService(SawSMPPlugin plugin) { this.plugin = plugin; }

    public boolean inMatch(UUID u) { return byPlayer.containsKey(u); }

    public int active() { return (int) byPlayer.values().stream().distinct().count(); }

    // ---------- 開始 ----------

    public void start(JsonObject p) {
        long id = p.get("match_id").getAsLong();
        JsonObject ja = p.getAsJsonObject("a"), jb = p.getAsJsonObject("b");
        UUID a = UUID.fromString(ApiClient.str(ja, "uuid")), b = UUID.fromString(ApiClient.str(jb, "uuid"));
        long limit = p.has("time_limit") ? p.get("time_limit").getAsLong() : 3600;
        Player pa = Bukkit.getPlayer(a), pb = Bukkit.getPlayer(b);
        if (pa == null || pb == null || pa.isDead() || pb.isDead() || inMatch(a) || inMatch(b)) {
            cancel(id, "player_unavailable");
            for (Player x : new Player[]{pa, pb}) if (x != null) Sched.entity(x, () -> Msg.send(x, "<red>配對已取消：對手目前無法進行對戰。</red>"));
            return;
        }
        Match m = new Match(id, a, pa.getName(), b, pb.getName());
        byPlayer.put(a, m); byPlayer.put(b, m);
        m.origin.put(a, pa.getLocation()); m.origin.put(b, pb.getLocation());
        for (Player x : new Player[]{pa, pb}) Sched.entity(x, () -> {
            Msg.send(x, "<#97c8c7>配對成功！</#97c8c7> <white>對手：{o}</white> <gray>正在尋找戰場…</gray>", "o", m.name(m.other(x.getUniqueId())));
            x.playSound(x.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 1f, 1.6f);
        });
        World w = Bukkit.getWorld(plugin.getConfig().getString("match.world", "world"));
        if (w == null) { abort(m, "no_world", "<red>找不到對戰世界，已取消。</red>"); return; }
        findArena(w, plugin.getConfig().getInt("match.max-attempts", 40)).whenComplete((spots, err) -> {
            if (err != null || spots == null) { abort(m, "no_safe_location", "<red>找不到安全的戰場位置，已取消配對。</red>"); return; }
            Player xa = Bukkit.getPlayer(a), xb = Bukkit.getPlayer(b);
            if (xa == null || xb == null || byPlayer.get(a) != m) { abort(m, "player_left", "<red>對手已離線，配對取消。</red>"); return; }
            teleport(xa, spots[0], spots[1]); teleport(xb, spots[1], spots[0]);
            countdown(m, spots[0], limit);
        });
    }

    private void teleport(Player p, Location to, Location lookAt) {
        Location l = to.clone();
        l.setDirection(lookAt.toVector().subtract(to.toVector()));
        Sched.entity(p, () -> {
            p.setFallDistance(0);
            p.teleportAsync(l, PlayerTeleportEvent.TeleportCause.PLUGIN);
        });
    }

    private void countdown(Match m, Location arena, long limitSeconds) {
        int secs = Math.max(0, plugin.getConfig().getInt("match.countdown", 3));
        for (int i = secs; i >= 0; i--) {
            final int n = i;
            Sched.globalLater(() -> {
                if (byPlayer.get(m.a) != m) return;
                for (UUID u : new UUID[]{m.a, m.b}) {
                    Player x = Bukkit.getPlayer(u); if (x == null) continue;
                    Sched.entity(x, () -> {
                        if (n > 0) {
                            x.showTitle(Title.title(Msg.parse("<#97c8c7><bold>" + n), Msg.parse("<gray>對手：<white>{o}", "o", m.name(m.other(u))),
                                    Title.Times.times(Duration.ZERO, Duration.ofMillis(900), Duration.ofMillis(100))));
                            x.playSound(x.getLocation(), Sound.BLOCK_NOTE_BLOCK_HAT, 1f, 1f);
                        } else {
                            x.showTitle(Title.title(Msg.parse("<red><bold>⚔ 開戰！"), Msg.parse("<gray>擊敗 <white>{o}</white>", "o", m.name(m.other(u)))));
                            x.playSound(x.getLocation(), Sound.ENTITY_ENDER_DRAGON_GROWL, .6f, 1.4f);
                        }
                    });
                }
                if (n == 0) {
                    m.live = true;
                    plugin.api().post("/api/plugin/match/started", ApiClient.obj("match_id", m.id, "world", arena.getWorld().getName(),
                            "x", arena.getBlockX(), "y", arena.getBlockY(), "z", arena.getBlockZ()));
                    m.timeout = Bukkit.getAsyncScheduler().runDelayed(plugin, t -> Sched.global(() -> finish(m, null, "timeout")),
                            Math.max(60, limitSeconds), TimeUnit.SECONDS);
                }
            }, 20L * (secs - i) + 20);
        }
    }

    // ---------- 安全位置 ----------

    private CompletableFuture<Location[]> findArena(World w, int attempts) {
        CompletableFuture<Location[]> out = new CompletableFuture<>();
        tryFind(w, attempts, out);
        return out;
    }

    private void tryFind(World w, int left, CompletableFuture<Location[]> out) {
        if (left <= 0) { out.complete(null); return; }
        ThreadLocalRandom r = ThreadLocalRandom.current();
        int min = plugin.getConfig().getInt("match.min-radius", 800), max = Math.max(min + 1, plugin.getConfig().getInt("match.max-radius", 4000));
        double ang = r.nextDouble(Math.PI * 2); int dist = r.nextInt(min, max);
        int x = (int) (Math.cos(ang) * dist), z = (int) (Math.sin(ang) * dist);
        int gap = plugin.getConfig().getInt("match.spacing", 14);
        w.getChunkAtAsync(x >> 4, z >> 4, true).thenCompose(c -> w.getChunkAtAsync((x + gap) >> 4, z >> 4, true)).thenAccept(c ->
                Sched.region(new Location(w, x, 0, z), () -> {
                    Location s1 = safeAt(w, x, z), s2 = s1 == null ? null : safeAt(w, x + gap, z);
                    if (s1 != null && s2 != null && Math.abs(s1.getY() - s2.getY()) <= 6) out.complete(new Location[]{s1, s2});
                    else tryFind(w, left - 1, out);
                })).exceptionally(ex -> { tryFind(w, left - 1, out); return null; });
    }

    private static Location safeAt(World w, int x, int z) {
        Block ground = w.getHighestBlockAt(x, z);
        Material t = ground.getType();
        if (!t.isSolid() || UNSAFE.contains(t) || Tag.LEAVES.isTagged(t)) return null;
        Block feet = ground.getRelative(0, 1, 0), head = ground.getRelative(0, 2, 0);
        if (!feet.isPassable() || !head.isPassable() || feet.isLiquid() || head.isLiquid()) return null;
        if (UNSAFE.contains(feet.getType()) || UNSAFE.contains(head.getType())) return null;
        return new Location(w, x + .5, ground.getY() + 1, z + .5);
    }

    // ---------- 結束 ----------

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(PlayerDeathEvent e) {
        Match m = byPlayer.get(e.getEntity().getUniqueId());
        if (m == null) return;
        if (!m.live) { abort(m, "died_before_start", "<red>開戰前有玩家死亡，配對取消。</red>"); return; }
        UUID dead = e.getEntity().getUniqueId();
        if (plugin.getConfig().getBoolean("match.return-to-origin", true)) returnOnRespawn.put(dead, m.origin.get(dead));
        finish(m, m.other(dead), "death");
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        Match m = byPlayer.get(e.getPlayer().getUniqueId());
        if (m == null) return;
        if (!m.live) { abort(m, "player_left", "<red>對手已離線，配對取消。</red>"); return; }
        finish(m, m.other(e.getPlayer().getUniqueId()), "quit");
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onRespawn(PlayerRespawnEvent e) {
        Location back = returnOnRespawn.remove(e.getPlayer().getUniqueId());
        if (back != null) e.setRespawnLocation(back);
    }

    private void finish(Match m, UUID winner, String reason) {
        if (byPlayer.get(m.a) != m && byPlayer.get(m.b) != m) return; // 已結束
        byPlayer.remove(m.a, m); byPlayer.remove(m.b, m);
        if (m.timeout != null) m.timeout.cancel();
        plugin.api().post("/api/plugin/match/end", ApiClient.obj("match_id", m.id, "winner_uuid", winner == null ? null : winner.toString(), "reason", reason));
        String why = switch (reason) { case "quit" -> "對手退出遊戲"; case "timeout" -> "時間到"; default -> "擊敗對手"; };
        for (UUID u : new UUID[]{m.a, m.b}) {
            Player x = Bukkit.getPlayer(u); if (x == null) continue;
            boolean won = u.equals(winner);
            Sched.entity(x, () -> {
                if (winner == null) {
                    x.showTitle(Title.title(Msg.parse("<gray><bold>平手"), Msg.parse("<gray>{w}", "w", why)));
                } else if (won) {
                    x.showTitle(Title.title(Msg.parse("<gold><bold>🏆 勝利！"), Msg.parse("<gray>{w} · 對手 <white>{o}", "w", why, "o", m.name(m.other(u)))));
                    x.playSound(x.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);
                } else {
                    x.showTitle(Title.title(Msg.parse("<red><bold>落敗"), Msg.parse("<gray>勝者 <white>{o}", "o", m.name(m.other(u)))));
                }
                Msg.send(x, "<gray>結果已記錄到網站，<#97c8c7>/match</#97c8c7> 頁面可再次配對。</gray>");
            });
            if (!x.isDead() && plugin.getConfig().getBoolean("match.return-to-origin", true)) {
                Location back = m.origin.get(u);
                if (back != null) Sched.entityLater(x, () -> { if (x.isOnline() && !x.isDead()) x.teleportAsync(back); }, 60);
            }
        }
        if (winner != null) Msg.broadcast("<gray>⚔ <white>{w}</white> 在配對對戰中擊敗了 <white>{l}</white></gray>", "w", m.name(winner), "l", m.name(m.other(winner)));
    }

    private void abort(Match m, String reason, String message) {
        byPlayer.remove(m.a, m); byPlayer.remove(m.b, m);
        if (m.timeout != null) m.timeout.cancel();
        cancel(m.id, reason);
        for (UUID u : new UUID[]{m.a, m.b}) {
            Player x = Bukkit.getPlayer(u); if (x == null) continue;
            Sched.entity(x, () -> Msg.send(x, message));
            Location back = m.origin.get(u);
            if (m.live && back != null) Sched.entity(x, () -> x.teleportAsync(back));
        }
    }

    private void cancel(long id, String reason) {
        plugin.api().post("/api/plugin/match/cancel", ApiClient.obj("match_id", id, "reason", reason));
    }

    /** 插件關閉時取消所有進行中的對戰（同步等待送出）。 */
    public void shutdown() {
        byPlayer.values().stream().distinct().forEach(m -> {
            try { plugin.api().post("/api/plugin/match/cancel", ApiClient.obj("match_id", m.id, "reason", "server_stop")).get(3, TimeUnit.SECONDS); }
            catch (Exception ignored) { }
        });
        byPlayer.clear();
    }
}
