package com.github.bpmncompare;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Minimal JSON for talking to the web view: a writer for the payloads pushed to the page (strings,
 * booleans, numbers, nested maps) and a reader for the flat string objects the page sends back.
 */
final class Json {

    private Json() {
    }

    /**
     * Reads a flat object of string values, which is all the web view ever sends.
     *
     * <p>Anything else - nested objects, numbers, arrays - is skipped rather than supported: a full
     * parser would be dead code here. Unparseable input yields an empty map.
     *
     * <p>Hand-rolled rather than a regex on purpose: a PNG export arrives as a megabytes-long data
     * URL, and the obvious {@code (?:\\.|[^"\\])*} pattern overflows the stack on input that size.
     */
    static Map<String, Object> read(String json) {
        Map<String, Object> values = new LinkedHashMap<>();
        int at = 0;
        while (at < json.length()) {
            int keyStart = json.indexOf('"', at);
            if (keyStart < 0) {
                break;
            }
            int keyEnd = endOfString(json, keyStart);
            if (keyEnd < 0) {
                break;
            }
            int colon = skipWhitespace(json, keyEnd + 1);
            if (colon >= json.length() || json.charAt(colon) != ':') {
                at = keyEnd + 1;
                continue;
            }
            int valueStart = skipWhitespace(json, colon + 1);
            if (valueStart >= json.length() || json.charAt(valueStart) != '"') {
                at = valueStart + 1; // not a string value - skip it
                continue;
            }
            int valueEnd = endOfString(json, valueStart);
            if (valueEnd < 0) {
                break;
            }
            values.put(unescape(json.substring(keyStart + 1, keyEnd)),
                    unescape(json.substring(valueStart + 1, valueEnd)));
            at = valueEnd + 1;
        }
        return values;
    }

    /** Index of the quote closing the string that opens at {@code quote}, or {@code -1}. */
    private static int endOfString(String json, int quote) {
        for (int i = quote + 1; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '\\') {
                i++;
            } else if (c == '"') {
                return i;
            }
        }
        return -1;
    }

    private static int skipWhitespace(String json, int from) {
        int i = from;
        while (i < json.length() && Character.isWhitespace(json.charAt(i))) {
            i++;
        }
        return i;
    }

    private static String unescape(String text) {
        if (text.indexOf('\\') < 0) {
            return text;
        }
        StringBuilder out = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c != '\\' || i + 1 >= text.length()) {
                out.append(c);
                continue;
            }
            char escaped = text.charAt(++i);
            switch (escaped) {
                case 'n' -> out.append('\n');
                case 'r' -> out.append('\r');
                case 't' -> out.append('\t');
                case 'b' -> out.append('\b');
                case 'f' -> out.append('\f');
                case 'u' -> {
                    if (i + 4 < text.length()) {
                        out.append((char) Integer.parseInt(text.substring(i + 1, i + 5), 16));
                        i += 4;
                    }
                }
                // \" \\ \/ and anything else stands for itself
                default -> out.append(escaped);
            }
        }
        return out.toString();
    }

    static String write(Object value) {
        StringBuilder out = new StringBuilder();
        write(value, out);
        return out.toString();
    }

    private static void write(Object value, StringBuilder out) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String s) {
            string(s, out);
        } else if (value instanceof Boolean || value instanceof Number) {
            out.append(value);
        } else if (value instanceof Map<?, ?> map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) {
                    out.append(',');
                }
                first = false;
                string(String.valueOf(entry.getKey()), out);
                out.append(':');
                write(entry.getValue(), out);
            }
            out.append('}');
        } else {
            throw new IllegalArgumentException("Unsupported JSON value: " + value.getClass());
        }
    }

    private static void string(String s, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                // valid JSON, but line terminators inside JavaScript source
                case ' ' -> out.append("\\u2028");
                case ' ' -> out.append("\\u2029");
                // keep "</script>"-like sequences harmless
                case '<' -> out.append("\\u003c");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        out.append('"');
    }
}
