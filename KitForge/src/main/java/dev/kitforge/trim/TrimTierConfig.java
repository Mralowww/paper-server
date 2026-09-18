package dev.kitforge.trim;

import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Ordered, worst-to-best ladder of (permission, trim-material) tiers read
 * from config.yml. A player's highest owned tier unlocks every weaker tier
 * below it too. kitforge.trims.admin bypasses the ladder entirely.
 */
public class TrimTierConfig {

    public static final String ADMIN_PERMISSION = "kitforge.trims.admin";

    public record Tier(String permission, String materialKey) {
    }

    private final boolean enabled;
    private final List<Tier> tiers = new ArrayList<>();

    public TrimTierConfig(Plugin plugin) {
        ConfigurationSection section = plugin.getConfig().getConfigurationSection("trims");
        this.enabled = section != null && section.getBoolean("enabled", true);
        if (section != null) {
            List<?> raw = section.getList("tiers");
            if (raw != null) {
                for (Object o : raw) {
                    if (o instanceof ConfigurationSection cfg) {
                        add(cfg.getString("permission"), cfg.getString("material"));
                    } else if (o instanceof java.util.Map<?, ?> map) {
                        Object permission = map.get("permission");
                        Object material = map.get("material");
                        add(permission == null ? null : permission.toString(), material == null ? null : material.toString());
                    }
                }
            }
        }
    }

    private void add(String permission, String material) {
        if (permission == null || permission.isBlank() || material == null || material.isBlank()) return;
        tiers.add(new Tier(permission, material.toUpperCase(Locale.ROOT)));
    }

    public boolean isEnabled() {
        return enabled && !tiers.isEmpty();
    }

    public List<Tier> getTiers() {
        return tiers;
    }

    public List<String> unlockedMaterials(Player player) {
        if (player.hasPermission(ADMIN_PERMISSION)) {
            return tiers.stream().map(Tier::materialKey).toList();
        }
        int highestIndex = -1;
        for (int i = 0; i < tiers.size(); i++) {
            if (player.hasPermission(tiers.get(i).permission())) highestIndex = i;
        }
        List<String> unlocked = new ArrayList<>();
        for (int i = 0; i <= highestIndex; i++) unlocked.add(tiers.get(i).materialKey());
        return unlocked;
    }

    public boolean canUse(Player player, String materialKey) {
        return unlockedMaterials(player).contains(materialKey.toUpperCase(Locale.ROOT));
    }

    /** Whether the player's highest owned tier is at or above the named rung (e.g. "lt2" = lt2 or anything stronger). */
    public boolean atLeastTier(Player player, String tierSuffix) {
        if (player.hasPermission(ADMIN_PERMISSION)) return true;
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
            if (player.hasPermission(tiers.get(i).permission())) highestIndex = i;
        }
        return highestIndex >= requiredIndex;
    }
}
