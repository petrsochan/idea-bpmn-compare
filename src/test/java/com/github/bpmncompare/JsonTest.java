package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class JsonTest {

    @Test
    void escapesStringsForEmbeddingInJavaScript() {
        assertEquals("\"a\\\"b\\\\c\\nd\\u2028\\u003c/script>\\u0001\"", Json.write("a\"b\\c\nd </script>"));
    }

    @Test
    void writesNestedMaps() {
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("xml", null);
        inner.put("missing", true);
        Map<String, Object> outer = new LinkedHashMap<>();
        outer.put("right", inner);
        outer.put("n", 3);
        assertEquals("{\"right\":{\"xml\":null,\"missing\":true},\"n\":3}", Json.write(outer));
    }

    @Test
    void readsAFlatObjectOfStrings() {
        assertEquals(Map.of("command", "openXml", "id", "Task_1"),
                Json.read("{\"command\":\"openXml\",\"id\":\"Task_1\"}"));
    }

    @Test
    void readsEscapedValues() {
        assertEquals(Map.of("id", "a\"b"), Json.read("{\"id\":\"a\\\"b\"}"));
        assertEquals(Map.of("id", "a\nb"), Json.read("{\"id\":\"a\\nb\"}"));
        assertEquals(Map.of("id", "a\\b"), Json.read("{\"id\":\"a\\\\b\"}"));
    }

    @Test
    void readingSomethingThatIsNotAFlatObjectYieldsAnEmptyMap() {
        assertEquals(Map.of(), Json.read("not json"));
        assertEquals(Map.of(), Json.read("{}"));
        // non-string values are not supported and are simply skipped
        assertEquals(Map.of(), Json.read("{\"n\":3}"));
    }

    @Test
    void readsALargeValueUnchanged() {
        // a PNG export arrives as one very long data URL string
        String payload = "x".repeat(2_000_000);

        assertEquals(payload, Json.read("{\"payload\":\"" + payload + "\"}").get("payload"));
    }

    @Test
    void writeThenReadRoundTripsAFlatObject() {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("command", "copyMarkdown");
        message.put("payload", "line1\nline2 \"quoted\" <tag>");

        assertEquals(message, Json.read(Json.write(message)));
    }
}
