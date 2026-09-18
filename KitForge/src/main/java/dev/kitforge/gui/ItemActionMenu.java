package dev.kitforge.gui;

import dev.kitforge.KitForgePlugin;
import dev.kitforge.anvil.EnchantSession;
import dev.kitforge.trim.TrimSession;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** Shift-right-click popup on an item in the kit editor: Anvil editor, and Armor Trim if it's an armor piece. */
public class ItemActionMenu implements KitForgeMenu {

    private final KitForgePlugin plugin;
    private final int kitSlot;
    private final int itemIndex;
    private final ItemStack item;
    private final TrimSession.Piece piece;
    private final boolean trimEligible;

    public ItemActionMenu(KitForgePlugin plugin, int kitSlot, int itemIndex, ItemStack item, TrimSession.Piece piece, boolean trimEligible) {
        this.plugin = plugin;
        this.kitSlot = kitSlot;
        this.itemIndex = itemIndex;
        this.item = item;
        this.piece = piece;
        this.trimEligible = trimEligible;
    }

    public void render(Inventory inventory) {
        inventory.setItem(11, item.clone());
        inventory.setItem(13, ItemUtil.item(Material.ANVIL, 1,
                "<aqua><bold>鐵砧編輯</bold></aqua>",
                "<gray>附魔、修復或改名此物品</gray>"));
        if (trimEligible) {
            inventory.setItem(15, ItemUtil.item(Material.SHIELD, 1,
                    "<light_purple><bold>盔甲樣式</bold></light_purple>",
                    "<gray>設計此裝備的花紋與材料</gray>"));
        }
        inventory.setItem(22, ItemUtil.item(Material.BARRIER, 1, "<red><bold>返回</bold></red>"));
    }

    @Override
    public void onClick(InventoryClickEvent event) {
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;

        switch (event.getSlot()) {
            case 13 -> {
                player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
                EnchantSession session = new EnchantSession(kitSlot, itemIndex, item.clone());
                new EnchantEditorGUI(plugin, session).open(player);
            }
            case 15 -> {
                if (!trimEligible) return;
                player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
                TrimSession session = new TrimSession(kitSlot, piece, item.clone());
                new TrimPatternGUI(plugin, session).open(player);
            }
            case 22 -> {
                player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
                new KitEditorGUI(plugin, kitSlot).open(player);
            }
            default -> {
            }
        }
    }
}
