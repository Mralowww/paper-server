package dev.mralow.tierbadge;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 存放「玩家名稱(小寫) -> 段位代碼」的記憶體快取,由背景執行緒定期從網站 API 更新。
 * 段位顯示用的顏色/樣式邏輯集中在這裡,免得 Mixin 裡塞一堆判斷式。
 */
public final class TierCache {

    private static final Map<String, String> TIERS = new ConcurrentHashMap<>();

    private TierCache() {
    }

    public static void replaceAll(Map<String, String> newData) {
        TIERS.clear();
        TIERS.putAll(newData);
    }

    public static String getTier(String mcUsername) {
        if (mcUsername == null) {
            return null;
        }
        return TIERS.get(mcUsername.toLowerCase());
    }

    public static int formatColor(String tier) {
        if (tier == null) {
            return 0xAAAAAA;
        }
        boolean high = tier.startsWith("H");
        return switch (tier.substring(1)) {
            case "1" -> high ? 0xFFD76A : 0xFFE8A8;
            case "2" -> high ? 0x7C8CFF : 0xB9C2FF;
            case "3" -> high ? 0x22D3B8 : 0x7FF0D8;
            case "4" -> high ? 0x9AA6C2 : 0xCFD6E6;
            case "5" -> high ? 0xB98A63 : 0xD9B48F;
            default -> 0xAAAAAA;
        };
    }
}
