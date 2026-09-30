package com.github.bpmncompare;

import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorState;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.UserDataHolderBase;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.beans.PropertyChangeListener;

/** "BPMN Diff" editor tab shown next to the text editor of a BPMN file. */
final class BpmnCompareEditor extends UserDataHolderBase implements FileEditor {

    private final VirtualFile file;
    private final BpmnComparePanel panel;

    BpmnCompareEditor(Project project, VirtualFile file) {
        this.file = file;
        this.panel = new BpmnComparePanel(project, file,
                new BpmnContentSource.Working(file),
                new BpmnContentSource.Revision(project, file, RevisionItem.HEAD));
        Disposer.register(this, panel);
    }

    BpmnComparePanel panel() {
        return panel;
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
    public @NotNull String getName() {
        return "BPMN Diff";
    }

    @Override
    public @NotNull VirtualFile getFile() {
        return file;
    }

    @Override
    public void selectNotify() {
        panel.activate();
    }

    @Override
    public void setState(@NotNull FileEditorState state) {
    }

    @Override
    public boolean isModified() {
        return false;
    }

    @Override
    public boolean isValid() {
        return file.isValid();
    }

    @Override
    public void addPropertyChangeListener(@NotNull PropertyChangeListener listener) {
    }

    @Override
    public void removePropertyChangeListener(@NotNull PropertyChangeListener listener) {
    }

    @Override
    public void dispose() {
    }
}
