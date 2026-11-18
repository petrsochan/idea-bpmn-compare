package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BpmnWebViewTest {

    @Test
    void aFailingBrowserIsReportedAndGivesNoPage() {
        List<Throwable> reported = new ArrayList<>();
        IllegalStateException failure = new IllegalStateException("CEF failed to initialize");

        Object page = BpmnWebView.createOrNull(() -> {
            throw failure;
        }, reported::add);

        assertNull(page);
        assertEquals(List.of(failure), reported);
    }

    @Test
    void aWorkingBrowserIsReturned() {
        List<Throwable> reported = new ArrayList<>();
        Object browser = new Object();

        assertSame(browser, BpmnWebView.createOrNull(() -> browser, reported::add));
        assertTrue(reported.isEmpty());
    }
}
