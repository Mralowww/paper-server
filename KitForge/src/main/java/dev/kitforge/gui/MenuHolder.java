package dev.kitforge.gui;

import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.jetbrains.annotations.NotNull;

public class MenuHolder implements InventoryHolder {

    private final KitForgeMenu menu;
    private Inventory inventory;

    public MenuHolder(KitForgeMenu menu) {
        this.menu = menu;
    }

    public KitForgeMenu getMenu() {
        return menu;
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
