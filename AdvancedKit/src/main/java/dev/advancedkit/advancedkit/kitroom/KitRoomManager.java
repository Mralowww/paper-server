package dev.advancedkit.advancedkit.kitroom;

import dev.advancedkit.advancedkit.AdvancedKitPlugin;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Level;

public class KitRoomManager {

    private final AdvancedKitPlugin plugin;
    private File file;
    private YamlConfiguration config;

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
        config = YamlConfiguration.loadConfiguration(file);

        title = config.getString("title", "Kit 房間");
        size = normalizeSize(config.getInt("size", 54));

        items.clear();
        List<?> rawItems = config.getList("items");
        if (rawItems == null) {
            return;
        }
        for (Object raw : rawItems) {
            if (!(raw instanceof java.util.Map<?, ?> map)) {
                continue;
            }
            try {
                int slot = ((Number) map.get("slot")).intValue();
                Material material = Material.valueOf(String.valueOf(map.get("material")).toUpperCase());
                int amount = map.containsKey("amount") ? ((Number) map.get("amount")).intValue() : 1;
                String name = map.containsKey("name") ? String.valueOf(map.get("name")) : material.name();
                @SuppressWarnings("unchecked")
                List<String> lore = map.get("lore") instanceof List<?> l
                        ? (List<String>) l.stream().map(String::valueOf).toList()
                        : List.of();
                int customModelData = map.containsKey("custom-model-data")
                        ? ((Number) map.get("custom-model-data")).intValue() : 0;
                if (slot < 0 || slot >= size) {
                    plugin.getLogger().warning("kitroom.yml 有物品的 slot 超出範圍: " + slot);
                    continue;
                }
                items.add(new KitRoomItem(slot, material, Math.max(1, amount), name, lore, customModelData));
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "kitroom.yml 有一筆物品設定錯誤，已略過: " + map, e);
            }
        }
    }

    public void reload() {
        load();
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

    private int normalizeSize(int requested) {
        int rows = Math.max(1, Math.min(6, (int) Math.ceil(requested / 9.0)));
        return rows * 9;
    }
}
