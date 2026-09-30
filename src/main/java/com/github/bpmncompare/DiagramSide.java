package com.github.bpmncompare;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * What one pane of the compare view should display: a diagram, or an explanation why there is none.
 *
 * <p>{@link #toJson()} always carries every key, because the web view overwrites its pane state from
 * this map and a missing key would leave a stale value behind.
 *
 * @param xml     the diagram source, or {@code null} when there is nothing to render
 * @param label   text shown above the diagram, or {@code null} to leave the header empty
 * @param error   failure to report in the pane
 * @param message neutral explanation, e.g. "loading" or "not in this revision"
 * @param missing whether the file does not exist on this side at all
 */
record DiagramSide(String xml, String label, String error, String message, boolean missing) {

    static DiagramSide xml(String xml, String label) {
        return new DiagramSide(xml, label, null, null, false);
    }

    static DiagramSide missing(String label, String message) {
        return new DiagramSide(null, label, null, message, true);
    }

    static DiagramSide error(String label, String message) {
        return new DiagramSide(null, label, message, null, false);
    }

    static DiagramSide message(String message) {
        return new DiagramSide(null, null, null, message, false);
    }

    Map<String, Object> toJson() {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("xml", xml);
        json.put("label", label);
        json.put("error", error);
        json.put("message", message);
        json.put("missing", missing);
        return json;
    }
}
