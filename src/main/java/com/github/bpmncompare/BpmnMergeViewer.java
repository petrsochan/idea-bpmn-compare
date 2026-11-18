package com.github.bpmncompare;

import com.intellij.diff.contents.DocumentContent;
import com.intellij.diff.merge.MergeResult;
import com.intellij.diff.merge.MergeTool;
import com.intellij.diff.merge.TextMergeRequest;
import com.intellij.icons.AllIcons;
import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.ToggleAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.editor.ScrollType;
import com.intellij.openapi.editor.event.CaretEvent;
import com.intellij.openapi.editor.event.CaretListener;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.util.Disposer;
import com.intellij.ui.OnePixelSplitter;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.util.ArrayList;
import java.util.List;

/**
 * The merge window's content for a BPMN file: the diagrams above the text merge, in a splitter whose
 * position is remembered. Everything that resolves the merge is the text merge's.
 */
final class BpmnMergeViewer implements MergeTool.MergeViewer {

    private static final String SPLITTER_KEY = "bpmnCompare.mergeSplitter";
    private static final float DEFAULT_DIAGRAMS_PROPORTION = 0.4f;

    private final MergeTool.MergeViewer text;
    private final Document result;
    /** The caret is being moved by the diagrams, not by the user. */
    private boolean revealing;
    private final BpmnMergePanel diagrams;
    private final OnePixelSplitter splitter = new OnePixelSplitter(true, SPLITTER_KEY, DEFAULT_DIAGRAMS_PROPORTION);

    /** The viewer of a merge request; ours, base and theirs are read once, as they do not change during it. */
    static BpmnMergeViewer of(TextMergeRequest request, MergeTool.MergeViewer text) {
        List<String> sideTexts = request.getContents().stream()
                .map(DocumentContent::getDocument)
                .map(Document::getText)
                .toList();
        return new BpmnMergeViewer(sideTexts, request.getContentTitles(), request.getOutputContent().getDocument(), text);
    }

    /**
     * @param sideTexts ours, base and theirs
     * @param titles    their titles
     * @param result    the result document the text merge edits
     * @param text      the text merge it wraps
     */
    BpmnMergeViewer(List<String> sideTexts, List<String> titles, Document result, MergeTool.MergeViewer text) {
        this.text = text;
        this.result = result;
        this.diagrams = new BpmnMergePanel(sideTexts, titles, result, this::revealInResult);
        splitter.setSecondComponent(text.getComponent());

        // the other direction: the caret in the result column selects its element in the diagrams
        EditorFactory.getInstance().getEventMulticaster().addCaretListener(new CaretListener() {
            @Override
            public void caretPositionChanged(@NotNull CaretEvent event) {
                Editor editor = event.getEditor();
                if (!revealing && editor.getDocument() == result && isInTextMerge(editor)) {
                    diagrams.caretMovedInResult(editor.getCaretModel().getOffset());
                }
            }
        }, diagrams);
    }

    private boolean isInTextMerge(Editor editor) {
        return SwingUtilities.isDescendingFrom(editor.getComponent(), text.getComponent());
    }

    @Override
    public @NotNull JComponent getComponent() {
        return splitter;
    }

    @Override
    public @Nullable JComponent getPreferredFocusedComponent() {
        return text.getPreferredFocusedComponent();
    }

    @Override
    public @NotNull MergeTool.ToolbarComponents init() {
        MergeTool.ToolbarComponents components = text.init();
        List<AnAction> actions = new ArrayList<>();
        if (components.toolbarActions != null) {
            actions.addAll(components.toolbarActions);
        }
        actions.add(new ToggleDiagramsAction());
        components.toolbarActions = actions;
        showDiagrams(BpmnCompareSettings.isMergeDiagramsVisible());
        return components;
    }

    @Override
    public @Nullable Action getResolveAction(@NotNull MergeResult result) {
        return text.getResolveAction(result);
    }

    /**
     * Puts the caret of the result column on the element {@code id} and scrolls it into the middle. The result
     * column is the editor of the result document inside this window's text merge; an element the result does
     * not have (yet) moves nothing.
     */
    void revealInResult(String id) {
        int offset = BpmnXmlLocator.offsetOfElement(result.getText(), id);
        if (offset < 0) {
            return;
        }
        for (Editor editor : EditorFactory.getInstance().getEditors(result)) {
            if (isInTextMerge(editor)) {
                // the focus stays in the diagrams, where F7 keeps stepping; a caret alone is not drawn in an
                // editor without focus, the selected line is
                int line = result.getLineNumber(offset);
                diagrams.caretPlacedOn(id);
                revealing = true;
                try {
                    editor.getCaretModel().moveToOffset(offset);
                    editor.getSelectionModel().setSelection(result.getLineStartOffset(line), result.getLineEndOffset(line));
                } finally {
                    revealing = false;
                }
                editor.getScrollingModel().scrollToCaret(ScrollType.CENTER);
                return;
            }
        }
    }

    boolean diagramsShown() {
        return splitter.getFirstComponent() != null;
    }

    void showDiagrams(boolean show) {
        if (show == diagramsShown()) {
            return;
        }
        if (show) {
            splitter.setFirstComponent(diagrams);
            diagrams.activate();
            diagrams.setLive(true);
        } else {
            diagrams.setLive(false);
            splitter.setFirstComponent(null);
        }
        splitter.revalidate();
        splitter.repaint();
    }

    @Override
    public void dispose() {
        Disposer.dispose(text);
        Disposer.dispose(diagrams);
    }

    private final class ToggleDiagramsAction extends ToggleAction implements DumbAware {

        ToggleDiagramsAction() {
            super("Show BPMN Diagrams", "Show the diagrams of ours, the result and theirs above the text merge",
                    AllIcons.Actions.Preview);
        }

        @Override
        public @NotNull ActionUpdateThread getActionUpdateThread() {
            return ActionUpdateThread.EDT;
        }

        @Override
        public boolean isSelected(@NotNull AnActionEvent e) {
            return diagramsShown();
        }

        @Override
        public void setSelected(@NotNull AnActionEvent e, boolean state) {
            BpmnCompareSettings.setMergeDiagramsVisible(state);
            showDiagrams(state);
        }
    }
}
