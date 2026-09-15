package dev.mralow.tierbadge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 存在 config/tierbadge.json,第一次啟動會自動產生預設檔案。
 * baseUrl 要指向網站根網址(例如 http://mralow.sytes.net:8787),apiKey 到網站管理後台申請。
 */
public class TierBadgeConfig {

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path PATH = Path.of("config", "tierbadge.json");

    public String baseUrl = "http://localhost:8787";
    public String apiKey = "";
    public int refreshIntervalSeconds = 60;
    public String badgeColor = "#7c8cff";

    public static TierBadgeConfig loadOrCreate() {
        try {
            if (Files.exists(PATH)) {
                try (Reader reader = Files.newBufferedReader(PATH, StandardCharsets.UTF_8)) {
                    TierBadgeConfig loaded = GSON.fromJson(reader, TierBadgeConfig.class);
                    if (loaded != null) {
                        return loaded;
                    }
                }
            }
        } catch (IOException e) {
            TierBadgeClient.LOGGER.warn("讀取 tierbadge.json 失敗,使用預設設定", e);
        }

        TierBadgeConfig config = new TierBadgeConfig();
        config.save();
        return config;
    }

    public void save() {
        try {
            Files.createDirectories(PATH.getParent());
            try (Writer writer = Files.newBufferedWriter(PATH, StandardCharsets.UTF_8)) {
                GSON.toJson(this, writer);
            }
        } catch (IOException e) {
            TierBadgeClient.LOGGER.warn("寫入 tierbadge.json 失敗", e);
        }
    }
}
