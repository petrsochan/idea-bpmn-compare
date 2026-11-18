package com.github.bpmncompare;

import com.intellij.dvcs.repo.Repository;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vcs.VcsException;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import git4idea.repo.GitRepository;
import git4idea.util.GitFileUtils;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * The three versions of a file in conflict, as Git keeps them in the index: stage 1 the base, 2 ours,
 * 3 theirs. Shown by the BPMN Diff tab while the file is in conflict.
 */
final class ConflictStages {

    /** What the page shows for each version; {@link #load} never throws. */
    record Sides(DiagramSide ours, DiagramSide base, DiagramSide theirs) {
    }

    /** Reads one version; throws what git reports. */
    @FunctionalInterface
    interface StageReader {
        String read() throws VcsException;
    }

    private ConflictStages() {
    }

    /** Reads the three stages; blocks - call it from a background thread. */
    static Sides load(Project project, GitRepository repository, VirtualFile file) {
        String path = VfsUtilCore.getRelativePath(file, repository.getRoot(), '/');
        List<String> labels = labels(repository.getState());
        if (path == null) {
            String outside = "The file is outside of the repository root.";
            return new Sides(DiagramSide.error(labels.get(0), outside), DiagramSide.error("Base", outside),
                    DiagramSide.error(labels.get(1), outside));
        }
        return new Sides(
                side(labels.get(0), "The file was deleted on this side.", () -> read(project, repository, 2, path)),
                side("Base", "No common base: the file was added on both sides.", () -> read(project, repository, 1, path)),
                side(labels.get(1), "The file was deleted on this side.", () -> read(project, repository, 3, path)));
    }

    /**
     * Whose side is whose: in a rebase "ours" is the branch being rebased onto, and the commit being replayed
     * is "theirs".
     *
     * @return the labels of ours and theirs
     */
    static List<String> labels(Repository.State state) {
        return switch (state) {
            case MERGING -> List.of("Ours · HEAD", "Theirs · MERGE_HEAD");
            case REBASING -> List.of("Upstream · HEAD", "Your commit");
            default -> List.of("Ours", "Theirs");
        };
    }

    /**
     * One version as a pane: the diagram, a missing side when git has no such stage (add/add has no base,
     * modify/delete misses a side), an error otherwise.
     */
    static DiagramSide side(String label, String missingMessage, StageReader reader) {
        try {
            return DiagramSide.xml(reader.read(), label);
        } catch (VcsException e) {
            String message = String.valueOf(e.getMessage());
            if (message.contains("not at stage") || message.contains("does not exist")) {
                return DiagramSide.missing(label, missingMessage);
            }
            return DiagramSide.error(label, message);
        }
    }

    private static String read(Project project, GitRepository repository, int stage, String path) throws VcsException {
        // `git show :<stage>:<path>`
        byte[] bytes = GitFileUtils.getFileContent(project, repository.getRoot(), ":" + stage, path);
        return GitRevisions.stripBom(new String(bytes, StandardCharsets.UTF_8));
    }
}
