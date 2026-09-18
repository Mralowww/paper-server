package dev.kitforge.gui;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.Material;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.List;

public final class ItemUtil {

    private static final Material[] RAINBOW_PANES = {
            Material.MAGENTA_STAINED_GLASS_PANE, Material.PINK_STAINED_GLASS_PANE,
            Material.PURPLE_STAINED_GLASS_PANE, Material.LIGHT_BLUE_STAINED_GLASS_PANE,
            Material.CYAN_STAINED_GLASS_PANE, Material.LIME_STAINED_GLASS_PANE,
            Material.YELLOW_STAINED_GLASS_PANE, Material.ORANGE_STAINED_GLASS_PANE
    };

    private ItemUtil() {
    }

    public static ItemStack item(Material material, String miniMessageName, String... miniMessageLore) {
        return item(material, 1, miniMessageName, miniMessageLore);
    }

    public static ItemStack item(Material material, int amount, String miniMessageName, String... miniMessageLore) {
        ItemStack stack = new ItemStack(material, amount);
        ItemMeta meta = stack.getItemMeta();
        meta.displayName(mm(miniMessageName));
        if (miniMessageLore.length > 0) {
            List<Component> lore = new ArrayList<>();
            for (String line : miniMessageLore) {
                if (line == null || line.isEmpty()) continue;
                lore.add(mm(line));
            }
            meta.lore(lore);
        }
        stack.setItemMeta(meta);
        return stack;
    }

    public static Component mm(String text) {
        return MiniMessage.miniMessage().deserialize(text).decoration(TextDecoration.ITALIC, false);
    }

    public static ItemStack hideExtras(ItemStack item) {
        ItemMeta meta = item.getItemMeta();
        if (meta != null) {
            meta.addItemFlags(ItemFlag.values());
            item.setItemMeta(meta);
        }
        return item;
    }

    public static ItemStack rainbowPane(int index) {
        ItemStack pane = new ItemStack(RAINBOW_PANES[Math.floorMod(index, RAINBOW_PANES.length)]);
        ItemMeta meta = pane.getItemMeta();
        meta.displayName(Component.text(" "));
        pane.setItemMeta(meta);
        return pane;
    }
}
