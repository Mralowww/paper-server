package dev.advancedkit.advancedkit.gui;

import dev.advancedkit.advancedkit.model.Kit;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.jetbrains.annotations.NotNull;

import java.util.HashMap;
import java.util.Map;

public class KitMenuHolder implements InventoryHolder {

    private final Map<Integer, Kit> slotToKit = new HashMap<>();
    private Inventory inventory;

    public void bind(int slot, Kit kit) {
        slotToKit.put(slot, kit);
    }

    public Kit getKitAt(int slot) {
        return slotToKit.get(slot);
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
