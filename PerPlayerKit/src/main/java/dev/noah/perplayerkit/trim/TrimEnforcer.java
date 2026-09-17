/*
 * Copyright 2022-2026 Noah Ross
 *
 * This file is part of PerPlayerKit.
 *
 * PerPlayerKit is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * PerPlayerKit is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for
 * more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with PerPlayerKit. If not, see <https://www.gnu.org/licenses/>.
 */
package dev.noah.perplayerkit.trim;

import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.List;

/**
 * Re-checks trim materials whenever a kit is actually equipped, not just when
 * it was saved. A player's rank can drop after they saved a kit with a
 * material their tier no longer covers (permission revoked, plugin
 * reconfigured, etc); loading that kit should never hand them a material
 * they are not currently allowed to use. Each armor piece is downgraded to
 * the strongest material the player still qualifies for, keeping the pattern
 * they chose, or has its trim removed entirely if they hold none of the
 * configured tiers.
 */
public final class TrimEnforcer {

    private TrimEnforcer() {
    }

    /** Downgrades in place and returns the same array for call-site convenience. */
    public static ItemStack[] downgradeUnauthorized(ItemStack[] items, Player player) {
        if (items == null || !TrimCompat.isSupported() || !TrimTierConfig.get().isEnabled()) {
            return items;
        }
        for (int i = 0; i < items.length; i++) {
            items[i] = downgradeItem(items[i], player);
        }
        return items;
    }

    private static ItemStack downgradeItem(ItemStack item, Player player) {
        if (item == null || !TrimCompat.isArmorPiece(item)) {
            return item;
        }
        String currentMaterial = TrimCompat.getTrimMaterialKey(item);
        if (currentMaterial == null) {
            return item; // no trim applied, nothing to check
        }
        if (TrimTierConfig.get().canUse(player, currentMaterial)) {
            return item; // still within their current permissions
        }

        List<String> unlocked = TrimTierConfig.get().unlockedMaterials(player);
        if (unlocked.isEmpty()) {
            TrimCompat.removeTrim(item);
            return item;
        }
        String strongestAllowed = unlocked.get(unlocked.size() - 1);
        String patternKey = TrimCompat.getTrimPatternKey(item);
        if (patternKey == null || !TrimCompat.apply(item, patternKey, strongestAllowed)) {
            TrimCompat.removeTrim(item);
        }
        return item;
    }
}
