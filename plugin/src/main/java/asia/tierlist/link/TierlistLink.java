package asia.tierlist.link;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Asks Mc.Tierlist.Asia whether each joining player is banned or needs to link their Discord account. */
public final class TierlistLink extends JavaPlugin implements Listener {
    private static final LegacyComponentSerializer SECTION = LegacyComponentSerializer.legacySection();
    private static final LegacyComponentSerializer AMPERSAND = LegacyComponentSerializer.legacyAmpersand();

    private final Map<UUID, Component> joinMessages = new ConcurrentHashMap<>();
    private Api api;
    private EventQueue events;
    private CorePlusSync corePlus;
    private Punishments punish;
    private boolean statsEnabled;
    private HttpClient http;
    private String apiUrl;
    private String serverKey;
    private boolean requireLink;
    private boolean opsBypass;
    private boolean failOpen;
    private boolean showLinked;
    private Duration timeout;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadSettings();
        getServer().getPluginManager().registerEvents(this, this);
        if (serverKey.isEmpty()) {
            getLogger().warning("config.yml 的 server-key 還沒填！請到網站後台建立「官方伺服器插件」金鑰。");
        }
        events = new EventQueue(api, getLogger());
        punish = new Punishments(this, api);
        punish.setBlockedCommands(getConfig().getStringList("punish.muted-blocked-commands"));
        getServer().getPluginManager().registerEvents(punish, this);
        for (String c : Punishments.COMMANDS) {
            org.bukkit.command.PluginCommand pc = getCommand(c);
            if (pc != null) pc.setTabCompleter(punish);
        }
        long syncTicks = Math.max(20L, getConfig().getLong("punish.sync-seconds", 5) * 20L);
        getServer().getScheduler().runTaskTimerAsynchronously(this, punish::poll, 40L, syncTicks);
        getServer().getScheduler().runTaskTimer(this, punish::refreshPermissions, 1200L, 1200L);
        if (statsEnabled) {
            getServer().getPluginManager().registerEvents(new CombatTracker(events), this);
            getServer().getScheduler().runTaskTimerAsynchronously(this, events::flush, 100L, 100L);
            getServer().getScheduler().runTaskTimer(this, this::sendPresence, 200L, 1200L);
        }
        if (getConfig().getBoolean("coreplus.enabled", true)) {
            long every = Math.max(1, getConfig().getLong("coreplus.sync-minutes", 10)) * 1200L;
            getServer().getScheduler().runTaskTimerAsynchronously(this, this::syncCorePlus, 600L, every);
        }
    }

    @Override
    public void onDisable() {
        if (events == null || !statsEnabled) return;
        // Close everyone's session so the website doesn't keep them "online" through a restart.
        for (org.bukkit.entity.Player p : getServer().getOnlinePlayers()) {
            JsonObject e = new JsonObject();
            e.addProperty("type", "quit");
            e.add("player", CombatTracker.ref(p));
            e.addProperty("world", p.getWorld().getName());
            events.add(e);
        }
        events.flush();
    }

    /** Heartbeat with who is online and in which world (runs on the main thread, sends async). */
    private void sendPresence() {
        com.google.gson.JsonArray list = new com.google.gson.JsonArray();
        for (org.bukkit.entity.Player p : getServer().getOnlinePlayers()) {
            JsonObject o = CombatTracker.ref(p);
            o.addProperty("world", p.getWorld().getName());
            list.add(o);
        }
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            if (!api.hasKey()) return;
            JsonObject body = new JsonObject();
            body.add("players", list);
            if (corePlus != null && corePlus.available()) body.add("worlds", corePlus.worlds());
            try {
                api.post("/api/server/presence", body);
            } catch (Exception e) {
                getLogger().fine("presence failed: " + e.getMessage());
            }
        });
    }

    private void syncCorePlus() {
        if (corePlus == null || !corePlus.available() || !api.hasKey()) return;
        try {
            corePlus.sync(api);
        } catch (Exception e) {
            getLogger().warning("CorePlus 資料同步失敗：" + e.getMessage());
        }
    }

    private void loadSettings() {
        reloadConfig();
        apiUrl = getConfig().getString("api-url", "https://tierlist.asia").replaceAll("/+$", "");
        serverKey = getConfig().getString("server-key", "").trim();
        requireLink = getConfig().getBoolean("require-link", true);
        opsBypass = getConfig().getBoolean("ops-bypass-link", true);
        failOpen = getConfig().getBoolean("fail-open", true);
        showLinked = getConfig().getBoolean("show-linked-message", false);
        timeout = Duration.ofMillis(Math.max(1000, getConfig().getLong("timeout-ms", 5000)));
        http = HttpClient.newBuilder().connectTimeout(timeout).build();
        statsEnabled = getConfig().getBoolean("stats.enabled", true);
        api = new Api(apiUrl, serverKey, timeout, getPluginMeta().getVersion());
        if (events != null) events.setApi(api);
        if (punish != null) {
            punish.setApi(api);
            punish.setBlockedCommands(getConfig().getStringList("punish.muted-blocked-commands"));
        }
        java.io.File cpFolder = new java.io.File(getDataFolder().getParentFile(), getConfig().getString("coreplus.folder", "CorePlus"));
        corePlus = getConfig().getBoolean("coreplus.enabled", true) ? new CorePlusSync(cpFolder, getLogger()) : null;
    }

    private String msg(String path) {
        return getConfig().getString("messages." + path, "");
    }

    /** Calls POST /api/server/join; throws on network or auth problems. */
    private JsonObject checkJoin(UUID uuid, String name, String ip) throws Exception {
        JsonObject body = new JsonObject();
        body.addProperty("uuid", uuid.toString());
        body.addProperty("name", name);
        body.addProperty("ip", ip);
        HttpRequest req = HttpRequest.newBuilder(URI.create(apiUrl + "/api/server/join"))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("User-Agent", "TierlistLink/" + getPluginMeta().getVersion())
                .header("X-API-Key", serverKey)
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) {
            throw new IllegalStateException("HTTP " + res.statusCode() + ": " + res.body());
        }
        return JsonParser.parseString(res.body()).getAsJsonObject();
    }

    private static String str(JsonObject o, String key) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : "";
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onPreLogin(AsyncPlayerPreLoginEvent event) {
        if (event.getLoginResult() != AsyncPlayerPreLoginEvent.Result.ALLOWED) return;
        UUID uuid = event.getUniqueId();
        JsonObject res;
        try {
            res = checkJoin(uuid, event.getName(), event.getAddress().getHostAddress());
        } catch (Exception e) {
            getLogger().warning("無法檢查 " + event.getName() + "：" + e.getMessage());
            if (!failOpen) {
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, AMPERSAND.deserialize(msg("unavailable")));
            }
            return;
        }
        punish.rememberLogin(uuid, res);
        if (res.get("allow").getAsBoolean()) {
            if (showLinked && res.has("discord")) {
                String discord = str(res.getAsJsonObject("discord"), "name");
                joinMessages.put(uuid, AMPERSAND.deserialize(msg("linked").replace("{discord}", discord)));
            }
            return;
        }
        String reason = str(res, "reason");
        Component kick = SECTION.deserialize(str(res, "kickMessage"));
        if ("banned".equals(reason)) {
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, kick);
            return;
        }
        if ("unlinked".equals(reason)) {
            boolean bypass = opsBypass && Bukkit.getOfflinePlayer(uuid).isOp();
            if (requireLink && !bypass) {
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, kick);
            } else {
                joinMessages.put(uuid, SECTION.deserialize(str(res, "chatMessage")));
            }
        }
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Component text = joinMessages.remove(event.getPlayer().getUniqueId());
        if (text != null) {
            Bukkit.getScheduler().runTaskLater(this, () -> {
                if (event.getPlayer().isOnline()) event.getPlayer().sendMessage(text);
            }, 40L);
        }
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        joinMessages.remove(event.getPlayer().getUniqueId());
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (Punishments.COMMANDS.contains(command.getName().toLowerCase())) {
            return punish.handle(sender, command.getName().toLowerCase(), args);
        }
        String sub = args.length > 0 ? args[0].toLowerCase() : "";
        if (sub.equals("reload")) {
            loadSettings();
            sender.sendMessage(AMPERSAND.deserialize("&6[Tierlist] &a設定已重新載入。"));
            return true;
        }
        if (sub.equals("sync")) {
            sender.sendMessage(AMPERSAND.deserialize("&6[Tierlist] &7正在上傳戰績與 CorePlus 資料…"));
            Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                events.flush();
                syncCorePlus();
                sender.sendMessage(AMPERSAND.deserialize("&6[Tierlist] &a完成，待上傳 " + events.size() + " 筆"));
            });
            return true;
        }
        if (sub.equals("status")) {
            sender.sendMessage(AMPERSAND.deserialize("&6[Tierlist] &7正在測試連線到 &f" + apiUrl + " &7…"));
            Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                String line;
                try {
                    HttpRequest req = HttpRequest.newBuilder(URI.create(apiUrl + "/api/health")).timeout(timeout)
                            .header("User-Agent", "TierlistLink/" + getPluginMeta().getVersion()).GET().build();
                    int code = http.send(req, HttpResponse.BodyHandlers.discarding()).statusCode();
                    line = code == 200 ? "&a網站連線正常" : "&c網站回應 HTTP " + code;
                } catch (Exception e) {
                    line = "&c連線失敗：" + e.getMessage();
                }
                for (String l : List.of(line,
                        "&7伺服器金鑰：" + (serverKey.isEmpty() ? "&c未設定" : "&a已設定"),
                        "&7未綁定玩家：" + (requireLink ? "&f踢出並顯示驗證碼" : "&f允許進入並提示"),
                        "&7網站離線時：" + (failOpen ? "&f放行" : "&f拒絕進入"),
                        "&7戰績記錄：" + (statsEnabled ? "&a開啟 &7（待上傳 " + events.size() + " 筆）" : "&c關閉"),
                        "&7CorePlus 同步：" + (corePlus == null ? "&c關閉" : corePlus.available() ? "&a已找到資料" : "&e找不到 CorePlus 資料夾"))) {
                    sender.sendMessage(AMPERSAND.deserialize("&6[Tierlist] " + l));
                }
            });
            return true;
        }
        sender.sendMessage(AMPERSAND.deserialize("&6[Tierlist] &f用法：/tierlist <reload|status|sync>"));
        return true;
    }
}
