package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GitLogParserTest {

    private static final String US = "";

    private static String line(String hash, String shortHash, String date, String author, String subject) {
        return String.join(US, hash, shortHash, date, author, subject);
    }

    @Test
    void parsesOneCommitPerLine() {
        List<RevisionItem> items = GitLogParser.parse(List.of(
                line("abc1234def", "abc1234", "2026-09-30", "Petr", "Fix the gateway"),
                line("0badc0ffee", "0badc0f", "2026-09-29", "Petr", "Add a task")));

        assertEquals(2, items.size());
        assertEquals("abc1234def", items.get(0).revision());
        assertEquals(RevisionItem.Group.COMMIT, items.get(0).group());
        assertTrue(items.get(0).label().contains("Fix the gateway"), items.get(0).label());
        assertTrue(items.get(0).shortLabel().startsWith("abc1234"), items.get(0).shortLabel());
    }

    @Test
    void keepsSeparatorsThatAppearInsideTheCommitSubject() {
        // the subject is the last field, so a separator inside it must not shift the other fields
        List<RevisionItem> items = GitLogParser.parse(List.of(
                line("abc1234def", "abc1234", "2026-09-30", "Petr", "Weird" + US + "subject")));

        assertEquals(1, items.size());
        assertEquals("abc1234def", items.get(0).revision());
        assertTrue(items.get(0).label().contains("Weird" + US + "subject"), items.get(0).label());
    }

    @Test
    void skipsLinesWithTooFewFields() {
        assertEquals(List.of(), GitLogParser.parse(List.of("", "abc1234def" + US + "abc1234")));
    }

    @Test
    void abbreviatesLongSubjects() {
        RevisionItem item = GitLogParser.parse(List.of(
                line("abc1234def", "abc1234", "2026-09-30", "Petr", "x".repeat(200)))).get(0);

        assertTrue(item.label().length() < 150, "label was " + item.label().length() + " chars");
        assertTrue(item.label().endsWith("…"), item.label());
        assertTrue(item.shortLabel().length() < 45, item.shortLabel());
    }
}
