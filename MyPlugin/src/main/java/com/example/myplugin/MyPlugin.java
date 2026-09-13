package com.example.myplugin;

import org.bukkit.plugin.java.JavaPlugin;

public final class MyPlugin extends JavaPlugin {

    @Override
    public void onEnable() {
        getLogger().info("MyPlugin has been enabled.");
    }

    @Override
    public void onDisable() {
        getLogger().info("MyPlugin has been disabled.");
    }
}
