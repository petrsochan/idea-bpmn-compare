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
    private final BpmnMergePanel diagrams;
    private final OnePixelSplitter splitter = new OnePixelSplitter(true, SPLITTER_KEY, DEFAULT_DIAGRAMS_PROPORTION);

    BpmnMergeViewer(TextMergeRequest request, MergeTool.MergeViewer text) {
        this.text = text;
        // read once, on the EDT the merge window builds its viewer on: ours, base and theirs do not change
        List<String> sideTexts = request.getContents().stream()
                .map(DocumentContent::getDocument)
                .map(document -> document.getText())
                .toList();
        this.diagrams = new BpmnMergePanel(sideTexts, request.getContentTitles(), request.getOutputContent().getDocument());
        splitter.setSecondComponent(text.getComponent());
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

    private boolean diagramsShown() {
        return splitter.getFirstComponent() != null;
    }

    private void showDiagrams(boolean show) {
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
