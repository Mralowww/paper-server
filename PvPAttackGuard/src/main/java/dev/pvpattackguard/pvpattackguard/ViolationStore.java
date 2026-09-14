package dev.pvpattackguard.pvpattackguard;

import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 以 SQLite 永久保存每次違規累積事件的證據(哪些檢測失敗、累積後的總分)，
 * 讓管理員能事後回放/查詢，而不是靠一句 log 訊息猜測玩家為什麼被處置。
 * 只新增不刪除，供稽核與玩家申訴時查證。
 */
public final class ViolationStore {

    private static final DateTimeFormatter TIMESTAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final File dbFile;
    private Connection connection;

    public ViolationStore(PvPAttackGuardPlugin plugin, String fileName) {
        plugin.getDataFolder().mkdirs();
        this.dbFile = new File(plugin.getDataFolder(), fileName);
        try {
            Class.forName("org.sqlite.JDBC");
            open();
            createSchema();
        } catch (Exception e) {
            plugin.getLogger().severe("無法開啟 SQLite 資料庫: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private void open() throws SQLException {
        this.connection = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
    }

    private void createSchema() throws SQLException {
        try (Statement st = connection.createStatement()) {
            st.execute("""
                    CREATE TABLE IF NOT EXISTS violations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ts TEXT NOT NULL,
                        player TEXT NOT NULL,
                        player_uuid TEXT,
                        added_score REAL NOT NULL,
                        total_score REAL NOT NULL,
                        tier TEXT NOT NULL,
                        evidence TEXT
                    )
                    """);
            st.execute("CREATE INDEX IF NOT EXISTS idx_violations_player ON violations(player)");
            st.execute("CREATE INDEX IF NOT EXISTS idx_violations_ts ON violations(ts)");
        }
    }

    public synchronized void log(String playerName, UUID uuid, double addedScore, double totalScore, String tier, String evidence) {
        if (connection == null) {
            return;
        }
        String sql = "INSERT INTO violations (ts, player, player_uuid, added_score, total_score, tier, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, LocalDateTime.now().format(TIMESTAMP));
            ps.setString(2, playerName);
            ps.setString(3, uuid == null ? null : uuid.toString());
            ps.setDouble(4, addedScore);
            ps.setDouble(5, totalScore);
            ps.setString(6, tier);
            ps.setString(7, evidence);
            ps.executeUpdate();
        } catch (SQLException e) {
            e.printStackTrace();
        }
    }

    public synchronized List<Violation> recent(int limit) {
        List<Violation> results = new ArrayList<>();
        String sql = "SELECT ts, player, player_uuid, added_score, total_score, tier, evidence FROM violations ORDER BY id DESC LIMIT ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setInt(1, limit);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    results.add(readRow(rs));
                }
            }
        } catch (SQLException e) {
            e.printStackTrace();
        }
        return results;
    }

    public synchronized List<Violation> forPlayer(String playerName) {
        List<Violation> results = new ArrayList<>();
        String sql = "SELECT ts, player, player_uuid, added_score, total_score, tier, evidence FROM violations "
                + "WHERE LOWER(player) = LOWER(?) ORDER BY id DESC";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, playerName);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    results.add(readRow(rs));
                }
            }
        } catch (SQLException e) {
            e.printStackTrace();
        }
        return results;
    }

    private Violation readRow(ResultSet rs) throws SQLException {
        return new Violation(
                rs.getString("ts"),
                rs.getString("player"),
                rs.getString("player_uuid"),
                rs.getDouble("added_score"),
                rs.getDouble("total_score"),
                rs.getString("tier"),
                rs.getString("evidence")
        );
    }

    public String getDatabasePath() {
        return dbFile.getAbsolutePath();
    }

    public void close() {
        if (connection != null) {
            try {
                connection.close();
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
    }

    public record Violation(String timestamp, String player, String uuid, double addedScore,
                             double totalScore, String tier, String evidence) {
    }
}
