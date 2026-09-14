package dev.pvpattackguard.pvpattackguard;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 所有玩家 PlayerState 的容器。ConcurrentHashMap 保證跨 region 執行緒(Folia)
 * 存取安全，不需要額外的全域鎖。
 */
public final class PlayerStateRegistry {

    private final ConcurrentHashMap<UUID, PlayerState> states = new ConcurrentHashMap<>();

    public PlayerState get(UUID uuid) {
        return states.computeIfAbsent(uuid, ignored -> new PlayerState());
    }

    public void remove(UUID uuid) {
        states.remove(uuid);
    }

    public void clear() {
        states.clear();
    }
}
