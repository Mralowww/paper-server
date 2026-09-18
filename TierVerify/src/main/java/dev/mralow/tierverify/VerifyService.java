package dev.mralow.tierverify;

import org.bukkit.Bukkit;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * 呼叫網站後端的 /internal/verify,把遊戲內的 UUID/暱稱 跟玩家輸入的驗證碼送過去核對。
 * 網站那邊會檢查驗證碼是否存在、未過期,核對成功就會把這個 MC 帳號跟先前 Discord 登入的紀錄綁在一起。
 */
public class VerifyService {

    private final JavaPlugin plugin;
    private final String backendUrl;
    private final String sharedSecret;
    private final int timeoutSeconds;

    public VerifyService(JavaPlugin plugin, String backendUrl, String sharedSecret, int timeoutSeconds) {
        this.plugin = plugin;
        this.backendUrl = backendUrl;
        this.sharedSecret = sharedSecret;
        this.timeoutSeconds = timeoutSeconds;
    }

    public void verifyAsync(UUID playerUuid, String playerName, String code, Consumer<VerifyResult> callback) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            VerifyResult result = doVerify(playerUuid, playerName, code);
            Bukkit.getScheduler().runTask(plugin, () -> callback.accept(result));
        });
    }

    private VerifyResult doVerify(UUID playerUuid, String playerName, String code) {
        if (backendUrl == null || backendUrl.isBlank()) {
            return VerifyResult.failure("伺服器尚未設定驗證網址,請聯絡管理員。");
        }
        try {
            HttpURLConnection conn = (HttpURLConnection) URI.create(backendUrl).toURL().openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("X-Plugin-Secret", sharedSecret);
            conn.setConnectTimeout(timeoutSeconds * 1000);
            conn.setReadTimeout(timeoutSeconds * 1000);
            conn.setDoOutput(true);

            String body = "{"
                    + "\"code\":\"" + escape(code) + "\","
                    + "\"mc_uuid\":\"" + playerUuid + "\","
                    + "\"mc_username\":\"" + escape(playerName) + "\""
                    + "}";

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }

            int status = conn.getResponseCode();
            if (status == 200) {
                return VerifyResult.success("驗證成功!你的 Discord 帳號已經跟這個 Minecraft 帳號綁定完成。");
            } else if (status == 404) {
                return VerifyResult.failure("驗證碼不存在或已過期,請回網站重新登入產生新的驗證碼。");
            } else if (status == 409) {
                return VerifyResult.failure("這個 Minecraft 帳號已經綁定過其他 Discord 帳號了。");
            } else {
                return VerifyResult.failure("驗證失敗 (伺服器回應代碼 " + status + "),請稍後再試或聯絡管理員。");
            }
        } catch (IOException e) {
            plugin.getLogger().warning("呼叫 Tier List 後端失敗: " + e.getMessage());
            return VerifyResult.failure("無法連線到驗證伺服器,請稍後再試。");
        }
    }

    private static String escape(String input) {
        return input.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public record VerifyResult(boolean ok, String message) {
        static VerifyResult success(String message) {
            return new VerifyResult(true, message);
        }

        static VerifyResult failure(String message) {
            return new VerifyResult(false, message);
        }
    }
}
