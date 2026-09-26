package asia.tierlist.link;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.permissions.PermissionAttachment;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-game punishment commands, mute enforcement, live sync of punishments made on the website,
 * and permission nodes granted from the website.
 */
final class Punishments implements Listener, TabCompleter {
    private static final LegacyComponentSerializer SECTION = LegacyComponentSerializer.legacySection();
    static final List<String> COMMANDS = List.of("ban", "tempban", "unban", "ipban", "mute", "tempmute", "unmute",
            "warn", "kick", "history", "check");
    private static final List<String> DURATIONS = List.of("30m", "1h", "6h", "12h", "1d", "3d", "7d", "14d", "30d", "1mo", "3mo", "1y");

    private record Mute(long id, long expiresAt, String message) {}

    private final JavaPlugin plugin;
    private final Map<UUID, Mute> mutes = new ConcurrentHashMap<>();
    private final Map<UUID, PermissionAttachment> attachments = new ConcurrentHashMap<>();
    private final Map<UUID, JsonObject> pendingNodes = new ConcurrentHashMap<>();
    private final Set<String> handled = Collections.newSetFromMap(new ConcurrentHashMap<>());
    private volatile Api api;
    private volatile long cursor = 0;
    private volatile long permsVersion = -1;
    private volatile boolean broadcast = true;
    private List<String> blockedCommands = List.of();

    Punishments(JavaPlugin plugin, Api api) {
        this.plugin = plugin;
        this.api = api;
    }

    void setApi(Api api) {
        this.api = api;
    }

    void setBlockedCommands(List<String> cmds) {
        List<String> out = new ArrayList<>();
        for (String c : cmds) out.add(c.toLowerCase(Locale.ROOT).replaceFirst("^/", ""));
        blockedCommands = out;
    }

    // ------------------------------------------------------------ data from the login check
    /** Called from AsyncPlayerPreLoginEvent with the website's answer. */
    void rememberLogin(UUID uuid, JsonObject res) {
        if (res.has("nodes") && res.get("nodes").isJsonObject()) pendingNodes.put(uuid, res.getAsJsonObject("nodes"));
        if (res.has("mute") && res.get("mute").isJsonObject()) putMute(uuid, res.getAsJsonObject("mute"));
        else mutes.remove(uuid);
    }

    private void putMute(UUID uuid, JsonObject m) {
        long exp = m.has("expiresAt") && !m.get("expiresAt").isJsonNull() ? m.get("expiresAt").getAsLong() : 0;
        mutes.put(uuid, new Mute(m.get("id").getAsLong(), exp, m.get("message").getAsString()));
    }

    // ------------------------------------------------------------ permissions
    private void applyNodes(Player p, JsonObject nodes) {
        PermissionAttachment old = attachments.remove(p.getUniqueId());
        if (old != null) {
            try { p.removeAttachment(old); } catch (IllegalArgumentException ignored) { /* already gone */ }
        }
        if (nodes == null || nodes.size() == 0) return;
        PermissionAttachment att = p.addAttachment(plugin);
        for (Map.Entry<String, JsonElement> e : nodes.entrySet()) att.setPermission(e.getKey(), e.getValue().getAsBoolean());
        attachments.put(p.getUniqueId(), att);
        p.updateCommands();
    }

    /** Re-fetches nodes for everyone online (after a rule change on the website, or periodically for role changes). */
    void refreshPermissions() {
        List<Player> online = new ArrayList<>(Bukkit.getOnlinePlayers());
        if (online.isEmpty() || !api.hasKey()) return;
        JsonArray uuids = new JsonArray();
        online.forEach(p -> uuids.add(undashed(p.getUniqueId())));
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                JsonObject body = new JsonObject();
                body.add("uuids", uuids);
                JsonObject res = api.post("/api/server/perms", body);
                permsVersion = res.get("version").getAsLong();
                JsonObject players = res.getAsJsonObject("players");
                Bukkit.getScheduler().runTask(plugin, () -> {
                    for (Player p : Bukkit.getOnlinePlayers()) {
                        String key = undashed(p.getUniqueId());
                        if (players.has(key)) applyNodes(p, players.getAsJsonObject(key));
                    }
                });
            } catch (Exception e) {
                plugin.getLogger().fine("perms refresh failed: " + e.getMessage());
            }
        });
    }

    static String undashed(UUID u) {
        return u.toString().replace("-", "");
    }

    static UUID dashed(String s) {
        if (s == null || s.length() != 32) return null;
        return UUID.fromString(s.replaceFirst("(\\w{8})(\\w{4})(\\w{4})(\\w{4})(\\w{12})", "$1-$2-$3-$4-$5"));
    }

    // ------------------------------------------------------------ live sync with the website
    /** Runs off the main thread every few seconds. */
    void poll() {
        if (!api.hasKey()) return;
        JsonObject res;
        try {
            res = api.get("/api/server/sync?cursor=" + cursor);
        } catch (Exception e) {
            plugin.getLogger().fine("sync failed: " + e.getMessage());
            return;
        }
        boolean first = cursor == 0;
        cursor = res.get("cursor").getAsLong();
        if (res.has("settings")) broadcast = res.getAsJsonObject("settings").get("broadcast").getAsBoolean();
        if (first && res.has("mutes")) {
            mutes.clear();
            for (JsonElement el : res.getAsJsonArray("mutes")) {
                JsonObject m = el.getAsJsonObject();
                UUID u = dashed(str(m, "uuid"));
                if (u != null) putMute(u, m);
            }
        }
        long version = res.get("permsVersion").getAsLong();
        JsonArray changes = res.getAsJsonArray("changes");
        Bukkit.getScheduler().runTask(plugin, () -> {
            for (JsonElement el : changes) apply(el.getAsJsonObject(), false);
            if (version != permsVersion) {
                permsVersion = version;
                refreshPermissions();
            }
        });
    }

    private static String str(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : null;
    }

    /** Acts on one punishment (main thread). `fromCommand` = issued here, so always announce it. */
    private void apply(JsonObject p, boolean fromCommand) {
        long id = p.get("id").getAsLong();
        String type = str(p, "type");
        String status = str(p, "status");
        UUID uuid = dashed(str(p, "uuid"));
        if (!handled.add(id + ":" + status)) return;
        long created = p.get("createdAt").getAsLong();
        boolean fresh = fromCommand || System.currentTimeMillis() - created < 120_000;

        if ("mute".equals(type)) {
            if ("active".equals(status) && uuid != null) {
                long exp = p.has("expiresAt") && !p.get("expiresAt").isJsonNull() ? p.get("expiresAt").getAsLong() : 0;
                mutes.put(uuid, new Mute(id, exp, str(p, "chat")));
                Player t = Bukkit.getPlayer(uuid);
                if (t != null && fresh) t.sendMessage(SECTION.deserialize(str(p, "chat")));
            } else if (uuid != null) {
                Mute m = mutes.get(uuid);
                if (m != null && m.id() == id) {
                    mutes.remove(uuid);
                    Player t = Bukkit.getPlayer(uuid);
                    if (t != null) t.sendMessage(SECTION.deserialize("§a你的禁言已解除。"));
                }
            }
        } else if (("ban".equals(type) || "ipban".equals(type)) && "active".equals(status)) {
            Component screen = SECTION.deserialize(str(p, "screen"));
            String ip = str(p, "ip");
            for (Player t : new ArrayList<>(Bukkit.getOnlinePlayers())) {
                boolean hit = t.getUniqueId().equals(uuid)
                        || ("ipban".equals(type) && ip != null && t.getAddress() != null && ip.equals(t.getAddress().getAddress().getHostAddress()));
                if (hit) t.kick(screen);
            }
        } else if ("kick".equals(type) && fresh && uuid != null) {
            Player t = Bukkit.getPlayer(uuid);
            if (t != null) t.kick(SECTION.deserialize(str(p, "screen")));
        } else if ("warn".equals(type) && fresh && uuid != null) {
            Player t = Bukkit.getPlayer(uuid);
            if (t != null) {
                t.sendMessage(SECTION.deserialize(str(p, "warn")));
                t.showTitle(net.kyori.adventure.title.Title.title(SECTION.deserialize("§6§l警告"), SECTION.deserialize("§f" + str(p, "reason"))));
            }
        }
        boolean instant = "warn".equals(type) || "kick".equals(type);
        if (fresh && ("active".equals(status) || instant)) announce(p);
    }

    private void announce(JsonObject p) {
        String line = str(p, "broadcast");
        if (line == null) return;
        boolean silent = p.get("silent").getAsBoolean();
        Component msg = SECTION.deserialize((silent ? "§8[靜默] " : "") + line);
        if (!silent && broadcast) {
            Bukkit.broadcast(msg);
        } else {
            for (Player pl : Bukkit.getOnlinePlayers()) if (pl.hasPermission("tierlist.notify")) pl.sendMessage(msg);
            Bukkit.getConsoleSender().sendMessage(msg);
        }
    }

    // ------------------------------------------------------------ events
    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent e) {
        JsonObject nodes = pendingNodes.remove(e.getPlayer().getUniqueId());
        if (nodes != null) applyNodes(e.getPlayer(), nodes);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        PermissionAttachment att = attachments.remove(e.getPlayer().getUniqueId());
        if (att != null) {
            try { e.getPlayer().removeAttachment(att); } catch (IllegalArgumentException ignored) { /* gone */ }
        }
    }

    private Mute activeMute(UUID uuid) {
        Mute m = mutes.get(uuid);
        if (m == null) return null;
        if (m.expiresAt() > 0 && m.expiresAt() <= System.currentTimeMillis()) {
            mutes.remove(uuid);
            return null;
        }
        return m;
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onChat(AsyncChatEvent e) {
        Mute m = activeMute(e.getPlayer().getUniqueId());
        if (m != null) {
            e.setCancelled(true);
            e.getPlayer().sendMessage(SECTION.deserialize(m.message()));
        }
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent e) {
        Mute m = activeMute(e.getPlayer().getUniqueId());
        if (m == null) return;
        String label = e.getMessage().substring(1).split(" ", 2)[0].toLowerCase(Locale.ROOT);
        if (label.contains(":")) label = label.substring(label.indexOf(':') + 1);
        if (blockedCommands.contains(label)) {
            e.setCancelled(true);
            e.getPlayer().sendMessage(SECTION.deserialize(m.message()));
        }
    }

    // ------------------------------------------------------------ commands
    private static void say(CommandSender s, String legacy) {
        s.sendMessage(SECTION.deserialize(legacy));
    }

    private static String usage(String cmd) {
        return switch (cmd) {
            case "tempban", "tempmute" -> "§e用法：/" + cmd + " <玩家> <時間> [原因] §7[-s 靜默] [-d/-nd Discord 同步]  §8時間例如 30m、12h、7d、1mo";
            case "ipban" -> "§e用法：/ipban <玩家|IP> [原因] §7[-t 時間] [-s] [-d/-nd]";
            case "unban", "unmute" -> "§e用法：/" + cmd + " <玩家> [原因]";
            case "history", "check" -> "§e用法：/" + cmd + " <玩家>";
            default -> "§e用法：/" + cmd + " <玩家> [原因] §7[-s 靜默] [-d/-nd Discord 同步]";
        };
    }

    boolean handle(CommandSender sender, String cmd, String[] args) {
        if (!api.hasKey()) {
            say(sender, "§c[Tierlist] 還沒設定 server-key，無法使用處罰指令。");
            return true;
        }
        List<String> words = new ArrayList<>();
        boolean silent = false;
        Boolean discord = null;
        String flagDuration = null;
        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            switch (a.toLowerCase(Locale.ROOT)) {
                case "-s" -> silent = true;
                case "-d" -> discord = true;
                case "-nd" -> discord = false;
                case "-t" -> { if (i + 1 < args.length) flagDuration = args[++i]; }
                default -> words.add(a);
            }
        }
        if (silent && !sender.hasPermission("tierlist.silent")) silent = false;
        if (words.isEmpty() || ((cmd.equals("tempban") || cmd.equals("tempmute")) && words.size() < 2)) {
            say(sender, usage(cmd));
            return true;
        }
        String target = words.get(0);
        JsonObject body = new JsonObject();
        body.addProperty("target", target);
        JsonObject actor = new JsonObject();
        if (sender instanceof Player p) {
            actor.addProperty("uuid", undashed(p.getUniqueId()));
            actor.addProperty("name", p.getName());
        } else {
            actor.addProperty("name", "console");
        }
        body.add("actor", actor);

        if (cmd.equals("history") || cmd.equals("check")) {
            Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                try {
                    JsonObject res = api.post("/api/server/history", body);
                    Bukkit.getScheduler().runTask(plugin, () -> {
                        if (!res.get("ok").getAsBoolean()) { say(sender, res.get("message").getAsString()); return; }
                        say(sender, "§8§m                                        ");
                        say(sender, res.get("summary").getAsString());
                        JsonArray lines = res.getAsJsonArray("lines");
                        int max = cmd.equals("check") ? Math.min(3, lines.size()) : lines.size();
                        for (int i = 0; i < max; i++) say(sender, lines.get(i).getAsString());
                        if (lines.isEmpty()) say(sender, "§7沒有任何處罰紀錄。");
                        say(sender, "§8§m                                        ");
                    });
                } catch (Exception e) {
                    Bukkit.getScheduler().runTask(plugin, () -> say(sender, "§c無法連線到網站：" + e.getMessage()));
                }
            });
            return true;
        }

        int reasonFrom = 1;
        if (cmd.equals("tempban") || cmd.equals("tempmute")) {
            body.addProperty("duration", words.get(1));
            reasonFrom = 2;
        } else if (cmd.equals("ipban") && flagDuration != null) {
            body.addProperty("duration", flagDuration);
        }
        String reason = String.join(" ", words.subList(Math.min(reasonFrom, words.size()), words.size()));
        body.addProperty("action", cmd);
        body.addProperty("reason", reason);
        body.addProperty("silent", silent);
        if (discord != null) body.addProperty("discord", discord);

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                JsonObject res = api.post("/api/server/punish", body);
                Bukkit.getScheduler().runTask(plugin, () -> {
                    say(sender, res.get("message").getAsString());
                    if (res.get("ok").getAsBoolean() && res.has("punishment")) apply(res.getAsJsonObject("punishment"), true);
                });
            } catch (Exception e) {
                Bukkit.getScheduler().runTask(plugin, () -> say(sender, "§c無法連線到網站：" + e.getMessage()));
            }
        });
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        String cmd = command.getName().toLowerCase(Locale.ROOT);
        String last = args.length == 0 ? "" : args[args.length - 1].toLowerCase(Locale.ROOT);
        List<String> out = new ArrayList<>();
        if (args.length == 1) {
            for (Player p : Bukkit.getOnlinePlayers()) if (p.getName().toLowerCase(Locale.ROOT).startsWith(last)) out.add(p.getName());
        } else if (args.length == 2 && (cmd.equals("tempban") || cmd.equals("tempmute"))) {
            for (String d : DURATIONS) if (d.startsWith(last)) out.add(d);
        } else if (last.startsWith("-")) {
            for (String f : new HashSet<>(List.of("-s", "-d", "-nd", "-t"))) if (f.startsWith(last)) out.add(f);
        }
        Collections.sort(out);
        return out;
    }
}
