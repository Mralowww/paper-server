package dev.pvpattackguard.pvpattackguard;

import org.bukkit.util.Vector;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 每個玩家的滾動狀態快取。Folia 下不同事件可能在不同 region 執行緒觸發，
 * 所有欄位都透過 AtomicReference 存取，不用鎖，避免跨執行緒資料損毀，
 * 也不需要額外的排程器就能安全讀寫。
 */
public final class PlayerState {

    /** 一次視角/位置封包的快照：眼睛座標 + 看方向 + 伺服器收到的時間(nanoTime)。 */
    public record MoveSnapshot(Vector eyeLocation, Vector direction, long timestampNanos) {
    }

    private final AtomicReference<MoveSnapshot> lastMove = new AtomicReference<>();
    private final AtomicReference<Long> lastSwingNanos = new AtomicReference<>();

    // 違規累積分數與最後更新時間，用來做「隨時間衰減」。
    private final AtomicReference<double[]> violation = new AtomicReference<>(new double[]{0.0, 0.0}); // [score, lastUpdateNanos]

    // 最近幾次攻擊的攻速充能進度與間隔，供規律性統計使用；只由攻擊者自己所在的
    // region 執行緒存取（攻擊事件一定在攻擊者所屬 region 觸發），用 synchronized 保護即可。
    private final Deque<Long> recentAttackTimestampsNanos = new ArrayDeque<>();
    private volatile long lastAttackTimestampNanos = -1L;

    public void recordMove(Vector eyeLocation, Vector direction, long timestampNanos) {
        lastMove.set(new MoveSnapshot(eyeLocation, direction, timestampNanos));
    }

    public MoveSnapshot getLastMove() {
        return lastMove.get();
    }

    public void recordSwing(long timestampNanos) {
        lastSwingNanos.set(timestampNanos);
    }

    public Long getLastSwingNanos() {
        return lastSwingNanos.get();
    }

    public synchronized void recordAttack(long timestampNanos, int sampleSize) {
        lastAttackTimestampNanos = timestampNanos;
        recentAttackTimestampsNanos.addLast(timestampNanos);
        while (recentAttackTimestampsNanos.size() > Math.max(2, sampleSize)) {
            recentAttackTimestampsNanos.removeFirst();
        }
    }

    public synchronized long getLastAttackTimestampNanos() {
        return lastAttackTimestampNanos;
    }

    /**
     * 回傳最近幾次攻擊間隔(毫秒)的複本，供統計規律性使用。
     */
    public synchronized double[] recentIntervalsMillis() {
        if (recentAttackTimestampsNanos.size() < 2) {
            return new double[0];
        }
        Long[] arr = recentAttackTimestampsNanos.toArray(new Long[0]);
        double[] intervals = new double[arr.length - 1];
        for (int i = 1; i < arr.length; i++) {
            intervals[i - 1] = (arr[i] - arr[i - 1]) / 1_000_000.0;
        }
        return intervals;
    }

    /**
     * 依照經過時間做指數衰減後加分，回傳衰減+加分後的目前分數。
     */
    public double addViolationScore(double add, double decayPerSecond, long nowNanos) {
        double[] updated;
        double[] prev;
        do {
            prev = violation.get();
            double elapsedSeconds = Math.max(0.0, (nowNanos - (long) prev[1]) / 1_000_000_000.0);
            double decayed = Math.max(0.0, prev[0] - decayPerSecond * elapsedSeconds);
            double newScore = decayed + add;
            updated = new double[]{newScore, (double) nowNanos};
        } while (!violation.compareAndSet(prev, updated));
        return updated[0];
    }

    public double currentViolationScore(double decayPerSecond, long nowNanos) {
        double[] prev = violation.get();
        double elapsedSeconds = Math.max(0.0, (nowNanos - (long) prev[1]) / 1_000_000_000.0);
        return Math.max(0.0, prev[0] - decayPerSecond * elapsedSeconds);
    }

    public void resetViolationScore() {
        violation.set(new double[]{0.0, (double) System.nanoTime()});
    }
}
