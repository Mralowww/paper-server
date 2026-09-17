package dev.noah.perplayerkit.storage.sql;

import dev.noah.perplayerkit.storage.SQLStorage;
import org.bukkit.plugin.Plugin;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SQLiteBackupTest {

    @Test
    void backupToWritesSelfContainedSnapshotOfLiveDatabase(@TempDir Path tempDir) throws Exception {
        Plugin plugin = mock(Plugin.class);
        when(plugin.getDataFolder()).thenReturn(tempDir.toFile());

        SQLite db = new SQLite(plugin);
        SQLStorage storage = new SQLStorage(db);
        storage.connect();
        storage.init();
        storage.saveKitDataByID("kit-1", "payload-1");
        storage.saveKitDataByID("kit-2", "payload-2");

        assertTrue(db.supportsOnlineBackup());

        Path snapshot = tempDir.resolve("backups").resolve("hourly_database.db");
        storage.backupTo(snapshot);

        // Writes after the snapshot must not leak into it.
        storage.saveKitDataByID("kit-3", "payload-3");

        assertTrue(Files.exists(snapshot));
        assertFalse(Files.exists(tempDir.resolve("backups").resolve("hourly_database.db-wal")));
        assertEquals(Set.of("kit-1", "kit-2"), readKitIds(snapshot));

        storage.close();

        // The snapshot is still readable and complete once the source is closed.
        assertEquals(Set.of("kit-1", "kit-2"), readKitIds(snapshot));
    }

    @Test
    void backupToOverwritesAnExistingSnapshot(@TempDir Path tempDir) throws Exception {
        Plugin plugin = mock(Plugin.class);
        when(plugin.getDataFolder()).thenReturn(tempDir.toFile());

        SQLite db = new SQLite(plugin);
        SQLStorage storage = new SQLStorage(db);
        storage.connect();
        storage.init();
        storage.saveKitDataByID("kit-1", "payload-1");

        Path snapshot = tempDir.resolve("snapshot.db");
        Files.writeString(snapshot, "stale contents");

        storage.backupTo(snapshot);

        assertEquals(Set.of("kit-1"), readKitIds(snapshot));

        storage.close();
    }

    private static Set<String> readKitIds(Path databaseFile) throws Exception {
        Set<String> ids = new HashSet<>();
        String url = "jdbc:sqlite:" + new File(databaseFile.toString()).getAbsolutePath().replace('\\', '/');
        try (Connection conn = DriverManager.getConnection(url);
                Statement st = conn.createStatement();
                ResultSet rs = st.executeQuery("SELECT KITID FROM kits")) {
            while (rs.next()) {
                ids.add(rs.getString("KITID"));
            }
        }
        return ids;
    }
}
