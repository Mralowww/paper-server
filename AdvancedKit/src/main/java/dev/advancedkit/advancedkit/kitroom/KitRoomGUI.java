package dev.advancedkit.advancedkit.kitroom;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

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
            ItemStack stack = new ItemStack(roomItem.getMaterial(), Math.min(roomItem.getAmount(), roomItem.getMaterial().getMaxStackSize()));
            ItemMeta meta = stack.getItemMeta();
            meta.displayName(LegacyComponentSerializer.legacyAmpersand().deserialize(roomItem.getDisplayName())
                    .decoration(TextDecoration.ITALIC, false));
            if (roomItem.getCustomModelData() > 0) {
                meta.setCustomModelData(roomItem.getCustomModelData());
            }
            List<Component> lore = roomItem.getLore().stream()
                    .map(line -> LegacyComponentSerializer.legacyAmpersand().deserialize(line)
                            .decoration(TextDecoration.ITALIC, false))
                    .collect(java.util.stream.Collectors.toList());
            lore.add(Component.text("左鍵拿取 " + roomItem.getAmount() + " 個 | Shift+左鍵拿取一組")
                    .color(NamedTextColor.DARK_GRAY).decoration(TextDecoration.ITALIC, false));
            meta.lore(lore);
            stack.setItemMeta(meta);
            inventory.setItem(roomItem.getSlot(), stack);
        }

        return inventory;
    }
}
