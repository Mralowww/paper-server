package dev.sawsmp.core.cmd;

import dev.sawsmp.core.SawSMPPlugin;
import dev.sawsmp.core.util.Msg;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;

import java.util.List;

/** /sawsmp reload|status */
public final class AdminCommand implements TabExecutor {
    private final SawSMPPlugin plugin;

    public AdminCommand(SawSMPPlugin plugin) { this.plugin = plugin; }

    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        String sub = args.length > 0 ? args[0].toLowerCase() : "status";
        if (sub.equals("reload")) {
            plugin.reloadSettings();
            plugin.perms().refreshAll();
            Msg.send(sender, "<green>設定已重新載入，權限已重新同步。</green>");
            return true;
        }
        plugin.api().get("/api/plugin/ping").thenAccept(r -> Msg.send(sender,
                "<gray>網站：</gray>{u}<gray> · 連線：</gray>" + (r.ok() ? "<green>正常</green>" : "<red>{e}</red>")
                        + "<gray> · 進行中對戰：</gray><white>{m}</white>",
                "u", plugin.getConfig().getString("api.url"), "e", r.error(), "m", String.valueOf(plugin.matches().active())));
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender s, Command c, String l, String[] args) {
        return args.length == 1 ? List.of("reload", "status").stream().filter(x -> x.startsWith(args[0])).toList() : List.of();
    }
}
