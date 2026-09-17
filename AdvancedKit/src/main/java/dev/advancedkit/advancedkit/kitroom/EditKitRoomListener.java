package dev.advancedkit.advancedkit.kitroom;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;

public class EditKitRoomListener implements Listener {

    private final KitRoomManager manager;

    public EditKitRoomListener(KitRoomManager manager) {
        this.manager = manager;
    }

    @EventHandler
    public void onClick(InventoryClickEvent event) {
        if (!(event.getInventory().getHolder() instanceof EditKitRoomHolder holder)) {
            return;
        }
        int saveSlot = holder.getSaveButtonSlot();

        boolean touchesSaveButton = event.getRawSlot() == saveSlot;
        if (touchesSaveButton) {
            event.setCancelled(true);
        }

        if (!(event.getWhoClicked() instanceof Player player)) {
            return;
        }

        if (touchesSaveButton) {
            manager.saveFromInventory(event.getInventory(), saveSlot);
            player.sendMessage(Component.text("已儲存 Kit 房間內容！所有玩家看到的展示櫃已更新").color(NamedTextColor.GREEN));
            player.closeInventory();
        }
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (!(event.getInventory().getHolder() instanceof EditKitRoomHolder holder)) {
            return;
        }
        if (event.getRawSlots().contains(holder.getSaveButtonSlot())) {
            event.setCancelled(true);
        }
    }
}
