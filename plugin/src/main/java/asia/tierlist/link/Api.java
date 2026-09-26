package asia.tierlist.link;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** Small JSON client for the Mc.Tierlist.Asia server API. */
final class Api {
    private final HttpClient http;
    private final String baseUrl;
    private final String key;
    private final Duration timeout;
    private final String userAgent;

    Api(String baseUrl, String key, Duration timeout, String version) {
        this.baseUrl = baseUrl;
        this.key = key;
        this.timeout = timeout;
        this.userAgent = "TierlistLink/" + version;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).build();
    }

    boolean hasKey() {
        return !key.isEmpty();
    }

    String baseUrl() {
        return baseUrl;
    }

    /** POSTs JSON and returns the parsed response; throws on network errors or non-2xx status. */
    JsonObject post(String path, JsonElement body) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("User-Agent", userAgent)
                .header("X-API-Key", key)
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() / 100 != 2) {
            throw new IllegalStateException("HTTP " + res.statusCode() + ": " + res.body());
        }
        return JsonParser.parseString(res.body()).getAsJsonObject();
    }

    int health() throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/health")).timeout(timeout)
                .header("User-Agent", userAgent).GET().build();
        return http.send(req, HttpResponse.BodyHandlers.discarding()).statusCode();
    }
}
