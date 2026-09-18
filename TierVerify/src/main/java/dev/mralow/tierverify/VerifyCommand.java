package dev.mralow.tierverify;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public class VerifyCommand implements CommandExecutor {

    private final VerifyService verifyService;

    public VerifyCommand(VerifyService verifyService) {
        this.verifyService = verifyService;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("這個指令只能在遊戲內使用。");
            return true;
        }

        if (args.length != 1) {
            player.sendMessage(Component.text("用法: /verify <網站給你的驗證碼>", NamedTextColor.YELLOW));
            return true;
        }

        String code = args[0].trim();
        player.sendMessage(Component.text("驗證中,請稍候...", NamedTextColor.GRAY));

        verifyService.verifyAsync(player.getUniqueId(), player.getName(), code, result -> {
            NamedTextColor color = result.ok() ? NamedTextColor.GREEN : NamedTextColor.RED;
            player.sendMessage(Component.text(result.message(), color));
        });

        return true;
    }
}
