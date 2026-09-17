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

import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Reads {@code trims.*} from config.yml: an ordered, worst-to-best ladder of
 * (permission, material) tiers. A player's highest owned tier unlocks every
 * weaker tier below it too, so rank permission plugins only need to grant one
 * node per rank rather than every node up to it.
 */
public class TrimTierConfig {

    private static TrimTierConfig instance;

    private final boolean enabled;
    private final List<TrimTier> tiers;

    public TrimTierConfig(Plugin plugin) {
        ConfigurationSection section = plugin.getConfig().getConfigurationSection("trims");
        this.enabled = section != null && section.getBoolean("enabled", true);
        this.tiers = new ArrayList<>();
        if (section != null) {
            List<?> raw = section.getList("tiers");
            if (raw != null) {
                for (Object o : raw) {
                    if (o instanceof ConfigurationSection cfgSection) {
                        addTier(cfgSection.getString("permission"), cfgSection.getString("material"));
                    } else if (o instanceof java.util.Map<?, ?> map) {
                        Object permission = map.get("permission");
                        Object material = map.get("material");
                        addTier(permission == null ? null : permission.toString(),
                                material == null ? null : material.toString());
                    }
                }
            }
        }
        instance = this;
    }

    private void addTier(String permission, String material) {
        if (permission == null || permission.isBlank() || material == null || material.isBlank()) {
            return;
        }
        tiers.add(new TrimTier(permission, material.toUpperCase(java.util.Locale.ROOT)));
    }

    public static TrimTierConfig get() {
        if (instance == null) {
            throw new IllegalStateException("TrimTierConfig has not been initialized yet!");
        }
        return instance;
    }

    public boolean isEnabled() {
        return enabled && !tiers.isEmpty();
    }

    /** Tiers in worst-to-best order, as configured. */
    public List<TrimTier> getTiers() {
        return tiers;
    }

    /**
     * The material keys this player may use, worst to best: every tier at or
     * below their highest owned permission. Empty if they hold none of the
     * configured permissions.
     */
    public List<String> unlockedMaterials(Player player) {
        int highestIndex = -1;
        for (int i = 0; i < tiers.size(); i++) {
            if (player.hasPermission(tiers.get(i).permission())) {
                highestIndex = i;
            }
        }
        List<String> unlocked = new ArrayList<>();
        for (int i = 0; i <= highestIndex; i++) {
            unlocked.add(tiers.get(i).materialKey());
        }
        return unlocked;
    }

    public boolean canUse(Player player, String materialKey) {
        return unlockedMaterials(player).contains(materialKey.toUpperCase(java.util.Locale.ROOT));
    }

    /**
     * Whether the player's highest owned tier is at or above the named rung
     * (e.g. {@code atLeastTier(player, "lt2")} for "lt2 or anything stronger").
     * Used to gate features unrelated to trim materials, such as renaming
     * items in the anvil editor, off the same rank ladder.
     */
    public boolean atLeastTier(Player player, String tierSuffix) {
        int requiredIndex = -1;
        for (int i = 0; i < tiers.size(); i++) {
            if (tiers.get(i).permission().endsWith("." + tierSuffix)) {
                requiredIndex = i;
                break;
            }
        }
        if (requiredIndex < 0) return false;

        int highestIndex = -1;
        for (int i = 0; i < tiers.size(); i++) {
            if (player.hasPermission(tiers.get(i).permission())) {
                highestIndex = i;
            }
        }
        return highestIndex >= requiredIndex;
    }
}
