package dev.kitforge.gui;

import dev.kitforge.KitForgePlugin;
import dev.kitforge.trim.TrimApplier;
import dev.kitforge.trim.TrimSession;
import dev.kitforge.trim.TrimTierConfig;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.List;
import java.util.Locale;
import java.util.Map;

public class TrimMaterialGUI implements KitForgeMenu {

    private static final Map<String, Material> ICONS = Map.ofEntries(
            Map.entry("QUARTZ", Material.QUARTZ), Map.entry("IRON", Material.IRON_INGOT),
            Map.entry("COPPER", Material.COPPER_INGOT), Map.entry("GOLD", Material.GOLD_INGOT),
            Map.entry("REDSTONE", Material.REDSTONE), Map.entry("LAPIS", Material.LAPIS_LAZULI),
            Map.entry("AMETHYST", Material.AMETHYST_SHARD), Map.entry("EMERALD", Material.EMERALD),
            Map.entry("DIAMOND", Material.DIAMOND), Map.entry("NETHERITE", Material.NETHERITE_INGOT)
    );

    private final KitForgePlugin plugin;
    private final TrimSession session;
    private final List<TrimTierConfig.Tier> tiers;

    public TrimMaterialGUI(KitForgePlugin plugin, TrimSession session) {
        this.plugin = plugin;
        this.session = session;
        this.tiers = plugin.getTrimTierConfig().getTiers();
    }

    public void open(Player player) {
        MenuHolder holder = new MenuHolder(this);
        Inventory inventory = Bukkit.createInventory(holder, 54, ItemUtil.mm("<gradient:#FF55FF:#AA00AA><bold>盔甲樣式：選擇材料</bold></gradient>"));
        holder.setInventory(inventory);

        for (int i = 0; i < 54; i++) inventory.setItem(i, ItemUtil.rainbowPane(i));

        List<String> unlocked = plugin.getTrimTierConfig().unlockedMaterials(player);
        int slotIndex = 10;
        for (TrimTierConfig.Tier tier : tiers) {
            if (slotIndex >= 44) break;
            boolean isUnlocked = unlocked.contains(tier.materialKey());
            Material icon = ICONS.getOrDefault(tier.materialKey(), Material.PAPER);
            String name = capitalize(tier.materialKey());
            if (isUnlocked) {
                inventory.setItem(slotIndex, ItemUtil.item(icon, 1, "<green>" + name + "</green>"));
            } else {
                inventory.setItem(slotIndex, ItemUtil.item(Material.GRAY_DYE, 1,
                        "<gray>" + name + "</gray>", "<red>需要權限：" + tier.permission() + "</red>"));
            }
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
            new TrimPatternGUI(plugin, session).open(player);
            return;
        }

        TrimTierConfig.Tier tier = tierAtSlot(event.getSlot());
        if (tier == null) return;

        if (!plugin.getTrimTierConfig().canUse(player, tier.materialKey())) {
            player.playSound(player.getLocation(), Sound.ENTITY_ITEM_BREAK, 1f, 1f);
            player.sendMessage(ItemUtil.mm("<red>你沒有執行此操作的權限</red>"));
            return;
        }

        applyAndReturn(player, tier.materialKey());
    }

    private void applyAndReturn(Player player, String materialKey) {
        ItemStack item = session.getItem();
        if (item != null && TrimApplier.apply(item, session.getPattern(), materialKey)) {
            session.setItem(item);
        }

        ItemStack[] fullKit = plugin.getStorage().loadKit(player.getUniqueId(), session.getKitSlot());
        if (fullKit != null) {
            fullKit[session.getPiece().kitSlotIndex] = session.getItem();
            plugin.getStorage().saveKit(player.getUniqueId(), session.getKitSlot(), fullKit);
        }

        player.sendMessage(ItemUtil.mm("<gradient:#FF55FF:#AA00AA>已套用盔甲樣式！</gradient>"));
        player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 1f, 1f);
        new KitEditorGUI(plugin, session.getKitSlot()).open(player);
    }

    private TrimTierConfig.Tier tierAtSlot(int slotIndex) {
        int i = 10;
        for (TrimTierConfig.Tier tier : tiers) {
            if (i >= 44) break;
            if (i == slotIndex) return tier;
            i++;
            if ((i + 1) % 9 == 0) i += 2;
        }
        return null;
    }

    private String capitalize(String s) {
        return s.charAt(0) + s.substring(1).toLowerCase(Locale.ROOT);
    }
}
