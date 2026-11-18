package com.github.bpmncompare;

import com.intellij.diff.merge.MergeResult;
import com.intellij.diff.merge.MergeTool;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.ToggleAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.util.Disposer;
import com.intellij.testFramework.TestActionEvent;
import com.intellij.testFramework.junit5.RunInEdt;
import com.intellij.testFramework.junit5.TestApplication;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.components.JBLabel;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import javax.swing.*;
import java.awt.*;
import java.awt.event.ActionEvent;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeFalse;

/**
 * The merge window's side of the merge view, in a running IDE application: the wrapping of the text merge,
 * the toggle, and the result column following the diagrams. The page itself is covered by the Playwright
 * tests; JCEF does not run here.
 */
@TestApplication
@RunInEdt
class BpmnMergeViewerTest {

    private static final String RESULT = """
            <bpmn:definitions>
              <bpmn:process id="P">
                <bpmn:task id="Task_Check" name="Check stock" />
                <bpmn:task id="Task_Ship" name="Ship order" />
              </bpmn:process>
            </bpmn:definitions>
            """;

    private final List<Editor> editors = new ArrayList<>();
    private Document result;
    private FakeTextMerge text;
    private BpmnMergeViewer viewer;
    private boolean diagramsVisibleBefore;

    @BeforeEach
    void setUp() {
        diagramsVisibleBefore = BpmnCompareSettings.isMergeDiagramsVisible();
        result = EditorFactory.getInstance().createDocument(RESULT);
        text = new FakeTextMerge();
        viewer = new BpmnMergeViewer(List.of("<ours/>", "<base/>", "<theirs/>"), List.of("Ours", "Base", "Theirs"),
                result, text);
    }

    @AfterEach
    void tearDown() {
        editors.forEach(EditorFactory.getInstance()::releaseEditor);
        Disposer.dispose(viewer);
        BpmnCompareSettings.setMergeDiagramsVisible(diagramsVisibleBefore);
    }

    /** An editor of the result document shown inside the text merge, like its result column. */
    private Editor resultColumn() {
        Editor editor = EditorFactory.getInstance().createEditor(result);
        editors.add(editor);
        text.component.add(editor.getComponent());
        return editor;
    }

    private ToggleAction toggle(MergeTool.ToolbarComponents components) {
        AnAction last = components.toolbarActions.get(components.toolbarActions.size() - 1);
        return assertInstanceOf(ToggleAction.class, last);
    }

    @Test
    void theTextMergeKeepsItsToolbarAndGetsTheToggle() {
        MergeTool.ToolbarComponents components = viewer.init();

        assertEquals(2, components.toolbarActions.size());
        assertSame(text.ownAction, components.toolbarActions.get(0));
        assertSame(text.closeHandler, components.closeHandler);
        assertEquals("Show BPMN Diagrams", toggle(components).getTemplateText());
    }

    @Test
    void resolvingIsTheTextMerges() {
        assertSame(text.resolve, viewer.getResolveAction(MergeResult.RESOLVED));
        assertSame(text.focus, viewer.getPreferredFocusedComponent());
    }

    @Test
    void theToggleHidesTheDiagramsAndRemembersIt() {
        BpmnCompareSettings.setMergeDiagramsVisible(true);
        ToggleAction toggle = toggle(viewer.init());
        AnActionEvent event = TestActionEvent.createTestEvent();
        assertTrue(viewer.diagramsShown());

        toggle.setSelected(event, false);

        assertFalse(viewer.diagramsShown());
        assertFalse(BpmnCompareSettings.isMergeDiagramsVisible());
        assertTrue(SwingUtilities.isDescendingFrom(text.component, viewer.getComponent()));

        toggle.setSelected(event, true);

        assertTrue(viewer.diagramsShown());
        assertTrue(BpmnCompareSettings.isMergeDiagramsVisible());
    }

    @Test
    void hiddenDiagramsStayHiddenInTheNextMergeWindow() {
        BpmnCompareSettings.setMergeDiagramsVisible(false);

        viewer.init();

        assertFalse(viewer.diagramsShown());
    }

    @Test
    void withoutJcefTheDiagramsSayWhyAndTheTextMergeStays() {
        assumeFalse(JBCefApp.isSupported());
        BpmnCompareSettings.setMergeDiagramsVisible(true);

        viewer.init();

        assertTrue(viewer.diagramsShown());
        assertTrue(containsLabel(viewer.getComponent(), "JCEF"));
        assertTrue(SwingUtilities.isDescendingFrom(text.component, viewer.getComponent()));
    }

    @Test
    void theResultColumnGoesToTheElementAndSelectsItsLine() {
        Editor column = resultColumn();

        viewer.revealInResult("Task_Ship");

        int offset = RESULT.indexOf("<bpmn:task id=\"Task_Ship\"");
        int line = result.getLineNumber(offset);
        assertEquals(offset, column.getCaretModel().getOffset());
        assertEquals(result.getLineStartOffset(line), column.getSelectionModel().getSelectionStart());
        assertEquals(result.getLineEndOffset(line), column.getSelectionModel().getSelectionEnd());
    }

    @Test
    void anEditorOfTheResultOutsideTheMergeWindowStaysWhereItIs() {
        Editor elsewhere = EditorFactory.getInstance().createEditor(result);
        editors.add(elsewhere);

        viewer.revealInResult("Task_Ship");

        assertEquals(0, elsewhere.getCaretModel().getOffset());
    }

    @Test
    void anElementTheResultDoesNotHaveMovesNothing() {
        Editor column = resultColumn();

        viewer.revealInResult("Task_Gift");

        assertEquals(0, column.getCaretModel().getOffset());
        assertFalse(column.getSelectionModel().hasSelection());
    }

    @Test
    void closingTheWindowDisposesTheTextMerge() {
        BpmnMergeViewer closing = new BpmnMergeViewer(List.of("", "", ""), List.of(), result, text);

        Disposer.dispose(closing);

        assertTrue(text.disposed);
    }

    private static boolean containsLabel(Container container, String text) {
        for (Component child : container.getComponents()) {
            if (child instanceof JBLabel label && label.getText() != null && label.getText().contains(text)) {
                return true;
            }
            if (child instanceof Container nested && containsLabel(nested, text)) {
                return true;
            }
        }
        return false;
    }

    /** Stands in for the platform's text merge viewer. */
    private static final class FakeTextMerge implements MergeTool.MergeViewer {
        final JPanel component = new JPanel(new BorderLayout());
        final JComponent focus = new JPanel();
        final AnAction ownAction = new AnAction("Apply non-conflicting changes") {
            @Override
            public void actionPerformed(@NotNull AnActionEvent e) {
            }
        };
        final kotlin.jvm.functions.Function0<Boolean> closeHandler = () -> true;
        final Action resolve = new AbstractAction("Apply") {
            @Override
            public void actionPerformed(ActionEvent e) {
            }
        };
        boolean disposed;

        @Override
        public @NotNull JComponent getComponent() {
            return component;
        }

        @Override
        public @Nullable JComponent getPreferredFocusedComponent() {
            return focus;
        }

        @Override
        public @Nullable Action getResolveAction(@NotNull MergeResult result) {
            return result == MergeResult.RESOLVED ? resolve : null;
        }

        @Override
        public @NotNull MergeTool.ToolbarComponents init() {
            MergeTool.ToolbarComponents components = new MergeTool.ToolbarComponents();
            components.toolbarActions = List.of(ownAction);
            components.closeHandler = closeHandler;
            return components;
        }

        @Override
        public void dispose() {
            disposed = true;
        }
    }
}
