package dev.pvpattackguard.pvpattackguard;

import io.papermc.paper.event.player.PlayerArmSwingEvent;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * 記錄每個玩家最新一次揮手動畫封包(對應 ServerboundSwingPacket)的到達時間，
 * 供攻擊發生時做揮手/攻擊時序關聯性驗證。
 */
public final class SwingTrackingListener implements Listener {

    private final PvPAttackGuardPlugin plugin;

    public SwingTrackingListener(PvPAttackGuardPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onSwing(PlayerArmSwingEvent event) {
        plugin.getPlayerStates().get(event.getPlayer().getUniqueId())
                .recordSwing(System.nanoTime());
    }
}
