package dev.mralow.tierbadge.client;

import dev.mralow.tierbadge.TierApiClient;
import dev.mralow.tierbadge.TierBadgeConfig;
import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class TierBadgeClient implements ClientModInitializer {

    public static final Logger LOGGER = LoggerFactory.getLogger("tierbadge");

    private static ScheduledExecutorService scheduler;

    @Override
    public void onInitializeClient() {
        TierBadgeConfig config = TierBadgeConfig.loadOrCreate();
        TierApiClient apiClient = new TierApiClient(config);

        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "tierbadge-refresh");
            t.setDaemon(true);
            return t;
        });
        scheduler.scheduleWithFixedDelay(
                apiClient::refreshOnce, 0, Math.max(config.refreshIntervalSeconds, 10), TimeUnit.SECONDS
        );

        ModListNetworking.register(config);

        LOGGER.info("TierBadge 已啟動,每 {} 秒從 {} 更新一次 Tier 資料", config.refreshIntervalSeconds, config.baseUrl);
    }
}
