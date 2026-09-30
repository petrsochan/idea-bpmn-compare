package com.github.bpmncompare;

import com.intellij.diff.DiffContext;
import com.intellij.diff.FrameDiffTool;
import com.intellij.diff.contents.DiffContent;
import com.intellij.diff.contents.DocumentContent;
import com.intellij.diff.requests.ContentDiffRequest;
import com.intellij.openapi.util.Disposer;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.util.List;

/** Shows {@link BpmnComparePanel} inside a platform diff window. */
final class BpmnDiffViewer implements FrameDiffTool.DiffViewer {

    private static final int BEFORE = 0;
    private static final int AFTER = 1;

    private final BpmnComparePanel panel;

    BpmnDiffViewer(DiffContext context, ContentDiffRequest request) {
        List<DiffContent> contents = request.getContents();
        List<String> titles = request.getContentTitles();

        // the platform orders contents as [before, after]; the newer side goes left, matching the
        // editor tab where the left pane is the current version
        this.panel = new BpmnComparePanel(context.getProject(), BpmnDiffTool.fileOf(contents.get(AFTER)),
                new BpmnContentSource.Fixed(textOf(contents.get(AFTER)), title(titles, AFTER, "After")),
                new BpmnContentSource.Fixed(textOf(contents.get(BEFORE)), title(titles, BEFORE, "Before")));
    }

    /**
     * {@code null} for content without a document - an {@code EmptyContent} of a file that did not exist.
     *
     * <p>No read action: the diff framework constructs the viewer on the EDT, which already holds
     * write-intent read access.
     */
    private static @Nullable String textOf(DiffContent content) {
        return content instanceof DocumentContent documentContent ? documentContent.getDocument().getText() : null;
    }

    private static String title(List<String> titles, int index, String fallback) {
        String title = index < titles.size() ? titles.get(index) : null;
        return title == null || title.isBlank() ? fallback : title;
    }

    @Override
    public @NotNull JComponent getComponent() {
        return panel;
    }

    @Override
    public @Nullable JComponent getPreferredFocusedComponent() {
        return panel;
    }

    @Override
    public @NotNull FrameDiffTool.ToolbarComponents init() {
        panel.activate();
        return new FrameDiffTool.ToolbarComponents();
    }

    @Override
    public void dispose() {
        Disposer.dispose(panel);
    }
}
