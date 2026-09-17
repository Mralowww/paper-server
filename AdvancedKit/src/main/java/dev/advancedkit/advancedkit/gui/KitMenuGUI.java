package dev.advancedkit.advancedkit.gui;

import dev.advancedkit.advancedkit.AdvancedKitPlugin;
import dev.advancedkit.advancedkit.KitManager;
import dev.advancedkit.advancedkit.model.Kit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.List;

public class KitMenuGUI {

    public static final String INVENTORY_TITLE_KEY = "advancedkit:menu";

    private final AdvancedKitPlugin plugin;

    public KitMenuGUI(AdvancedKitPlugin plugin) {
        this.plugin = plugin;
    }

    public Inventory build(Player player) {
        KitManager manager = plugin.getKitManager();
        List<Kit> serverKits = manager.listServerKits();
        List<Kit> ownKits = manager.listOwnKits(player);

        int size = Math.max(9, roundUpToNine(serverKits.size() + ownKits.size() + 1));
        KitMenuHolder holder = new KitMenuHolder();
        Inventory inventory = plugin.getServer().createInventory(holder, size,
                Component.text("我的 Kit 選單").color(NamedTextColor.DARK_AQUA));
        holder.setInventory(inventory);

        int slot = 0;
        for (Kit kit : serverKits) {
            inventory.setItem(slot, buildKitIcon(player, kit, true));
            holder.bind(slot, kit);
            slot++;
        }
        for (Kit kit : ownKits) {
            inventory.setItem(slot, buildKitIcon(player, kit, false));
            holder.bind(slot, kit);
            slot++;
        }

        ItemStack info = new ItemStack(Material.NETHER_STAR);
        ItemMeta meta = info.getItemMeta();
        meta.displayName(Component.text("建立新 Kit").color(NamedTextColor.GREEN).decoration(TextDecoration.ITALIC, false));
        int limit = manager.getKitLimit(player);
        String limitText = limit == Integer.MAX_VALUE ? "無限" : String.valueOf(limit);
        List<Component> lore = new ArrayList<>();
        lore.add(Component.text("目前擁有 " + ownKits.size() + " / " + limitText + " 個 Kit")
                .color(NamedTextColor.GRAY).decoration(TextDecoration.ITALIC, false));
        lore.add(Component.text("使用 /kit create <名稱> 建立").color(NamedTextColor.DARK_GRAY)
                .decoration(TextDecoration.ITALIC, false));
        meta.lore(lore);
        info.setItemMeta(meta);
        inventory.setItem(size - 1, info);

        return inventory;
    }

    private ItemStack buildKitIcon(Player player, Kit kit, boolean serverKit) {
        Material material;
        try {
            material = Material.valueOf(kit.getIcon());
        } catch (IllegalArgumentException e) {
            material = Material.CHEST;
        }
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        NamedTextColor nameColor = serverKit ? NamedTextColor.GOLD : NamedTextColor.AQUA;
        meta.displayName(Component.text((serverKit ? "[伺服器] " : "") + kit.getName())
                .color(nameColor).decoration(TextDecoration.ITALIC, false));

        List<Component> lore = new ArrayList<>();
        long remaining = plugin.getKitManager().getRemainingCooldownSeconds(player, kit);
        if (remaining > 0) {
            lore.add(Component.text("冷卻中: " + remaining + " 秒").color(NamedTextColor.RED)
                    .decoration(TextDecoration.ITALIC, false));
        } else {
            lore.add(Component.text("點擊領取此 Kit").color(NamedTextColor.YELLOW)
                    .decoration(TextDecoration.ITALIC, false));
        }
        if (kit.getCooldownSeconds() > 0) {
            lore.add(Component.text("冷卻時間: " + kit.getCooldownSeconds() + " 秒").color(NamedTextColor.GRAY)
                    .decoration(TextDecoration.ITALIC, false));
        }
        if (!serverKit) {
            lore.add(Component.text("Shift+左鍵: 刪除此 Kit").color(NamedTextColor.DARK_RED)
                    .decoration(TextDecoration.ITALIC, false));
        }
        meta.lore(lore);
        item.setItemMeta(meta);
        return item;
    }

    private int roundUpToNine(int value) {
        return ((value + 8) / 9) * 9;
    }
}
