package dev.pvpattackguard.pvpattackguard;

import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.util.Vector;

/**
 * 記錄每個玩家最新回報的視角/位置封包(對應 ServerboundMovePlayerPacket)，
 * 供攻擊發生時做射線追蹤一致性驗證。這裡只做記錄，不做任何攔截判定。
 */
public final class MoveTrackingListener implements Listener {

    private final PvPAttackGuardPlugin plugin;

    public MoveTrackingListener(PvPAttackGuardPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        record(event.getPlayer(), event.getTo());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        record(player, player.getLocation());
        plugin.getJoinTimestamps().put(player.getUniqueId(), System.nanoTime());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        plugin.getPlayerStates().remove(event.getPlayer().getUniqueId());
        plugin.getJoinTimestamps().remove(event.getPlayer().getUniqueId());
    }

    private void record(Player player, Location to) {
        if (to == null) {
            return;
        }
        double eyeHeight = player.getEyeHeight();
        Vector eyeLocation = to.toVector().add(new Vector(0, eyeHeight, 0));
        Vector direction = to.getDirection();
        plugin.getPlayerStates().get(player.getUniqueId())
                .recordMove(eyeLocation, direction, System.nanoTime());
    }
}
