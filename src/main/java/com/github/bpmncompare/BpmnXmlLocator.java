package com.github.bpmncompare;

import org.jetbrains.annotations.Nullable;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Maps between a BPMN element id and a position in the XML text.
 *
 * <p>Plain text scanning on purpose: the same code has to serve the working copy, where a PSI tree
 * exists, and the content of a Git revision, where it does not - and it never needs a read action.
 */
final class BpmnXmlLocator {

    /** {@code id="x"} or {@code id='x'}; the back-reference forces matching quotes. */
    private static final String ID_ATTRIBUTE = "\\bid\\s*=\\s*([\"'])";

    private static final Pattern ANY_ID = Pattern.compile(ID_ATTRIBUTE + "(.*?)\\1");

    private BpmnXmlLocator() {
    }

    /**
     * Offset of the opening {@code <} of the element carrying {@code id}, or {@code -1} if there is none.
     *
     * <p>Only a real {@code id} attribute matches: a {@code bpmnElement="id"} reference of a diagram
     * shape does not, and neither does an id that is merely a prefix of another one.
     */
    static int offsetOfElement(String xml, String id) {
        Matcher matcher = Pattern.compile(ID_ATTRIBUTE + Pattern.quote(id) + "\\1").matcher(xml);
        while (matcher.find()) {
            int start = xml.lastIndexOf('<', matcher.start());
            if (start >= 0) {
                return start;
            }
        }
        return -1;
    }

    /** Id of the element whose opening tag contains {@code offset}, or {@code null} if there is none. */
    static @Nullable String elementIdAt(String xml, int offset) {
        if (xml.isEmpty()) {
            return null;
        }
        int start = xml.lastIndexOf('<', Math.min(offset, xml.length() - 1));
        if (start < 0) {
            return null;
        }
        int end = xml.indexOf('>', start);
        Matcher matcher = ANY_ID.matcher(xml.substring(start, end < 0 ? xml.length() : end));
        return matcher.find() ? matcher.group(2) : null;
    }
}
