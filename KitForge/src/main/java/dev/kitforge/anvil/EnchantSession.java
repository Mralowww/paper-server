package dev.kitforge.anvil;

import org.bukkit.inventory.ItemStack;

/** In-progress anvil edit: which kit slot and item index to write back to, and the working copy being edited. */
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
