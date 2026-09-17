package dev.advancedkit.advancedkit.kitroom;

import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.jetbrains.annotations.NotNull;

public class KitRoomHolder implements InventoryHolder {

    private Inventory inventory;

    @NotNull
    @Override
    public Inventory getInventory() {
        return inventory;
    }

    public void setInventory(Inventory inventory) {
        this.inventory = inventory;
    }
}
