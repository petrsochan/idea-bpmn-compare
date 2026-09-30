package com.github.bpmncompare;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.vcs.VcsException;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import git4idea.GitLocalBranch;
import git4idea.GitRemoteBranch;
import git4idea.commands.Git;
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
import java.util.List;

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

    private static List<RevisionItem> fileHistory(Project project, GitRepository repository, VirtualFile file) throws VcsException {
        GitLineHandler handler = new GitLineHandler(project, repository.getRoot(), GitCommand.LOG);
        handler.setSilent(true);
        handler.addParameters("--max-count=" + MAX_COMMITS, "--date=short", GitLogParser.FORMAT);
        handler.endOptions();
        handler.addRelativeFiles(List.of(file));

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
     * @throws MissingInRevisionException if the file does not exist in that revision
     */
    static String content(Project project, GitRepository repository, VirtualFile file, String revision) throws VcsException {
        String relativePath = VfsUtilCore.getRelativePath(file, repository.getRoot(), '/');
        if (relativePath == null) {
            throw new VcsException("File is outside of the repository root " + repository.getRoot().getPresentableUrl());
        }
        if (shortHash(project, repository, revision) == null) {
            throw new VcsException("Unknown revision '" + revision + "'");
        }
        try {
            byte[] bytes = GitFileUtils.getFileContent(project, repository.getRoot(), revision, relativePath);
            return stripBom(new String(bytes, StandardCharsets.UTF_8));
        } catch (VcsException e) {
            String message = String.valueOf(e.getMessage());
            if (message.contains("does not exist") || message.contains("exists on disk, but not in")) {
                throw new MissingInRevisionException(relativePath, revision);
            }
            throw e;
        }
    }

    private static String stripBom(String text) {
        return !text.isEmpty() && text.charAt(0) == '﻿' ? text.substring(1) : text;
    }

    static final class MissingInRevisionException extends VcsException {
        MissingInRevisionException(String path, String revision) {
            super(path + " does not exist in " + revision);
        }
    }
}
