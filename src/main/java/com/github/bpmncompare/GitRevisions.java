package com.github.bpmncompare;

import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.io.FileUtil;
import com.intellij.openapi.vcs.FilePath;
import com.intellij.openapi.vcs.VcsException;
import com.intellij.openapi.vcs.changes.Change;
import com.intellij.openapi.vcs.changes.ChangeListManager;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import git4idea.GitLocalBranch;
import git4idea.GitRemoteBranch;
import git4idea.commands.Git;
import git4idea.commands.GitBinaryHandler;
import git4idea.commands.GitCommand;
import git4idea.commands.GitCommandResult;
import git4idea.commands.GitLineHandler;
import git4idea.repo.GitRepository;
import git4idea.repo.GitRepositoryManager;
import git4idea.util.GitFileUtils;
import org.jetbrains.annotations.Nullable;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Git access used by the compare view. All methods block and must be called from a background thread.
 */
final class GitRevisions {

    private static final int MAX_COMMITS = 300;
    private static final int MAX_TAGS = 50;

    private GitRevisions() {
    }

    static @Nullable GitRepository repositoryFor(Project project, VirtualFile file) {
        return GitRepositoryManager.getInstance(project).getRepositoryForFile(file);
    }

    static List<RevisionItem> listRevisions(Project project, GitRepository repository, VirtualFile file) throws VcsException {
        List<RevisionItem> items = new ArrayList<>();
        items.add(RevisionItem.HEAD);

        GitLocalBranch current = repository.getCurrentBranch();
        repository.getBranches().getLocalBranches().stream()
                .sorted(Comparator.comparing((GitLocalBranch b) -> !b.equals(current)).thenComparing(GitLocalBranch::getName))
                .forEach(b -> items.add(new RevisionItem(RevisionItem.Group.LOCAL, b.getName(),
                        b.equals(current) ? b.getName() + "  (current)" : b.getName(), b.getName())));

        repository.getBranches().getRemoteBranches().stream()
                .map(GitRemoteBranch::getName)
                .filter(name -> !name.endsWith("/HEAD"))
                .sorted()
                .forEach(name -> items.add(new RevisionItem(RevisionItem.Group.REMOTE, name, name, name)));

        for (String tag : tags(project, repository)) {
            items.add(new RevisionItem(RevisionItem.Group.TAG, "refs/tags/" + tag, tag, tag));
        }

        items.addAll(fileHistory(project, repository, file));
        items.add(RevisionItem.ENTER_REVISION);
        return items;
    }

    private static List<String> tags(Project project, GitRepository repository) {
        GitLineHandler handler = new GitLineHandler(project, repository.getRoot(), GitCommand.TAG);
        handler.setSilent(true);
        handler.addParameters("--list", "--sort=-creatordate");
        GitCommandResult result = Git.getInstance().runCommand(handler);
        if (!result.success()) {
            return List.of();
        }
        return result.getOutput().stream().map(String::trim).filter(s -> !s.isEmpty()).limit(MAX_TAGS).toList();
    }

    /**
     * The commits that changed the file, with its content before and after each of them, read with two
     * git calls whatever the length of the history: the log names the blobs, one {@code cat-file --batch}
     * reads them all. The same depth and rename handling as the revision chooser.
     */
    static FileHistory fileHistoryWithBlobs(Project project, GitRepository repository, VirtualFile file,
                                            ProgressIndicator indicator) throws VcsException {
        GitLineHandler log = new GitLineHandler(project, repository.getRoot(), GitCommand.LOG);
        log.setSilent(true);
        // --raw against the first parent: the blob ids before and after each commit, renames included
        log.addParameters("--follow", "--raw", "--no-abbrev", "-z", "--max-count=" + MAX_COMMITS, "--date=short",
                GitLogParser.HISTORY_FORMAT);
        log.endOptions();
        String beforeMove = pendingMoveSource(project, repository, file);
        if (beforeMove != null) {
            log.addParameters(beforeMove);
        } else {
            log.addRelativeFiles(List.of(file));
        }
        GitCommandResult result = Git.getInstance().runCommand(log);
        result.throwOnError();
        List<HistoryCommit> commits = GitLogParser.parseHistory(String.join("\n", result.getOutput()));
        indicator.checkCanceled();

        Set<String> ids = new LinkedHashSet<>();
        for (HistoryCommit commit : commits) {
            if (commit.beforeBlob() != null) {
                ids.add(commit.beforeBlob());
            }
            if (commit.afterBlob() != null) {
                ids.add(commit.afterBlob());
            }
        }
        Map<String, String> blobs = new HashMap<>();
        if (!ids.isEmpty()) {
            GitBinaryHandler catFile = new GitBinaryHandler(project, repository.getRoot(), GitCommand.CAT_FILE);
            catFile.setSilent(true);
            catFile.addParameters("--batch");
            catFile.setInputProcessor(out -> {
                try (out) {
                    out.write((String.join("\n", ids) + "\n").getBytes(StandardCharsets.US_ASCII));
                }
            });
            GitLogParser.parseCatFileBatch(catFile.run())
                    .forEach((id, bytes) -> blobs.put(id, stripBom(new String(bytes, StandardCharsets.UTF_8))));
        }
        indicator.checkCanceled();
        return new FileHistory(commits, blobs);
    }

    private static List<RevisionItem> fileHistory(Project project, GitRepository repository, VirtualFile file) throws VcsException {
        GitLineHandler handler = new GitLineHandler(project, repository.getRoot(), GitCommand.LOG);
        handler.setSilent(true);
        // --follow: commits from before a rename or move are listed too
        handler.addParameters("--follow", "--max-count=" + MAX_COMMITS, "--date=short", GitLogParser.FORMAT);
        handler.endOptions();
        // a rename that is not committed yet: the commits know the file only under its earlier name
        String beforeMove = pendingMoveSource(project, repository, file);
        if (beforeMove != null) {
            handler.addParameters(beforeMove); // relative to the repository root, the handler's working directory
        } else {
            handler.addRelativeFiles(List.of(file));
        }

        GitCommandResult result = Git.getInstance().runCommand(handler);
        result.throwOnError();
        return GitLogParser.parse(result.getOutput());
    }

    /** Resolves a revision to its abbreviated commit hash, or {@code null} if it cannot be resolved. */
    static @Nullable String shortHash(Project project, GitRepository repository, String revision) {
        GitLineHandler handler = new GitLineHandler(project, repository.getRoot(), GitCommand.REV_PARSE);
        handler.setSilent(true);
        handler.addParameters("--short", "--verify", "--quiet", revision + "^{commit}");
        GitCommandResult result = Git.getInstance().runCommand(handler);
        return result.success() && !result.getOutput().isEmpty() ? result.getOutput().get(0).trim() : null;
    }

    /**
     * Content of {@code file} at {@code revision}.
     *
     * <p>If the file is not at its current path in that revision, the paths it had before are tried,
     * so a renamed or moved diagram is still compared with its own past instead of being shown as
     * entirely new: first the name it had before a rename that is not committed yet, then the earlier
     * names from the history of the current branch. A diagram copied from another one is not
     * followed back to its source.
     *
     * @throws MissingInRevisionException if the file exists in that revision under none of its names
     */
    static RevisionContent content(Project project, GitRepository repository, VirtualFile file, String revision) throws VcsException {
        String relativePath = VfsUtilCore.getRelativePath(file, repository.getRoot(), '/');
        if (relativePath == null) {
            throw new VcsException("File is outside of the repository root " + repository.getRoot().getPresentableUrl());
        }
        if (shortHash(project, repository, revision) == null) {
            throw new VcsException("Unknown revision '" + revision + "'");
        }
        try {
            return new RevisionContent(read(project, repository, revision, relativePath), null);
        } catch (MissingInRevisionException missing) {
            for (String path : earlierPaths(project, repository, file, relativePath)) {
                try {
                    return new RevisionContent(read(project, repository, revision, path), path);
                } catch (MissingInRevisionException notUnderThisName) {
                    // try the next older name
                }
            }
            throw missing;
        }
    }

    /** Candidate earlier paths, most likely first: the pending move's before-path, then the committed history. */
    private static List<String> earlierPaths(Project project, GitRepository repository, VirtualFile file, String currentPath) {
        List<String> paths = new ArrayList<>();
        String committedName = currentPath;
        String beforeMove = pendingMoveSource(project, repository, file);
        if (beforeMove != null && !beforeMove.equals(currentPath)) {
            paths.add(beforeMove);
            committedName = beforeMove;
        }
        for (String path : historicalPaths(project, repository, committedName)) {
            if (!paths.contains(path)) {
                paths.add(path);
            }
        }
        return paths;
    }

    /** Repository-relative path the file had before a move or rename that is not committed yet, if any. */
    private static @Nullable String pendingMoveSource(Project project, GitRepository repository, VirtualFile file) {
        Change change = ChangeListManager.getInstance(project).getChange(file);
        if (change == null || change.getType() != Change.Type.MOVED || change.getBeforeRevision() == null) {
            return null;
        }
        FilePath before = change.getBeforeRevision().getFile();
        String rootPath = repository.getRoot().getPath();
        return FileUtil.isAncestor(rootPath, before.getPath(), true)
                ? FileUtil.getRelativePath(rootPath, before.getPath(), '/')
                : null;
    }

    private static String read(Project project, GitRepository repository, String revision, String path) throws VcsException {
        try {
            byte[] bytes = GitFileUtils.getFileContent(project, repository.getRoot(), revision, path);
            return stripBom(new String(bytes, StandardCharsets.UTF_8));
        } catch (VcsException e) {
            String message = String.valueOf(e.getMessage());
            if (message.contains("does not exist") || message.contains("exists on disk, but not in")) {
                throw new MissingInRevisionException(path, revision);
            }
            throw e;
        }
    }

    /**
     * Earlier names of the file, newest first; empty when it was never renamed (a copy does not count)
     * or git fails.
     */
    private static List<String> historicalPaths(Project project, GitRepository repository, String currentPath) {
        GitLineHandler handler = new GitLineHandler(project, repository.getRoot(), GitCommand.LOG);
        handler.setSilent(true);
        // --name-status tells a rename from a copy; -z: no quoting of non-ASCII names, see GitLogParser#historicalPaths
        handler.addParameters("--follow", "--name-status", "--format=", "-z");
        handler.endOptions();
        handler.addParameters(currentPath); // relative to the repository root, the handler's working directory
        GitCommandResult result = Git.getInstance().runCommand(handler);
        return result.success() ? GitLogParser.historicalPaths(result.getOutput(), currentPath) : List.of();
    }

    /**
     * @param xml         the file's content
     * @param earlierPath the repository-relative path it was read from, when that is not the current one
     */
    record RevisionContent(String xml, @Nullable String earlierPath) {
    }

    static String stripBom(String text) {
        return !text.isEmpty() && text.charAt(0) == '﻿' ? text.substring(1) : text;
    }

    static final class MissingInRevisionException extends VcsException {
        MissingInRevisionException(String path, String revision) {
            super(path + " does not exist in " + revision);
        }
    }
}
