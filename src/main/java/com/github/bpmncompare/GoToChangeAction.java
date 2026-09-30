package com.github.bpmncompare;

import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.PlatformDataKeys;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.project.DumbAware;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/**
 * Steps to the next or previous highlighted change of the BPMN compare view.
 *
 * <p>The web view handles F7 itself while the diagram has focus; these actions make the shortcut work
 * from anywhere in the editor tab and put the commands in the keymap and in <i>Find Action</i>.
 */
public abstract class GoToChangeAction extends AnAction implements DumbAware {

    private final int step;

    private GoToChangeAction(int step) {
        this.step = step;
    }

    @Override
    public @NotNull ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.EDT;
    }

    @Override
    public void update(@NotNull AnActionEvent e) {
        e.getPresentation().setEnabledAndVisible(panelOf(e) != null);
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        BpmnComparePanel panel = panelOf(e);
        if (panel != null) {
            panel.goToChange(step);
        }
    }

    private static @Nullable BpmnComparePanel panelOf(AnActionEvent e) {
        FileEditor editor = e.getData(PlatformDataKeys.FILE_EDITOR);
        return editor instanceof BpmnCompareEditor compareEditor ? compareEditor.panel() : null;
    }

    public static final class Next extends GoToChangeAction {
        public Next() {
            super(1);
        }
    }

    public static final class Previous extends GoToChangeAction {
        public Previous() {
            super(-1);
        }
    }
}
