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
}
