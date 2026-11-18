package com.github.bpmncompare;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.util.Disposer;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBCheckBox;
import com.intellij.ui.components.JBLabel;
import com.intellij.util.Alarm;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.NotNull;

import javax.swing.*;
import java.awt.*;
import java.awt.datatransfer.StringSelection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * The diagrams of a merge: ours, the result as it is being resolved, and theirs, with the base behind a
 * switch. Lives in the merge window above the text merge, see {@link BpmnMergeViewer}.
 *
 * <p>Ours, base and theirs do not change during the merge and are read once; the result is pushed again,
 * shortly after each edit, while the panel is live.
 */
final class BpmnMergePanel extends JPanel implements Disposable {

    private static final int RESULT_UPDATE_DELAY_MS = 300;
    private static final String RESULT_LABEL = "Result";

    private final List<String> sideTexts;
    private final List<String> titles;
    private final Document result;
    private final BpmnWebView webView = new BpmnWebView(this, this::pushAll, this::handleHostRequest);
    private final Consumer<String> revealInResult;
    private final Alarm resultAlarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, this);
    private final JBCheckBox syncBox = new JBCheckBox("Synchronize mouse & view", BpmnCompareSettings.isSyncEnabled());

    private boolean initialized;
    private boolean live = true;

    /**
     * @param sideTexts the texts of ours, base and theirs, in this order
     * @param titles    their titles, as the merge window shows them
     * @param result    the merge window's result document
     * @param revealInResult puts the result column's caret on the element with the given id
     */
    BpmnMergePanel(List<String> sideTexts, List<String> titles, Document result, Consumer<String> revealInResult) {
        super(new BorderLayout());
        this.sideTexts = sideTexts;
        this.titles = titles;
        this.result = result;
        this.revealInResult = revealInResult;
        Disposer.register(this, webView);
        add(createToolbar(), BorderLayout.NORTH);
    }

    /** Creates the browser; called when the diagrams are shown for the first time. */
    void activate() {
        if (initialized) {
            return;
        }
        initialized = true;

        JComponent page = webView.create();
        if (page == null) {
            JBLabel label = new JBLabel("JCEF (embedded Chromium) is not available in this IDE runtime.",
                    SwingConstants.CENTER);
            label.setForeground(JBColor.GRAY);
            add(label, BorderLayout.CENTER);
            revalidate();
            return;
        }
        add(page, BorderLayout.CENTER);
        revalidate();

        result.addDocumentListener(new DocumentListener() {
            @Override
            public void documentChanged(@NotNull DocumentEvent event) {
                if (!live) {
                    return;
                }
                resultAlarm.cancelAllRequests();
                resultAlarm.addRequest(BpmnMergePanel.this::pushResult, RESULT_UPDATE_DELAY_MS, webView.modality());
            }
        }, this);
    }

    /**
     * While hidden, edits of the result are not rendered; when shown again, the current result is pushed
     * at once.
     */
    void setLive(boolean live) {
        this.live = live;
        if (live) {
            pushResult();
        } else {
            resultAlarm.cancelAllRequests();
        }
    }

    /** A message from the page; called on the browser thread. */
    private void handleHostRequest(Map<String, Object> message) {
        String command = String.valueOf(message.get("command"));
        switch (command) {
            case "revealInResult" -> {
                String id = String.valueOf(message.get("id"));
                webView.onEdt(() -> revealInResult.accept(id));
            }
            case "copyMarkdown" -> {
                String markdown = String.valueOf(message.get("payload"));
                webView.onEdt(() -> CopyPasteManager.getInstance().setContents(new StringSelection(markdown)));
            }
            default -> {
                // the merge view has no element menu, SVG/PNG export or XML navigation
            }
        }
    }

    private void pushAll() {
        webView.pushTheme();
        webView.call("setSync", syncBox.isSelected());
        Map<String, Object> merge = new LinkedHashMap<>();
        merge.put("ours", side(0, "Ours"));
        merge.put("base", side(1, "Base"));
        merge.put("theirs", side(2, "Theirs"));
        merge.put("result", DiagramSide.xml(result.getText(), RESULT_LABEL).toJson());
        webView.call("setMerge", merge);
    }

    private Map<String, Object> side(int index, String fallback) {
        String title = index < titles.size() ? titles.get(index) : null;
        return DiagramSide.xml(sideTexts.get(index), title == null || title.isBlank() ? fallback : title).toJson();
    }

    private void pushResult() {
        webView.call("setMergeResult", DiagramSide.xml(result.getText(), RESULT_LABEL).toJson());
    }

    private JComponent createToolbar() {
        JPanel bar = new JPanel(new BorderLayout());
        bar.setBorder(JBUI.Borders.compound(
                JBUI.Borders.customLineBottom(JBColor.border()),
                JBUI.Borders.empty(3, 8)));
        bar.add(new JBLabel("BPMN diagrams of the merge"), BorderLayout.WEST);
        syncBox.setToolTipText("Pan, zoom, hover and the mouse cursor move all diagrams together");
        syncBox.addActionListener(e -> {
            BpmnCompareSettings.setSyncEnabled(syncBox.isSelected());
            webView.call("setSync", syncBox.isSelected());
        });
        bar.add(syncBox, BorderLayout.EAST);
        return bar;
    }

    @Override
    public void dispose() {
    }
}
