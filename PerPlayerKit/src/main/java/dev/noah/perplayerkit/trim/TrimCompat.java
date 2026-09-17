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

import org.bukkit.NamespacedKey;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Locale;

/**
 * Armor trims (ArmorMeta#setTrim, TrimPattern, TrimMaterial) only exist on
 * Bukkit 1.20+. This plugin still compiles against the 1.19 API, so those
 * types are reached entirely through reflection here, kept out of every
 * other class. {@link #isSupported()} is false on older servers and the
 * trim button/menus stay hidden instead of throwing.
 */
public final class TrimCompat {

    private static final boolean SUPPORTED;
    private static Class<?> armorMetaClass;
    private static Object trimPatternRegistry;
    private static Object trimMaterialRegistry;
    private static Method registryGet;
    private static Constructor<?> armorTrimConstructor;
    private static Method setTrimMethod;

    static {
        boolean ok;
        try {
            armorMetaClass = Class.forName("org.bukkit.inventory.meta.ArmorMeta");
            Class<?> trimPatternClass = Class.forName("org.bukkit.inventory.meta.trim.TrimPattern");
            Class<?> trimMaterialClass = Class.forName("org.bukkit.inventory.meta.trim.TrimMaterial");
            Class<?> armorTrimClass = Class.forName("org.bukkit.inventory.meta.trim.ArmorTrim");
            Class<?> registryClass = Class.forName("org.bukkit.Registry");

            Field trimPatternField = registryClass.getField("TRIM_PATTERN");
            Field trimMaterialField = registryClass.getField("TRIM_MATERIAL");
            trimPatternRegistry = trimPatternField.get(null);
            trimMaterialRegistry = trimMaterialField.get(null);
            registryGet = registryClass.getMethod("get", NamespacedKey.class);
            armorTrimConstructor = armorTrimClass.getConstructor(trimMaterialClass, trimPatternClass);
            setTrimMethod = armorMetaClass.getMethod("setTrim", armorTrimClass);
            ok = true;
        } catch (ReflectiveOperationException e) {
            ok = false;
        }
        SUPPORTED = ok;
    }

    private TrimCompat() {
    }

    /** False on any server older than 1.20, where the trim registries don't exist. */
    public static boolean isSupported() {
        return SUPPORTED;
    }

    public static boolean isArmorPiece(ItemStack item) {
        if (!SUPPORTED || item == null) return false;
        ItemMeta meta = item.getItemMeta();
        return armorMetaClass.isInstance(meta);
    }

    /** Applies the trim in place and writes the updated meta back onto {@code armor}. False if unsupported or unknown keys. */
    public static boolean apply(ItemStack armor, String patternKey, String materialKey) {
        if (!SUPPORTED || armor == null) return false;
        try {
            ItemMeta meta = armor.getItemMeta();
            if (!armorMetaClass.isInstance(meta)) return false;

            Object pattern = registryGet.invoke(trimPatternRegistry, NamespacedKey.minecraft(patternKey.toLowerCase(Locale.ROOT)));
            Object material = registryGet.invoke(trimMaterialRegistry, NamespacedKey.minecraft(materialKey.toLowerCase(Locale.ROOT)));
            if (pattern == null || material == null) return false;

            Object armorTrim = armorTrimConstructor.newInstance(material, pattern);
            setTrimMethod.invoke(meta, armorTrim);
            armor.setItemMeta(meta);
            return true;
        } catch (ReflectiveOperationException e) {
            return false;
        }
    }
}
