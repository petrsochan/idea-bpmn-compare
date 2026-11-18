package com.github.bpmncompare;

import com.intellij.diff.merge.MergeContext;
import com.intellij.diff.merge.MergeRequest;
import com.intellij.diff.merge.MergeTool;
import org.jetbrains.annotations.NotNull;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

class BpmnMergeToolTest {

    /** A merge tool that only stands for itself; {@code canShow} is decided by the test's predicate. */
    private static MergeTool tool() {
        return new MergeTool() {
            @Override
            public @NotNull MergeViewer createComponent(@NotNull MergeContext context, @NotNull MergeRequest request) {
                throw new UnsupportedOperationException();
            }

            @Override
            public boolean canShow(@NotNull MergeContext context, @NotNull MergeRequest request) {
                throw new UnsupportedOperationException();
            }
        };
    }

    @Test
    void skipsItselfAndPicksTheFirstToolThatCanShow() {
        MergeTool bpmn = new BpmnMergeTool();
        MergeTool cannot = tool();
        MergeTool text = tool();
        MergeTool other = tool();
        Set<MergeTool> able = Set.of(bpmn, text, other);

        assertSame(text, BpmnMergeTool.delegate(List.of(bpmn, cannot, text, other), able::contains));
    }

    @Test
    void noDelegateWhenNothingElseCanShow() {
        MergeTool bpmn = new BpmnMergeTool();
        MergeTool cannot = tool();
        Set<MergeTool> able = Set.of(bpmn);

        assertNull(BpmnMergeTool.delegate(List.of(bpmn, cannot), able::contains));
    }
}
