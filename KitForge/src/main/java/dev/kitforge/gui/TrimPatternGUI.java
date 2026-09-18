package dev.kitforge.gui;

import dev.kitforge.KitForgePlugin;
import dev.kitforge.trim.TrimSession;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.meta.trim.TrimPattern;

import java.util.ArrayList;
import java.util.List;

public class TrimPatternGUI implements KitForgeMenu {

    private static final String[] PATTERN_KEYS = {
            "sentry", "dune", "coast", "wild", "ward", "eye", "vex", "tide",
            "snout", "rib", "spire", "wayfinder", "shaper", "silence", "raiser", "host", "flow", "bolt"
    };

    private final KitForgePlugin plugin;
    private final TrimSession session;
    private final List<TrimPattern> patterns = new ArrayList<>();

    public TrimPatternGUI(KitForgePlugin plugin, TrimSession session) {
        this.plugin = plugin;
        this.session = session;
        for (String key : PATTERN_KEYS) {
            TrimPattern pattern = Registry.TRIM_PATTERN.get(NamespacedKey.minecraft(key));
            if (pattern != null) patterns.add(pattern);
        }
    }

    public void open(Player player) {
        MenuHolder holder = new MenuHolder(this);
        Inventory inventory = Bukkit.createInventory(holder, 54, ItemUtil.mm("<gradient:#FF55FF:#AA00AA><bold>盔甲樣式：選擇花紋</bold></gradient>"));
        holder.setInventory(inventory);

        for (int i = 0; i < 54; i++) inventory.setItem(i, ItemUtil.rainbowPane(i));

        int slotIndex = 10;
        for (TrimPattern pattern : patterns) {
            if (slotIndex >= 44) break;
            String name = pattern.getKey().getKey();
            inventory.setItem(slotIndex, ItemUtil.item(Material.PAPER, 1,
                    "<yellow>" + Character.toUpperCase(name.charAt(0)) + name.substring(1) + "</yellow>"));
            slotIndex++;
            if ((slotIndex + 1) % 9 == 0) slotIndex += 2;
        }

        inventory.setItem(53, ItemUtil.item(Material.OAK_DOOR, 1, "<red><bold>返回</bold></red>"));
        player.openInventory(inventory);
    }

    @Override
    public void onClick(InventoryClickEvent event) {
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;

        if (event.getSlot() == 53) {
            player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
            new KitEditorGUI(plugin, session.getKitSlot()).open(player);
            return;
        }

        TrimPattern pattern = patternAtSlot(event.getSlot());
        if (pattern == null) return;
        player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
        session.setPattern(pattern);
        new TrimMaterialGUI(plugin, session).open(player);
    }

    private TrimPattern patternAtSlot(int slotIndex) {
        int i = 10;
        for (TrimPattern pattern : patterns) {
            if (i >= 44) break;
            if (i == slotIndex) return pattern;
            i++;
            if ((i + 1) % 9 == 0) i += 2;
        }
        return null;
    }
}
