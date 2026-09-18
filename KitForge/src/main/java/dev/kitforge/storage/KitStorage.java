package dev.kitforge.storage;

import dev.kitforge.KitForgePlugin;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.io.BukkitObjectInputStream;
import org.bukkit.util.io.BukkitObjectOutputStream;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;

/**
 * Flat-file storage: one YAML file per player under data/kits/, plus a
 * shared kitroom.yml. No database driver, no native libraries, no shading —
 * this plugin only ever runs on one server, so a real database was never
 * worth the jar size or the moving parts.
 */
public class KitStorage {

    public static final int SLOTS = 41; // 36 inventory + 4 armor + 1 offhand

    private final KitForgePlugin plugin;
    private File kitsDir;
    private File kitRoomFile;

    public KitStorage(KitForgePlugin plugin) {
        this.plugin = plugin;
    }

    public void connect() {
        kitsDir = new File(plugin.getDataFolder(), "kits");
        if (!kitsDir.exists()) kitsDir.mkdirs();
        kitRoomFile = new File(plugin.getDataFolder(), "kitroom.yml");
    }

    public void close() {
        // Nothing to close: every write is flushed to disk immediately.
    }

    private File playerFile(UUID player) {
        return new File(kitsDir, player.toString() + ".yml");
    }

    public synchronized void saveKit(UUID player, int slot, ItemStack[] contents) {
        File file = playerFile(player);
        YamlConfiguration yaml = file.exists() ? YamlConfiguration.loadConfiguration(file) : new YamlConfiguration();
        yaml.set("kits." + slot, serialize(contents));
        save(yaml, file);
    }

    public synchronized void deleteKit(UUID player, int slot) {
        File file = playerFile(player);
        if (!file.exists()) return;
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        yaml.set("kits." + slot, null);
        save(yaml, file);
    }

    public synchronized ItemStack[] loadKit(UUID player, int slot) {
        File file = playerFile(player);
        if (!file.exists()) return null;
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        String data = yaml.getString("kits." + slot);
        return data == null ? null : deserialize(data);
    }

    public synchronized boolean hasKit(UUID player, int slot) {
        File file = playerFile(player);
        if (!file.exists()) return false;
        return YamlConfiguration.loadConfiguration(file).contains("kits." + slot);
    }

    public synchronized void saveKitRoom(int slot, ItemStack item) {
        YamlConfiguration yaml = kitRoomFile.exists() ? YamlConfiguration.loadConfiguration(kitRoomFile) : new YamlConfiguration();
        yaml.set("items." + slot, serializeSingle(item));
        save(yaml, kitRoomFile);
    }

    public synchronized void clearKitRoom() {
        YamlConfiguration yaml = new YamlConfiguration();
        save(yaml, kitRoomFile);
    }

    public synchronized Map<Integer, ItemStack> loadKitRoom() {
        Map<Integer, ItemStack> result = new LinkedHashMap<>();
        if (!kitRoomFile.exists()) return result;
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(kitRoomFile);
        var section = yaml.getConfigurationSection("items");
        if (section == null) return result;
        for (String key : section.getKeys(false)) {
            try {
                int slot = Integer.parseInt(key);
                ItemStack item = deserializeSingle(section.getString(key));
                if (item != null) result.put(slot, item);
            } catch (NumberFormatException ignored) {
            }
        }
        return result;
    }

    public synchronized boolean kitRoomHasData() {
        return kitRoomFile.exists() && YamlConfiguration.loadConfiguration(kitRoomFile).contains("items");
    }

    private void save(YamlConfiguration yaml, File file) {
        try {
            yaml.save(file);
        } catch (IOException e) {
            plugin.getLogger().log(Level.SEVERE, "無法寫入 " + file.getName(), e);
        }
    }

    private String serialize(ItemStack[] items) {
        try (ByteArrayOutputStream byteOut = new ByteArrayOutputStream();
             BukkitObjectOutputStream dataOut = new BukkitObjectOutputStream(byteOut)) {
            dataOut.writeInt(items.length);
            for (ItemStack item : items) {
                dataOut.writeObject(item);
            }
            return Base64.getEncoder().encodeToString(byteOut.toByteArray());
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private ItemStack[] deserialize(String data) {
        try (ByteArrayInputStream byteIn = new ByteArrayInputStream(Base64.getDecoder().decode(data));
             BukkitObjectInputStream dataIn = new BukkitObjectInputStream(byteIn)) {
            int length = dataIn.readInt();
            ItemStack[] items = new ItemStack[length];
            for (int i = 0; i < length; i++) {
                items[i] = (ItemStack) dataIn.readObject();
            }
            return items;
        } catch (IOException | ClassNotFoundException e) {
            throw new RuntimeException(e);
        }
    }

    private String serializeSingle(ItemStack item) {
        return serialize(new ItemStack[]{item});
    }

    private ItemStack deserializeSingle(String data) {
        ItemStack[] items = deserialize(data);
        return items.length > 0 ? items[0] : null;
    }
}
