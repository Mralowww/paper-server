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

import org.bukkit.inventory.ItemStack;

/** In-progress anvil edit: which kit slot and which of its 41 item indexes, plus the working copy being edited. */
public class EnchantSession {

    private final int kitSlot;
    private final int itemIndex;
    private ItemStack item;

    public EnchantSession(int kitSlot, int itemIndex, ItemStack item) {
        this.kitSlot = kitSlot;
        this.itemIndex = itemIndex;
        this.item = item;
    }

    public int getKitSlot() {
        return kitSlot;
    }

    public int getItemIndex() {
        return itemIndex;
    }

    public ItemStack getItem() {
        return item;
    }

    public void setItem(ItemStack item) {
        this.item = item;
    }
}
