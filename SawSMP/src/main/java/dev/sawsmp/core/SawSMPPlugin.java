package dev.sawsmp.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.sawsmp.core.api.ApiClient;
import dev.sawsmp.core.cmd.AdminCommand;
import dev.sawsmp.core.cmd.InfoCommand;
import dev.sawsmp.core.cmd.LinkCommand;
import dev.sawsmp.core.cmd.PunishCommand;
import dev.sawsmp.core.match.MatchService;
import dev.sawsmp.core.perm.PermService;
import dev.sawsmp.core.punish.PunishService;
import dev.sawsmp.core.stats.StatsListener;
import dev.sawsmp.core.util.Msg;
import dev.sawsmp.core.util.Sched;
import org.bukkit.Bukkit;
import org.bukkit.command.PluginCommand;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.concurrent.atomic.AtomicBoolean;

/** 鋸齒 SMP 核心插件：與網站雙向同步懲處、帳號綁定、權限、戰績與配對對戰。 */
public final class SawSMPPlugin extends JavaPlugin {
    private ApiClient api;
    private PunishService punish;
    private PermService perms;
    private MatchService matches;
    private final AtomicBoolean beating = new AtomicBoolean();
    private volatile boolean warnedOffline;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        Sched.init(this);
        api = new ApiClient(getLogger());
        reloadSettings();
        punish = new PunishService(this);
        perms = new PermService(this);
        matches = new MatchService(this);

        var pm = getServer().getPluginManager();
        pm.registerEvents(punish, this);
        pm.registerEvents(new StatsListener(this), this);
        pm.registerEvents(matches, this);

        PunishCommand pc = new PunishCommand(this);
        for (String c : new String[]{"ban", "tempban", "ipban", "mute", "tempmute", "warn", "kick", "unban", "unipban", "unmute"}) bind(c, pc);
        InfoCommand ic = new InfoCommand(this);
        bind("history", ic);
        bind("check", ic);
        PluginCommand link = getCommand("link");
        if (link != null) link.setExecutor(new LinkCommand(this));
        bind("sawsmp", new AdminCommand(this));

        if (!api.configured()) getLogger().warning("尚未設定 api.key：請到網站後台 → API Keys 產生插件金鑰，填入 config.yml 後執行 /sawsmp reload");
        Sched.asyncRepeating(this::heartbeat, Math.max(2, getConfig().getInt("heartbeat-seconds", 5)));
        // 重新載入插件時，替已在線的玩家同步權限
        Sched.globalLater(() -> perms.refreshAll(), 40);
        getLogger().info("鋸齒 SMP 核心已啟用");
    }

    @Override
    public void onDisable() {
        if (matches != null) matches.shutdown();
        if (perms != null) perms.clearAll();
    }

    private void bind(String name, TabExecutor ex) {
        PluginCommand c = getCommand(name);
        if (c != null) { c.setExecutor(ex); c.setTabCompleter(ex); }
    }

    public void reloadSettings() {
        reloadConfig();
        api.configure(getConfig().getString("api.url", ""), getConfig().getString("api.key", ""), getConfig().getInt("api.timeout-seconds", 5));
        Msg.setPrefix(getConfig().getString("messages.prefix", ""));
    }

    /** 回報線上玩家，取得網站排入的動作（踢出、禁言、權限重載、配對開始…），執行後回報完成。 */
    private void heartbeat() {
        if (!api.configured() || !beating.compareAndSet(false, true)) return;
        JsonArray online = new JsonArray();
        for (Player p : Bukkit.getOnlinePlayers()) online.add(ApiClient.obj("uuid", p.getUniqueId().toString(), "name", p.getName()));
        api.post("/api/plugin/heartbeat", ApiClient.obj("online", online)).whenComplete((r, err) -> {
            try {
                if (r == null || !r.ok()) {
                    if (!warnedOffline) getLogger().warning("無法連線到網站：" + (r == null ? err : r.error()));
                    warnedOffline = true;
                    return;
                }
                if (warnedOffline) getLogger().info("已恢復與網站的連線");
                warnedOffline = false;
                JsonArray done = new JsonArray();
                for (JsonElement el : r.body().getAsJsonArray("actions")) {
                    JsonObject a = el.getAsJsonObject();
                    try { handle(ApiClient.str(a, "action"), a.getAsJsonObject("payload")); }
                    catch (Exception ex) { getLogger().warning("執行動作失敗 " + a + "：" + ex.getMessage()); }
                    done.add(a.get("id"));
                }
                if (!done.isEmpty()) api.post("/api/plugin/actions/ack", ApiClient.obj("ids", done));
            } finally {
                beating.set(false);
            }
        });
    }

    private void handle(String action, JsonObject payload) {
        switch (action) {
            case "kick", "mute", "unmute", "warn" -> punish.handleAction(action, payload);
            case "permissions_reload" -> perms.refreshAll();
            case "match_start" -> Sched.global(() -> matches.start(payload));
            default -> getLogger().fine("未知的動作：" + action);
        }
    }

    public ApiClient api() { return api; }
    public PunishService punish() { return punish; }
    public PermService perms() { return perms; }
    public MatchService matches() { return matches; }
}
