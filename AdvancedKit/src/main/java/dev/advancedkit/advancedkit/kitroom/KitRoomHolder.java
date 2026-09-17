package dev.advancedkit.advancedkit.kitroom;

import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.jetbrains.annotations.NotNull;

import java.util.HashMap;
import java.util.Map;

public class KitRoomHolder implements InventoryHolder {

    private final Map<Integer, ItemStack> cleanItems = new HashMap<>();
    private Inventory inventory;

    public void bind(int slot, ItemStack cleanItem) {
        cleanItems.put(slot, cleanItem);
    }

    public ItemStack getCleanItem(int slot) {
        ItemStack item = cleanItems.get(slot);
        return item == null ? null : item.clone();
    }

    @NotNull
    @Override
    public Inventory getInventory() {
        return inventory;
    }

    public void setInventory(Inventory inventory) {
        this.inventory = inventory;
    }
}
