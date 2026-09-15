package dev.mralow.tierverify;

import org.bukkit.Bukkit;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

/**
 * 把玩家用的模組列表(從 TierVerify 頻道收到的)轉送到 Tier List 網站的 /internal/modlist。
 * 網站那邊會存起來,方便之後在後台或考試時查這個玩家裝了哪些客戶端模組。
 */
public class ModListService {

    public record ModEntry(String id, String version) {
    }

    private final JavaPlugin plugin;
    private final String backendUrl;
    private final String sharedSecret;
    private final int timeoutSeconds;

    public ModListService(JavaPlugin plugin, String backendUrl, String sharedSecret, int timeoutSeconds) {
        this.plugin = plugin;
        this.backendUrl = backendUrl;
        this.sharedSecret = sharedSecret;
        this.timeoutSeconds = timeoutSeconds;
    }

    public void sendAsync(UUID playerUuid, String playerName, List<ModEntry> mods) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> send(playerUuid, playerName, mods));
    }

    private void send(UUID playerUuid, String playerName, List<ModEntry> mods) {
        if (backendUrl == null || backendUrl.isBlank() || sharedSecret == null || sharedSecret.isBlank()) {
            return;
        }
        try {
            HttpURLConnection conn = (HttpURLConnection) URI.create(backendUrl).toURL().openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("X-Plugin-Secret", sharedSecret);
            conn.setConnectTimeout(timeoutSeconds * 1000);
            conn.setReadTimeout(timeoutSeconds * 1000);
            conn.setDoOutput(true);

            StringBuilder modsJson = new StringBuilder("[");
            for (int i = 0; i < mods.size(); i++) {
                ModEntry m = mods.get(i);
                if (i > 0) {
                    modsJson.append(",");
                }
                modsJson.append("{\"id\":\"").append(escape(m.id())).append("\",")
                        .append("\"version\":\"").append(escape(m.version())).append("\"}");
            }
            modsJson.append("]");

            String body = "{"
                    + "\"mc_uuid\":\"" + playerUuid + "\","
                    + "\"mc_username\":\"" + escape(playerName) + "\","
                    + "\"mods\":" + modsJson
                    + "}";

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }

            int status = conn.getResponseCode();
            if (status != 200) {
                plugin.getLogger().warning("回報模組列表到 Tier List 後端失敗,HTTP " + status);
            }
        } catch (IOException e) {
            plugin.getLogger().warning("回報模組列表到 Tier List 後端失敗: " + e.getMessage());
        }
    }

    private static String escape(String input) {
        return input.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
