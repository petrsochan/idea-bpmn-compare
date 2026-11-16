package com.github.bpmncompare;

import com.intellij.diff.DiffContentFactory;
import com.intellij.diff.DiffDialogHints;
import com.intellij.diff.DiffManager;
import com.intellij.diff.chains.SimpleDiffRequestChain;
import com.intellij.diff.contents.DiffContent;
import com.intellij.diff.requests.SimpleDiffRequest;
import com.intellij.diff.util.DiffUserDataKeysEx;
import com.intellij.icons.AllIcons;
import com.intellij.openapi.progress.ProcessCanceledException;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.MessageType;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.ui.popup.Balloon;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.ui.popup.PopupStep;
import com.intellij.openapi.ui.popup.util.BaseListPopupStep;
import com.intellij.openapi.util.Key;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.openapi.vcs.VcsException;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.awt.RelativePoint;
import git4idea.repo.GitRepository;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * The commits that changed one element of a diagram: who, when and why, and from each of them the BPMN
 * diff of that commit.
 *
 * <p>Git is read here, in two calls whatever the length of the history; deciding which commits touched
 * the element is left to the page, which runs the same differ as the view, so the list never disagrees
 * with the diff a click on it opens. The page gets the commits in chunks - a large diagram times hundreds
 * of versions would be tens of megabytes in one script call - and answers each chunk once, through
 * {@link #onChunk}.
 */
final class ElementHistory {

    /** Element id a diff window opened from the history centres on; read by {@link BpmnDiffViewer}. */
    static final Key<String> FOCUS_ELEMENT = Key.create("bpmnCompare.focusElement");

    private static final int CHUNK = 10;
    private static final long ANSWER_TIMEOUT_MS = 60_000;
    private static final long POLL_MS = 200;
    private static final int SUBJECT_MAX = 70;

    /** Sends one chunk to the page: {@code bpmnCompare.computeHistory(args)}. */
    interface Page {
        void computeHistory(Map<String, Object> args);
    }

    /** One commit that changed the element, as the page reported it. */
    record Entry(String hash, List<String> kinds, String summary) {
    }

    private record Row(HistoryCommit commit, String summary) {
    }

    private final Project project;
    private final VirtualFile file;
    private final GitRepository repository;
    private final String id;
    private final String name;
    private final Page page;
    private final BlockingQueue<Map<String, Object>> answers = new LinkedBlockingQueue<>();
    private volatile String expectedToken;

    private ElementHistory(Project project, VirtualFile file, GitRepository repository, String id, String name, Page page) {
        this.project = project;
        this.file = file;
        this.repository = repository;
        this.id = id;
        this.name = name;
        this.page = page;
    }

    /**
     * Reads the history in the background and shows it in a popup at {@code anchor}.
     *
     * @param onFinished called on the EDT when the run is over, however it ended
     * @return the run, which must receive the page's {@code historyChunk} answers
     */
    static ElementHistory start(Project project, VirtualFile file, GitRepository repository, String id, String name,
                                Page page, RelativePoint anchor, Runnable onFinished) {
        ElementHistory history = new ElementHistory(project, file, repository, id, name, page);
        history.queue(anchor, onFinished);
        return history;
    }

    /** A {@code historyChunk} message from the page; answers to an earlier, abandoned chunk are dropped. */
    void onChunk(Map<String, Object> message) {
        if (Objects.equals(message.get("token"), expectedToken)) {
            answers.offer(message);
        }
    }

    private void queue(RelativePoint anchor, Runnable onFinished) {
        new Task.Backgroundable(project, "Reading history of " + file.getName(), true) {
            private FileHistory history;
            private final List<Row> rows = new ArrayList<>();

            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                try {
                    history = GitRevisions.fileHistoryWithBlobs(project, repository, file, indicator);
                } catch (VcsException e) {
                    throw new HistoryException(e.getMessage());
                }
                List<HistoryCommit> commits = history.commits();
                indicator.setIndeterminate(false);
                for (int from = 0; from < commits.size(); from += CHUNK) {
                    indicator.checkCanceled();
                    indicator.setFraction((double) from / commits.size());
                    indicator.setText2(from + " of " + commits.size() + " commits");
                    List<HistoryCommit> chunk = commits.subList(from, Math.min(from + CHUNK, commits.size()));
                    rows.addAll(ask(chunk, history.blobs(), indicator));
                }
            }

            @Override
            public void onSuccess() {
                show(rows, history.commits().size(), history.blobs(), anchor);
            }

            @Override
            public void onThrowable(@NotNull Throwable error) {
                Messages.showErrorDialog(project, "Cannot read the history of " + file.getName() + ": "
                        + error.getMessage(), "BPMN Compare");
            }

            @Override
            public void onFinished() {
                expectedToken = null;
                onFinished.run();
            }
        }.queue();
    }

    /** Sends one chunk to the page and waits for its answer, staying responsive to Cancel. */
    private List<Row> ask(List<HistoryCommit> chunk, Map<String, String> blobs, ProgressIndicator indicator) {
        String token = UUID.randomUUID().toString();
        answers.clear();
        expectedToken = token;

        List<Object> commits = new ArrayList<>();
        Map<String, HistoryCommit> byHash = new HashMap<>();
        for (HistoryCommit commit : chunk) {
            Map<String, Object> json = new LinkedHashMap<>();
            json.put("hash", commit.hash());
            json.put("before", text(blobs, commit.beforeBlob()));
            json.put("after", text(blobs, commit.afterBlob()));
            commits.add(json);
            byHash.put(commit.hash(), commit);
        }
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("token", token);
        args.put("id", id);
        args.put("commits", commits);
        page.computeHistory(args);

        Map<String, Object> answer = null;
        for (long waited = 0; answer == null; waited += POLL_MS) {
            indicator.checkCanceled();
            if (waited >= ANSWER_TIMEOUT_MS) {
                throw new HistoryException("the diff view did not answer");
            }
            try {
                answer = answers.poll(POLL_MS, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new ProcessCanceledException();
            }
        }
        if (answer.get("error") != null) {
            throw new HistoryException(String.valueOf(answer.get("error")));
        }

        List<Row> rows = new ArrayList<>();
        for (Entry entry : decodeEntries((String) answer.get("entries"))) {
            HistoryCommit commit = byHash.get(entry.hash());
            if (commit != null) {
                rows.add(new Row(commit, entry.summary()));
            }
        }
        return rows;
    }

    private static @Nullable String text(Map<String, String> blobs, @Nullable String blob) {
        return blob == null ? null : blobs.get(blob);
    }

    /** Entries separated by U+001E, fields (hash, comma-separated kinds, summary) by U+001F. */
    static List<Entry> decodeEntries(@Nullable String encoded) {
        List<Entry> entries = new ArrayList<>();
        if (encoded == null || encoded.isEmpty()) {
            return entries;
        }
        for (String entry : encoded.split("\u001e")) {
            String[] fields = entry.split("\u001f", 3);
            if (fields.length == 3) {
                entries.add(new Entry(fields[0], List.of(fields[1].split(",")), fields[2]));
            }
        }
        return entries;
    }

    // ------------------------------------------------------------------------------------------------------------
    // popup and diff
    // ------------------------------------------------------------------------------------------------------------

    private void show(List<Row> rows, int commitCount, Map<String, String> blobs, RelativePoint anchor) {
        if (rows.isEmpty()) {
            JBPopupFactory.getInstance()
                    .createHtmlTextBalloonBuilder(StringUtil.escapeXmlEntities("No change to \"" + name + "\" in the last "
                            + commitCount + " commits of " + file.getName()), MessageType.INFO, null)
                    .createBalloon()
                    .show(anchor, Balloon.Position.below);
            return;
        }
        BaseListPopupStep<Row> step = new BaseListPopupStep<>("History of \"" + name + "\"", rows) {
            @Override
            public @NotNull String getTextFor(Row row) {
                HistoryCommit c = row.commit();
                return c.shortHash() + "  " + c.date() + "  " + c.author() + "  —  "
                        + StringUtil.shortenTextWithEllipsis(c.subject(), SUBJECT_MAX, 0) + "   ·  " + row.summary();
            }

            @Override
            public Icon getIconFor(Row row) {
                return AllIcons.Actions.Commit;
            }

            @Override
            public boolean isSpeedSearchEnabled() {
                return true;
            }

            @Override
            public PopupStep<?> onChosen(Row row, boolean finalChoice) {
                return doFinalStep(() -> openDiff(row.commit(), blobs));
            }
        };
        JBPopupFactory.getInstance().createListPopup(step, 20).show(anchor);
    }

    /** The commit against its first parent, in the BPMN view, centred on the element. */
    private void openDiff(HistoryCommit commit, Map<String, String> blobs) {
        DiffContentFactory factory = DiffContentFactory.getInstance();
        SimpleDiffRequest request = new SimpleDiffRequest(
                file.getName() + " · " + commit.shortHash() + " " + commit.subject(),
                content(factory, text(blobs, commit.beforeBlob())),
                content(factory, text(blobs, commit.afterBlob())),
                commit.shortHash() + "^",
                commit.shortHash() + "  " + StringUtil.shortenTextWithEllipsis(commit.subject(), SUBJECT_MAX, 0));
        request.putUserData(FOCUS_ELEMENT, id);
        SimpleDiffRequestChain chain = new SimpleDiffRequestChain(request);
        // read from the diff window's context, which for a chain is the chain itself
        chain.putUserData(DiffUserDataKeysEx.FORCE_DIFF_TOOL, new BpmnDiffTool());
        DiffManager.getInstance().showDiff(project, chain, DiffDialogHints.DEFAULT);
    }

    private DiffContent content(DiffContentFactory factory, @Nullable String text) {
        // the file as highlight file: BpmnDiffTool recognises BPMN content by it
        return text == null ? factory.createEmpty() : factory.create(project, text, file);
    }

    /** A failure worth showing to the user, as opposed to a bug. */
    private static final class HistoryException extends RuntimeException {
        HistoryException(String message) {
            super(message);
        }
    }
}
