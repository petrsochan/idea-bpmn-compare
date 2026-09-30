package com.github.bpmncompare;

import java.util.ArrayList;
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

    private static String abbreviate(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max - 1) + "…";
    }
}
