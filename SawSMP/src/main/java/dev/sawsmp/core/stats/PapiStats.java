package dev.sawsmp.core.stats;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.sawsmp.core.SawSMPPlugin;
import dev.sawsmp.core.api.ApiClient;
import dev.sawsmp.core.util.Sched;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * 從 PlaceholderAPI 讀取玩家原本就有的戰績（例如 %statistic_player_kills%），
 * 定期把數值同步到網站排行榜。以反射呼叫 PAPI，伺服器沒有安裝 PAPI 時自動停用。
 */
public final class PapiStats {
    /** 網站接受的欄位。 */
    private static final String[] FIELDS = {"kills", "deaths", "playtime", "wins", "losses", "best_streak"};

    private final SawSMPPlugin plugin;
    private Method setPlaceholders;
    private final Map<String, String> placeholders = new LinkedHashMap<>();

    public PapiStats(SawSMPPlugin plugin) { this.plugin = plugin; }

    /** 設定檔選用 papi 且伺服器有 PAPI 時為 true。 */
    public boolean active() { return setPlaceholders != null && !placeholders.isEmpty(); }

    public void load() {
        setPlaceholders = null;
        placeholders.clear();
        if (!"papi".equalsIgnoreCase(plugin.getConfig().getString("stats.source", "papi"))) return;
        if (Bukkit.getPluginManager().getPlugin("PlaceholderAPI") == null) {
            plugin.getLogger().warning("stats.source 設為 papi，但伺服器沒有安裝 PlaceholderAPI；改用插件自行統計");
            return;
        }
        try {
            setPlaceholders = Class.forName("me.clip.placeholderapi.PlaceholderAPI")
                    .getMethod("setPlaceholders", OfflinePlayer.class, String.class);
        } catch (ReflectiveOperationException e) {
            plugin.getLogger().warning("無法連接 PlaceholderAPI：" + e);
            return;
        }
        ConfigurationSection sec = plugin.getConfig().getConfigurationSection("stats.papi.placeholders");
        if (sec != null) for (String f : FIELDS) {
            String v = sec.getString(f, "");
            if (v != null && !v.isBlank()) placeholders.put(f, v.trim());
        }
        plugin.getLogger().info("戰績來源：PlaceholderAPI（" + String.join(", ", placeholders.keySet()) + "）");
    }

    /** 讀取所有線上玩家的佔位符並一次送到網站。 */
    public void syncAll() {
        if (!active() || !plugin.api().configured()) return;
        List<CompletableFuture<JsonObject>> jobs = new ArrayList<>();
        for (Player p : Bukkit.getOnlinePlayers()) {
            CompletableFuture<JsonObject> f = new CompletableFuture<>();
            jobs.add(f);
            // 讀統計值要在玩家所屬的區域執行緒（Folia / Canvas）
            try {
                Sched.entity(p, () -> {
                    try { f.complete(read(p)); } catch (Throwable t) { f.complete(null); }
                });
            } catch (Throwable t) { f.complete(null); }
        }
        if (jobs.isEmpty()) return;
        CompletableFuture.allOf(jobs.toArray(new CompletableFuture[0]))
                .completeOnTimeout(null, 10, java.util.concurrent.TimeUnit.SECONDS)
                .whenComplete((v, err) -> {
                    JsonArray arr = new JsonArray();
                    for (CompletableFuture<JsonObject> j : jobs) {
                        JsonObject o = j.getNow(null);
                        if (o != null && o.size() > 2) arr.add(o);
                    }
                    if (!arr.isEmpty()) plugin.api().post("/api/plugin/stats", ApiClient.obj("players", arr));
                });
    }

    private JsonObject read(Player p) throws ReflectiveOperationException {
        JsonObject o = ApiClient.obj("uuid", p.getUniqueId().toString(), "name", p.getName());
        for (var e : placeholders.entrySet()) {
            String raw = (String) setPlaceholders.invoke(null, p, e.getValue());
            Long n = number(raw);
            if (n != null) o.addProperty(e.getKey(), n);
        }
        return o;
    }

    /** 取出數字（容許千分位逗號、小數）；沒被替換的佔位符或非數字回傳 null。 */
    static Long number(String raw) {
        if (raw == null || raw.contains("%")) return null;
        String s = raw.replaceAll("[,\\s]", "");
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("-?\\d+(\\.\\d+)?").matcher(s);
        if (!m.find()) return null;
        try { return Math.max(0, Math.round(Double.parseDouble(m.group()))); } catch (NumberFormatException ex) { return null; }
    }
}
