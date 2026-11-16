package com.github.bpmncompare;

import org.jetbrains.annotations.Nullable;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * Parses {@code git log} output into entries of the "compare with" chooser.
 *
 * <p>The format string lives here next to its parser so the two cannot drift apart. Fields are
 * separated by {@code %x1f} (unit separator) and split with a limit, so a separator inside the
 * commit subject - the last field - stays part of it instead of shifting every other field.
 */
final class GitLogParser {

    static final String FORMAT = "--pretty=format:%H%x1f%h%x1f%ad%x1f%an%x1f%s";

    private static final String FIELD_SEPARATOR = "";
    private static final int FIELDS = 5;
    private static final int LABEL_SUBJECT_MAX = 90;
    private static final int SHORT_LABEL_SUBJECT_MAX = 30;

    private GitLogParser() {
    }

    /** @param lines output of {@code git log} formatted with {@link #FORMAT}; malformed lines are skipped */
    static List<RevisionItem> parse(List<String> lines) {
        List<RevisionItem> commits = new ArrayList<>();
        for (String line : lines) {
            String[] fields = line.split(FIELD_SEPARATOR, FIELDS);
            if (fields.length < FIELDS) {
                continue;
            }
            String shortHash = fields[1];
            String date = fields[2];
            String author = fields[3];
            String subject = fields[4];
            commits.add(new RevisionItem(RevisionItem.Group.COMMIT, fields[0],
                    shortHash + "  " + date + "  " + author + "  —  " + abbreviate(subject, LABEL_SUBJECT_MAX),
                    shortHash + " " + abbreviate(subject, SHORT_LABEL_SUBJECT_MAX)));
        }
        return commits;
    }

    /**
     * Paths a file had before it was renamed, newest first, without the current one.
     *
     * <p>Walks the status records git prints newest commit first: {@code R<score>} (old path, new
     * path) adds the old path, {@code C<score>} or {@code A} ends the walk because the file started
     * there - as a copy of another file that still exists, or as a new file. A copy is therefore not
     * mistaken for a rename: its source is not an earlier name of the file.
     *
     * @param lines output of {@code git log --follow --name-status --format= -z -- <path>}; the
     *              records are NUL- (or newline-) separated, a truncated last record is ignored
     */
    static List<String> historicalPaths(List<String> lines, String currentPath) {
        List<String> tokens = new ArrayList<>();
        for (String line : lines) {
            for (String token : line.split("[\\x00\\n]")) {
                if (!token.isEmpty()) {
                    tokens.add(token);
                }
            }
        }
        LinkedHashSet<String> paths = new LinkedHashSet<>();
        int i = 0;
        while (i < tokens.size()) {
            String status = tokens.get(i++);
            char kind = status.charAt(0);
            if (kind == 'R' || kind == 'C') {
                if (i + 1 >= tokens.size()) {
                    break; // truncated record
                }
                String oldPath = tokens.get(i);
                i += 2;
                if (kind == 'C') {
                    break;
                }
                if (!oldPath.equals(currentPath)) {
                    paths.add(oldPath);
                }
            } else if (kind == 'A') {
                break;
            } else {
                i++; // M, D, T, ...: one path
            }
        }
        return List.copyOf(paths);
    }

    /**
     * Format of the element history log: a record separator before each commit, so commits can be told
     * apart from the NUL-separated raw records that {@code -z} puts after them.
     */
    // no %h: --no-abbrev, needed for full blob ids, makes %h print the full hash as well
    static final String HISTORY_FORMAT = "--format=%x1e%H%x1f%ad%x1f%an%x1f%s";

    private static final int HISTORY_FIELDS = 4;
    private static final int SHORT_HASH = 7;
    private static final String NO_BLOB = "0".repeat(40);

    /**
     * @param output output of {@code git log --follow --raw --no-abbrev -z --date=short} with
     *               {@link #HISTORY_FORMAT}: per commit the header ended by NUL (and a line break), then
     *               the NUL-terminated raw record; a commit without one (a merge) is left out
     */
    static List<HistoryCommit> parseHistory(String output) {
        List<HistoryCommit> commits = new ArrayList<>();
        for (String chunk : output.split("\u001e")) {
            int headerEnd = indexOfAny(chunk, '\u0000', '\n');
            if (headerEnd < 0) {
                continue;
            }
            String[] fields = chunk.substring(0, headerEnd).split(FIELD_SEPARATOR, HISTORY_FIELDS);
            String[] raw = rawRecord(chunk.substring(headerEnd + 1));
            if (fields.length < HISTORY_FIELDS || raw == null) {
                continue;
            }
            String hash = fields[0];
            commits.add(new HistoryCommit(hash, hash.substring(0, Math.min(SHORT_HASH, hash.length())),
                    fields[1], fields[2], fields[3], blobOrNull(raw[2]), blobOrNull(raw[3])));
        }
        return commits;
    }

    private static int indexOfAny(String text, char first, char second) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == first || c == second) {
                return i;
            }
        }
        return -1;
    }

    /** {@code :<old mode> <new mode> <old blob> <new blob> <status>} split on spaces, or {@code null}. */
    private static String @Nullable [] rawRecord(String body) {
        for (String token : body.split("\u0000")) {
            String trimmed = token.strip();
            if (trimmed.startsWith(":")) {
                String[] parts = trimmed.split(" ");
                return parts.length >= 5 ? parts : null;
            }
        }
        return null;
    }

    private static @Nullable String blobOrNull(String id) {
        return NO_BLOB.equals(id) ? null : id;
    }

    /**
     * @param output output of {@code git cat-file --batch}: per object a header {@code <id> blob <size>}
     *               followed by exactly size bytes and a newline, or {@code <id> missing}
     * @return id → content of every object found; a truncated last object is left out
     */
    static Map<String, byte[]> parseCatFileBatch(byte[] output) {
        Map<String, byte[]> blobs = new LinkedHashMap<>();
        int pos = 0;
        while (pos < output.length) {
            int lineEnd = indexOf(output, (byte) '\n', pos);
            if (lineEnd < 0) {
                break;
            }
            String[] header = new String(output, pos, lineEnd - pos, StandardCharsets.US_ASCII).split(" ");
            pos = lineEnd + 1;
            if (header.length < 3) {
                continue; // "<id> missing"
            }
            int size;
            try {
                size = Integer.parseInt(header[2]);
            } catch (NumberFormatException e) {
                break;
            }
            if (pos + size > output.length) {
                break;
            }
            blobs.put(header[0], Arrays.copyOfRange(output, pos, pos + size));
            pos += size + 1;
        }
        return blobs;
    }

    private static int indexOf(byte[] bytes, byte value, int from) {
        for (int i = from; i < bytes.length; i++) {
            if (bytes[i] == value) {
                return i;
            }
        }
        return -1;
    }

    private static String abbreviate(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max - 1) + "…";
    }
}
