package dev.kitforge.gui;

import dev.kitforge.KitForgePlugin;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** Admin edit mode: a real editable chest. Click the save button to persist the current layout. */
public class EditKitRoomGUI implements KitForgeMenu {

    private final KitForgePlugin plugin;
    private final int size;
    private final int saveSlot;

    public EditKitRoomGUI(KitForgePlugin plugin) {
        this.plugin = plugin;
        this.size = normalizeSize(plugin.getConfig().getInt("kitroom.size", 54));
        this.saveSlot = size - 1;
    }

    private int normalizeSize(int requested) {
        int rows = Math.max(1, Math.min(6, (int) Math.ceil(requested / 9.0)));
        return rows * 9;
    }

    public void open(Player player) {
        MenuHolder holder = new MenuHolder(this);
        String title = plugin.getConfig().getString("kitroom.title", "Kit 房間");
        Inventory inventory = Bukkit.createInventory(holder, size, ItemUtil.mm("<red>[編輯模式] </red>" + title));
        holder.setInventory(inventory);

        java.util.Map<Integer, ItemStack> stored = plugin.getStorage().loadKitRoom();
        for (var entry : stored.entrySet()) {
            if (entry.getKey() == saveSlot || entry.getKey() >= size) continue;
            inventory.setItem(entry.getKey(), entry.getValue());
        }

        inventory.setItem(saveSlot, ItemUtil.item(Material.EMERALD_BLOCK, 1,
                "<green><bold>儲存並套用</bold></green>",
                "<gray>點擊將目前排列的物品儲存成 Kit 房間內容</gray>",
                "<dark_gray>此格本身不會被儲存</dark_gray>"));

        player.openInventory(inventory);
    }

    @Override
    public void onClick(InventoryClickEvent event) {
        if (event.getRawSlot() != saveSlot) return; // everything else edits freely
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;

        Inventory inventory = event.getInventory();
        plugin.getStorage().clearKitRoom();
        for (int i = 0; i < size; i++) {
            if (i == saveSlot) continue;
            ItemStack item = inventory.getItem(i);
            if (item == null || item.getType() == Material.AIR) continue;
            plugin.getStorage().saveKitRoom(i, item.clone());
        }

        player.sendMessage(ItemUtil.mm("<green>已儲存 Kit 房間內容！</green>"));
        player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
        player.closeInventory();
    }
}
