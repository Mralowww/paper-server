package dev.advancedkit.advancedkit.kitroom;

import org.bukkit.inventory.ItemStack;

public class KitRoomItem {

    private final int slot;
    private final ItemStack item;

    public KitRoomItem(int slot, ItemStack item) {
        this.slot = slot;
        this.item = item;
    }

    public int getSlot() {
        return slot;
    }

    public ItemStack getItem() {
        return item.clone();
    }
}
