package dev.opopjjjidj.totemcounter;

import org.bukkit.plugin.java.JavaPlugin;

public class TotemCounterPlugin extends JavaPlugin {

    private DataManager dataManager;
    private ActionBarManager actionBarManager;

    @Override
    public void onEnable() {
        dataManager = new DataManager(this);
        dataManager.load();

        actionBarManager = new ActionBarManager(this);
        actionBarManager.start();

        getServer().getPluginManager().registerEvents(new TotemListener(dataManager), this);
        getServer().getPluginManager().registerEvents(new TotemGuiListener(actionBarManager), this);

        var totemCounterCommand = getCommand("totemcounter");
        if (totemCounterCommand != null) {
            totemCounterCommand.setExecutor(new TotemCounterCommand(this));
        }

        var totemCommand = getCommand("totem");
        if (totemCommand != null) {
            totemCommand.setExecutor(new TotemGuiCommand(this));
        }

        var totemActionBarCommand = getCommand("totemactionbar");
        if (totemActionBarCommand != null) {
            totemActionBarCommand.setExecutor(new TotemActionBarCommand(this));
        }

        if (getServer().getPluginManager().getPlugin("PlaceholderAPI") != null) {
            new TotemPlaceholderExpansion(this).register();
            getLogger().info("已註冊 PlaceholderAPI 變數 (%totem_pop%, %totem_pop_top1~9%)。");
        } else {
            getLogger().warning("找不到 PlaceholderAPI，圖騰相關 Placeholder 將無法使用。");
        }
    }

    @Override
    public void onDisable() {
        if (actionBarManager != null) {
            actionBarManager.stop();
        }
        if (dataManager != null) {
            dataManager.save();
        }
    }

    public DataManager getDataManager() {
        return dataManager;
    }

    public ActionBarManager getActionBarManager() {
        return actionBarManager;
    }
}
