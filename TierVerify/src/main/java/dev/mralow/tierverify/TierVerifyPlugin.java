package dev.mralow.tierverify;

import org.bukkit.plugin.java.JavaPlugin;

public class TierVerifyPlugin extends JavaPlugin {

    private VerifyService verifyService;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        String backendUrl = getConfig().getString("backend-url", "");
        String sharedSecret = getConfig().getString("shared-secret", "");
        int timeoutSeconds = getConfig().getInt("timeout-seconds", 5);

        if (sharedSecret.isBlank() || sharedSecret.equals("CHANGE_ME_TO_A_LONG_RANDOM_SECRET")) {
            getLogger().warning("shared-secret 尚未設定,請編輯 config.yml 後重啟伺服器,否則 /verify 無法運作。");
        }

        this.verifyService = new VerifyService(this, backendUrl, sharedSecret, timeoutSeconds);

        VerifyCommand verifyCommand = new VerifyCommand(verifyService);
        getCommand("verify").setExecutor(verifyCommand);
    }
}
