package dev.opopjjjidj.totemcounter;

import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.io.IOException;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class DataManager {

    private final JavaPlugin plugin;
    private final File dataFile;
    private final Map<UUID, PlayerTotemData> players = new ConcurrentHashMap<>();
    private List<PlayerTotemData> cachedLeaderboard = List.of();

    public DataManager(JavaPlugin plugin) {
        this.plugin = plugin;
        this.dataFile = new File(plugin.getDataFolder(), "players.yml");
    }

    public void load() {
        players.clear();
        if (!dataFile.exists()) {
            rebuildLeaderboard();
            return;
        }
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(dataFile);
        var section = yaml.getConfigurationSection("players");
        if (section != null) {
            for (String key : section.getKeys(false)) {
                try {
                    UUID uuid = UUID.fromString(key);
                    String name = section.getString(key + ".name", key);
                    int current = section.getInt(key + ".current", 0);
                    long total = section.getLong(key + ".total", 0L);
                    players.put(uuid, new PlayerTotemData(uuid, name, current, total));
                } catch (IllegalArgumentException ignored) {
                    // 忽略格式錯誤的資料列
                }
            }
        }
        rebuildLeaderboard();
    }

    public synchronized void save() {
        YamlConfiguration yaml = new YamlConfiguration();
        for (PlayerTotemData data : players.values()) {
            String path = "players." + data.getUuid();
            yaml.set(path + ".name", data.getName());
            yaml.set(path + ".current", data.getCurrentCount());
            yaml.set(path + ".total", data.getTotalCount());
        }
        try {
            plugin.getDataFolder().mkdirs();
            yaml.save(dataFile);
        } catch (IOException e) {
            plugin.getLogger().warning("無法儲存 TotemCounter 資料: " + e.getMessage());
        }
    }

    public PlayerTotemData getOrCreate(UUID uuid, String name) {
        return players.computeIfAbsent(uuid, id -> new PlayerTotemData(id, name, 0, 0L));
    }

    public void onTotemPop(UUID uuid, String name) {
        PlayerTotemData data = getOrCreate(uuid, name);
        data.setName(name);
        data.incrementPop();
        rebuildLeaderboard();
    }

    public void onDeath(UUID uuid) {
        PlayerTotemData data = players.get(uuid);
        if (data != null) {
            data.resetCurrent();
        }
    }

    public void resetPlayer(UUID uuid) {
        PlayerTotemData data = players.get(uuid);
        if (data != null) {
            players.put(uuid, new PlayerTotemData(uuid, data.getName(), 0, 0L));
            rebuildLeaderboard();
        }
    }

    public int getCurrentCount(UUID uuid) {
        PlayerTotemData data = players.get(uuid);
        return data == null ? 0 : data.getCurrentCount();
    }

    private void rebuildLeaderboard() {
        cachedLeaderboard = players.values().stream()
                .sorted(Comparator.comparingLong(PlayerTotemData::getTotalCount).reversed())
                .toList();
    }

    public PlayerTotemData getRank(int rank) {
        if (rank < 1 || rank > cachedLeaderboard.size()) {
            return null;
        }
        return cachedLeaderboard.get(rank - 1);
    }
}
