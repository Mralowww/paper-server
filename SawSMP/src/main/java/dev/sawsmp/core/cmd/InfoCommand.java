package dev.sawsmp.core.cmd;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.sawsmp.core.SawSMPPlugin;
import dev.sawsmp.core.api.ApiClient;
import dev.sawsmp.core.util.Durations;
import dev.sawsmp.core.util.Msg;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;

import java.util.List;
import java.util.Locale;

/** /history 玩家：最近處罰紀錄；/check 玩家：目前生效中的處罰、綁定與狀態。 */
public final class InfoCommand implements TabExecutor {
    private final SawSMPPlugin plugin;

    public InfoCommand(SawSMPPlugin plugin) { this.plugin = plugin; }

    private static String color(String type) {
        return switch (type) { case "ban" -> "#ef6b6b"; case "mute" -> "#e2c25a"; case "warn" -> "#eb9a4f"; case "kick" -> "#6fa8e8"; default -> "#b196ea"; };
    }

    private static String name(String type) {
        return switch (type) { case "ban" -> "封禁"; case "ipban" -> "IP封禁"; case "mute" -> "禁言"; case "warn" -> "警告"; case "kick" -> "踢出"; default -> type; };
    }

    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        if (args.length < 1) { Msg.send(sender, "<gray>用法：</gray><white>{u}</white>", "u", cmd.getUsage()); return true; }
        boolean check = cmd.getName().equalsIgnoreCase("check");
        plugin.api().get("/api/plugin/history/" + ApiClient.enc(args[0])).thenAccept(r -> {
            if (!r.ok()) { Msg.send(sender, "<red>查詢失敗：{e}</red>", "e", r.error()); return; }
            JsonObject pl = r.body().getAsJsonObject("player");
            String n = ApiClient.str(pl, "name");
            int total = 0, active = 0;
            StringBuilder lines = new StringBuilder();
            for (JsonElement el : r.body().getAsJsonArray("punishments")) {
                JsonObject p = el.getAsJsonObject();
                boolean on = p.get("active").getAsInt() == 1;
                total++;
                if (on) active++;
                if (check && !on) continue;
                String t = ApiClient.str(p, "type");
                String state = on ? "<green>生效中</green> <gray>" + Durations.remaining(ApiClient.str(p, "expires_at")) + "</gray>" : "<dark_gray>已結束</dark_gray>";
                lines.append("\n <").append(color(t)).append(">").append(name(t)).append("</").append(color(t)).append("> <dark_gray>#")
                        .append(ApiClient.str(p, "id")).append("</dark_gray> <white>").append(esc(ApiClient.str(p, "reason")))
                        .append("</white> <gray>· ").append(esc(ApiClient.str(p, "staff_name"))).append("</gray> ").append(state);
            }
            JsonObject dc = r.body().has("discord") && r.body().get("discord").isJsonObject() ? r.body().getAsJsonObject("discord") : null;
            String head = check
                    ? "<#97c8c7><bold>{n}</bold></#97c8c7> <gray>· " + (pl.get("online").getAsBoolean() ? "<green>在線</green>" : "離線")
                      + " · Discord：" + (dc == null ? "未綁定" : "{d}") + (sender.hasPermission("sawsmp.admin") && ApiClient.str(pl, "last_ip") != null ? " · IP：{ip}" : "")
                      + "\n 生效中處罰 " + active + " 筆 · 歷史共 " + total + " 筆</gray>"
                    : "<#97c8c7><bold>{n}</bold></#97c8c7> <gray>的處罰紀錄（最近 " + total + " 筆）</gray>";
            String body = lines.isEmpty() ? "\n <gray>" + (check ? "目前沒有生效中的處罰。" : "沒有任何紀錄。") + "</gray>" : lines.toString();
            sender.sendMessage(Msg.parse(head + body, "n", n, "d", dc == null ? "" : ApiClient.str(dc, "username"), "ip", ApiClient.str(pl, "last_ip")));
        });
        return true;
    }

    private static String esc(String s) { return s == null ? "" : s.replace("<", "\\<"); }

    @Override
    public List<String> onTabComplete(CommandSender s, Command c, String l, String[] args) {
        if (args.length != 1) return List.of();
        String pre = args[0].toLowerCase(Locale.ROOT);
        return Bukkit.getOnlinePlayers().stream().map(Player::getName).filter(n -> n.toLowerCase(Locale.ROOT).startsWith(pre)).toList();
    }
}
