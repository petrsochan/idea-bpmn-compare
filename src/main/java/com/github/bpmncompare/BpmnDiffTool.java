package com.github.bpmncompare;

import com.intellij.diff.DiffContext;
import com.intellij.diff.FrameDiffTool;
import com.intellij.diff.contents.DiffContent;
import com.intellij.diff.contents.DocumentContent;
import com.intellij.diff.requests.ContentDiffRequest;
import com.intellij.diff.requests.DiffRequest;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.List;

/**
 * Makes the BPMN compare view available wherever the IDE shows a diff: the commit dialog, the Git log,
 * <i>Compare with Branch</i>, <i>Compare Two Files</i>.
 *
 * <p>The user picks it in the diff window's tool selector, so the text diff stays the default. This is
 * also the only way to compare two revisions of a diagram with each other - the editor tab always has
 * the working copy on one side.
 */
public final class BpmnDiffTool implements FrameDiffTool {

    @Override
    public @NotNull String getName() {
        return "BPMN diagram";
    }

    @Override
    public boolean canShow(@NotNull DiffContext context, @NotNull DiffRequest request) {
        if (context.getProject() == null || !(request instanceof ContentDiffRequest contentRequest)) {
            return false;
        }
        List<DiffContent> contents = contentRequest.getContents();
        // two sides, at least one of them a BPMN file - the other may be an EmptyContent when the
        // file was added or deleted in the compared revision
        return contents.size() == 2 && contents.stream().anyMatch(BpmnDiffTool::isBpmn);
    }

    @Override
    public @NotNull DiffViewer createComponent(@NotNull DiffContext context, @NotNull DiffRequest request) {
        return new BpmnDiffViewer(context, (ContentDiffRequest) request);
    }

    static boolean isBpmn(DiffContent content) {
        return BpmnFiles.isBpmn(fileOf(content));
    }

    /** The file a diff content stands for, or {@code null} for content with no file behind it. */
    static @Nullable VirtualFile fileOf(DiffContent content) {
        return content instanceof DocumentContent documentContent ? documentContent.getHighlightFile() : null;
    }
}
