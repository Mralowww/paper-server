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
package dev.noah.perplayerkit.anvil;

import dev.noah.perplayerkit.util.StyleManager;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Pure item-editing helpers for the anvil/enchant editor: add/remove a level
 * at a time, capped at the enchantment's own vanilla max level, refusing
 * anything {@link Enchantment#conflictsWith(Enchantment)} would reject (e.g.
 * Fortune and Silk Touch on the same pickaxe).
 */
public final class EnchantEditor {

    private EnchantEditor() {
    }

    /** Enchantments that make sense to offer for this item, sorted by display name. */
    public static List<Enchantment> applicableEnchants(ItemStack item) {
        List<Enchantment> list = new ArrayList<>();
        for (Enchantment enchantment : Enchantment.values()) {
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

    /** The first currently-applied enchant that would conflict, or null if none. */
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

    public enum AddResult {ADDED, MAX_LEVEL, CONFLICT}

    /** Raises the enchant by one level (starting a fresh one at level 1), refusing conflicts and the vanilla level cap. */
    public static AddResult increaseLevel(ItemStack item, Enchantment enchantment) {
        int current = currentLevel(item, enchantment);
        if (current >= enchantment.getMaxLevel()) {
            return AddResult.MAX_LEVEL;
        }
        if (current == 0) {
            Enchantment conflict = findConflict(item, enchantment);
            if (conflict != null) {
                return AddResult.CONFLICT;
            }
        }
        ItemMeta meta = item.getItemMeta();
        meta.addEnchant(enchantment, current + 1, true);
        item.setItemMeta(meta);
        return AddResult.ADDED;
    }

    public static void removeEnchant(ItemStack item, Enchantment enchantment) {
        ItemMeta meta = item.getItemMeta();
        if (meta == null) return;
        meta.removeEnchant(enchantment);
        item.setItemMeta(meta);
    }

    public static boolean repair(ItemStack item) {
        ItemMeta meta = item.getItemMeta();
        if (!(meta instanceof Damageable damageable) || damageable.getDamage() <= 0) {
            return false;
        }
        damageable.setDamage(0);
        item.setItemMeta(meta);
        return true;
    }

    /** Renames using the same MiniMessage/legacy formatting the rest of the plugin's items use. "" or null clears the custom name. */
    public static void rename(ItemStack item, String rawName) {
        ItemMeta meta = item.getItemMeta();
        if (meta == null) return;
        if (rawName == null || rawName.isBlank()) {
            meta.setDisplayName(null);
        } else {
            meta.setDisplayName(StyleManager.convertMiniMessage(rawName));
        }
        item.setItemMeta(meta);
    }
}
