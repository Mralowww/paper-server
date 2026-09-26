package dev.sawsmp.core.util;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.plugin.Plugin;

import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * 排程工具：統一使用 Paper 的區域化排程器，Paper 與 Folia 都能正確執行。
 */
public final class Sched {
    private static Plugin plugin;

    private Sched() {}

    public static void init(Plugin p) { plugin = p; }

    /** 非同步執行（網路請求等）。 */
    public static void async(Runnable r) {
        Bukkit.getAsyncScheduler().runNow(plugin, t -> r.run());
    }

    public static void asyncRepeating(Runnable r, long periodSeconds) {
        Bukkit.getAsyncScheduler().runAtFixedRate(plugin, t -> r.run(), periodSeconds, periodSeconds, TimeUnit.SECONDS);
    }

    /** 全域執行緒（廣播、非特定實體的工作）。 */
    public static void global(Runnable r) {
        Bukkit.getGlobalRegionScheduler().execute(plugin, r);
    }

    public static void globalLater(Runnable r, long ticks) {
        Bukkit.getGlobalRegionScheduler().runDelayed(plugin, t -> r.run(), Math.max(1, ticks));
    }

    /** 在實體所屬的執行緒執行（踢出、傳送、發訊息給特定玩家）。 */
    public static void entity(Entity e, Runnable r) {
        e.getScheduler().run(plugin, t -> r.run(), null);
    }

    public static void entityLater(Entity e, Runnable r, long ticks) {
        e.getScheduler().runDelayed(plugin, t -> r.run(), null, Math.max(1, ticks));
    }

    /** 在某個位置所屬的區域執行緒執行（讀取方塊）。 */
    public static void region(Location loc, Runnable r) {
        Bukkit.getRegionScheduler().execute(plugin, loc, r);
    }

    public static <T> Consumer<T> onEntity(Entity e, Consumer<T> c) {
        return v -> entity(e, () -> c.accept(v));
    }
}
