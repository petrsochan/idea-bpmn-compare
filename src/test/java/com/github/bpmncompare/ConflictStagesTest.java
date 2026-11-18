package com.github.bpmncompare;

import com.intellij.dvcs.repo.Repository;
import com.intellij.openapi.vcs.VcsException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConflictStagesTest {

    @Test
    void aMergeNamesHeadAndMergeHead() {
        assertEquals(List.of("Ours · HEAD", "Theirs · MERGE_HEAD"), ConflictStages.labels(Repository.State.MERGING));
    }

    @Test
    void aRebaseNamesTheUpstreamAndYourCommit() {
        assertEquals(List.of("Upstream · HEAD", "Your commit"), ConflictStages.labels(Repository.State.REBASING));
    }

    @Test
    void anythingElseIsOursAndTheirs() {
        assertEquals(List.of("Ours", "Theirs"), ConflictStages.labels(Repository.State.NORMAL));
        assertEquals(List.of("Ours", "Theirs"), ConflictStages.labels(Repository.State.GRAFTING));
    }

    @Test
    void aStageGitHasIsTheDiagram() {
        DiagramSide side = ConflictStages.side("Base", "No base.", () -> "<definitions/>");

        assertEquals("<definitions/>", side.xml());
        assertEquals("Base", side.label());
    }

    @Test
    void aStageGitDoesNotHaveIsMissing() {
        DiagramSide side = ConflictStages.side("Base", "No common base.", () -> {
            throw new VcsException("fatal: path 'order.bpmn' is in the index, but not at stage 1");
        });

        assertTrue(side.missing());
        assertEquals("No common base.", side.message());
    }

    @Test
    void anyOtherFailureIsAnError() {
        DiagramSide side = ConflictStages.side("Base", "No common base.", () -> {
            throw new VcsException("fatal: not a git repository");
        });

        assertFalse(side.missing());
        assertEquals("fatal: not a git repository", side.error());
    }
}
