package com.github.bpmncompare;

import com.intellij.diff.DiffManagerEx;
import com.intellij.diff.merge.MergeContext;
import com.intellij.diff.merge.MergeRequest;
import com.intellij.diff.merge.MergeTool;
import com.intellij.diff.merge.TextMergeRequest;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.List;
import java.util.function.Predicate;

/**
 * The merge window of a BPMN file: the IDE's own text merge, with the diagrams of ours, the result and
 * theirs above it.
 *
 * <p>The merge window has no tool selector - it takes the first tool that can show the request, and
 * registered tools come before the built-in text merge. So this tool does not replace the text merge but
 * wraps it: the text merge is whichever other tool would have shown the request.
 */
public final class BpmnMergeTool implements MergeTool {

    @Override
    public boolean canShow(@NotNull MergeContext context, @NotNull MergeRequest request) {
        return context.getProject() != null
                && request instanceof TextMergeRequest textRequest
                && BpmnFiles.isBpmn(textRequest.getOutputContent().getHighlightFile())
                && delegate(context, request) != null;
    }

    @Override
    public @NotNull MergeViewer createComponent(@NotNull MergeContext context, @NotNull MergeRequest request) {
        MergeTool delegate = delegate(context, request);
        if (delegate == null) {
            throw new IllegalStateException("No merge tool to show " + request);
        }
        return new BpmnMergeViewer((TextMergeRequest) request, delegate.createComponent(context, request));
    }

    private static @Nullable MergeTool delegate(MergeContext context, MergeRequest request) {
        return delegate(DiffManagerEx.getInstance().getMergeTools(), tool -> tool.canShow(context, request));
    }

    /** The first tool that is not a BPMN merge tool and can show the request; {@code null} if none. */
    static @Nullable MergeTool delegate(List<MergeTool> tools, Predicate<MergeTool> canShow) {
        for (MergeTool tool : tools) {
            if (!(tool instanceof BpmnMergeTool) && canShow.test(tool)) {
                return tool;
            }
        }
        return null;
    }
}
