package dev.sawsmp.core.util;

import java.time.Duration;
import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 時長解析與格式化：支援 30s、10m、12h、3d、2w、1mo、1y，可組合如 1d12h。 */
public final class Durations {
    private static final Pattern PART = Pattern.compile("(\\d+)\\s*(mo|y|w|d|h|m|s)", Pattern.CASE_INSENSITIVE);
    private static final Pattern FULL = Pattern.compile("^((\\d+)\\s*(mo|y|w|d|h|m|s))+$", Pattern.CASE_INSENSITIVE);

    private Durations() {}

    /** 回傳秒數；無法解析回傳 -1；perm / permanent / 永久 回傳 0 代表永久。 */
    public static long parse(String text) {
        if (text == null) return -1;
        String s = text.trim().toLowerCase();
        if (s.equals("perm") || s.equals("permanent") || s.equals("永久")) return 0;
        if (!FULL.matcher(s).matches()) return -1;
        long total = 0;
        Matcher m = PART.matcher(s);
        while (m.find()) {
            long n = Long.parseLong(m.group(1));
            total += switch (m.group(2)) {
                case "s" -> n;
                case "m" -> n * 60;
                case "h" -> n * 3600;
                case "d" -> n * 86400;
                case "w" -> n * 604800;
                case "mo" -> n * 2592000;
                case "y" -> n * 31536000;
                default -> 0;
            };
        }
        return total > 0 ? total : -1;
    }

    public static String format(long seconds) {
        if (seconds <= 0) return "永久";
        long d = seconds / 86400, h = seconds % 86400 / 3600, m = seconds % 3600 / 60, s = seconds % 60;
        StringBuilder b = new StringBuilder();
        if (d > 0) b.append(d).append(" 天 ");
        if (h > 0) b.append(h).append(" 小時 ");
        if (m > 0) b.append(m).append(" 分 ");
        if (b.isEmpty()) b.append(s).append(" 秒");
        return b.toString().trim();
    }

    /** ISO 時間到現在的剩餘時間；null 代表永久。 */
    public static String remaining(String iso) {
        if (iso == null || iso.isBlank()) return "永久";
        try {
            long sec = Duration.between(Instant.now(), Instant.parse(iso.replace("+00:00", "Z"))).getSeconds();
            return sec <= 0 ? "已到期" : format(sec);
        } catch (Exception e) {
            return iso;
        }
    }

    public static Instant parseIso(String iso) {
        if (iso == null || iso.isBlank()) return null;
        try {
            return Instant.parse(iso.replace("+00:00", "Z"));
        } catch (Exception e) {
            return null;
        }
    }
}
