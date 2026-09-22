package com.github.bpmncompare;

import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorPolicy;
import com.intellij.openapi.fileEditor.FileEditorProvider;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

public final class BpmnCompareEditorProvider implements FileEditorProvider, DumbAware {

    static final String ID = "bpmn-compare-editor";

    @Override
    public boolean accept(@NotNull Project project, @NotNull VirtualFile file) {
        return BpmnFiles.isBpmn(file);
    }

    @Override
    public boolean acceptRequiresReadAction() {
        return false;
    }

    @Override
    public @NotNull FileEditor createEditor(@NotNull Project project, @NotNull VirtualFile file) {
        return new BpmnCompareEditor(project, file);
    }

    @Override
    public @NotNull String getEditorTypeId() {
        return ID;
    }

    @Override
    public @NotNull FileEditorPolicy getPolicy() {
        return FileEditorPolicy.PLACE_AFTER_DEFAULT_EDITOR;
    }
}
