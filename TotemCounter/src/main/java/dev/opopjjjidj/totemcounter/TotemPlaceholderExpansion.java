package dev.opopjjjidj.totemcounter;

import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.OfflinePlayer;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

public class TotemPlaceholderExpansion extends PlaceholderExpansion {

    private final TotemCounterPlugin plugin;

    public TotemPlaceholderExpansion(TotemCounterPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public @NotNull String getIdentifier() {
        return "totem";
    }

    @Override
    public @NotNull String getAuthor() {
        return "opopjjjidj";
    }

    @Override
    public @NotNull String getVersion() {
        return plugin.getDescription().getVersion();
    }

    @Override
    public boolean persist() {
        return true;
    }

    @Override
    public String onRequest(OfflinePlayer offlinePlayer, @NotNull String params) {
        DataManager dataManager = plugin.getDataManager();

        if (params.equalsIgnoreCase("pop")) {
            if (offlinePlayer == null) {
                return "0";
            }
            return String.valueOf(dataManager.getCurrentCount(offlinePlayer.getUniqueId()));
        }

        if (params.toLowerCase().startsWith("pop_top")) {
            String rankPart = params.substring("pop_top".length());
            int rank;
            try {
                rank = Integer.parseInt(rankPart);
            } catch (NumberFormatException e) {
                return "";
            }
            if (rank < 1 || rank > 9) {
                return "";
            }
            PlayerTotemData data = dataManager.getRank(rank);
            if (data == null) {
                return "-";
            }
            return data.getName() + ": " + data.getTotalCount();
        }

        return null;
    }
}
