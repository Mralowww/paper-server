package dev.kitforge.gui;

import dev.kitforge.KitForgePlugin;
import dev.kitforge.anvil.EnchantEditor;
import dev.kitforge.anvil.EnchantSession;
import dev.kitforge.storage.KitStorage;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.List;

public class EnchantEditorGUI implements KitForgeMenu {

    private static final int PREVIEW_SLOT = 4;
    private static final int REPAIR_SLOT = 48;
    private static final int RENAME_SLOT = 50;
    private static final int SAVE_SLOT = 53;

    private final KitForgePlugin plugin;
    private final EnchantSession session;
    private Inventory inventory;

    public EnchantEditorGUI(KitForgePlugin plugin, EnchantSession session) {
        this.plugin = plugin;
        this.session = session;
    }

    public void open(Player player) {
        MenuHolder holder = new MenuHolder(this);
        inventory = Bukkit.createInventory(holder, 54, ItemUtil.mm("<gradient:#AAAAAA:#FFAA00><bold>鐵砧：附魔</bold></gradient>"));
        holder.setInventory(inventory);
        render(player);
        player.openInventory(inventory);
    }

    private void render(Player player) {
        for (int i = 0; i < 54; i++) inventory.setItem(i, ItemUtil.rainbowPane(i));
        inventory.setItem(PREVIEW_SLOT, ItemUtil.hideExtras(session.getItem().clone()));

        List<Enchantment> enchants = EnchantEditor.applicableEnchants(session.getItem());
        int slotIndex = 19;
        for (Enchantment enchantment : enchants) {
            if (slotIndex >= 44) break;
            renderEnchantSlot(slotIndex, enchantment);
            slotIndex++;
            if ((slotIndex + 1) % 9 == 0) slotIndex += 2;
        }

        inventory.setItem(REPAIR_SLOT, ItemUtil.item(Material.EXPERIENCE_BOTTLE, 1,
                "<green><bold>修復</bold></green>", "<gray>清除所有耐久損耗</gray>"));

        boolean canRename = plugin.getTrimTierConfig().atLeastTier(player, plugin.getConfig().getString("rename-min-tier", "lt2"));
        if (canRename) {
            inventory.setItem(RENAME_SLOT, ItemUtil.item(Material.NAME_TAG, 1,
                    "<yellow><bold>改名</bold></yellow>", "<gray>在聊天室輸入新名稱</gray>"));
        } else {
            inventory.setItem(RENAME_SLOT, ItemUtil.item(Material.BARRIER, 1,
                    "<gray><bold>改名</bold></gray>", "<red>需要權限：kitforge.trims.lt2(或更高)</red>"));
        }

        inventory.setItem(SAVE_SLOT, ItemUtil.item(Material.OAK_DOOR, 1, "<red><bold>儲存並返回</bold></red>"));
    }

    private void renderEnchantSlot(int slotIndex, Enchantment enchantment) {
        int level = EnchantEditor.currentLevel(session.getItem(), enchantment);
        String name = enchantment.getKey().getKey().replace('_', ' ');
        inventory.setItem(slotIndex, ItemUtil.item(level > 0 ? Material.ENCHANTED_BOOK : Material.BOOK, 1,
                "<aqua><bold>" + name + "</bold></aqua>",
                "<gray>目前等級：<white>" + level + "</white>",
                "<gray>最高等級：<white>" + enchantment.getMaxLevel() + "</white>",
                "<green>左鍵</green><gray>：+1</gray>",
                "<red>右鍵</red><gray>：-1</gray>",
                "<yellow>Shift + 左鍵</yellow><gray>：設為最高等級</gray>",
                "<red>Shift + 右鍵</red><gray>：移除</gray>"));
    }

    @Override
    public void onClick(InventoryClickEvent event) {
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;
        int slot = event.getSlot();

        if (slot == REPAIR_SLOT) {
            if (EnchantEditor.repair(session.getItem())) {
                player.sendMessage(ItemUtil.mm("<green>物品已修復！</green>"));
            }
            player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
            render(player);
            return;
        }
        if (slot == RENAME_SLOT) {
            boolean canRename = plugin.getTrimTierConfig().atLeastTier(player, plugin.getConfig().getString("rename-min-tier", "lt2"));
            if (!canRename) {
                player.playSound(player.getLocation(), Sound.ENTITY_ITEM_BREAK, 1f, 1f);
                player.sendMessage(ItemUtil.mm("<red>你沒有執行此操作的權限</red>"));
                return;
            }
            player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
            player.closeInventory();
            player.sendMessage(ItemUtil.mm("<yellow>請在聊天室輸入新名稱，輸入 cancel 取消。</yellow>"));
            plugin.getRenamePrompt().await(player.getUniqueId(), text -> {
                if (!player.isOnline()) return;
                if (!text.equalsIgnoreCase("cancel")) {
                    EnchantEditor.rename(session.getItem(), ItemUtil.mm(text));
                    player.sendMessage(ItemUtil.mm("<green>物品已改名！</green>"));
                }
                open(player);
            });
            return;
        }
        if (slot == SAVE_SLOT) {
            player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
            saveAndReturn(player);
            return;
        }

        Enchantment enchantment = findEnchantmentAtSlot(slot);
        if (enchantment == null) return;

        switch (event.getClick()) {
            case SHIFT_RIGHT -> {
                EnchantEditor.removeEnchant(session.getItem(), enchantment);
                player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
            }
            case SHIFT_LEFT -> applyResult(player, EnchantEditor.setMaxLevel(session.getItem(), enchantment));
            case RIGHT -> {
                EnchantEditor.decreaseLevel(session.getItem(), enchantment);
                player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
            }
            default -> applyResult(player, EnchantEditor.increaseLevel(session.getItem(), enchantment));
        }
        render(player);
    }

    private void applyResult(Player player, EnchantEditor.Result result) {
        switch (result) {
            case ADDED -> player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
            case MAX_LEVEL -> {
                player.sendMessage(ItemUtil.mm("<red>此附魔已達最高等級</red>"));
                player.playSound(player.getLocation(), Sound.ENTITY_ITEM_BREAK, 1f, 1f);
            }
            case CONFLICT -> {
                player.sendMessage(ItemUtil.mm("<red>此附魔與物品上已有的附魔衝突</red>"));
                player.playSound(player.getLocation(), Sound.ENTITY_ITEM_BREAK, 1f, 1f);
            }
        }
    }

    private Enchantment findEnchantmentAtSlot(int slotIndex) {
        List<Enchantment> enchants = EnchantEditor.applicableEnchants(session.getItem());
        int i = 19;
        for (Enchantment enchantment : enchants) {
            if (i >= 44) break;
            if (i == slotIndex) return enchantment;
            i++;
            if ((i + 1) % 9 == 0) i += 2;
        }
        return null;
    }

    private void saveAndReturn(Player player) {
        ItemStack[] fullKit = plugin.getStorage().loadKit(player.getUniqueId(), session.getKitSlot());
        if (fullKit != null && session.getItemIndex() < fullKit.length) {
            fullKit[session.getItemIndex()] = session.getItem();
            plugin.getStorage().saveKit(player.getUniqueId(), session.getKitSlot(), fullKit);
        }
        new KitEditorGUI(plugin, session.getKitSlot()).open(player);
    }
}
