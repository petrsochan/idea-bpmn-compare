package com.github.bpmncompare;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

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

    private static String abbreviate(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max - 1) + "…";
    }
}
