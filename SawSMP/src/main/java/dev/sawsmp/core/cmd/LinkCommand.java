package dev.sawsmp.core.cmd;

import dev.sawsmp.core.SawSMPPlugin;
import dev.sawsmp.core.api.ApiClient;
import dev.sawsmp.core.util.Msg;
import dev.sawsmp.core.util.Sched;
import org.bukkit.Sound;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** /link 驗證碼：把 Minecraft 帳號綁定到網站（Discord）帳號。 */
public final class LinkCommand implements CommandExecutor {
    private final SawSMPPlugin plugin;

    public LinkCommand(SawSMPPlugin plugin) { this.plugin = plugin; }

    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        if (!(sender instanceof Player p)) { Msg.send(sender, "<red>只有玩家可以使用。</red>"); return true; }
        if (args.length != 1) {
            Msg.send(p, "<gray>請到網站「我的帳號」產生驗證碼，再輸入 </gray><#97c8c7>/link 驗證碼</#97c8c7>");
            return true;
        }
        plugin.api().post("/api/plugin/link", ApiClient.obj("code", args[0], "uuid", p.getUniqueId().toString(), "name", p.getName())).thenAccept(r ->
                Sched.entity(p, () -> {
                    boolean ok = r.ok() && r.body().has("ok") && r.body().get("ok").getAsBoolean();
                    String m = r.ok() ? ApiClient.str(r.body(), "message") : r.error();
                    Msg.send(p, (ok ? "<green>" : "<red>") + "{m}", "m", m);
                    if (ok) {
                        p.playSound(p.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 1f, 1.2f);
                        plugin.perms().refresh(p);
                    }
                }));
        return true;
    }
}
