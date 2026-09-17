package dev.advancedkit.advancedkit.kitroom;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.List;

public class EditKitRoomGUI {

    private final KitRoomManager manager;

    public EditKitRoomGUI(KitRoomManager manager) {
        this.manager = manager;
    }

    public Inventory build(Player player) {
        int size = manager.getSize();
        int saveButtonSlot = size - 1;
        EditKitRoomHolder holder = new EditKitRoomHolder(saveButtonSlot);

        Component title = LegacyComponentSerializer.legacyAmpersand()
                .deserialize("&c[編輯模式] ").append(LegacyComponentSerializer.legacyAmpersand().deserialize(manager.getTitle()));
        Inventory inventory = player.getServer().createInventory(holder, size, title);
        holder.setInventory(inventory);

        for (KitRoomItem roomItem : manager.getItems()) {
            if (roomItem.getSlot() == saveButtonSlot) {
                continue;
            }
            inventory.setItem(roomItem.getSlot(), roomItem.getItem());
        }

        ItemStack saveButton = new ItemStack(Material.EMERALD_BLOCK);
        ItemMeta meta = saveButton.getItemMeta();
        meta.displayName(Component.text("儲存並套用").color(NamedTextColor.GREEN)
                .decoration(TextDecoration.ITALIC, false));
        meta.lore(List.of(
                Component.text("點擊將目前排列的物品儲存成 Kit 房間內容").color(NamedTextColor.GRAY)
                        .decoration(TextDecoration.ITALIC, false),
                Component.text("此格本身不會被儲存").color(NamedTextColor.DARK_GRAY)
                        .decoration(TextDecoration.ITALIC, false)
        ));
        saveButton.setItemMeta(meta);
        inventory.setItem(saveButtonSlot, saveButton);

        return inventory;
    }
}
