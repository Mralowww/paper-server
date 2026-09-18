package dev.opopjjjidj.totemcounter;

import java.util.UUID;

public class PlayerTotemData {

    private final UUID uuid;
    private String name;
    private int currentCount;
    private long totalCount;

    public PlayerTotemData(UUID uuid, String name, int currentCount, long totalCount) {
        this.uuid = uuid;
        this.name = name;
        this.currentCount = currentCount;
        this.totalCount = totalCount;
    }

    public UUID getUuid() {
        return uuid;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getCurrentCount() {
        return currentCount;
    }

    public long getTotalCount() {
        return totalCount;
    }

    public void incrementPop() {
        currentCount++;
        totalCount++;
    }

    public void resetCurrent() {
        currentCount = 0;
    }
}
