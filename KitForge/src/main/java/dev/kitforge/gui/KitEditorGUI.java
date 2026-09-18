package dev.kitforge.gui;

import dev.kitforge.KitForgePlugin;
import dev.kitforge.anvil.EnchantSession;
import dev.kitforge.trim.TrimApplier;
import dev.kitforge.trim.TrimSession;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

public class KitEditorGUI implements KitForgeMenu {

    public static final int CONTENT_SIZE = 41; // 0-35 inv, 36 boots, 37 legs, 38 chest, 39 helmet, 40 offhand
    private static final int IMPORT_SLOT = 47;
    private static final int CLEAR_SLOT = 49;
    private static final int BACK_SLOT = 53;

    private final KitForgePlugin plugin;
    private final int slot;

    public KitEditorGUI(KitForgePlugin plugin, int slot) {
        this.plugin = plugin;
        this.slot = slot;
    }

    public void open(Player player) {
        MenuHolder holder = new MenuHolder(this);
        Inventory inventory = Bukkit.createInventory(holder, 54, ItemUtil.mm("<gradient:#55FFFF:#5555FF><bold>編輯套裝 " + slot + "</bold></gradient>"));
        holder.setInventory(inventory);

        for (int i = CONTENT_SIZE; i < 54; i++) {
            inventory.setItem(i, ItemUtil.hideExtras(new ItemStack(Material.BLACK_STAINED_GLASS_PANE)));
        }

        ItemStack[] existing = plugin.getStorage().loadKit(player.getUniqueId(), slot);
        if (existing != null) {
            for (int i = 0; i < CONTENT_SIZE && i < existing.length; i++) {
                inventory.setItem(i, existing[i]);
            }
        }

        inventory.setItem(IMPORT_SLOT, ItemUtil.item(Material.HOPPER, 1,
                "<green><bold>從背包匯入</bold></green>",
                "<dark_purple>»</dark_purple> <yellow>點擊以從背包匯入</yellow> <dark_purple>«</dark_purple>"));
        inventory.setItem(CLEAR_SLOT, ItemUtil.item(Material.BARRIER, 1,
                "<red><bold>清空套裝</bold></red>",
                "<dark_purple>»</dark_purple> <yellow>Shift + 點擊以清空</yellow> <dark_purple>«</dark_purple>"));
        inventory.setItem(BACK_SLOT, ItemUtil.item(Material.OAK_DOOR, 1, "<red><bold>返回</bold></red>"));

        player.openInventory(inventory);
    }

    @Override
    public void onClick(InventoryClickEvent event) {
        int rawSlot = event.getRawSlot();
        if (rawSlot < 0 || rawSlot >= 54) {
            return; // click landed in the player's own inventory; leave it alone
        }

        if (rawSlot >= CONTENT_SIZE) {
            event.setCancelled(true);
            handleButton(event, rawSlot);
            return;
        }

        if (event.getClick() != ClickType.SHIFT_RIGHT) {
            saveSoon(event);
            return; // free editing: place/take/drag within the content area
        }

        event.setResult(Event.Result.DENY);
        if (!(event.getWhoClicked() instanceof Player player)) return;
        ItemStack current = event.getInventory().getItem(rawSlot);
        if (current == null || current.getType() == Material.AIR) {
            player.playSound(player.getLocation(), Sound.ENTITY_ITEM_BREAK, 1f, 1f);
            player.sendMessage(ItemUtil.mm("<red>找不到套裝</red>"));
            return;
        }
        player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
        openItemActionMenu(player, rawSlot, current.clone());
    }

    private void saveSoon(InventoryClickEvent event) {
        // Persist a moment after the click so the item stack reflects the post-click state.
        Bukkit.getScheduler().runTask(plugin, () -> {
            Inventory inv = event.getInventory();
            ItemStack[] contents = new ItemStack[CONTENT_SIZE];
            for (int i = 0; i < CONTENT_SIZE; i++) contents[i] = inv.getItem(i);
            if (event.getWhoClicked() instanceof Player player) {
                plugin.getStorage().saveKit(player.getUniqueId(), slot, contents);
            }
        });
    }

    private void handleButton(InventoryClickEvent event, int rawSlot) {
        if (!(event.getWhoClicked() instanceof Player player)) return;
        Inventory inv = event.getInventory();

        if (rawSlot == IMPORT_SLOT) {
            ItemStack[] playerInv = player.getInventory().getContents();
            for (int i = 0; i < CONTENT_SIZE && i < playerInv.length; i++) {
                inv.setItem(i, playerInv[i]);
            }
            player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
            persist(player, inv);
        } else if (rawSlot == CLEAR_SLOT) {
            if (event.getClick() != ClickType.SHIFT_LEFT && event.getClick() != ClickType.SHIFT_RIGHT) return;
            for (int i = 0; i < CONTENT_SIZE; i++) inv.setItem(i, null);
            player.playSound(player.getLocation(), Sound.ENTITY_ITEM_BREAK, 1f, 1f);
            plugin.getStorage().deleteKit(player.getUniqueId(), slot);
            player.sendMessage(ItemUtil.mm("<red>已清空套裝 " + slot + "</red>"));
        } else if (rawSlot == BACK_SLOT) {
            player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
            persist(player, inv);
            new MainMenuGUI(plugin).open(player);
        }
    }

    private void persist(Player player, Inventory inv) {
        ItemStack[] contents = new ItemStack[CONTENT_SIZE];
        for (int i = 0; i < CONTENT_SIZE; i++) contents[i] = inv.getItem(i);
        boolean empty = true;
        for (ItemStack item : contents) {
            if (item != null && item.getType() != Material.AIR) {
                empty = false;
                break;
            }
        }
        if (empty) {
            plugin.getStorage().deleteKit(player.getUniqueId(), slot);
        } else {
            plugin.getStorage().saveKit(player.getUniqueId(), slot, contents);
        }
    }

    private void openItemActionMenu(Player player, int itemIndex, ItemStack item) {
        TrimSession.Piece piece = TrimSession.Piece.fromKitSlotIndex(itemIndex);
        boolean trimEligible = piece != null && plugin.getTrimTierConfig().isEnabled() && TrimApplier.isArmorPiece(item);

        ItemActionMenu actionMenu = new ItemActionMenu(plugin, slot, itemIndex, item, piece, trimEligible);
        MenuHolder holder = new MenuHolder(actionMenu);
        Inventory inventory = Bukkit.createInventory(holder, 27, ItemUtil.mm("<gradient:#FFD700:#FF69B4><bold>物品操作</bold></gradient>"));
        holder.setInventory(inventory);
        actionMenu.render(inventory);

        player.openInventory(inventory);
    }
}
