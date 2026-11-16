package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * The parsers behind the element history: {@code git log --follow --raw --no-abbrev -z} with
 * {@link GitLogParser#HISTORY_FORMAT}, and {@code git cat-file --batch}. Separators are written as escapes,
 * so the file stays plain text.
 */
class FileHistoryParserTest {

    private static final String RS = "\u001e";
    private static final String US = "\u001f";
    private static final String NUL = "\u0000";
    private static final String ZERO = "0".repeat(40);
    private static final String BLOB_A = "a".repeat(40);
    private static final String BLOB_B = "b".repeat(40);
    private static final String BLOB_C = "c".repeat(40);

    private static String header(String hash, String subject) {
        return RS + String.join(US, hash, "2026-11-02", "Jan Novák", subject);
    }

    /** As git prints it with -z: the header's line end, a blank line, then NUL-terminated fields. */
    private static String raw(String oldBlob, String newBlob, String status, String... paths) {
        return "\n\n:100644 100644 " + oldBlob + " " + newBlob + " " + status + NUL + String.join(NUL, paths) + NUL;
    }

    @Test
    void parsesHistoryWithBlobIds() {
        String output = header("1111111aaaa", "Rename the check") + raw(BLOB_B, BLOB_C, "M", "order.bpmn")
                + "\n" + header("2222222bbbb", "Add the check") + raw(BLOB_A, BLOB_B, "M", "order.bpmn");

        List<HistoryCommit> commits = GitLogParser.parseHistory(output);

        assertEquals(2, commits.size());
        HistoryCommit first = commits.get(0);
        assertEquals("1111111aaaa", first.hash());
        assertEquals("1111111", first.shortHash());
        assertEquals("2026-11-02", first.date());
        assertEquals("Jan Novák", first.author());
        assertEquals("Rename the check", first.subject());
        assertEquals(BLOB_B, first.beforeBlob());
        assertEquals(BLOB_C, first.afterBlob());
        assertEquals(BLOB_A, commits.get(1).beforeBlob());
    }

    @Test
    void fileCreatedInACommitHasNoBeforeBlob() {
        List<HistoryCommit> commits = GitLogParser.parseHistory(
                header("1111111aaaa", "Create") + raw(ZERO, BLOB_A, "A", "order.bpmn"));

        assertNull(commits.get(0).beforeBlob());
        assertEquals(BLOB_A, commits.get(0).afterBlob());
    }

    @Test
    void parsesRenameRecords() {
        String output = header("1111111aaaa", "Move it") + raw(BLOB_A, BLOB_B, "R095", "old.bpmn", "new.bpmn")
                + header("2222222bbbb", "Before the move") + raw(BLOB_C, BLOB_A, "M", "old.bpmn");

        List<HistoryCommit> commits = GitLogParser.parseHistory(output);

        assertEquals(2, commits.size());
        assertEquals(BLOB_A, commits.get(0).beforeBlob());
        assertEquals(BLOB_B, commits.get(0).afterBlob());
        assertEquals("2222222bbbb", commits.get(1).hash());
    }

    @Test
    void dropsCommitsWithoutARawRecord() {
        String output = header("1111111aaaa", "Merge branch 'side'") + "\n"
                + header("2222222bbbb", "Edit") + raw(BLOB_A, BLOB_B, "M", "order.bpmn");

        List<HistoryCommit> commits = GitLogParser.parseHistory(output);

        assertEquals(1, commits.size());
        assertEquals("2222222bbbb", commits.get(0).hash());
    }

    @Test
    void keepsSeparatorsInsideTheSubject() {
        List<HistoryCommit> commits = GitLogParser.parseHistory(
                header("1111111aaaa", "Weird" + US + "subject") + raw(BLOB_A, BLOB_B, "M", "order.bpmn"));

        assertEquals("Weird" + US + "subject", commits.get(0).subject());
    }

    @Test
    void parsesCatFileBatch() {
        byte[] czech = "čau".getBytes(StandardCharsets.UTF_8);
        // content that itself looks like a batch header must not be taken for one
        String tricky = "x\n" + BLOB_C + " blob 3\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes((BLOB_A + " blob " + czech.length + "\n").getBytes(StandardCharsets.UTF_8));
        out.writeBytes(czech);
        out.writeBytes("\n".getBytes(StandardCharsets.UTF_8));
        out.writeBytes((BLOB_B + " missing\n").getBytes(StandardCharsets.UTF_8));
        out.writeBytes((BLOB_C + " blob " + tricky.length() + "\n" + tricky + "\n").getBytes(StandardCharsets.UTF_8));

        Map<String, byte[]> blobs = GitLogParser.parseCatFileBatch(out.toByteArray());

        assertEquals("čau", new String(blobs.get(BLOB_A), StandardCharsets.UTF_8));
        assertFalse(blobs.containsKey(BLOB_B));
        assertEquals(tricky, new String(blobs.get(BLOB_C), StandardCharsets.UTF_8));
        assertEquals(2, blobs.size());
    }
}
