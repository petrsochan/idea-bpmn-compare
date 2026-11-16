package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The encoding of a history chunk the page sends back: entries by U+001E, fields by U+001F. */
class ElementHistoryTest {

    @Test
    void decodesEntries() {
        String encoded = "abc\u001fchanged\u001fChanged: name: \"A\" → \"B\""
                + "\u001e" + "def\u001fchanged,layout\u001fChanged + Moved";

        List<ElementHistory.Entry> entries = ElementHistory.decodeEntries(encoded);

        assertEquals(List.of(
                new ElementHistory.Entry("abc", List.of("changed"), "Changed: name: \"A\" → \"B\""),
                new ElementHistory.Entry("def", List.of("changed", "layout"), "Changed + Moved")), entries);
    }

    @Test
    void noEntriesDecodeToAnEmptyList() {
        assertEquals(List.of(), ElementHistory.decodeEntries(""));
        assertEquals(List.of(), ElementHistory.decodeEntries(null));
    }

    @Test
    void skipsMalformedEntries() {
        assertEquals(List.of(new ElementHistory.Entry("abc", List.of("added"), "Added")),
                ElementHistory.decodeEntries("broken\u001e" + "abc\u001fadded\u001fAdded"));
    }
}
