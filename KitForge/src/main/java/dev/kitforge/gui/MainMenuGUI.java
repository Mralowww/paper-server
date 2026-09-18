package dev.kitforge.gui;

import dev.kitforge.KitForgePlugin;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

public class MainMenuGUI implements KitForgeMenu {

    private final KitForgePlugin plugin;
    private final int maxSlots;

    public MainMenuGUI(KitForgePlugin plugin) {
        this.plugin = plugin;
        this.maxSlots = Math.max(1, Math.min(45, plugin.getConfig().getInt("kits.max-slots", 9)));
    }

    public void open(Player player) {
        MenuHolder holder = new MenuHolder(this);
        Inventory inventory = Bukkit.createInventory(holder, 54, ItemUtil.mm("<gradient:#55FFFF:#5555FF><bold>我的套裝</bold></gradient>"));
        holder.setInventory(inventory);

        for (int i = 0; i < inventory.getSize(); i++) {
            inventory.setItem(i, ItemUtil.hideExtras(new ItemStack(Material.BLACK_STAINED_GLASS_PANE)));
        }

        for (int slot = 1; slot <= maxSlots; slot++) {
            int index = slot - 1;
            boolean exists = plugin.getStorage().hasKit(player.getUniqueId(), slot);
            ItemStack icon = ItemUtil.item(exists ? Material.CHEST : Material.BARRIER, 1,
                    "<gradient:#55FFFF:#5555FF><bold>套裝 " + slot + "</bold></gradient>",
                    "<aqua>左鍵</aqua><gray>：載入套裝</gray>",
                    "<light_purple>右鍵</light_purple><gray>：編輯套裝</gray>",
                    exists ? "" : "<gray>(尚未建立)</gray>");
            inventory.setItem(index, icon);
        }

        inventory.setItem(49, ItemUtil.item(Material.NETHER_STAR, 1,
                "<gradient:#FFD700:#FF69B4><bold>Kit 房間</bold></gradient>",
                "<gray>點擊開啟無限資源展示櫃</gray>"));

        player.openInventory(inventory);
    }

    @Override
    public void onClick(InventoryClickEvent event) {
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;
        int slotIndex = event.getSlot();

        if (slotIndex == 49) {
            player.playSound(player.getLocation(), org.bukkit.Sound.UI_BUTTON_CLICK, 1f, 1f);
            new KitRoomGUI(plugin, false).open(player);
            return;
        }

        if (slotIndex >= maxSlots) return;
        int slot = slotIndex + 1;
        player.playSound(player.getLocation(), org.bukkit.Sound.UI_BUTTON_CLICK, 1f, 1f);

        if (event.getClick() == ClickType.LEFT || event.getClick() == ClickType.SHIFT_LEFT) {
            ItemStack[] kit = plugin.getStorage().loadKit(player.getUniqueId(), slot);
            if (kit == null) {
                player.sendMessage(ItemUtil.mm("<red>此套裝尚未建立</red>"));
                player.playSound(player.getLocation(), org.bukkit.Sound.ENTITY_ITEM_BREAK, 1f, 1f);
                return;
            }
            dev.kitforge.trim.TrimEnforcer.downgradeUnauthorized(kit, player, plugin.getTrimTierConfig());
            player.getInventory().setContents(kit);
            player.updateInventory();
            if (plugin.getConfig().getBoolean("heal-on-load", true)) {
                var maxHealth = player.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH);
                if (maxHealth != null) player.setHealth(maxHealth.getValue());
                player.setFoodLevel(20);
                player.setSaturation(20f);
            }
            player.sendMessage(ItemUtil.mm("<green>已載入套裝 " + slot + "</green>"));
            player.closeInventory();
        } else if (event.getClick() == ClickType.RIGHT || event.getClick() == ClickType.SHIFT_RIGHT) {
            new KitEditorGUI(plugin, slot).open(player);
        }
    }
}
