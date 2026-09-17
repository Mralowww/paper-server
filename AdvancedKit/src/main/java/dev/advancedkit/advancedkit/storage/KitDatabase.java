package dev.advancedkit.advancedkit.storage;

import dev.advancedkit.advancedkit.model.Kit;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.logging.Level;

public class KitDatabase {

    private final JavaPlugin plugin;
    private Connection connection;

    public KitDatabase(JavaPlugin plugin) {
        this.plugin = plugin;
    }

    public void connect() {
        try {
            if (!plugin.getDataFolder().exists()) {
                plugin.getDataFolder().mkdirs();
            }
            File dbFile = new File(plugin.getDataFolder(), "kits.db");
            connection = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
            try (Statement statement = connection.createStatement()) {
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS kits (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            owner_uuid TEXT NOT NULL,
                            name TEXT NOT NULL,
                            contents TEXT NOT NULL,
                            armor TEXT NOT NULL,
                            offhand TEXT,
                            icon TEXT NOT NULL,
                            cooldown_seconds INTEGER NOT NULL DEFAULT 0,
                            created_at INTEGER NOT NULL,
                            UNIQUE(owner_uuid, name)
                        );
                        """);
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS cooldowns (
                            player_uuid TEXT NOT NULL,
                            kit_id INTEGER NOT NULL,
                            last_used INTEGER NOT NULL,
                            PRIMARY KEY (player_uuid, kit_id)
                        );
                        """);
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "無法連接 SQLite 資料庫", e);
        }
    }

    public void close() {
        if (connection != null) {
            try {
                connection.close();
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "關閉資料庫連線時發生錯誤", e);
            }
        }
    }

    public synchronized Kit createKit(String ownerUuid, String name, String contents, String armor,
                                       String offhand, String icon, int cooldownSeconds) {
        String sql = "INSERT INTO kits (owner_uuid, name, contents, armor, offhand, icon, cooldown_seconds, created_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        long now = System.currentTimeMillis();
        try (PreparedStatement ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, ownerUuid);
            ps.setString(2, name);
            ps.setString(3, contents);
            ps.setString(4, armor);
            ps.setString(5, offhand);
            ps.setString(6, icon);
            ps.setInt(7, cooldownSeconds);
            ps.setLong(8, now);
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                int id = keys.next() ? keys.getInt(1) : -1;
                return new Kit(id, ownerUuid, name, contents, armor, offhand, icon, cooldownSeconds, now);
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "建立 Kit 失敗", e);
            return null;
        }
    }

    public synchronized boolean updateKitContents(int kitId, String contents, String armor, String offhand) {
        String sql = "UPDATE kits SET contents = ?, armor = ?, offhand = ? WHERE id = ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, contents);
            ps.setString(2, armor);
            ps.setString(3, offhand);
            ps.setInt(4, kitId);
            return ps.executeUpdate() > 0;
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "更新 Kit 失敗", e);
            return false;
        }
    }

    public synchronized boolean updateKitCooldown(int kitId, int cooldownSeconds) {
        String sql = "UPDATE kits SET cooldown_seconds = ? WHERE id = ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setInt(1, cooldownSeconds);
            ps.setInt(2, kitId);
            return ps.executeUpdate() > 0;
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "更新 Kit 冷卻失敗", e);
            return false;
        }
    }

    public synchronized boolean deleteKit(int kitId) {
        try (PreparedStatement ps = connection.prepareStatement("DELETE FROM kits WHERE id = ?");
             PreparedStatement psCooldown = connection.prepareStatement("DELETE FROM cooldowns WHERE kit_id = ?")) {
            ps.setInt(1, kitId);
            psCooldown.setInt(1, kitId);
            psCooldown.executeUpdate();
            return ps.executeUpdate() > 0;
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "刪除 Kit 失敗", e);
            return false;
        }
    }

    public synchronized Optional<Kit> findKit(String ownerUuid, String name) {
        String sql = "SELECT * FROM kits WHERE owner_uuid = ? AND name = ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, ownerUuid);
            ps.setString(2, name);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(mapRow(rs));
                }
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "查詢 Kit 失敗", e);
        }
        return Optional.empty();
    }

    public synchronized Optional<Kit> findKitById(int id) {
        String sql = "SELECT * FROM kits WHERE id = ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setInt(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(mapRow(rs));
                }
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "查詢 Kit 失敗", e);
        }
        return Optional.empty();
    }

    public synchronized List<Kit> listKits(String ownerUuid) {
        List<Kit> kits = new ArrayList<>();
        String sql = "SELECT * FROM kits WHERE owner_uuid = ? ORDER BY created_at ASC";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, ownerUuid);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    kits.add(mapRow(rs));
                }
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "列出 Kit 失敗", e);
        }
        return kits;
    }

    public synchronized int countKits(String ownerUuid) {
        String sql = "SELECT COUNT(*) FROM kits WHERE owner_uuid = ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, ownerUuid);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "計算 Kit 數量失敗", e);
            return 0;
        }
    }

    public synchronized long getCooldownRemainingMillis(String playerUuid, int kitId, long cooldownMillis) {
        String sql = "SELECT last_used FROM cooldowns WHERE player_uuid = ? AND kit_id = ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, playerUuid);
            ps.setInt(2, kitId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    long elapsed = System.currentTimeMillis() - rs.getLong(1);
                    long remaining = cooldownMillis - elapsed;
                    return Math.max(remaining, 0);
                }
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "查詢冷卻時間失敗", e);
        }
        return 0;
    }

    public synchronized void setCooldown(String playerUuid, int kitId) {
        String sql = "INSERT INTO cooldowns (player_uuid, kit_id, last_used) VALUES (?, ?, ?) " +
                "ON CONFLICT(player_uuid, kit_id) DO UPDATE SET last_used = excluded.last_used";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, playerUuid);
            ps.setInt(2, kitId);
            ps.setLong(3, System.currentTimeMillis());
            ps.executeUpdate();
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "設定冷卻時間失敗", e);
        }
    }

    private Kit mapRow(ResultSet rs) throws SQLException {
        return new Kit(
                rs.getInt("id"),
                rs.getString("owner_uuid"),
                rs.getString("name"),
                rs.getString("contents"),
                rs.getString("armor"),
                rs.getString("offhand"),
                rs.getString("icon"),
                rs.getInt("cooldown_seconds"),
                rs.getLong("created_at")
        );
    }
}
