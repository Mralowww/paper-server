package dev.kitforge.trim;

import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.trim.TrimPattern;

/** In-progress trim edit for one armor piece, opened directly from shift-right-click. */
public class TrimSession {

    public enum Piece {
        HELMET(39), CHESTPLATE(38), LEGGINGS(37), BOOTS(36);

        public final int kitSlotIndex;

        Piece(int kitSlotIndex) {
            this.kitSlotIndex = kitSlotIndex;
        }

        public static Piece fromKitSlotIndex(int index) {
            for (Piece piece : values()) {
                if (piece.kitSlotIndex == index) return piece;
            }
            return null;
        }
    }

    private final int kitSlot;
    private final Piece piece;
    private ItemStack item;
    private TrimPattern pattern;

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

    public TrimPattern getPattern() {
        return pattern;
    }

    public void setPattern(TrimPattern pattern) {
        this.pattern = pattern;
    }
}
