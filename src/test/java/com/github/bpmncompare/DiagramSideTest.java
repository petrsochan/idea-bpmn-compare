package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DiagramSideTest {

    @Test
    void xmlSideCarriesContentAndLabel() {
        Map<String, Object> json = DiagramSide.xml("<definitions/>", "main").toJson();

        assertEquals("<definitions/>", json.get("xml"));
        assertEquals("main", json.get("label"));
        assertNull(json.get("error"));
        assertNull(json.get("message"));
        assertEquals(Boolean.FALSE, json.get("missing"));
    }

    @Test
    void missingSideIsFlaggedAndHasNoXml() {
        Map<String, Object> json = DiagramSide.missing("main", "not there").toJson();

        assertNull(json.get("xml"));
        assertEquals(Boolean.TRUE, json.get("missing"));
        assertEquals("not there", json.get("message"));
        assertEquals("main", json.get("label"));
    }

    @Test
    void errorSideCarriesTheMessageAndNoXml() {
        Map<String, Object> json = DiagramSide.error("main", "boom").toJson();

        assertEquals("boom", json.get("error"));
        assertEquals("main", json.get("label"));
        assertNull(json.get("xml"));
        assertEquals(Boolean.FALSE, json.get("missing"));
    }

    @Test
    void aPlainMessageHasNoLabelSoThePaneKeepsItsHeaderEmpty() {
        Map<String, Object> json = DiagramSide.message("Loading HEAD…").toJson();

        assertEquals("Loading HEAD…", json.get("message"));
        assertNull(json.get("label"));
        assertNull(json.get("error"));
    }

    @Test
    void jsonAlwaysHasEveryKeySoTheWebViewCanResetItsState() {
        // the web view overwrites its pane state from this map; a missing key would keep a stale value
        for (DiagramSide side : List.of(
                DiagramSide.xml("<x/>", "l"),
                DiagramSide.missing("l", "m"),
                DiagramSide.error("l", "e"),
                DiagramSide.message("m"))) {
            assertTrue(side.toJson().keySet().containsAll(List.of("xml", "label", "error", "message", "missing")),
                    side.toString());
        }
    }
}
