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
package dev.noah.perplayerkit.gui;

import org.bukkit.entity.Player;
import org.bukkit.inventory.InventoryView;
import org.bukkit.inventory.meta.ItemMeta;

import java.lang.reflect.Method;

/**
 * Reflection access to inventory API added after the 1.19 API this plugin
 * compiles against: InventoryView#setTitle (1.20+) and
 * ItemMeta#setHideTooltip (1.20.5+). Both degrade gracefully on old servers.
 */
final class GuiCompat {

    private static final Method SET_TITLE = findMethod(InventoryView.class, "setTitle", String.class);
    private static final Method SET_HIDE_TOOLTIP = findMethod(ItemMeta.class, "setHideTooltip", boolean.class);

    private GuiCompat() {
    }

    private static Method findMethod(Class<?> owner, String name, Class<?>... params) {
        try {
            return owner.getMethod(name, params);
        } catch (NoSuchMethodException e) {
            return null;
        }
    }

    /**
     * Whether the title of an already-open inventory can be updated in place.
     * When false, menus must reopen so titles stay correct, at the cost of the
     * client recentering the mouse cursor.
     */
    static boolean supportsTitleUpdate() {
        return SET_TITLE != null;
    }

    static void updateTitle(Player player, String title) {
        if (SET_TITLE == null || title == null) {
            return;
        }
        InventoryView view = player.getOpenInventory();
        if (title.equals(view.getTitle())) {
            return;
        }
        try {
            SET_TITLE.invoke(view, title);
        } catch (ReflectiveOperationException ignored) {
        }
    }

    /** Hides the item's tooltip entirely. Returns false on pre-1.20.5 servers. */
    static boolean hideTooltip(ItemMeta meta) {
        if (SET_HIDE_TOOLTIP == null) {
            return false;
        }
        try {
            SET_HIDE_TOOLTIP.invoke(meta, true);
            return true;
        } catch (ReflectiveOperationException e) {
            return false;
        }
    }
}
