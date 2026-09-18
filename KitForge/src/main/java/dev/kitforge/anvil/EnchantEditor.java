package dev.kitforge.anvil;

import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.List;

/**
 * Pure item-editing helpers for the anvil editor: level up/down one step at a
 * time or jump to max, capped at the enchantment's own vanilla max level,
 * refusing anything {@link Enchantment#conflictsWith(Enchantment)} would
 * reject (e.g. Fortune and Silk Touch on the same pickaxe).
 */
public final class EnchantEditor {

    private EnchantEditor() {
    }

    public enum Result {ADDED, MAX_LEVEL, CONFLICT}

    public static List<Enchantment> applicableEnchants(ItemStack item) {
        List<Enchantment> list = new ArrayList<>();
        for (Enchantment enchantment : org.bukkit.Registry.ENCHANTMENT) {
            if (enchantment.canEnchantItem(item)) {
                list.add(enchantment);
            }
        }
        list.sort((a, b) -> a.getKey().getKey().compareToIgnoreCase(b.getKey().getKey()));
        return list;
    }

    public static int currentLevel(ItemStack item, Enchantment enchantment) {
        ItemMeta meta = item.getItemMeta();
        return meta == null ? 0 : meta.getEnchantLevel(enchantment);
    }

    public static Enchantment findConflict(ItemStack item, Enchantment candidate) {
        ItemMeta meta = item.getItemMeta();
        if (meta == null) return null;
        for (Enchantment existing : meta.getEnchants().keySet()) {
            if (!existing.equals(candidate) && existing.conflictsWith(candidate)) {
                return existing;
            }
        }
        return null;
    }

    public static Result increaseLevel(ItemStack item, Enchantment enchantment) {
        int current = currentLevel(item, enchantment);
        if (current >= enchantment.getMaxLevel()) return Result.MAX_LEVEL;
        if (current == 0 && findConflict(item, enchantment) != null) return Result.CONFLICT;
        ItemMeta meta = item.getItemMeta();
        meta.addEnchant(enchantment, current + 1, true);
        item.setItemMeta(meta);
        return Result.ADDED;
    }

    public static void decreaseLevel(ItemStack item, Enchantment enchantment) {
        int current = currentLevel(item, enchantment);
        if (current <= 0) return;
        if (current == 1) {
            removeEnchant(item, enchantment);
            return;
        }
        ItemMeta meta = item.getItemMeta();
        meta.addEnchant(enchantment, current - 1, true);
        item.setItemMeta(meta);
    }

    public static Result setMaxLevel(ItemStack item, Enchantment enchantment) {
        if (currentLevel(item, enchantment) == 0 && findConflict(item, enchantment) != null) return Result.CONFLICT;
        ItemMeta meta = item.getItemMeta();
        meta.addEnchant(enchantment, enchantment.getMaxLevel(), true);
        item.setItemMeta(meta);
        return Result.ADDED;
    }

    public static void removeEnchant(ItemStack item, Enchantment enchantment) {
        ItemMeta meta = item.getItemMeta();
        if (meta == null) return;
        meta.removeEnchant(enchantment);
        item.setItemMeta(meta);
    }

    public static boolean repair(ItemStack item) {
        ItemMeta meta = item.getItemMeta();
        if (!(meta instanceof Damageable damageable) || damageable.getDamage() <= 0) return false;
        damageable.setDamage(0);
        item.setItemMeta(meta);
        return true;
    }

    public static void rename(ItemStack item, net.kyori.adventure.text.Component name) {
        ItemMeta meta = item.getItemMeta();
        if (meta == null) return;
        meta.displayName(name);
        item.setItemMeta(meta);
    }
}
