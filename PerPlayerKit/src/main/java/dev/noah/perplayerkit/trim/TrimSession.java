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
 * Holds the state of an in-progress trim edit between the piece/pattern/material
 * steps of the GUI: which kit slot to write back to, the armor snapshot taken
 * the moment the player opened the editor, which piece they picked, and the
 * pattern once chosen. Kept per-player in {@link TrimGUI}.
 */
public class TrimSession {

    public enum Piece {
        HELMET(39), CHESTPLATE(38), LEGGINGS(37), BOOTS(36);

        public final int kitSlotIndex;

        Piece(int kitSlotIndex) {
            this.kitSlotIndex = kitSlotIndex;
        }
    }

    private final int kitSlot;
    private final ItemStack[] armorSnapshot;
    private Piece piece;
    private String patternKey;

    public TrimSession(int kitSlot, ItemStack[] armorSnapshot) {
        this.kitSlot = kitSlot;
        this.armorSnapshot = armorSnapshot;
    }

    public int getKitSlot() {
        return kitSlot;
    }

    public ItemStack getArmorItem(Piece piece) {
        ItemStack item = armorSnapshot[piece.ordinal()];
        return item == null ? null : item.clone();
    }

    public void setArmorItem(Piece piece, ItemStack item) {
        armorSnapshot[piece.ordinal()] = item;
    }

    public Piece getPiece() {
        return piece;
    }

    public void setPiece(Piece piece) {
        this.piece = piece;
    }

    public String getPatternKey() {
        return patternKey;
    }

    public void setPatternKey(String patternKey) {
        this.patternKey = patternKey;
    }
}
