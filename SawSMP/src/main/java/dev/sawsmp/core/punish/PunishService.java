package dev.sawsmp.core.punish;

import com.google.gson.JsonObject;
import dev.sawsmp.core.SawSMPPlugin;
import dev.sawsmp.core.api.ApiClient;
import dev.sawsmp.core.util.Durations;
import dev.sawsmp.core.util.Msg;
import dev.sawsmp.core.util.Sched;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/** 進服封鎖檢查、禁言快取與攔截、網站下發的懲處動作。 */
public final class PunishService implements Listener {
    private static final Set<String> CHAT_COMMANDS = Set.of("msg", "tell", "w", "me", "say", "teammsg", "tm", "r", "reply",
            "whisper", "m", "pm", "dm", "mail");

    public record Mute(long id, String reason, Instant expires) {
        boolean expired() { return expires != null && Instant.now().isAfter(expires); }
    }

    private final SawSMPPlugin plugin;
    private final Map<UUID, Mute> mutes = new ConcurrentHashMap<>();

    public PunishService(SawSMPPlugin plugin) { this.plugin = plugin; }

    public void setMute(UUID uuid, JsonObject m) {
        if (m == null) { mutes.remove(uuid); return; }
        mutes.put(uuid, new Mute(m.has("id") && !m.get("id").isJsonNull() ? m.get("id").getAsLong() : 0,
                ApiClient.str(m, "reason"), Durations.parseIso(ApiClient.str(m, "expires_at"))));
    }

    public Mute muteOf(UUID uuid) {
        Mute m = mutes.get(uuid);
        if (m != null && m.expired()) { mutes.remove(uuid); return null; }
        return m;
    }

    // ---------- 事件 ----------

    @EventHandler(priority = EventPriority.HIGH)
    public void onPreLogin(AsyncPlayerPreLoginEvent e) {
        if (!plugin.getConfig().getBoolean("login.check", true) || !plugin.api().configured()) return;
        JsonObject body = ApiClient.obj("uuid", e.getUniqueId().toString(), "name", e.getName(),
                "ip", e.getAddress() == null ? null : e.getAddress().getHostAddress());
        ApiClient.Resp r;
        try {
            r = plugin.api().post("/api/plugin/login", body).get(plugin.getConfig().getInt("api.timeout-seconds", 5) + 1L, TimeUnit.SECONDS);
        } catch (Exception ex) {
            r = new ApiClient.Resp(0, null);
        }
        if (!r.ok()) {
            if (!plugin.getConfig().getBoolean("login.fail-open", true)) {
                e.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, Component.text("無法連線到鋸齒 SMP 驗證伺服器，請稍後再試。"));
            }
            return;
        }
        if (r.body().has("allowed") && !r.body().get("allowed").getAsBoolean()) {
            e.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, Component.text(ApiClient.str(r.body(), "message")));
            return;
        }
        JsonObject mute = r.body().has("mute") && r.body().get("mute").isJsonObject() ? r.body().getAsJsonObject("mute") : null;
        setMute(e.getUniqueId(), mute);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        plugin.perms().refresh(p);
        Mute m = muteOf(p.getUniqueId());
        if (m != null) Sched.entityLater(p, () -> Msg.send(p, "<red>你目前被禁言：</red><white>{r}</white> <gray>（剩餘 {t}）</gray>",
                "r", m.reason(), "t", m.expires() == null ? "永久" : Durations.format(m.expires().getEpochSecond() - Instant.now().getEpochSecond())), 40);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        UUID id = e.getPlayer().getUniqueId();
        plugin.perms().clear(e.getPlayer());
        if (plugin.api().configured()) plugin.api().post("/api/plugin/quit", ApiClient.obj("uuid", id.toString()));
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onChat(AsyncChatEvent e) {
        Mute m = muteOf(e.getPlayer().getUniqueId());
        if (m == null || e.getPlayer().hasPermission("sawsmp.bypass.mute")) return;
        e.setCancelled(true);
        Msg.send(e.getPlayer(), "<red>你被禁言中，無法發言。</red> <gray>原因：{r}（{t}）</gray>", "r", m.reason(),
                "t", m.expires() == null ? "永久" : "剩餘 " + Durations.format(m.expires().getEpochSecond() - Instant.now().getEpochSecond()));
    }

    /** 舊版聊天事件：部分聊天插件（格式化、跨服聊天）只聽這個事件，也要一併擋下。 */
    @SuppressWarnings("deprecation")
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onLegacyChat(org.bukkit.event.player.AsyncPlayerChatEvent e) {
        if (muteOf(e.getPlayer().getUniqueId()) == null || e.getPlayer().hasPermission("sawsmp.bypass.mute")) return;
        e.setCancelled(true);
    }

    /** 以網站回傳的完整清單覆蓋線上玩家的禁言狀態（每次心跳），確保不漏也不殘留。 */
    public void syncMutes(JsonObject list) {
        for (Player p : Bukkit.getOnlinePlayers()) {
            UUID id = p.getUniqueId();
            JsonObject m = list.has(id.toString()) && list.get(id.toString()).isJsonObject() ? list.getAsJsonObject(id.toString()) : null;
            setMute(id, m);
        }
    }

    /** 清掉遊戲內其他來源（原版、AdvancedBan）的同一筆封禁 / 禁言。 */
    public void pardonElsewhere(String type, String name, String ip) {
        Sched.global(() -> {
            var console = Bukkit.getConsoleSender();
            if ("ban".equals(type) && name != null) Bukkit.dispatchCommand(console, "minecraft:pardon " + name);
            if ("ipban".equals(type) && ip != null) Bukkit.dispatchCommand(console, "minecraft:pardon-ip " + ip);
            if (Bukkit.getPluginManager().isPluginEnabled("AdvancedBan")) {
                String cmd = switch (type) { case "mute" -> "advancedban:unmute"; default -> "advancedban:unban"; };
                String who = "ipban".equals(type) && ip != null ? ip : name;
                if (who != null) Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd + " " + who);
            }
        });
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent e) {
        if (muteOf(e.getPlayer().getUniqueId()) == null || e.getPlayer().hasPermission("sawsmp.bypass.mute")) return;
        String label = e.getMessage().substring(1).split(" ", 2)[0].toLowerCase();
        int colon = label.indexOf(':');
        if (colon >= 0) label = label.substring(colon + 1);
        if (CHAT_COMMANDS.contains(label)) {
            e.setCancelled(true);
            Msg.send(e.getPlayer(), "<red>你被禁言中，無法使用這個指令。</red>");
        }
    }

    // ---------- 網站下發的動作 ----------

    public void handleAction(String action, JsonObject p) {
        String uuidStr = ApiClient.str(p, "uuid");
        Player target = uuidStr == null ? null : Bukkit.getPlayer(UUID.fromString(uuidStr));
        switch (action) {
            case "kick" -> {
                Component msg = Component.text(ApiClient.str(p, "message") == null ? "你已被踢出伺服器" : ApiClient.str(p, "message"));
                if (target != null) Sched.entity(target, () -> target.kick(msg));
                String ip = ApiClient.str(p, "ip");
                if (ip != null) {
                    for (Player o : Bukkit.getOnlinePlayers()) {
                        if (o.getAddress() != null && ip.equals(o.getAddress().getAddress().getHostAddress())) Sched.entity(o, () -> o.kick(msg));
                    }
                }
            }
            case "mute" -> {
                if (target == null) return;
                setMute(target.getUniqueId(), ApiClient.obj("id", p.get("punishment_id"), "reason", ApiClient.str(p, "reason"), "expires_at", ApiClient.str(p, "expires_at")));
                Sched.entity(target, () -> Msg.send(target, "<red>你已被禁言：</red><white>{r}</white> <gray>（{t}）</gray>",
                        "r", ApiClient.str(p, "reason"), "t", Durations.remaining(ApiClient.str(p, "expires_at"))));
            }
            case "pardon" -> pardonElsewhere(ApiClient.str(p, "type"), ApiClient.str(p, "name"), ApiClient.str(p, "ip"));
            case "unmute" -> {
                if (target == null) return;
                mutes.remove(target.getUniqueId());
                Sched.entity(target, () -> Msg.send(target, "<green>你的禁言已解除。</green>"));
            }
            case "warn" -> {
                if (target == null) return;
                Sched.entity(target, () -> {
                    Msg.send(target, "<gold>⚠ 你收到一次警告：</gold><white>{r}</white>", "r", ApiClient.str(p, "reason"));
                    target.showTitle(net.kyori.adventure.title.Title.title(Msg.parse("<gold>⚠ 警告"), Msg.parse("<white>{r}", "r", ApiClient.str(p, "reason"))));
                });
            }
            default -> { }
        }
    }
}
