package dev.advancedkit.advancedkit.model;

public class Kit {

    public static final String SERVER_OWNER = "SERVER";

    private final int id;
    private final String ownerUuid;
    private final String name;
    private String contents;
    private String armor;
    private String offhand;
    private String icon;
    private int cooldownSeconds;
    private final long createdAt;

    public Kit(int id, String ownerUuid, String name, String contents, String armor,
               String offhand, String icon, int cooldownSeconds, long createdAt) {
        this.id = id;
        this.ownerUuid = ownerUuid;
        this.name = name;
        this.contents = contents;
        this.armor = armor;
        this.offhand = offhand;
        this.icon = icon;
        this.cooldownSeconds = cooldownSeconds;
        this.createdAt = createdAt;
    }

    public int getId() {
        return id;
    }

    public String getOwnerUuid() {
        return ownerUuid;
    }

    public boolean isServerKit() {
        return SERVER_OWNER.equals(ownerUuid);
    }

    public String getName() {
        return name;
    }

    public String getContents() {
        return contents;
    }

    public void setContents(String contents) {
        this.contents = contents;
    }

    public String getArmor() {
        return armor;
    }

    public void setArmor(String armor) {
        this.armor = armor;
    }

    public String getOffhand() {
        return offhand;
    }

    public void setOffhand(String offhand) {
        this.offhand = offhand;
    }

    public String getIcon() {
        return icon;
    }

    public void setIcon(String icon) {
        this.icon = icon;
    }

    public int getCooldownSeconds() {
        return cooldownSeconds;
    }

    public void setCooldownSeconds(int cooldownSeconds) {
        this.cooldownSeconds = cooldownSeconds;
    }

    public long getCreatedAt() {
        return createdAt;
    }
}
