package dev.pvpattackguard.pvpattackguard;

import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.util.BoundingBox;
import org.bukkit.util.RayTraceResult;
import org.bukkit.util.Vector;

import java.util.ArrayList;
import java.util.List;

/**
 * 核心：跨封包因果鏈驗證。
 *
 * 一次真實的玩家攻擊，理論上會有三個互相關聯的訊號：
 *   1. 視角/位置封包 -> 攻擊前必須先把準星轉到目標身上
 *   2. 揮手動畫封包   -> 左鍵點擊時幾乎同時送出
 *   3. 攻擊封包       -> 只有這個封包觸發傷害，本身不帶距離/角度資訊
 *
 * 這裡不對單一訊號做硬性門檻判定，而是把每項檢測的結果當作「證據」餵進
 * 違規累積系統(PlayerState#addViolationScore)，只有持續、規律性地出現
 * 多重異常，才會累積到會被處置的門檻。單次延遲抖動不會造成誤判。
 */
public final class AttackValidationListener implements Listener {

    private final PvPAttackGuardPlugin plugin;

    public AttackValidationListener(PvPAttackGuardPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onAttack(EntityDamageByEntityEvent event) {
        if (event.getCause() != EntityDamageEvent.DamageCause.ENTITY_ATTACK) {
            return;
        }
        if (!(event.getDamager() instanceof Player attacker)) {
            return;
        }
        if (attacker.hasPermission("pvpattackguard.bypass")) {
            return;
        }

        long now = System.nanoTime();
        Long joinedAt = plugin.getJoinTimestamps().get(attacker.getUniqueId());
        long graceNanos = plugin.getConfig().getLong("join-grace-period-ms", 2000) * 1_000_000L;
        if (joinedAt != null && (now - joinedAt) < graceNanos) {
            return; // 剛加入的寬容期，避免視角資料還沒建立就被判定
        }

        PlayerState state = plugin.getPlayerStates().get(attacker.getUniqueId());
        BoundingBox targetBounds = event.getEntity().getBoundingBox();

        List<String> evidence = new ArrayList<>();
        double addedScore = 0.0;

        double rayTraceWeight = checkRayTrace(attacker, state, targetBounds, evidence);
        double aimRecencyWeight = checkAimRecency(state, now, evidence);
        double swingWeight = checkSwingCorrelation(state, now, evidence);
        double regularityWeight = checkAttackRegularity(attacker, state, evidence);

        addedScore = rayTraceWeight + aimRecencyWeight + swingWeight + regularityWeight;
        state.recordAttack(now, plugin.getConfig().getInt("checks.attack-regularity.sample-size", 10));

        double decayPerSecond = plugin.getConfig().getDouble("violation.decay-per-second", 0.15);
        double totalScore = addedScore > 0
                ? state.addViolationScore(addedScore, decayPerSecond, now)
                : state.currentViolationScore(decayPerSecond, now);

        if (addedScore <= 0.0) {
            return; // 這次攻擊完全沒有異常訊號，不用記錄
        }

        plugin.handleViolation(attacker, totalScore, addedScore, evidence);
    }

    private double checkRayTrace(Player attacker, PlayerState state, BoundingBox targetBounds, List<String> evidence) {
        if (!plugin.getConfig().getBoolean("checks.ray-trace.enabled", true)) {
            return 0.0;
        }
        PlayerState.MoveSnapshot move = state.getLastMove();
        if (move == null) {
            return 0.0;
        }
        double tolerance = plugin.getConfig().getDouble("checks.ray-trace.tolerance-blocks", 0.3);
        BoundingBox inflated = targetBounds.clone().expand(tolerance);
        double maxDistance = getEntityInteractionRange(attacker) + tolerance + 1.0;

        Vector direction = move.direction();
        if (direction.lengthSquared() < 1.0e-6) {
            return 0.0;
        }
        RayTraceResult result = inflated.rayTrace(move.eyeLocation(), direction, maxDistance);
        if (result != null) {
            return 0.0;
        }
        double weight = plugin.getConfig().getDouble("checks.ray-trace.weight", 3.0);
        evidence.add("ray-trace-miss(視角未真正對準目標)");
        return weight;
    }

    private double checkAimRecency(PlayerState state, long now, List<String> evidence) {
        if (!plugin.getConfig().getBoolean("checks.aim-recency.enabled", true)) {
            return 0.0;
        }
        PlayerState.MoveSnapshot move = state.getLastMove();
        if (move == null) {
            return 0.0;
        }
        long maxStalenessNanos = plugin.getConfig().getLong("checks.aim-recency.max-staleness-ms", 150) * 1_000_000L;
        long age = now - move.timestampNanos();
        if (age <= maxStalenessNanos) {
            return 0.0;
        }
        double weight = plugin.getConfig().getDouble("checks.aim-recency.weight", 2.0);
        evidence.add("aim-stale(" + (age / 1_000_000) + "ms 前的舊視角資料)");
        return weight;
    }

    private double checkSwingCorrelation(PlayerState state, long now, List<String> evidence) {
        if (!plugin.getConfig().getBoolean("checks.swing-correlation.enabled", true)) {
            return 0.0;
        }
        Long lastSwing = state.getLastSwingNanos();
        long maxOffsetNanos = plugin.getConfig().getLong("checks.swing-correlation.max-offset-ms", 250) * 1_000_000L;
        if (lastSwing != null && Math.abs(now - lastSwing) <= maxOffsetNanos) {
            return 0.0;
        }
        double weight = plugin.getConfig().getDouble("checks.swing-correlation.weight", 2.0);
        long offsetMs = lastSwing == null ? -1 : Math.abs(now - lastSwing) / 1_000_000;
        evidence.add("swing-missing(揮手動畫缺失或偏移 " + offsetMs + "ms)");
        return weight;
    }

    private double checkAttackRegularity(Player attacker, PlayerState state, List<String> evidence) {
        if (!plugin.getConfig().getBoolean("checks.attack-regularity.enabled", true)) {
            return 0.0;
        }
        double[] intervals = state.recentIntervalsMillis();
        int sampleSize = plugin.getConfig().getInt("checks.attack-regularity.sample-size", 10);
        if (intervals.length < Math.max(3, sampleSize - 1)) {
            return 0.0; // 樣本不足，不做統計判定，避免誤判
        }
        double mean = 0.0;
        for (double v : intervals) {
            mean += v;
        }
        mean /= intervals.length;
        double variance = 0.0;
        for (double v : intervals) {
            variance += (v - mean) * (v - mean);
        }
        variance /= intervals.length;
        double stddev = Math.sqrt(variance);

        float cooldown = attacker.getAttackCooldown();
        double fastCooldownThreshold = plugin.getConfig().getDouble("checks.attack-regularity.fast-cooldown-threshold", 0.3);
        double lowStddevThreshold = plugin.getConfig().getDouble("checks.attack-regularity.low-stddev-ms-threshold", 15.0);

        // 只有「持續無視冷卻」且「間隔異常規律(像機器而不是人)」同時成立才計分，
        // 避免把單純手速快、或正常攻速武器的玩家誤判。
        if (cooldown >= fastCooldownThreshold || stddev >= lowStddevThreshold) {
            return 0.0;
        }
        double weight = plugin.getConfig().getDouble("checks.attack-regularity.weight", 1.0);
        evidence.add("attack-regularity(間隔標準差僅 " + String.format("%.1f", stddev)
                + "ms，攻速充能僅 " + String.format("%.2f", cooldown) + ")");
        return weight;
    }

    private double getEntityInteractionRange(Player player) {
        var attribute = player.getAttribute(Attribute.ENTITY_INTERACTION_RANGE);
        if (attribute == null) {
            return 3.0;
        }
        return attribute.getValue();
    }
}
