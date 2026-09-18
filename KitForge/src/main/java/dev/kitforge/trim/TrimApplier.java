package dev.kitforge.trim;

import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ArmorMeta;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.trim.ArmorTrim;
import org.bukkit.inventory.meta.trim.TrimMaterial;
import org.bukkit.inventory.meta.trim.TrimPattern;

import java.util.Locale;

/** Applies/reads/clears armor trims directly through the real 1.21 API. */
public final class TrimApplier {

    private TrimApplier() {
    }

    public static boolean isArmorPiece(ItemStack item) {
        return item != null && item.getItemMeta() instanceof ArmorMeta;
    }

    public static TrimMaterial materialByKey(String key) {
        return Registry.TRIM_MATERIAL.get(NamespacedKey.minecraft(key.toLowerCase(Locale.ROOT)));
    }

    public static boolean apply(ItemStack item, TrimPattern pattern, String materialKey) {
        if (item == null || pattern == null) return false;
        ItemMeta meta = item.getItemMeta();
        if (!(meta instanceof ArmorMeta armorMeta)) return false;
        TrimMaterial material = materialByKey(materialKey);
        if (material == null) return false;
        armorMeta.setTrim(new ArmorTrim(material, pattern));
        item.setItemMeta(armorMeta);
        return true;
    }

    public static String currentMaterialKey(ItemStack item) {
        if (item == null || !(item.getItemMeta() instanceof ArmorMeta armorMeta)) return null;
        ArmorTrim trim = armorMeta.getTrim();
        return trim == null ? null : trim.getMaterial().getKey().getKey().toUpperCase(Locale.ROOT);
    }

    public static TrimPattern currentPattern(ItemStack item) {
        if (item == null || !(item.getItemMeta() instanceof ArmorMeta armorMeta)) return null;
        ArmorTrim trim = armorMeta.getTrim();
        return trim == null ? null : trim.getPattern();
    }

    public static void clear(ItemStack item) {
        if (item == null || !(item.getItemMeta() instanceof ArmorMeta armorMeta)) return;
        armorMeta.setTrim(null);
        item.setItemMeta(armorMeta);
    }
}
