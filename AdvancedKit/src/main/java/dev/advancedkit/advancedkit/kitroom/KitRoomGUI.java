package dev.advancedkit.advancedkit.kitroom;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.List;

public class KitRoomGUI {

    private final KitRoomManager manager;

    public KitRoomGUI(KitRoomManager manager) {
        this.manager = manager;
    }

    public Inventory build(Player player) {
        KitRoomHolder holder = new KitRoomHolder();
        Component title = LegacyComponentSerializer.legacyAmpersand().deserialize(manager.getTitle());
        Inventory inventory = player.getServer().createInventory(holder, manager.getSize(), title);
        holder.setInventory(inventory);

        for (KitRoomItem roomItem : manager.getItems()) {
            ItemStack clean = roomItem.getItem();
            holder.bind(roomItem.getSlot(), clean);

            ItemStack display = clean.clone();
            ItemMeta meta = display.getItemMeta();
            List<Component> lore = new ArrayList<>();
            if (meta.hasLore() && meta.lore() != null) {
                lore.addAll(meta.lore());
            }
            lore.add(Component.text("左鍵拿取 " + clean.getAmount() + " 個 | Shift+左鍵拿取一組")
                    .color(NamedTextColor.DARK_GRAY).decoration(TextDecoration.ITALIC, false));
            meta.lore(lore);
            display.setItemMeta(meta);

            inventory.setItem(roomItem.getSlot(), display);
        }

        return inventory;
    }
}
