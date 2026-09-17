package dev.noah.perplayerkit.util;

import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RekitKitResolverTest {

    private ConfigurationSection kitsSection(String yaml) {
        YamlConfiguration config = new YamlConfiguration();
        try {
            config.loadFromString(yaml);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return config.getConfigurationSection("kits");
    }

    @Test
    void returnsNullWithoutSectionOrWorld() {
        assertNull(RekitKitResolver.resolveKit(null, "ffa", Collections.emptyList()));
        assertNull(RekitKitResolver.resolveKit(kitsSection("kits:\n  ffa: sword"), null, Collections.emptyList()));
    }

    @Test
    void resolvesWorldWideEntry() {
        ConfigurationSection kits = kitsSection("kits:\n  ffa: sword\n  duel: axe");
        assertEquals("sword", RekitKitResolver.resolveKit(kits, "ffa", Collections.emptyList()));
        assertEquals("axe", RekitKitResolver.resolveKit(kits, "duel", Collections.emptyList()));
        assertNull(RekitKitResolver.resolveKit(kits, "lobby", Collections.emptyList()));
    }

    @Test
    void supportsNestedKitKeyFormat() {
        ConfigurationSection kits = kitsSection("kits:\n  \"ffa:arena\":\n    kit: sword");
        assertEquals("sword", RekitKitResolver.resolveKit(kits, "ffa", List.of("arena")));
    }

    @Test
    void regionEntryWinsOverWorldEntry() {
        ConfigurationSection kits = kitsSection("kits:\n  ffa: sword\n  \"ffa:pot_arena\": pot");
        assertEquals("pot", RekitKitResolver.resolveKit(kits, "ffa", List.of("pot_arena")));
        assertEquals("sword", RekitKitResolver.resolveKit(kits, "ffa", List.of("other_region")));
        assertEquals("sword", RekitKitResolver.resolveKit(kits, "ffa", Collections.emptyList()));
    }

    @Test
    void firstMatchingRegionInPriorityOrderWins() {
        ConfigurationSection kits = kitsSection("kits:\n  \"ffa:inner\": pot\n  \"ffa:outer\": sword");
        assertEquals("pot", RekitKitResolver.resolveKit(kits, "ffa", List.of("inner", "outer")));
        assertEquals("sword", RekitKitResolver.resolveKit(kits, "ffa", List.of("outer", "inner")));
    }

    @Test
    void regionEntryOnlyMatchesItsOwnWorld() {
        ConfigurationSection kits = kitsSection("kits:\n  \"ffa:arena\": pot");
        assertNull(RekitKitResolver.resolveKit(kits, "duel", List.of("arena")));
    }

    @Test
    void matchesCaseInsensitivelyAndTrimsWhitespace() {
        ConfigurationSection kits = kitsSection("kits:\n  \"FFA : Arena\": pot\n  \"Duel\": \"  axe  \"");
        assertEquals("pot", RekitKitResolver.resolveKit(kits, "ffa", List.of("arena")));
        assertEquals("axe", RekitKitResolver.resolveKit(kits, "duel", Collections.emptyList()));
    }

    @Test
    void ignoresBlankAndMalformedEntries() {
        ConfigurationSection kits = kitsSection("kits:\n  ffa: \"\"\n  \"duel:arena\":\n    wrong-key: axe");
        assertNull(RekitKitResolver.resolveKit(kits, "ffa", Collections.emptyList()));
        assertNull(RekitKitResolver.resolveKit(kits, "duel", List.of("arena")));
    }

    @Test
    void detectsRegionEntries() {
        assertTrue(RekitKitResolver.hasRegionEntries(kitsSection("kits:\n  \"ffa:arena\": pot")));
        assertFalse(RekitKitResolver.hasRegionEntries(kitsSection("kits:\n  ffa: pot")));
        assertFalse(RekitKitResolver.hasRegionEntries(null));
    }
}
