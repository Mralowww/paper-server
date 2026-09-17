package dev.advancedkit.advancedkit.command;

import dev.advancedkit.advancedkit.AdvancedKitPlugin;
import dev.advancedkit.advancedkit.KitManager;
import dev.advancedkit.advancedkit.gui.KitMenuGUI;
import dev.advancedkit.advancedkit.kitroom.KitRoomGUI;
import dev.advancedkit.advancedkit.model.Kit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

public class KitCommand implements CommandExecutor, TabCompleter {

    private final AdvancedKitPlugin plugin;

    public KitCommand(AdvancedKitPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 0) {
            if (!(sender instanceof Player player)) {
                sender.sendMessage("僅限玩家使用，主控台請使用 /kit admin ...");
                return true;
            }
            player.openInventory(new KitMenuGUI(plugin).build(player));
            return true;
        }

        String sub = args[0].toLowerCase();
        switch (sub) {
            case "room", "kitroom" -> handleRoom(sender);
            case "create" -> handleCreate(sender, args);
            case "save" -> handleSave(sender, args);
            case "delete" -> handleDelete(sender, args);
            case "give" -> handleGive(sender, args);
            case "admin" -> handleAdmin(sender, args);
            case "reload" -> handleReload(sender);
            default -> sendUsage(sender);
        }
        return true;
    }

    private void handleRoom(CommandSender sender) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("僅限玩家使用");
            return;
        }
        if (!player.hasPermission("advancedkit.kitroom.use")) {
            player.sendMessage(Component.text("你沒有權限進入 Kit 房間").color(NamedTextColor.RED));
            return;
        }
        player.openInventory(new KitRoomGUI(plugin.getKitRoomManager()).build(player));
    }

    private void handleCreate(CommandSender sender, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("僅限玩家使用");
            return;
        }
        if (args.length < 2) {
            player.sendMessage(Component.text("用法: /kit create <名稱> [冷卻秒數]").color(NamedTextColor.RED));
            return;
        }
        String name = args[1];
        int cooldown = parseCooldown(args, 2, plugin.getConfig().getInt("default-cooldown-seconds", 300));

        KitManager.CreateResult result = plugin.getKitManager().createFromInventory(player, name, cooldown);
        switch (result) {
            case SUCCESS -> player.sendMessage(Component.text("已建立 Kit: " + name).color(NamedTextColor.GREEN));
            case ALREADY_EXISTS -> player.sendMessage(Component.text("已存在同名 Kit").color(NamedTextColor.RED));
            case LIMIT_REACHED -> player.sendMessage(Component.text("已達到 Kit 數量上限").color(NamedTextColor.RED));
            case EMPTY_INVENTORY -> player.sendMessage(Component.text("物品欄是空的，無法建立 Kit").color(NamedTextColor.RED));
        }
    }

    private void handleSave(CommandSender sender, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("僅限玩家使用");
            return;
        }
        if (args.length < 2) {
            player.sendMessage(Component.text("用法: /kit save <名稱>").color(NamedTextColor.RED));
            return;
        }
        Optional<Kit> kit = plugin.getKitManager().findOwnKit(player, args[1]);
        if (kit.isEmpty()) {
            player.sendMessage(Component.text("找不到此 Kit，請先使用 /kit create 建立").color(NamedTextColor.RED));
            return;
        }
        plugin.getKitManager().saveExisting(player, kit.get());
        player.sendMessage(Component.text("已更新 Kit: " + args[1]).color(NamedTextColor.GREEN));
    }

    private void handleDelete(CommandSender sender, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("僅限玩家使用");
            return;
        }
        if (args.length < 2) {
            player.sendMessage(Component.text("用法: /kit delete <名稱>").color(NamedTextColor.RED));
            return;
        }
        Optional<Kit> kit = plugin.getKitManager().findOwnKit(player, args[1]);
        if (kit.isEmpty()) {
            player.sendMessage(Component.text("找不到此 Kit").color(NamedTextColor.RED));
            return;
        }
        plugin.getKitManager().deleteKit(kit.get());
        player.sendMessage(Component.text("已刪除 Kit: " + args[1]).color(NamedTextColor.GREEN));
    }

    private void handleGive(CommandSender sender, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("僅限玩家使用");
            return;
        }
        if (args.length < 2) {
            player.sendMessage(Component.text("用法: /kit give <名稱>").color(NamedTextColor.RED));
            return;
        }
        String name = args[1];
        Optional<Kit> kit = plugin.getKitManager().findOwnKit(player, name);
        if (kit.isEmpty()) {
            kit = plugin.getKitManager().findServerKit(name);
        }
        if (kit.isEmpty()) {
            player.sendMessage(Component.text("找不到此 Kit").color(NamedTextColor.RED));
            return;
        }
        KitManager.ApplyResult result = plugin.getKitManager().applyKit(player, kit.get(), false);
        if (result == KitManager.ApplyResult.SUCCESS) {
            player.sendMessage(Component.text("已領取 Kit: " + name).color(NamedTextColor.GREEN));
        } else if (result == KitManager.ApplyResult.ON_COOLDOWN) {
            long remaining = plugin.getKitManager().getRemainingCooldownSeconds(player, kit.get());
            player.sendMessage(Component.text("此 Kit 冷卻中，還需等待 " + remaining + " 秒").color(NamedTextColor.RED));
        }
    }

    private void handleAdmin(CommandSender sender, String[] args) {
        if (!sender.hasPermission("advancedkit.admin")) {
            sender.sendMessage(Component.text("你沒有權限執行此指令").color(NamedTextColor.RED));
            return;
        }
        if (args.length < 2) {
            sender.sendMessage(Component.text("用法: /kit admin <create|delete|give> ...").color(NamedTextColor.RED));
            return;
        }
        String adminSub = args[1].toLowerCase();
        switch (adminSub) {
            case "create" -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("僅限玩家使用（需要目前的物品欄作為 Kit 內容）");
                    return;
                }
                if (args.length < 3) {
                    player.sendMessage(Component.text("用法: /kit admin create <名稱> [冷卻秒數]").color(NamedTextColor.RED));
                    return;
                }
                int cooldown = parseCooldown(args, 3, 0);
                Kit created = plugin.getKitManager().createServerKit(player, args[2], cooldown);
                if (created == null) {
                    player.sendMessage(Component.text("已存在同名伺服器 Kit").color(NamedTextColor.RED));
                } else {
                    player.sendMessage(Component.text("已建立伺服器 Kit: " + args[2]).color(NamedTextColor.GREEN));
                }
            }
            case "delete" -> {
                if (args.length < 3) {
                    sender.sendMessage(Component.text("用法: /kit admin delete <名稱>").color(NamedTextColor.RED));
                    return;
                }
                Optional<Kit> kit = plugin.getKitManager().findServerKit(args[2]);
                if (kit.isEmpty()) {
                    sender.sendMessage(Component.text("找不到此伺服器 Kit").color(NamedTextColor.RED));
                    return;
                }
                plugin.getKitManager().deleteKit(kit.get());
                sender.sendMessage(Component.text("已刪除伺服器 Kit: " + args[2]).color(NamedTextColor.GREEN));
            }
            case "give" -> {
                if (args.length < 4) {
                    sender.sendMessage(Component.text("用法: /kit admin give <玩家> <名稱>").color(NamedTextColor.RED));
                    return;
                }
                Player target = Bukkit.getPlayerExact(args[2]);
                if (target == null) {
                    sender.sendMessage(Component.text("找不到線上玩家: " + args[2]).color(NamedTextColor.RED));
                    return;
                }
                Optional<Kit> kit = plugin.getKitManager().findServerKit(args[3]);
                if (kit.isEmpty()) {
                    kit = plugin.getKitManager().findOwnKit(target, args[3]);
                }
                if (kit.isEmpty()) {
                    sender.sendMessage(Component.text("找不到此 Kit").color(NamedTextColor.RED));
                    return;
                }
                plugin.getKitManager().applyKit(target, kit.get(), true);
                sender.sendMessage(Component.text("已將 Kit " + args[3] + " 給予 " + target.getName())
                        .color(NamedTextColor.GREEN));
                target.sendMessage(Component.text("管理員給予了你 Kit: " + args[3]).color(NamedTextColor.GREEN));
            }
            default -> sender.sendMessage(Component.text("用法: /kit admin <create|delete|give> ...").color(NamedTextColor.RED));
        }
    }

    private void handleReload(CommandSender sender) {
        if (!sender.hasPermission("advancedkit.admin")) {
            sender.sendMessage(Component.text("你沒有權限執行此指令").color(NamedTextColor.RED));
            return;
        }
        plugin.reloadConfig();
        plugin.getKitRoomManager().reload();
        sender.sendMessage(Component.text("AdvancedKit 設定已重新載入(含 kitroom.yml)").color(NamedTextColor.GREEN));
    }

    private int parseCooldown(String[] args, int index, int fallback) {
        if (args.length <= index) {
            return fallback;
        }
        try {
            return Math.max(0, Integer.parseInt(args[index]));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private void sendUsage(CommandSender sender) {
        sender.sendMessage(Component.text("=== AdvancedKit 指令 ===").color(NamedTextColor.AQUA));
        sender.sendMessage(Component.text("/kit - 開啟 Kit 選單").color(NamedTextColor.GRAY));
        sender.sendMessage(Component.text("/kit room - 開啟 Kit 房間(無限資源，拿取後用 create/save 存成 Kit)").color(NamedTextColor.GRAY));
        sender.sendMessage(Component.text("/kit create <名稱> [冷卻秒數] - 以目前物品欄建立新 Kit").color(NamedTextColor.GRAY));
        sender.sendMessage(Component.text("/kit save <名稱> - 更新既有 Kit 內容").color(NamedTextColor.GRAY));
        sender.sendMessage(Component.text("/kit delete <名稱> - 刪除 Kit").color(NamedTextColor.GRAY));
        sender.sendMessage(Component.text("/kit give <名稱> - 領取 Kit").color(NamedTextColor.GRAY));
        if (sender.hasPermission("advancedkit.admin")) {
            sender.sendMessage(Component.text("/kit admin create|delete|give ... - 管理伺服器 Kit").color(NamedTextColor.GRAY));
            sender.sendMessage(Component.text("/kit reload - 重新載入設定").color(NamedTextColor.GRAY));
        }
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        List<String> options = new ArrayList<>();
        if (args.length == 1) {
            options.addAll(List.of("room", "create", "save", "delete", "give"));
            if (sender.hasPermission("advancedkit.admin")) {
                options.addAll(List.of("admin", "reload"));
            }
            return filter(options, args[0]);
        }
        if (args.length == 2) {
            if (args[0].equalsIgnoreCase("save") || args[0].equalsIgnoreCase("delete") || args[0].equalsIgnoreCase("give")) {
                if (sender instanceof Player player) {
                    List<String> names = plugin.getKitManager().listOwnKits(player).stream()
                            .map(Kit::getName).collect(Collectors.toList());
                    if (args[0].equalsIgnoreCase("give")) {
                        names.addAll(plugin.getKitManager().listServerKits().stream()
                                .map(Kit::getName).toList());
                    }
                    return filter(names, args[1]);
                }
            }
            if (args[0].equalsIgnoreCase("admin")) {
                return filter(List.of("create", "delete", "give"), args[1]);
            }
        }
        if (args.length == 3 && args[0].equalsIgnoreCase("admin")) {
            if (args[1].equalsIgnoreCase("delete")) {
                return filter(plugin.getKitManager().listServerKits().stream().map(Kit::getName).toList(), args[2]);
            }
            if (args[1].equalsIgnoreCase("give")) {
                return filter(Bukkit.getOnlinePlayers().stream().map(Player::getName).toList(), args[2]);
            }
        }
        if (args.length == 4 && args[0].equalsIgnoreCase("admin") && args[1].equalsIgnoreCase("give")) {
            return filter(plugin.getKitManager().listServerKits().stream().map(Kit::getName).toList(), args[3]);
        }
        return options;
    }

    private List<String> filter(List<String> options, String prefix) {
        String lower = prefix.toLowerCase();
        return options.stream().filter(o -> o.toLowerCase().startsWith(lower)).collect(Collectors.toList());
    }
}
