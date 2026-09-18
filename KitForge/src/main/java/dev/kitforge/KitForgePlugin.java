package dev.kitforge;

import dev.kitforge.command.KitCommand;
import dev.kitforge.gui.GuiListener;
import dev.kitforge.listener.JoinListener;
import dev.kitforge.listener.RenameChatListener;
import dev.kitforge.listener.RenamePrompt;
import dev.kitforge.storage.KitStorage;
import dev.kitforge.trim.TrimTierConfig;
import org.bukkit.plugin.java.JavaPlugin;

public class KitForgePlugin extends JavaPlugin {

    private KitStorage storage;
    private TrimTierConfig trimTierConfig;
    private RenamePrompt renamePrompt;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        storage = new KitStorage(this);
        storage.connect();

        trimTierConfig = new TrimTierConfig(this);
        renamePrompt = new RenamePrompt();

        KitCommand kitCommand = new KitCommand(this);
        var command = getCommand("kit");
        if (command != null) {
            command.setExecutor(kitCommand);
            command.setTabCompleter(kitCommand);
        }

        getServer().getPluginManager().registerEvents(new GuiListener(), this);
        getServer().getPluginManager().registerEvents(new JoinListener(this), this);
        getServer().getPluginManager().registerEvents(new RenameChatListener(this), this);

        getLogger().info("KitForge 已啟用");
    }

    @Override
    public void onDisable() {
        if (storage != null) storage.close();
    }

    public KitStorage getStorage() {
        return storage;
    }

    public TrimTierConfig getTrimTierConfig() {
        return trimTierConfig;
    }

    public RenamePrompt getRenamePrompt() {
        return renamePrompt;
    }

    public void reload() {
        reloadConfig();
        trimTierConfig = new TrimTierConfig(this);
    }
}
