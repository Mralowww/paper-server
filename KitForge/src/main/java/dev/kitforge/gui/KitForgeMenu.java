package dev.kitforge.gui;

import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;

/** A screen owned by KitForge. The central GuiListener dispatches events to whichever menu the clicked inventory belongs to. */
public interface KitForgeMenu {

    void onClick(InventoryClickEvent event);

    default void onDrag(InventoryDragEvent event) {
    }

    default void onClose(InventoryCloseEvent event) {
    }
}
