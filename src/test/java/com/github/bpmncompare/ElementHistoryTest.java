package com.github.bpmncompare;

import com.intellij.testFramework.LightVirtualFile;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
    void aChunkCarriesEveryVersionOnceByBlobId() {
        List<HistoryCommit> chunk = List.of(
                new HistoryCommit("c3", "c3", "2026-11-03", "A", "third", "v2", "v3"),
                new HistoryCommit("c2", "c2", "2026-11-02", "A", "second", "v1", "v2"),
                new HistoryCommit("c1", "c1", "2026-11-01", "A", "first", null, "v1"));
        Map<String, String> blobs = Map.of("v1", "<one/>", "v2", "<two/>", "v3", "<three/>", "v0", "<unused/>");

        Map<String, Object> args = ElementHistory.chunkArgs("tok", "Task_1", chunk, blobs);

        assertEquals("tok", args.get("token"));
        assertEquals("Task_1", args.get("id"));
        assertEquals(Map.of("v1", "<one/>", "v2", "<two/>", "v3", "<three/>"), args.get("blobs"));
        List<?> commits = (List<?>) args.get("commits");
        assertEquals(3, commits.size());
        Map<?, ?> last = (Map<?, ?>) commits.get(2);
        assertEquals("c1", last.get("hash"));
        assertNull(last.get("before"));
        assertEquals("v1", last.get("after"));
    }

    @Test
    void waitingForThePageEndsAtOnceWhenTheViewIsClosed() {
        long start = System.nanoTime();

        assertNull(ElementHistory.awaitAnswer(new LinkedBlockingQueue<>(), () -> true, 60_000, 20));
        assertTrue(System.nanoTime() - start < 1_000_000_000L, "returned only after " + (System.nanoTime() - start) + " ns");
    }

    @Test
    void waitingForThePageReturnsTheAnswer() {
        LinkedBlockingQueue<Map<String, Object>> answers = new LinkedBlockingQueue<>();
        answers.offer(Map.of("token", "tok"));

        assertEquals(Map.of("token", "tok"), ElementHistory.awaitAnswer(answers, () -> false, 60_000, 20));
    }

    @Test
    void waitingForThePageGivesUpAfterTheTimeout() {
        assertThrows(ElementHistory.HistoryException.class,
                () -> ElementHistory.awaitAnswer(new LinkedBlockingQueue<>(), () -> false, 60, 20));
    }

    @Test
    void aSideWithoutAFileHasNoHistory() {
        assertEquals("The diagram is not a file in the project.", ElementHistory.unavailableReason(null, f -> true));
    }

    @Test
    void aFileOutsideGitHasNoHistory() {
        assertEquals("The file is not under Git version control.",
                ElementHistory.unavailableReason(new LightVirtualFile("a.bpmn"), f -> false));
    }

    @Test
    void aFileInGitHasHistory() {
        assertNull(ElementHistory.unavailableReason(new LightVirtualFile("a.bpmn"), f -> true));
    }

    @Test
    void skipsMalformedEntries() {
        assertEquals(List.of(new ElementHistory.Entry("abc", List.of("added"), "Added")),
                ElementHistory.decodeEntries("broken\u001e" + "abc\u001fadded\u001fAdded"));
    }
}
