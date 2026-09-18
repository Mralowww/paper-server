package dev.kitforge.gui;

import dev.kitforge.KitForgePlugin;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.HashMap;
import java.util.Map;

/** View-mode kit room: click an item to take a copy, infinite supply. */
public class KitRoomGUI implements KitForgeMenu {

    private final KitForgePlugin plugin;
    private final boolean fromMainMenu;
    private final Map<Integer, ItemStack> cleanItems = new HashMap<>();
    private final int size;

    public KitRoomGUI(KitForgePlugin plugin, boolean fromMainMenu) {
        this.plugin = plugin;
        this.fromMainMenu = fromMainMenu;
        this.size = normalizeSize(plugin.getConfig().getInt("kitroom.size", 54));
    }

    private int normalizeSize(int requested) {
        int rows = Math.max(1, Math.min(6, (int) Math.ceil(requested / 9.0)));
        return rows * 9;
    }

    public void open(Player player) {
        MenuHolder holder = new MenuHolder(this);
        String title = plugin.getConfig().getString("kitroom.title", "Kit 房間");
        Inventory inventory = Bukkit.createInventory(holder, size, ItemUtil.mm(title));
        holder.setInventory(inventory);

        for (int i = 0; i < size; i++) inventory.setItem(i, ItemUtil.hideExtras(new ItemStack(Material.BLACK_STAINED_GLASS_PANE)));

        Map<Integer, ItemStack> stored = plugin.getStorage().loadKitRoom();
        for (Map.Entry<Integer, ItemStack> entry : stored.entrySet()) {
            if (entry.getKey() >= size) continue;
            ItemStack clean = entry.getValue();
            cleanItems.put(entry.getKey(), clean);
            ItemStack display = clean.clone();
            inventory.setItem(entry.getKey(), display);
        }

        player.openInventory(inventory);
    }

    @Override
    public void onClick(InventoryClickEvent event) {
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;
        ItemStack clean = cleanItems.get(event.getSlot());
        if (clean == null) return;

        int amount = event.getClick().isShiftClick() ? clean.getType().getMaxStackSize() : clean.getAmount();
        ItemStack toGive = clean.clone();
        toGive.setAmount(amount);
        Map<Integer, ItemStack> leftover = player.getInventory().addItem(toGive);
        if (!leftover.isEmpty()) {
            for (ItemStack drop : leftover.values()) player.getWorld().dropItemNaturally(player.getLocation(), drop);
        }
        player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
    }
}
