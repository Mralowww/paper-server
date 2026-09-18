package dev.opopjjjidj.totemcounter;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerQuitEvent;

public class TotemGuiListener implements Listener {

    private final ActionBarManager actionBarManager;

    public TotemGuiListener(ActionBarManager actionBarManager) {
        this.actionBarManager = actionBarManager;
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        actionBarManager.disable(event.getPlayer().getUniqueId());
    }

    @EventHandler
    public void onClick(InventoryClickEvent event) {
        if (event.getInventory().getHolder() instanceof TotemGuiHolder) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (event.getInventory().getHolder() instanceof TotemGuiHolder) {
            event.setCancelled(true);
        }
    }
}
