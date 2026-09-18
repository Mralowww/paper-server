package dev.opopjjjidj.totemcounter;

import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public class TotemGuiCommand implements CommandExecutor {

    private final TotemCounterPlugin plugin;

    public TotemGuiCommand(TotemCounterPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player viewer)) {
            sender.sendMessage("§c此指令只能由玩家執行。");
            return true;
        }

        if (args.length < 1) {
            sender.sendMessage("§e用法: /totem <player>");
            return true;
        }

        Player target = Bukkit.getPlayerExact(args[0]);
        if (target == null) {
            sender.sendMessage("§c找不到線上玩家: " + args[0]);
            return true;
        }

        viewer.openInventory(TotemGui.open(plugin, target));
        return true;
    }
}
