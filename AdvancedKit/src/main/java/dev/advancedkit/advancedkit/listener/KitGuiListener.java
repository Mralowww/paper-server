package dev.advancedkit.advancedkit.listener;

import dev.advancedkit.advancedkit.AdvancedKitPlugin;
import dev.advancedkit.advancedkit.KitManager;
import dev.advancedkit.advancedkit.gui.KitMenuGUI;
import dev.advancedkit.advancedkit.gui.KitMenuHolder;
import dev.advancedkit.advancedkit.model.Kit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.InventoryHolder;

public class KitGuiListener implements Listener {

    private final AdvancedKitPlugin plugin;

    public KitGuiListener(AdvancedKitPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler
    public void onClick(InventoryClickEvent event) {
        InventoryHolder holder = event.getInventory().getHolder();
        if (!(holder instanceof KitMenuHolder menuHolder)) {
            return;
        }
        event.setCancelled(true);

        if (!(event.getWhoClicked() instanceof Player player)) {
            return;
        }
        int slot = event.getRawSlot();
        Kit kit = menuHolder.getKitAt(slot);
        if (kit == null) {
            return;
        }

        KitManager manager = plugin.getKitManager();
        if (event.isShiftClick() && !kit.isServerKit()) {
            if (!kit.getOwnerUuid().equals(player.getUniqueId().toString())) {
                return;
            }
            manager.deleteKit(kit);
            player.sendMessage(Component.text("已刪除 Kit: " + kit.getName()).color(NamedTextColor.RED));
            player.openInventory(new KitMenuGUI(plugin).build(player));
            return;
        }

        KitManager.ApplyResult result = manager.applyKit(player, kit, false);
        switch (result) {
            case SUCCESS -> {
                player.closeInventory();
                player.sendMessage(Component.text("已領取 Kit: " + kit.getName()).color(NamedTextColor.GREEN));
            }
            case ON_COOLDOWN -> {
                long remaining = manager.getRemainingCooldownSeconds(player, kit);
                player.sendMessage(Component.text("此 Kit 冷卻中，還需等待 " + remaining + " 秒")
                        .color(NamedTextColor.RED));
            }
            case NOT_FOUND -> player.sendMessage(Component.text("找不到此 Kit").color(NamedTextColor.RED));
        }
    }
}
