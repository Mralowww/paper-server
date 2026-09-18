package dev.kitforge.trim;

import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.trim.TrimPattern;

import java.util.List;

/**
 * Re-checks trim materials whenever a kit is equipped, not just when it was
 * saved: downgrades each armor piece to the strongest material the player
 * currently qualifies for (keeping the pattern), or strips the trim
 * entirely if they hold none of the configured tiers.
 */
public final class TrimEnforcer {

    private TrimEnforcer() {
    }

    public static void downgradeUnauthorized(ItemStack[] items, Player player, TrimTierConfig config) {
        if (items == null || !config.isEnabled()) return;
        for (ItemStack item : items) {
            downgradeItem(item, player, config);
        }
    }

    private static void downgradeItem(ItemStack item, Player player, TrimTierConfig config) {
        if (item == null || !TrimApplier.isArmorPiece(item)) return;
        String currentMaterial = TrimApplier.currentMaterialKey(item);
        if (currentMaterial == null || config.canUse(player, currentMaterial)) return;

        List<String> unlocked = config.unlockedMaterials(player);
        if (unlocked.isEmpty()) {
            TrimApplier.clear(item);
            return;
        }
        TrimPattern pattern = TrimApplier.currentPattern(item);
        String strongestAllowed = unlocked.get(unlocked.size() - 1);
        if (pattern == null || !TrimApplier.apply(item, pattern, strongestAllowed)) {
            TrimApplier.clear(item);
        }
    }
}
