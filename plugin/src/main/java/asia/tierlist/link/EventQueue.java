package asia.tierlist.link;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.logging.Logger;

/** Buffers gameplay events and sends them in batches; failed batches are kept and retried. */
final class EventQueue {
    private static final int MAX_BUFFER = 20000;
    private static final int BATCH = 500;

    private final ConcurrentLinkedDeque<JsonObject> queue = new ConcurrentLinkedDeque<>();
    private final Logger log;
    private volatile Api api;
    private long lastWarn;

    EventQueue(Api api, Logger log) {
        this.api = api;
        this.log = log;
    }

    void setApi(Api api) {
        this.api = api;
    }

    int size() {
        return queue.size();
    }

    void add(JsonObject event) {
        event.addProperty("ts", System.currentTimeMillis());
        queue.addLast(event);
        while (queue.size() > MAX_BUFFER) queue.pollFirst();
    }

    /** Sends everything queued; call off the main thread. */
    synchronized void flush() {
        if (!api.hasKey()) return;
        while (!queue.isEmpty()) {
            List<JsonObject> batch = new ArrayList<>();
            JsonObject e;
            while (batch.size() < BATCH && (e = queue.pollFirst()) != null) batch.add(e);
            JsonArray arr = new JsonArray();
            batch.forEach(arr::add);
            JsonObject body = new JsonObject();
            body.add("events", arr);
            try {
                api.post("/api/server/events", body);
            } catch (Exception ex) {
                for (int i = batch.size() - 1; i >= 0; i--) queue.addFirst(batch.get(i));
                long now = System.currentTimeMillis();
                if (now - lastWarn > 60_000) {
                    lastWarn = now;
                    log.warning("無法上傳戰鬥紀錄（" + queue.size() + " 筆待傳）：" + ex.getMessage());
                }
                return;
            }
        }
    }
}
