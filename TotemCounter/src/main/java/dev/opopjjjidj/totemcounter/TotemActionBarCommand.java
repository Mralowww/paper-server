package dev.opopjjjidj.totemcounter;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public class TotemActionBarCommand implements CommandExecutor {

    private final TotemCounterPlugin plugin;

    public TotemActionBarCommand(TotemCounterPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§c此指令只能由玩家執行。");
            return true;
        }

        if (args.length < 1 || !args[0].equalsIgnoreCase("toggle")) {
            sender.sendMessage("§e用法: /totemactionbar toggle");
            return true;
        }

        boolean nowEnabled = plugin.getActionBarManager().toggle(player.getUniqueId());
        if (nowEnabled) {
            player.sendMessage("§a已開啟圖騰 Actionbar 顯示。");
        } else {
            player.sendMessage("§c已關閉圖騰 Actionbar 顯示。");
        }
        return true;
    }
}
