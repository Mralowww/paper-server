package dev.advancedkit.advancedkit.kitroom;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.ItemStack;

import java.util.Map;

public class KitRoomListener implements Listener {

    @EventHandler
    public void onClick(InventoryClickEvent event) {
        if (!(event.getInventory().getHolder() instanceof KitRoomHolder holder)) {
            return;
        }
        event.setCancelled(true);

        if (!(event.getWhoClicked() instanceof Player player)) {
            return;
        }
        int slot = event.getRawSlot();
        if (slot < 0 || slot >= event.getInventory().getSize()) {
            return;
        }
        ItemStack clean = holder.getCleanItem(slot);
        if (clean == null) {
            return;
        }

        int amount = event.isShiftClick() ? clean.getType().getMaxStackSize() : clean.getAmount();
        ItemStack toGive = clean.clone();
        toGive.setAmount(amount);

        Map<Integer, ItemStack> leftover = player.getInventory().addItem(toGive);
        if (!leftover.isEmpty()) {
            for (ItemStack drop : leftover.values()) {
                player.getWorld().dropItemNaturally(player.getLocation(), drop);
            }
            player.sendMessage(Component.text("物品欄已滿，部分物品已掉落在腳下").color(NamedTextColor.YELLOW));
        }
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (event.getInventory().getHolder() instanceof KitRoomHolder) {
            event.setCancelled(true);
        }
    }
}
