package dev.mralow.tierbadge;

import dev.mralow.tierbadge.client.TierBadgeClient;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 定期呼叫 Mralow Tiers 網站的 GET /api/v1/tiers,把整份排名抓回來存進 TierCache。
 * 用整批抓取而不是每個玩家單獨查,是為了不要對網站瘋狂發請求(遊戲裡玩家一多會很誇張)。
 */
public class TierApiClient {

    private final TierBadgeConfig config;

    public TierApiClient(TierBadgeConfig config) {
        this.config = config;
    }

    public void refreshOnce() {
        if (config.apiKey == null || config.apiKey.isBlank()) {
            TierBadgeClient.LOGGER.warn("尚未設定 apiKey,無法抓取 Tier 資料(編輯 config/tierbadge.json)");
            return;
        }

        String url = trimTrailingSlash(config.baseUrl) + "/api/v1/tiers";
        try {
            HttpURLConnection conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("X-API-Key", config.apiKey);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);

            int status = conn.getResponseCode();
            if (status != 200) {
                TierBadgeClient.LOGGER.warn("抓取 Tier 資料失敗,HTTP {}", status);
                return;
            }

            String body;
            try (InputStream in = conn.getInputStream()) {
                body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }

            JsonElement parsed = JsonParser.parseString(body);
            if (!parsed.isJsonArray()) {
                return;
            }

            Map<String, String> next = new HashMap<>();
            for (JsonElement el : (JsonArray) parsed) {
                var obj = el.getAsJsonObject();
                if (!obj.has("username") || obj.get("username").isJsonNull()) {
                    continue;
                }
                if (!obj.has("tier") || obj.get("tier").isJsonNull()) {
                    continue;
                }
                next.put(obj.get("username").getAsString().toLowerCase(), obj.get("tier").getAsString());
            }
            TierCache.replaceAll(next);
        } catch (IOException e) {
            TierBadgeClient.LOGGER.warn("抓取 Tier 資料時發生連線錯誤: {}", e.getMessage());
        }
    }

    private static String trimTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }
}
