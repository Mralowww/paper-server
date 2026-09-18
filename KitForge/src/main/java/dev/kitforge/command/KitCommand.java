package dev.kitforge.command;

import dev.kitforge.KitForgePlugin;
import dev.kitforge.gui.EditKitRoomGUI;
import dev.kitforge.gui.ItemUtil;
import dev.kitforge.gui.KitRoomGUI;
import dev.kitforge.gui.MainMenuGUI;
import dev.kitforge.listener.JoinListener;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.List;

public class KitCommand implements CommandExecutor, TabCompleter {

    private final KitForgePlugin plugin;

    public KitCommand(KitForgePlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command, @NotNull String label, @NotNull String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("僅限玩家使用");
            return true;
        }

        if (args.length >= 1 && args[0].equalsIgnoreCase("reload")) {
            if (!player.hasPermission("kitforge.admin")) {
                player.sendMessage(ItemUtil.mm("<red>你沒有權限執行此指令</red>"));
                return true;
            }
            plugin.reload();
            player.sendMessage(ItemUtil.mm("<green>KitForge 設定已重新載入</green>"));
            return true;
        }

        if (args.length >= 1 && args[0].equalsIgnoreCase("tutorial")) {
            dev.kitforge.dialog.TutorialDialog.show(player, () -> JoinListener.markTutorialSeen(player));
            return true;
        }

        if (args.length >= 1 && args[0].equalsIgnoreCase("room")) {
            if (args.length >= 2 && args[1].equalsIgnoreCase("edit")) {
                if (!player.hasPermission("kitforge.kitroom.edit")) {
                    player.sendMessage(ItemUtil.mm("<red>你沒有權限編輯 Kit 房間</red>"));
                    return true;
                }
                new EditKitRoomGUI(plugin).open(player);
                return true;
            }
            new KitRoomGUI(plugin, false).open(player);
            return true;
        }

        if (!JoinListener.hasSeenTutorial(player)) {
            dev.kitforge.dialog.TutorialDialog.show(player, () -> {
                JoinListener.markTutorialSeen(player);
                new MainMenuGUI(plugin).open(player);
            });
            return true;
        }

        new MainMenuGUI(plugin).open(player);
        return true;
    }

    @Override
    public @Nullable List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command, @NotNull String alias, @NotNull String[] args) {
        if (args.length == 1) return List.of("tutorial", "room", "reload");
        if (args.length == 2 && args[0].equalsIgnoreCase("room")) return List.of("edit");
        return List.of();
    }
}
