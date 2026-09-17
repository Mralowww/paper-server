package dev.advancedkit.advancedkit.kitroom;

import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.jetbrains.annotations.NotNull;

public class EditKitRoomHolder implements InventoryHolder {

    private Inventory inventory;
    private final int saveButtonSlot;

    public EditKitRoomHolder(int saveButtonSlot) {
        this.saveButtonSlot = saveButtonSlot;
    }

    public int getSaveButtonSlot() {
        return saveButtonSlot;
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
