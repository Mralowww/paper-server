package dev.opopjjjidj.totemcounter;

import org.bukkit.OfflinePlayer;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;

public class TotemCounterCommand implements CommandExecutor {

    private final TotemCounterPlugin plugin;

    public TotemCounterCommand(TotemCounterPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("totemcounter.admin")) {
            sender.sendMessage("§c你沒有權限執行此指令。");
            return true;
        }

        if (args.length == 0) {
            sender.sendMessage("§e用法: /totemcounter reload|reset <player>");
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "reload" -> {
                plugin.getDataManager().save();
                plugin.getDataManager().load();
                sender.sendMessage("§aTotemCounter 資料已重新載入。");
            }
            case "reset" -> {
                if (args.length < 2) {
                    sender.sendMessage("§e用法: /totemcounter reset <player>");
                    return true;
                }
                OfflinePlayer target = Bukkit.getOfflinePlayer(args[1]);
                plugin.getDataManager().resetPlayer(target.getUniqueId());
                sender.sendMessage("§a已重置 " + args[1] + " 的圖騰資料。");
            }
            default -> sender.sendMessage("§e用法: /totemcounter reload|reset <player>");
        }
        return true;
    }
}
