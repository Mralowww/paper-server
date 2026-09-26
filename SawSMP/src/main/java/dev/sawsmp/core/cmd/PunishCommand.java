package dev.sawsmp.core.cmd;

import com.google.gson.JsonObject;
import dev.sawsmp.core.SawSMPPlugin;
import dev.sawsmp.core.api.ApiClient;
import dev.sawsmp.core.util.Durations;
import dev.sawsmp.core.util.Msg;
import dev.sawsmp.core.util.Sched;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * /ban /tempban /ipban /mute /tempmute /warn /kick 與 /unban /unipban /unmute。
 * 用法：/ban 玩家 [時長] [-s] [原因]，-s 為靜默（只通知管理團隊）。處罰會寫入網站並同步到所有地方。
 */
public final class PunishCommand implements TabExecutor {
    private static final List<String> DURS = List.of("30m", "1h", "12h", "1d", "3d", "7d", "30d", "perm");
    private final SawSMPPlugin plugin;

    public PunishCommand(SawSMPPlugin plugin) { this.plugin = plugin; }

    private static String typeOf(String label) {
        return switch (label.toLowerCase(Locale.ROOT)) {
            case "ban", "tempban" -> "ban";
            case "ipban", "ban-ip" -> "ipban";
            case "mute", "tempmute" -> "mute";
            case "warn" -> "warn";
            case "kick" -> "kick";
            case "unban", "pardon" -> "unban";
            case "unipban", "pardon-ip" -> "unipban";
            case "unmute" -> "unmute";
            default -> "";
        };
    }

    private static String typeName(String t) {
        return switch (t) { case "ban" -> "封禁"; case "ipban" -> "IP 封禁"; case "mute" -> "禁言"; case "warn" -> "警告"; case "kick" -> "踢出"; default -> t; };
    }

    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        String type = typeOf(cmd.getName());
        if (!plugin.api().configured()) { Msg.send(sender, "<red>插件尚未設定網站 API 金鑰（config.yml → api.key）。</red>"); return true; }
        if (args.length < 1) { Msg.send(sender, "<gray>用法：</gray><white>{u}</white>", "u", cmd.getUsage()); return true; }
        String target = args[0];
        String staff = sender instanceof Player p ? p.getName() : "Console";
        List<String> rest = new ArrayList<>(Arrays.asList(args).subList(1, args.length));
        boolean silent = rest.remove("-s");
        if (silent && !sender.hasPermission("sawsmp.silent")) { Msg.send(sender, "<red>你沒有使用靜默處罰的權限。</red>"); return true; }

        if (type.startsWith("un")) {
            String revokeType = switch (type) { case "unban" -> "ban"; case "unipban" -> "ipban"; default -> "mute"; };
            String reason = String.join(" ", rest);
            plugin.api().post("/api/plugin/revoke", ApiClient.obj("name", target, "type", revokeType, "staff_name", staff, "reason", reason)).thenAccept(r -> {
                if (!r.ok()) { Msg.send(sender, "<red>解除失敗：{e}</red>", "e", r.error()); return; }
                // 不論網站上有沒有這筆，都清掉遊戲內其他插件（原版 / AdvancedBan）的紀錄
                plugin.punish().pardonElsewhere(revokeType, target, "ipban".equals(revokeType) ? target : null);
                if (ApiClient.str(r.body(), "id") == null) Msg.send(sender, "<yellow>網站上沒有 {p} 生效中的{t}，已清除遊戲內的紀錄。</yellow>", "p", target, "t", typeName(revokeType));
                else Msg.send(sender, "<green>已解除 {p} 的{t}（#{id}）。</green>", "p", target, "t", typeName(revokeType), "id", ApiClient.str(r.body(), "id"));
                if ("mute".equals(revokeType)) {
                    Player online = Bukkit.getPlayerExact(target);
                    if (online != null) { plugin.punish().setMute(online.getUniqueId(), null); Sched.entity(online, () -> Msg.send(online, "<green>你的禁言已解除。</green>")); }
                }
                Msg.notifyStaff("<gray>{s} 解除了 {p} 的{t}</gray>", "s", staff, "p", target, "t", typeName(revokeType));
            });
            return true;
        }

        long seconds = 0; // 0 = 永久
        boolean needsDuration = cmd.getName().startsWith("temp");
        if (!rest.isEmpty() && !"warn".equals(type) && !"kick".equals(type)) {
            long d = Durations.parse(rest.get(0));
            if (d >= 0) { seconds = d; rest.remove(0); }
        }
        if (needsDuration && seconds <= 0) { Msg.send(sender, "<red>請提供時長，例如 1d、12h、30m。</red>"); return true; }
        String reason = String.join(" ", rest).trim();
        if (reason.isEmpty()) {
            if ("warn".equals(type)) { Msg.send(sender, "<red>警告必須填寫原因。</red>"); return true; }
            reason = "未提供原因";
        }
        Player online = Bukkit.getPlayerExact(target);
        String ip = online != null && online.getAddress() != null ? online.getAddress().getAddress().getHostAddress() : null;
        JsonObject body = ApiClient.obj("name", target, "uuid", online != null ? online.getUniqueId().toString() : null, "type", type,
                "reason", reason, "duration", seconds > 0 ? seconds : null, "staff_name", staff, "ip", "ipban".equals(type) ? ip : null, "silent", silent);
        final long dur = seconds;
        final String why = reason;
        plugin.api().post("/api/plugin/punish", body).thenAccept(r -> {
            if (!r.ok()) { Msg.send(sender, "<red>處罰失敗：{e}</red>", "e", r.error()); return; }
            String name = ApiClient.str(r.body(), "name");
            String id = ApiClient.str(r.body(), "id");
            String durText = "kick".equals(type) || "warn".equals(type) ? "" : "（" + Durations.format(dur) + "）";
            applyLocally(type, ApiClient.str(r.body(), "uuid"), name, why, ApiClient.str(r.body(), "message"), ApiClient.str(r.body(), "expires_at"), ApiClient.str(r.body(), "ip"), id);
            Msg.send(sender, "<green>已{t} {p}{d}，編號 #{id}。</green>", "t", typeName(type), "p", name, "d", durText, "id", id);
            if (silent) Msg.notifyStaff("<dark_gray>[靜默]</dark_gray> <gray>{s} {t}了 {p}{d}：{r}</gray>", "s", staff, "t", typeName(type), "p", name, "d", durText, "r", why);
            else Msg.broadcast("<gray>⚖ <white>{p}</white> 被 <white>{s}</white> <red>{t}</red>{d}：<white>{r}</white></gray>", "p", name, "s", staff, "t", typeName(type), "d", durText, "r", why);
        });
        return true;
    }

    /** 遊戲內下的處罰由插件自己立即執行（網站不會再下發一次）。 */
    private void applyLocally(String type, String uuid, String name, String reason, String kickMsg, String expires, String ip, String id) {
        Player p = uuid == null ? Bukkit.getPlayerExact(name) : Bukkit.getPlayer(java.util.UUID.fromString(uuid));
        switch (type) {
            case "ban", "kick", "ipban" -> {
                Component msg = Component.text(kickMsg == null ? "你已被踢出伺服器：" + reason : kickMsg);
                if (p != null) Sched.entity(p, () -> p.kick(msg));
                if ("ipban".equals(type) && ip != null) {
                    for (Player o : Bukkit.getOnlinePlayers()) {
                        if (o.getAddress() != null && ip.equals(o.getAddress().getAddress().getHostAddress())) Sched.entity(o, () -> o.kick(msg));
                    }
                }
            }
            case "mute" -> {
                if (p == null) return;
                plugin.punish().setMute(p.getUniqueId(), ApiClient.obj("id", id, "reason", reason, "expires_at", expires));
                Sched.entity(p, () -> Msg.send(p, "<red>你已被禁言：</red><white>{r}</white> <gray>（{t}）</gray>", "r", reason, "t", Durations.remaining(expires)));
            }
            case "warn" -> {
                if (p == null) return;
                JsonObject payload = ApiClient.obj("uuid", p.getUniqueId().toString(), "reason", reason);
                plugin.punish().handleAction("warn", payload);
            }
            default -> { }
        }
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command cmd, String label, String[] args) {
        String type = typeOf(cmd.getName());
        if (args.length == 1) {
            String pre = args[0].toLowerCase(Locale.ROOT);
            return Bukkit.getOnlinePlayers().stream().map(Player::getName).filter(n -> n.toLowerCase(Locale.ROOT).startsWith(pre)).toList();
        }
        if (args.length == 2 && !type.startsWith("un") && !"warn".equals(type) && !"kick".equals(type)) {
            return DURS.stream().filter(d -> d.startsWith(args[1].toLowerCase(Locale.ROOT))).toList();
        }
        if (args.length >= 2 && !type.startsWith("un") && sender.hasPermission("sawsmp.silent") && "-s".startsWith(args[args.length - 1])) return List.of("-s");
        return List.of();
    }
}
