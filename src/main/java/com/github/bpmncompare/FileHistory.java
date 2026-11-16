package com.github.bpmncompare;

import java.util.List;
import java.util.Map;

/**
 * The commits that changed a file, newest first, with the file's content before and after each of them.
 *
 * @param commits commits of {@code git log --follow}, merges left out
 * @param blobs   blob id → the file's text in that version (UTF-8, BOM stripped)
 */
record FileHistory(List<HistoryCommit> commits, Map<String, String> blobs) {
}
