package com.github.bpmncompare;

import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.openapi.vcs.VcsException;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import git4idea.repo.GitRepository;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;

/**
 * Where the content of one pane comes from.
 *
 * <p>Having both panes go through a source is what allows comparisons the view could not do while the
 * left side was hardwired to the working copy: revision against revision, or the two sides of a diff
 * request handed over by the platform.
 *
 * <p>{@link #load()} blocks - call it from a background thread - and never throws: a failure comes
 * back as an error {@link DiagramSide} so the pane can show it.
 */
interface BpmnContentSource {

    /** Text shown above the diagram before the content is loaded. */
    String label();

    DiagramSide load();

    /** The revision this side shows, or {@code null} when it is not revision-backed. */
    default @Nullable RevisionItem revision() {
        return null;
    }

    /** The same source pinned to another revision; only a revision-backed source supports this. */
    default BpmnContentSource at(RevisionItem item) {
        throw new UnsupportedOperationException(getClass().getSimpleName() + " is not revision-backed");
    }

    /** The live document of a file, unsaved changes included. */
    record Working(VirtualFile file) implements BpmnContentSource {

        @Override
        public String label() {
            return "working copy · " + file.getName();
        }

        @Override
        public DiagramSide load() {
            String xml = text();
            return StringUtil.isEmptyOrSpaces(xml)
                    ? DiagramSide.error(label(), "The current file is empty.")
                    : DiagramSide.xml(xml, label());
        }

        /** Read action because this also runs from the background task that reloads a side. */
        private String text() {
            return ReadAction.compute(() -> {
                Document document = FileDocumentManager.getInstance().getDocument(file);
                if (document != null) {
                    return document.getText();
                }
                try {
                    return VfsUtilCore.loadText(file);
                } catch (IOException e) {
                    return "";
                }
            });
        }
    }

    /** A file as of a Git revision. */
    record Revision(Project project, VirtualFile file, RevisionItem item) implements BpmnContentSource {

        @Override
        public String label() {
            return item.label();
        }

        @Override
        public RevisionItem revision() {
            return item;
        }

        @Override
        public BpmnContentSource at(RevisionItem other) {
            return new Revision(project, file, other);
        }

        @Override
        public DiagramSide load() {
            GitRepository repository = GitRevisions.repositoryFor(project, file);
            if (repository == null) {
                return DiagramSide.error(item.label(), "The file is not under Git version control.");
            }
            // show the resolved hash next to a moving label like HEAD or a branch name
            String hash = GitRevisions.shortHash(project, repository, item.revision());
            String label = hash == null || hash.equals(item.revision())
                    ? item.label()
                    : item.shortLabel() + " (" + hash + ")";
            try {
                return DiagramSide.xml(GitRevisions.content(project, repository, file, item.revision()), label);
            } catch (GitRevisions.MissingInRevisionException e) {
                return DiagramSide.missing(label, "The file does not exist in " + item.shortLabel()
                        + ".\nEverything in the other version is new.");
            } catch (VcsException e) {
                return DiagramSide.error(label, e.getMessage());
            }
        }
    }

    /** Text the platform already loaded, e.g. one side of a diff request. */
    record Fixed(@Nullable String xml, String label) implements BpmnContentSource {

        @Override
        public DiagramSide load() {
            // no content at all means the file does not exist on this side of the comparison
            return xml == null
                    ? DiagramSide.missing(label, "The file does not exist in " + label + ".\nEverything in the other version is new.")
                    : DiagramSide.xml(xml, label);
        }
    }
}
