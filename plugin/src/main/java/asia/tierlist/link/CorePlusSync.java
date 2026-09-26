package asia.tierlist.link;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.File;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Logger;

/** Reads CorePlus's local YAML data (per-player stats, achievements, world names) and uploads it. */
final class CorePlusSync {
    private final File folder;
    private final Logger log;
    private long lastSync;

    CorePlusSync(File folder, Logger log) {
        this.folder = folder;
        this.log = log;
    }

    boolean available() {
        return new File(folder, "playerdata").isDirectory();
    }

    /** world name → {id, display} from CorePlus's rtp-venues. */
    JsonObject worlds() {
        JsonObject out = new JsonObject();
        File cfg = new File(folder, "config.yml");
        if (!cfg.isFile()) return out;
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(cfg);
        for (Map<?, ?> venue : yaml.getMapList("rtp-venues")) {
            Object world = venue.get("world");
            if (world == null) continue;
            JsonObject v = new JsonObject();
            v.addProperty("id", String.valueOf(venue.get("id")));
            v.addProperty("display", String.valueOf(venue.containsKey("display") ? venue.get("display") : world));
            out.add(String.valueOf(world), v);
        }
        return out;
    }

    /** Uploads player files changed since the last successful sync. Call off the main thread. */
    synchronized int sync(Api api) throws Exception {
        File dir = new File(folder, "playerdata");
        File[] files = dir.listFiles((d, n) -> n.endsWith(".yml"));
        if (files == null) return 0;
        long started = System.currentTimeMillis();
        JsonArray batch = new JsonArray();
        int sent = 0;
        for (File f : files) {
            if (f.lastModified() < lastSync) continue;
            String id = f.getName().substring(0, f.getName().length() - 4);
            try {
                UUID.fromString(id);
            } catch (IllegalArgumentException e) {
                continue;
            }
            YamlConfiguration yaml = YamlConfiguration.loadConfiguration(f);
            JsonObject p = new JsonObject();
            p.addProperty("uuid", id);
            p.addProperty("name", yaml.getString("name", ""));
            p.addProperty("loginStreak", yaml.getInt("login-streak", 0));
            JsonObject stats = new JsonObject();
            ConfigurationSection sec = yaml.getConfigurationSection("stats");
            if (sec != null) for (String k : sec.getKeys(false)) stats.addProperty(k, sec.getInt(k));
            p.add("stats", stats);
            JsonArray ach = new JsonArray();
            yaml.getStringList("achievements").forEach(ach::add);
            p.add("achievements", ach);
            batch.add(p);
            if (batch.size() >= 200) {
                send(api, batch);
                sent += batch.size();
                batch = new JsonArray();
            }
        }
        if (!batch.isEmpty()) {
            send(api, batch);
            sent += batch.size();
        }
        lastSync = started;
        if (sent > 0) log.info("已同步 " + sent + " 位玩家的 CorePlus 資料");
        return sent;
    }

    private static void send(Api api, JsonArray players) throws Exception {
        JsonObject body = new JsonObject();
        body.add("players", players);
        api.post("/api/server/coreplus", body);
    }
}
