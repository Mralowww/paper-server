package dev.sawsmp.core.api;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.logging.Logger;

/** 與網站 /api/plugin/* 溝通的 HTTP 客戶端（JSON，X-API-Key 驗證）。 */
public final class ApiClient {
    public static final Gson GSON = new Gson();
    private final HttpClient http;
    private final Logger log;
    private volatile String base;
    private volatile String key;
    private volatile Duration timeout;

    public ApiClient(Logger log) {
        this.log = log;
        // 固定 HTTP/1.1：部分伺服器（uvicorn 等）不接受 h2c 升級請求
        this.http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();
    }

    public void configure(String baseUrl, String apiKey, int timeoutSeconds) {
        this.base = baseUrl.replaceAll("/+$", "");
        this.key = apiKey;
        this.timeout = Duration.ofSeconds(Math.max(1, timeoutSeconds));
    }

    public boolean configured() { return key != null && !key.isBlank() && base != null && !base.isBlank(); }

    public static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20"); }

    /** API 回應；ok() 表示 HTTP 2xx。 */
    public record Resp(int status, JsonObject body) {
        public boolean ok() { return status >= 200 && status < 300; }

        public String error() {
            if (body != null && body.has("detail")) {
                JsonElement d = body.get("detail");
                return d.isJsonPrimitive() ? d.getAsString() : d.toString();
            }
            return status == 0 ? "無法連線到網站" : "HTTP " + status;
        }
    }

    public CompletableFuture<Resp> get(String path) { return send("GET", path, null); }

    public CompletableFuture<Resp> post(String path, Object body) { return send("POST", path, body); }

    private CompletableFuture<Resp> send(String method, String path, Object body) {
        if (!configured()) return CompletableFuture.completedFuture(new Resp(0, err("尚未設定 api.key")));
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path))
                .timeout(timeout)
                .header("X-API-Key", key)
                .header("Accept", "application/json")
                .header("User-Agent", "SawSMP-Plugin/1.0");
        if (body != null) {
            b.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(GSON.toJson(body)));
        } else {
            b.method(method, HttpRequest.BodyPublishers.noBody());
        }
        return http.sendAsync(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
                .thenApply(r -> new Resp(r.statusCode(), parse(r.body())))
                .exceptionally(ex -> {
                    log.warning("網站 API 請求失敗 " + method + " " + path + "：" + ex.getMessage());
                    return new Resp(0, err("無法連線到網站"));
                });
    }

    private static JsonObject parse(String s) {
        try {
            JsonElement e = JsonParser.parseString(s == null || s.isBlank() ? "{}" : s);
            return e.isJsonObject() ? e.getAsJsonObject() : new JsonObject();
        } catch (Exception ex) {
            return new JsonObject();
        }
    }

    private static JsonObject err(String m) {
        JsonObject o = new JsonObject();
        o.addProperty("detail", m);
        return o;
    }

    // ---- JSON 小工具 ----
    public static String str(JsonObject o, String k) {
        return o != null && o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : null;
    }

    public static JsonObject obj(Object... kv) {
        JsonObject o = new JsonObject();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            Object v = kv[i + 1];
            String k = String.valueOf(kv[i]);
            if (v == null) o.add(k, com.google.gson.JsonNull.INSTANCE);
            else if (v instanceof Number n) o.addProperty(k, n);
            else if (v instanceof Boolean bo) o.addProperty(k, bo);
            else if (v instanceof JsonElement je) o.add(k, je);
            else o.addProperty(k, String.valueOf(v));
        }
        return o;
    }
}
