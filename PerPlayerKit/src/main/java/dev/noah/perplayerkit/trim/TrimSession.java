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

import org.bukkit.inventory.ItemStack;

/**
 * In-progress trim edit, opened directly from a shift-right-click on an
 * armor piece in the kit editor: which kit slot and item index to write
 * back to, the piece it corresponds to, the item itself, and the pattern
 * once chosen.
 */
public class TrimSession {

    public enum Piece {
        HELMET(39), CHESTPLATE(38), LEGGINGS(37), BOOTS(36);

        public final int kitSlotIndex;

        Piece(int kitSlotIndex) {
            this.kitSlotIndex = kitSlotIndex;
        }

        /** The piece whose kit slot matches, or null if this index isn't one of the four armor slots. */
        public static Piece fromKitSlotIndex(int kitSlotIndex) {
            for (Piece piece : values()) {
                if (piece.kitSlotIndex == kitSlotIndex) {
                    return piece;
                }
            }
            return null;
        }
    }

    private final int kitSlot;
    private final Piece piece;
    private ItemStack item;
    private String patternKey;

    public TrimSession(int kitSlot, Piece piece, ItemStack item) {
        this.kitSlot = kitSlot;
        this.piece = piece;
        this.item = item;
    }

    public int getKitSlot() {
        return kitSlot;
    }

    public Piece getPiece() {
        return piece;
    }

    public ItemStack getItem() {
        return item;
    }

    public void setItem(ItemStack item) {
        this.item = item;
    }

    public String getPatternKey() {
        return patternKey;
    }

    public void setPatternKey(String patternKey) {
        this.patternKey = patternKey;
    }
}
