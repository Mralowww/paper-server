package dev.advancedkit.advancedkit;

import dev.advancedkit.advancedkit.command.KitCommand;
import dev.advancedkit.advancedkit.listener.KitGuiListener;
import dev.advancedkit.advancedkit.storage.KitDatabase;
import org.bukkit.plugin.java.JavaPlugin;

public class AdvancedKitPlugin extends JavaPlugin {

    private KitDatabase database;
    private KitManager kitManager;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        database = new KitDatabase(this);
        database.connect();

        kitManager = new KitManager(this, database);

        KitCommand kitCommand = new KitCommand(this);
        var command = getCommand("kit");
        if (command != null) {
            command.setExecutor(kitCommand);
            command.setTabCompleter(kitCommand);
        }

        getServer().getPluginManager().registerEvents(new KitGuiListener(this), this);

        getLogger().info("AdvancedKit 已啟用");
    }

    @Override
    public void onDisable() {
        if (database != null) {
            database.close();
        }
        getLogger().info("AdvancedKit 已停用");
    }

    public KitManager getKitManager() {
        return kitManager;
    }

    public KitDatabase getDatabase() {
        return database;
    }
}
