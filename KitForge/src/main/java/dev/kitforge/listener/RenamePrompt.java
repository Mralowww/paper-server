package dev.kitforge.listener;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/** One outstanding "type the new name in chat" request per player. */
public class RenamePrompt {

    private final Map<UUID, Consumer<String>> pending = new ConcurrentHashMap<>();

    public void await(UUID player, Consumer<String> onSubmit) {
        pending.put(player, onSubmit);
    }

    public boolean isAwaiting(UUID player) {
        return pending.containsKey(player);
    }

    public void cancel(UUID player) {
        pending.remove(player);
    }

    public boolean submit(UUID player, String text) {
        Consumer<String> callback = pending.remove(player);
        if (callback == null) return false;
        callback.accept(text);
        return true;
    }
}
