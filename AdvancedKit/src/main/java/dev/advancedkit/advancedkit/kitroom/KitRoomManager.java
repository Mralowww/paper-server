package dev.advancedkit.advancedkit.kitroom;

import dev.advancedkit.advancedkit.AdvancedKitPlugin;
import dev.advancedkit.advancedkit.storage.ItemStackSerializer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.potion.PotionType;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Level;

public class KitRoomManager {

    private final AdvancedKitPlugin plugin;
    private File file;

    private String title = "Kit 房間";
    private int size = 54;
    private final List<KitRoomItem> items = new ArrayList<>();

    public KitRoomManager(AdvancedKitPlugin plugin) {
        this.plugin = plugin;
    }

    public void load() {
        file = new File(plugin.getDataFolder(), "kitroom.yml");
        if (!file.exists()) {
            plugin.saveResource("kitroom.yml", false);
        }
        YamlConfiguration config = YamlConfiguration.loadConfiguration(file);

        title = config.getString("title", "Kit 房間");
        size = normalizeSize(config.getInt("size", 54));

        items.clear();
        if (config.contains("items")) {
            // 管理員已經在遊戲內編輯並儲存過，以檔案內容為準(即使是空的也是刻意清空)
            List<?> rawItems = config.getList("items");
            if (rawItems != null) {
                for (Object raw : rawItems) {
                    if (!(raw instanceof Map<?, ?> map)) {
                        continue;
                    }
                    try {
                        int slot = ((Number) map.get("slot")).intValue();
                        String base64 = String.valueOf(map.get("item"));
                        ItemStack stack = ItemStackSerializer.deserializeSingle(base64);
                        if (stack == null || stack.getType() == Material.AIR) {
                            continue;
                        }
                        if (slot < 0 || slot >= size) {
                            plugin.getLogger().warning("kitroom.yml 有物品的 slot 超出範圍: " + slot);
                            continue;
                        }
                        items.add(new KitRoomItem(slot, stack));
                    } catch (Exception e) {
                        plugin.getLogger().log(Level.WARNING, "kitroom.yml 有一筆物品讀取失敗，已略過", e);
                    }
                }
            }
        } else {
            // 從未儲存過，先提供內建的預設水晶 PVP 展示櫃，等管理員用 /kit room edit 編輯並儲存
            items.addAll(buildStarterItems());
        }
    }

    public void reload() {
        load();
    }

    public boolean isCustomized() {
        return file != null && YamlConfiguration.loadConfiguration(file).contains("items");
    }

    public String getTitle() {
        return title;
    }

    public int getSize() {
        return size;
    }

    public List<KitRoomItem> getItems() {
        return items;
    }

    public void saveFromInventory(Inventory inventory, int excludedSlot) {
        List<Map<String, Object>> serialized = new ArrayList<>();
        List<KitRoomItem> newItems = new ArrayList<>();
        for (int slot = 0; slot < inventory.getSize(); slot++) {
            if (slot == excludedSlot) {
                continue;
            }
            ItemStack stack = inventory.getItem(slot);
            if (stack == null || stack.getType() == Material.AIR) {
                continue;
            }
            ItemStack clean = stack.clone();
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("slot", slot);
            entry.put("item", ItemStackSerializer.serializeSingle(clean));
            serialized.add(entry);
            newItems.add(new KitRoomItem(slot, clean));
        }

        YamlConfiguration config = file.exists() ? YamlConfiguration.loadConfiguration(file) : new YamlConfiguration();
        config.set("title", title);
        config.set("size", size);
        config.set("items", serialized);
        try {
            config.save(file);
        } catch (IOException e) {
            plugin.getLogger().log(Level.SEVERE, "無法儲存 kitroom.yml", e);
        }

        items.clear();
        items.addAll(newItems);
    }

    private int normalizeSize(int requested) {
        int rows = Math.max(1, Math.min(6, (int) Math.ceil(requested / 9.0)));
        return rows * 9;
    }

    private List<KitRoomItem> buildStarterItems() {
        List<KitRoomItem> starter = new ArrayList<>();
        starter.add(new KitRoomItem(10, named(Material.END_CRYSTAL, 16, "&d終界水晶")));
        starter.add(new KitRoomItem(11, named(Material.RESPAWN_ANCHOR, 4, "&5重生錨")));
        starter.add(new KitRoomItem(12, named(Material.GLOWSTONE, 16, "&e螢石")));
        starter.add(new KitRoomItem(13, named(Material.TOTEM_OF_UNDYING, 1, "&6不死圖騰")));
        starter.add(new KitRoomItem(14, named(Material.OBSIDIAN, 16, "&8黑曜石")));
        starter.add(new KitRoomItem(15, named(Material.FLINT_AND_STEEL, 1, "&7打火石")));
        starter.add(new KitRoomItem(16, named(Material.ENDER_PEARL, 16, "&d終界珍珠")));

        starter.add(new KitRoomItem(19, named(Material.DIAMOND_SWORD, 1, "&b鑽石劍")));
        starter.add(new KitRoomItem(20, named(Material.DIAMOND_AXE, 1, "&b鑽石斧")));
        starter.add(new KitRoomItem(21, named(Material.BOW, 1, "&a弓")));
        starter.add(new KitRoomItem(22, named(Material.CROSSBOW, 1, "&a弩")));
        starter.add(new KitRoomItem(23, named(Material.ARROW, 16, "&f箭矢")));
        starter.add(new KitRoomItem(24, named(Material.TRIDENT, 1, "&3三叉戟")));
        starter.add(new KitRoomItem(25, named(Material.SHIELD, 1, "&e盾牌")));

        starter.add(new KitRoomItem(28, named(Material.DIAMOND_HELMET, 1, "&b鑽石頭盔")));
        starter.add(new KitRoomItem(29, named(Material.DIAMOND_CHESTPLATE, 1, "&b鑽石胸甲")));
        starter.add(new KitRoomItem(30, named(Material.DIAMOND_LEGGINGS, 1, "&b鑽石護腿")));
        starter.add(new KitRoomItem(31, named(Material.DIAMOND_BOOTS, 1, "&b鑽石靴子")));
        starter.add(new KitRoomItem(32, named(Material.SHEARS, 1, "&f剪刀")));
        starter.add(new KitRoomItem(33, named(Material.WATER_BUCKET, 1, "&9水桶")));
        starter.add(new KitRoomItem(34, named(Material.ELYTRA, 1, "&d鞘翅")));

        starter.add(new KitRoomItem(37, named(Material.GOLDEN_APPLE, 16, "&6金蘋果")));
        starter.add(new KitRoomItem(38, named(Material.ENCHANTED_GOLDEN_APPLE, 4, "&e附魔金蘋果")));
        starter.add(new KitRoomItem(39, potion(PotionType.HEALING, 4, "&c噴濺藥水(治療)")));
        starter.add(new KitRoomItem(40, named(Material.COOKED_BEEF, 16, "&c熟牛排")));
        starter.add(new KitRoomItem(41, named(Material.FIREWORK_ROCKET, 16, "&f煙火火箭")));
        starter.add(new KitRoomItem(42, named(Material.BLAZE_ROD, 4, "&6烈焰棒")));
        starter.add(new KitRoomItem(43, named(Material.EXPERIENCE_BOTTLE, 16, "&a附魔之瓶")));
        return starter;
    }

    private ItemStack named(Material material, int amount, String legacyName) {
        ItemStack stack = new ItemStack(material, amount);
        ItemMeta meta = stack.getItemMeta();
        Component name = LegacyComponentSerializer.legacyAmpersand().deserialize(legacyName)
                .decoration(TextDecoration.ITALIC, false);
        meta.displayName(name);
        stack.setItemMeta(meta);
        return stack;
    }

    private ItemStack potion(PotionType type, int amount, String legacyName) {
        ItemStack stack = new ItemStack(Material.SPLASH_POTION, amount);
        org.bukkit.inventory.meta.PotionMeta meta = (org.bukkit.inventory.meta.PotionMeta) stack.getItemMeta();
        meta.setBasePotionType(type);
        meta.displayName(LegacyComponentSerializer.legacyAmpersand().deserialize(legacyName)
                .decoration(TextDecoration.ITALIC, false));
        stack.setItemMeta(meta);
        return stack;
    }
}
