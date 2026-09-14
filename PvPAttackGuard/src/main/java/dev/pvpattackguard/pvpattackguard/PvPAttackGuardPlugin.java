package dev.pvpattackguard.pvpattackguard;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class PvPAttackGuardPlugin extends JavaPlugin {

    private final PlayerStateRegistry playerStates = new PlayerStateRegistry();
    private final ConcurrentHashMap<UUID, Long> joinTimestamps = new ConcurrentHashMap<>();
    private ViolationStore violationStore;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        this.violationStore = new ViolationStore(this, getConfig().getString("database-file", "pvpattackguard.db"));

        getServer().getPluginManager().registerEvents(new MoveTrackingListener(this), this);
        getServer().getPluginManager().registerEvents(new SwingTrackingListener(this), this);
        getServer().getPluginManager().registerEvents(new AttackValidationListener(this), this);

        getLogger().info("PvPAttackGuard 已啟用：跨封包因果鏈驗證 + 違規累積系統。");
    }

    @Override
    public void onDisable() {
        if (violationStore != null) {
            violationStore.close();
        }
        playerStates.clear();
        joinTimestamps.clear();
    }

    public void reload() {
        reloadConfig();
    }

    public PlayerStateRegistry getPlayerStates() {
        return playerStates;
    }

    public ConcurrentHashMap<UUID, Long> getJoinTimestamps() {
        return joinTimestamps;
    }

    public ViolationStore getViolationStore() {
        return violationStore;
    }

    /**
     * 分級處置：log-threshold 只記錄，notify-threshold 通知管理員 + 留證據，
     * action-threshold 才真正處置(踢出)。全部門檻都在 config.yml 可調整。
     */
    public void handleViolation(Player attacker, double totalScore, double addedScore, List<String> evidence) {
        double logThreshold = getConfig().getDouble("violation.log-threshold", 3.0);
        double notifyThreshold = getConfig().getDouble("violation.notify-threshold", 8.0);
        double actionThreshold = getConfig().getDouble("violation.action-threshold", 15.0);

        String tier;
        if (totalScore >= actionThreshold) {
            tier = "ACTION";
        } else if (totalScore >= notifyThreshold) {
            tier = "NOTIFY";
        } else if (totalScore >= logThreshold) {
            tier = "LOG";
        } else {
            return; // 分數太低，不留紀錄，避免資料庫被雜訊灌爆
        }

        String evidenceText = String.join("; ", evidence);
        violationStore.log(attacker.getName(), attacker.getUniqueId(), addedScore, totalScore, tier, evidenceText);

        if ("LOG".equals(tier)) {
            return;
        }

        Component alert = Component.text("[PvPAttackGuard] ", NamedTextColor.RED)
                .append(Component.text(attacker.getName(), NamedTextColor.YELLOW))
                .append(Component.text(" 累積異常攻擊分數 " + String.format("%.1f", totalScore) + " (", NamedTextColor.RED))
                .append(Component.text(evidenceText, NamedTextColor.GRAY))
                .append(Component.text(")", NamedTextColor.RED));

        // Folia 下每個玩家的實體操作(含收訊息)只能由該玩家自己所屬的
        // region 執行緒處理，所以用各自的 getScheduler() 派送，不直接跨執行緒呼叫。
        for (Player online : Bukkit.getOnlinePlayers()) {
            if (online.hasPermission("pvpattackguard.notify")) {
                online.getScheduler().run(this, task -> online.sendMessage(alert), null);
            }
        }

        if ("ACTION".equals(tier)) {
            String onThreshold = getConfig().getString("actions.on-threshold", "KICK");
            if ("KICK".equalsIgnoreCase(onThreshold)) {
                String rawMessage = getConfig().getString("actions.kick-message",
                        "&c[PvPAttackGuard] 偵測到持續且多重的異常攻擊行為，已將你請出伺服器。");
                Component kickMessage = legacyToComponent(rawMessage);
                attacker.getScheduler().run(this, task -> attacker.kick(kickMessage), null);
                attacker.getScheduler().run(this, task -> {
                    PlayerState state = playerStates.get(attacker.getUniqueId());
                    state.resetViolationScore();
                }, null);
            }
        }
    }

    private Component legacyToComponent(String legacy) {
        return net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer.legacyAmpersand().deserialize(legacy);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("pvpguard")) {
            return false;
        }
        if (args.length == 0) {
            sender.sendMessage("§7/pvpguard reload §f- 重新載入設定");
            sender.sendMessage("§7/pvpguard stats §f- 顯示資料庫檔案位置");
            sender.sendMessage("§7/pvpguard recent [數量] §f- 列出最近的違規記錄(預設 10 筆)");
            sender.sendMessage("§7/pvpguard export <玩家> §f- 將指定玩家的所有違規記錄匯出成檔案");
            return true;
        }
        switch (args[0].toLowerCase(Locale.ROOT)) {
            case "reload" -> {
                reload();
                sender.sendMessage("§a[PvPAttackGuard] 設定已重新載入。");
            }
            case "stats" -> sender.sendMessage("§7[PvPAttackGuard] 資料庫檔案: " + violationStore.getDatabasePath());
            case "recent" -> {
                int limit = 10;
                if (args.length > 1) {
                    try {
                        limit = Math.max(1, Integer.parseInt(args[1]));
                    } catch (NumberFormatException ignored) {
                    }
                }
                List<ViolationStore.Violation> rows = violationStore.recent(limit);
                if (rows.isEmpty()) {
                    sender.sendMessage("§7目前沒有任何違規記錄。");
                    break;
                }
                sender.sendMessage("§7最近 " + rows.size() + " 筆違規記錄:");
                for (ViolationStore.Violation v : rows) {
                    sender.sendMessage("§8[" + v.timestamp() + "] §e" + v.player()
                            + " §7tier=" + v.tier() + " total=" + String.format("%.1f", v.totalScore())
                            + " §f" + trimForChat(v.evidence()));
                }
            }
            case "export" -> {
                if (args.length < 2) {
                    sender.sendMessage("§c用法: /pvpguard export <玩家名稱>");
                    break;
                }
                String targetName = args[1];
                List<ViolationStore.Violation> rows = violationStore.forPlayer(targetName);
                if (rows.isEmpty()) {
                    sender.sendMessage("§7找不到玩家 " + targetName + " 的任何違規記錄。");
                    break;
                }
                String path = exportPlayer(targetName, rows);
                sender.sendMessage("§a已匯出 " + rows.size() + " 筆記錄 -> §f" + path);
            }
            default -> sender.sendMessage("§c未知的子指令。");
        }
        return true;
    }

    private String trimForChat(String content) {
        if (content == null) {
            return "";
        }
        return content.length() > 80 ? content.substring(0, 80) + "..." : content;
    }

    private String exportPlayer(String targetName, List<ViolationStore.Violation> rows) {
        Path exportDir = getDataFolder().toPath().resolve("exports");
        exportDir.toFile().mkdirs();
        String stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
        Path file = exportDir.resolve(targetName + "-" + stamp + ".txt");
        try (PrintWriter writer = new PrintWriter(new FileWriter(file.toFile(), false))) {
            writer.println("玩家 " + targetName + " 的違規記錄，共 " + rows.size() + " 筆");
            writer.println("匯出時間: " + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
            writer.println("=".repeat(60));
            for (ViolationStore.Violation v : rows) {
                writer.println("[" + v.timestamp() + "] uuid=" + v.uuid());
                writer.println("  tier=" + v.tier() + " added=" + v.addedScore() + " total=" + v.totalScore());
                writer.println("  evidence=" + v.evidence());
                writer.println("-".repeat(60));
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return file.toAbsolutePath().toString();
    }
}
