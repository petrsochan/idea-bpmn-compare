package com.github.bpmncompare;

import com.intellij.icons.AllIcons;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.editor.event.CaretEvent;
import com.intellij.openapi.editor.event.CaretListener;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.fileChooser.FileChooserFactory;
import com.intellij.openapi.fileChooser.FileSaverDescriptor;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.ui.popup.ListSeparator;
import com.intellij.openapi.ui.popup.PopupStep;
import com.intellij.openapi.ui.popup.util.BaseListPopupStep;
import com.intellij.dvcs.repo.VcsRepositoryManager;
import com.intellij.dvcs.repo.VcsRepositoryMappingListener;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.openapi.vcs.AbstractVcsHelper;
import com.intellij.openapi.vcs.FileStatus;
import com.intellij.openapi.vcs.FileStatusListener;
import com.intellij.openapi.vcs.FileStatusManager;
import com.intellij.openapi.vcs.VcsException;
import com.intellij.openapi.vfs.VfsUtil;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileWrapper;
import com.intellij.ui.JBColor;
import com.intellij.ui.awt.RelativePoint;
import com.intellij.ui.components.JBCheckBox;
import com.intellij.ui.components.JBLabel;
import com.intellij.util.Alarm;
import com.intellij.util.ui.JBUI;
import com.intellij.util.ui.UIUtil;
import git4idea.repo.GitRepository;
import git4idea.repo.GitRepositoryChangeListener;
import git4idea.repo.GitRepositoryManager;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;
import java.awt.datatransfer.StringSelection;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Side-by-side view: the current content of a BPMN file (left) and the same file in a chosen Git revision (right),
 * rendered and diffed by bpmn.io inside JCEF.
 *
 * <p>All state is confined to the EDT; Git work runs in background tasks.
 */
final class BpmnComparePanel extends JPanel implements Disposable {

    private static final Logger LOG = Logger.getInstance(BpmnComparePanel.class);
    private static final int DOCUMENT_UPDATE_DELAY_MS = 600;
    private static final int GIT_UPDATE_DELAY_MS = 400;
    private static final int CARET_UPDATE_DELAY_MS = 250;

    private final Project project;
    private final VirtualFile file;
    /**
     * The file whose history the right pane's element menu shows. The same file in the editor tab, where the
     * right pane is a revision of it; in a diff window possibly another one (<i>Compare Two Files</i>).
     */
    private @Nullable VirtualFile rightFile;

    private final JButton revisionButton = new JButton();
    private final JBLabel compareWith = new JBLabel("Compare with:");
    private final JButton resolveButton = new JButton("Resolve…");
    /** The file is in conflict and the tab shows its stages instead of the comparison. */
    private boolean inConflict;
    private @Nullable ConflictStages.Sides conflictSides;
    /** Only the newest loading of the stages counts. */
    private int conflictRequest;
    private final JBCheckBox syncBox = new JBCheckBox("Synchronize mouse & view", BpmnCompareSettings.isSyncEnabled());
    private final Alarm documentAlarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, this);
    /** Separate from {@link #documentAlarm} so an edit and a repository change cannot cancel each other. */
    private final Alarm gitAlarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, this);
    /** Dragging the caret must not flood JCEF with one call per position. */
    private final Alarm caretAlarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, this);
    private final JBCheckBox followCaretBox =
            new JBCheckBox("Follow caret", BpmnCompareSettings.isFollowCaretEnabled());

    private final BpmnWebView webView = new BpmnWebView(this, () -> pushAll(false), this::handleHostRequest);
    private boolean initialized;
    private volatile boolean disposed;

    private BpmnContentSource leftSource;
    private BpmnContentSource rightSource;
    private DiagramSide leftSide;
    private DiagramSide rightSide;

    /** The element history being read, which receives the page's answers; at most one at a time. */
    private volatile @Nullable ElementHistory history;
    /** Element to centre on once the diagrams are shown, for a diff window opened from the history. */
    private @Nullable String focusOnLoad;

    /** Per side, so a slow load of one pane cannot discard a newer load of the other. */
    private final EnumMap<Side, Integer> requests = new EnumMap<>(Side.class);

    private enum Side {
        LEFT, RIGHT;

        String key() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    /**
     * @param file the file the left side belongs to, used for the document listener and the toolbar
     *             title; {@code null} when neither side is backed by a file in the project
     */
    BpmnComparePanel(Project project, @Nullable VirtualFile file, BpmnContentSource left, BpmnContentSource right) {
        super(new BorderLayout());
        this.project = project;
        this.file = file;
        this.rightFile = file;
        this.leftSource = left;
        this.rightSource = right;
        this.leftSide = DiagramSide.message("Loading " + left.label() + "…");
        this.rightSide = DiagramSide.message("Loading " + right.label() + "…");
        add(createToolbar(), BorderLayout.NORTH);
        Disposer.register(this, webView);
    }

    /** Creates the browser lazily, when the editor tab is shown for the first time. */
    void activate() {
        if (initialized) {
            return;
        }
        initialized = true;

        JComponent page = webView.create();
        if (page == null) {
            add(centeredLabel("JCEF (embedded Chromium) is not available in this IDE runtime."), BorderLayout.CENTER);
            revalidate();
            return;
        }
        add(page, BorderLayout.CENTER);
        revalidate();

        // only a live working copy changes under us; the fixed content of a diff window does not
        Document document = leftSource instanceof BpmnContentSource.Working ? documentOfFile() : null;
        if (document != null) {
            document.addDocumentListener(new DocumentListener() {
                @Override
                public void documentChanged(@NotNull DocumentEvent event) {
                    // a file in conflict holds markers, which do not render; the tab shows the conflict instead
                    if (inConflict) {
                        return;
                    }
                    documentAlarm.cancelAllRequests();
                    documentAlarm.addRequest(() -> reloadSide(Side.LEFT, leftSource, true), DOCUMENT_UPDATE_DELAY_MS);
                }
            }, this);
            followTheCaret(document);
        }

        subscribeToGitChanges();
        // the quick repository lookup knows no repository until the IDE has mapped them, which right after
        // start-up is later than the page loads - without this the history would stay "not under Git"
        project.getMessageBus().connect(this).subscribe(VcsRepositoryManager.VCS_REPOSITORY_MAPPING_UPDATED,
                (VcsRepositoryMappingListener) () -> ApplicationManager.getApplication()
                        .invokeLater(this::pushHistoryAvailability, webView.modality(), o -> disposed));

        if (conflictAware()) {
            FileStatusManager.getInstance(project).addFileStatusListener(new FileStatusListener() {
                @Override
                public void fileStatusesChanged() {
                    onEdt(BpmnComparePanel.this::checkConflict);
                }

                @Override
                public void fileStatusChanged(@NotNull VirtualFile changed) {
                    if (changed.equals(file)) {
                        onEdt(BpmnComparePanel.this::checkConflict);
                    }
                }
            }, this);
        }

        if (conflictAware() && isConflicted()) {
            enterConflict();
        } else {
            reloadBothSides();
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // conflict mode: while the file is in conflict, the tab shows ours | base | theirs from the Git index
    // ------------------------------------------------------------------------------------------------------------

    /** Only the editor tab of a file follows its conflict; a diff window shows what it was asked to. */
    private boolean conflictAware() {
        return file != null && leftSource instanceof BpmnContentSource.Working && rightSource.revision() != null;
    }

    private boolean isConflicted() {
        return FileStatusManager.getInstance(project).getStatus(file) == FileStatus.MERGED_WITH_CONFLICTS;
    }

    /** Switches between the conflict and the comparison when - and only when - the conflict state changed. */
    private void checkConflict() {
        boolean conflicted = isConflicted();
        if (conflicted == inConflict) {
            return;
        }
        if (conflicted) {
            enterConflict();
        } else {
            inConflict = false;
            conflictSides = null;
            updateToolbarForConflict();
            reloadBothSides();
        }
    }

    private void enterConflict() {
        inConflict = true;
        updateToolbarForConflict();
        int request = ++conflictRequest;
        pushStatus("left", "Loading the conflict…");

        new Task.Backgroundable(project, "Loading the conflict of " + file.getName(), false) {
            private ConflictStages.Sides sides;

            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                GitRepository repository = GitRevisions.repositoryFor(project, file);
                String notUnderGit = "The file is not under Git version control.";
                sides = repository != null
                        ? ConflictStages.load(project, repository, file)
                        : new ConflictStages.Sides(DiagramSide.error("Ours", notUnderGit),
                                DiagramSide.error("Base", notUnderGit), DiagramSide.error("Theirs", notUnderGit));
            }

            @Override
            public void onSuccess() {
                if (request != conflictRequest || !inConflict || disposed) {
                    return;
                }
                conflictSides = sides;
                pushDiagrams(false);
            }
        }.queue();
    }

    private void updateToolbarForConflict() {
        compareWith.setVisible(!inConflict && rightSource.revision() != null);
        revisionButton.setVisible(!inConflict && rightSource.revision() != null);
        resolveButton.setVisible(inConflict);
    }

    /** The IDE's merge window for the file - with the diagrams above the text merge. */
    private void resolveConflict() {
        AbstractVcsHelper.getInstance(project).showMergeDialogWithResult(List.of(file));
    }

    /**
     * After a checkout, commit, fetch or rebase the same revision expression resolves somewhere else,
     * so a view pinned to HEAD or a branch would keep showing the previous content until the user
     * pressed Refresh. Only a revision-backed side needs this; fixed content cannot go stale.
     */
    private void subscribeToGitChanges() {
        if (rightSource.revision() == null || file == null) {
            return;
        }
        project.getMessageBus().connect(this).subscribe(GitRepository.GIT_REPO_CHANGE,
                (GitRepositoryChangeListener) repository -> {
                    // a plain parent-chain check, so the listener needs no read action to decide
                    if (!VfsUtilCore.isAncestor(repository.getRoot(), file, false)) {
                        return;
                    }
                    ApplicationManager.getApplication().invokeLater(() -> {
                        // a rebase fires a burst of these; only the last one needs to do the work
                        gitAlarm.cancelAllRequests();
                        gitAlarm.addRequest(() -> reloadSide(Side.RIGHT, rightSource, true), GIT_UPDATE_DELAY_MS);
                    }, webView.modality(), o -> disposed);
                });
    }

    private @Nullable Document documentOfFile() {
        return file == null ? null : FileDocumentManager.getInstance().getDocument(file);
    }

    // ------------------------------------------------------------------------------------------------------------
    // web view -> IDE bridge
    // ------------------------------------------------------------------------------------------------------------

    /** A message from the page; called on the browser thread. */
    private void handleHostRequest(Map<String, Object> message) {
        String command = String.valueOf(message.get("command"));
        String payload = String.valueOf(message.get("payload"));
        switch (command) {
            case "openXml" -> onEdt(() -> openXml(String.valueOf(message.get("id"))));
            // the merge view asks for the merge window's result column, which the tab does not have
            case "revealInResult" -> { }
            case "elementHistory" -> onEdt(() -> showElementHistory(message));
            case "historyChunk" -> {
                // not via the EDT: the history's background task is waiting for exactly this
                ElementHistory running = history;
                if (running != null) {
                    running.onChunk(message);
                }
            }
            case "copyMarkdown" -> onEdt(() -> CopyPasteManager.getInstance().setContents(new StringSelection(payload)));
            case "saveSvg" -> onEdt(() -> saveExport("svg", payload.getBytes(StandardCharsets.UTF_8)));
            case "savePng" -> onEdt(() -> saveExport("png", decodeDataUrl(payload)));
            case "exportFailed" -> onEdt(() -> Messages.showErrorDialog(project, payload, "BPMN Compare"));
            default -> LOG.warn("Unknown web view command: " + command);
        }
    }

    private void onEdt(Runnable action) {
        webView.onEdt(action);
    }

    /** Asks for a target file and writes the exported bytes there. */
    private void saveExport(String extension, byte[] bytes) {
        String upper = extension.toUpperCase(Locale.ROOT);
        FileSaverDescriptor descriptor =
                new FileSaverDescriptor("Export BPMN Diagram", "Save the diagram as " + upper, extension);
        String name = (file == null ? "diagram" : file.getNameWithoutExtension()) + "-diff." + extension;
        VirtualFileWrapper target = FileChooserFactory.getInstance()
                .createSaveFileDialog(descriptor, project)
                .save((VirtualFile) null, name);
        if (target == null) {
            return;
        }
        Path path = target.getFile().toPath();
        try {
            Files.write(path, bytes);
            VfsUtil.markDirtyAndRefresh(true, false, false, target.getVirtualFile());
        } catch (IOException e) {
            LOG.warn("Cannot write " + path, e);
            Messages.showErrorDialog(project, "Cannot write " + path + ": " + e.getMessage(), "BPMN Compare");
        }
    }

    private static byte[] decodeDataUrl(String dataUrl) {
        int comma = dataUrl.indexOf(',');
        return Base64.getDecoder().decode(comma < 0 ? dataUrl : dataUrl.substring(comma + 1));
    }

    /**
     * With <i>Follow caret</i> on, moving the caret in the XML selects the element it is inside, which
     * pairs with the double-click navigation in the other direction.
     */
    private void followTheCaret(Document document) {
        EditorFactory.getInstance().getEventMulticaster().addCaretListener(new CaretListener() {
            @Override
            public void caretPositionChanged(@NotNull CaretEvent event) {
                if (event.getEditor().getDocument() != document || !followCaretBox.isSelected()) {
                    return;
                }
                int offset = event.getEditor().getCaretModel().getOffset();
                caretAlarm.cancelAllRequests();
                caretAlarm.addRequest(() -> selectElementAt(document, offset), CARET_UPDATE_DELAY_MS);
            }
        }, this);
    }

    private void selectElementAt(Document document, int offset) {
        if (!webView.isReady()) {
            return;
        }
        String id = BpmnXmlLocator.elementIdAt(document.getText(), offset);
        if (id != null) {
            call("selectElement", id);
        }
    }

    /** The file the right pane's element history reads, when it is not the panel's file. */
    void historyFileOfRight(@Nullable VirtualFile file) {
        rightFile = file;
    }

    /** Right-click → history of an element: the commits that changed it, read from Git. */
    private void showElementHistory(Map<String, Object> message) {
        // each pane reads the history of its own file - in a diff of two files they differ
        VirtualFile file = "right".equals(message.get("side")) ? rightFile : this.file;
        GitRepository repository = file == null ? null : GitRevisions.repositoryFor(project, file);
        if (history != null || repository == null || webView.component() == null) {
            return;
        }
        Point point = new Point(parseInt(message.get("x")), parseInt(message.get("y")));
        RelativePoint anchor = new RelativePoint(webView.component(), point);
        String id = String.valueOf(message.get("id"));
        String name = String.valueOf(message.get("name"));
        ElementHistory run = ElementHistory.create(project, file, repository, id, name,
                args -> call("computeHistory", args));
        // held before it starts, so the page's first answer always finds it
        history = run;
        run.run(anchor, () -> {
            if (history == run) {
                history = null;
            }
        });
    }

    private static int parseInt(Object value) {
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** Tells the page, per pane, whether its element menu can offer the history, and if not, why. */
    private void pushHistoryAvailability() {
        if (!webView.isReady()) {
            return;
        }
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("left", historyAvailability(file));
        state.put("right", historyAvailability(rightFile));
        call("setHistoryAvailable", state);
    }

    private Map<String, Object> historyAvailability(@Nullable VirtualFile file) {
        String reason = ElementHistory.unavailableReason(file,
                f -> GitRepositoryManager.getInstance(project).getRepositoryForFileQuick(f) != null);
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("available", reason == null);
        state.put("reason", reason == null ? "" : reason);
        return state;
    }

    /** Centres the view on this element once the diagrams are shown. */
    void focusOnLoad(@Nullable String id) {
        focusOnLoad = id;
    }

    /** Opens the text editor of the file with the caret on the element carrying {@code id}. */
    private void openXml(String id) {
        Document document = documentOfFile();
        if (document == null || file == null) {
            return;
        }
        int offset = BpmnXmlLocator.offsetOfElement(document.getText(), id);
        if (offset >= 0) {
            new OpenFileDescriptor(project, file, offset).navigate(true);
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // toolbar
    // ------------------------------------------------------------------------------------------------------------

    private JComponent createToolbar() {
        JPanel bar = new JPanel(new BorderLayout());
        bar.setBorder(JBUI.Borders.compound(
                JBUI.Borders.customLineBottom(JBColor.border()),
                JBUI.Borders.empty(3, 8)));

        JBLabel current = new JBLabel(leftSource.label(), AllIcons.Actions.Diff, SwingConstants.LEFT);
        current.setToolTipText(file == null ? leftSource.label() : file.getPresentableUrl());
        bar.add(current, BorderLayout.WEST);

        JPanel controls = new JPanel(new FlowLayout(FlowLayout.RIGHT, JBUI.scale(6), 0));
        controls.setOpaque(false);

        // only a revision-backed right side can be pointed somewhere else; in a diff window both
        // sides are fixed by the request, so the chooser would have nothing to offer
        RevisionItem revision = rightSource.revision();
        if (conflictAware()) {
            resolveButton.setIcon(AllIcons.Vcs.Merge);
            resolveButton.setToolTipText("Open the merge window, with the diagrams above the text merge");
            resolveButton.addActionListener(e -> resolveConflict());
            resolveButton.setVisible(false);
            controls.add(resolveButton);
        }
        if (revision != null) {
            controls.add(compareWith);
            revisionButton.setText(revision.shortLabel() + "  ▾");
            revisionButton.setIcon(AllIcons.Vcs.Branch);
            revisionButton.setToolTipText("Choose a branch, tag or commit to compare with");
            revisionButton.addActionListener(e -> chooseRevision());
            controls.add(revisionButton);
        }

        JButton refresh = new JButton(AllIcons.Actions.Refresh);
        refresh.setToolTipText("Reload both diagrams");
        refresh.addActionListener(e -> reloadBothSides());
        controls.add(refresh);

        syncBox.setToolTipText("Mirror the mouse cursor, hover and pan/zoom between both diagrams");
        syncBox.addActionListener(e -> {
            BpmnCompareSettings.setSyncEnabled(syncBox.isSelected());
            pushSync();
        });
        controls.add(syncBox);

        // pointless without a document to put a caret in
        if (leftSource instanceof BpmnContentSource.Working) {
            followCaretBox.setToolTipText("Select the element the caret is in while you edit the XML");
            followCaretBox.addActionListener(e -> BpmnCompareSettings.setFollowCaretEnabled(followCaretBox.isSelected()));
            controls.add(followCaretBox);
        }

        bar.add(controls, BorderLayout.EAST);
        return bar;
    }

    private static JComponent centeredLabel(String text) {
        JBLabel label = new JBLabel(text, SwingConstants.CENTER);
        label.setForeground(UIUtil.getContextHelpForeground());
        return label;
    }

    // ------------------------------------------------------------------------------------------------------------
    // revision selection + loading
    // ------------------------------------------------------------------------------------------------------------

    private void chooseRevision() {
        revisionButton.setEnabled(false);
        new Task.Backgroundable(project, "Loading Git revisions", true) {
            private List<RevisionItem> items;
            private String error;

            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                GitRepository repo = file == null ? null : GitRevisions.repositoryFor(project, file);
                if (repo == null) {
                    error = "The file is not under Git version control.";
                    return;
                }
                try {
                    items = GitRevisions.listRevisions(project, repo, file);
                } catch (VcsException e) {
                    error = e.getMessage();
                }
            }

            @Override
            public void onFinished() {
                revisionButton.setEnabled(true);
            }

            @Override
            public void onSuccess() {
                if (error != null) {
                    Messages.showErrorDialog(project, error, "BPMN Compare");
                } else if (revisionButton.isShowing()) {
                    showRevisionPopup(items);
                }
            }
        }.queue();
    }

    private void showRevisionPopup(List<RevisionItem> items) {
        BaseListPopupStep<RevisionItem> step = new BaseListPopupStep<>("Compare With", items) {
            @Override
            public @NotNull String getTextFor(RevisionItem item) {
                return item.label();
            }

            @Override
            public Icon getIconFor(RevisionItem item) {
                return switch (item.group()) {
                    case HEAD, LOCAL, REMOTE -> AllIcons.Vcs.Branch;
                    case TAG -> AllIcons.Nodes.Tag;
                    case COMMIT -> AllIcons.Actions.Commit;
                    case CUSTOM -> AllIcons.Actions.Edit;
                };
            }

            @Override
            public ListSeparator getSeparatorAbove(RevisionItem item) {
                int index = getValues().indexOf(item);
                RevisionItem previous = index > 0 ? getValues().get(index - 1) : null;
                if (item.group().title != null && (previous == null || previous.group() != item.group())) {
                    return new ListSeparator(item.group().title);
                }
                return null;
            }

            @Override
            public int getDefaultOptionIndex() {
                for (int i = 0; i < getValues().size(); i++) {
                    if (getValues().get(i).equals(rightSource.revision())) {
                        return i;
                    }
                }
                return 0;
            }

            @Override
            public boolean isSpeedSearchEnabled() {
                return true;
            }

            @Override
            public PopupStep<?> onChosen(RevisionItem item, boolean finalChoice) {
                return doFinalStep(() -> {
                    if (item.revision() == null) {
                        askForRevision();
                    } else {
                        loadRevision(item);
                    }
                });
            }
        };
        JBPopupFactory.getInstance().createListPopup(step, 25).showUnderneathOf(revisionButton);
    }

    private void askForRevision() {
        String input = Messages.showInputDialog(project,
                "Commit hash, branch, tag or any Git revision expression:",
                "Compare With Revision", null);
        if (!StringUtil.isEmptyOrSpaces(input)) {
            loadRevision(RevisionItem.custom(input.trim()));
        }
    }

    /** Points the right side at another revision. */
    private void loadRevision(RevisionItem item) {
        rightSource = rightSource.at(item);
        revisionButton.setText(item.shortLabel() + "  ▾");
        reloadSide(Side.RIGHT, rightSource, false);
    }

    private void reloadBothSides() {
        reloadSide(Side.LEFT, leftSource, false);
        reloadSide(Side.RIGHT, rightSource, false);
    }

    /**
     * Loads one side in the background and pushes the result to the web view.
     *
     * @param preserveView keep the current pan and zoom instead of fitting the diagram again
     */
    private void reloadSide(Side side, BpmnContentSource source, boolean preserveView) {
        int request = requests.merge(side, 1, Integer::sum);
        // text the platform already loaded needs no background task - whose completion, in a modal
        // window, would wait for the window to close
        if (source instanceof BpmnContentSource.Fixed) {
            applyLoaded(side, request, source.load(), preserveView);
            return;
        }
        pushStatus(side.key(), "Loading " + source.label() + "…");

        new Task.Backgroundable(project, "Loading " + source.label(), false) {
            private DiagramSide result;

            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                result = source.load();
            }

            @Override
            public void onSuccess() {
                applyLoaded(side, request, result, preserveView);
            }
        }.queue();
    }

    private void applyLoaded(Side side, int request, DiagramSide result, boolean preserveView) {
        // a newer request for this side has been started meanwhile - its result wins
        if (request != requests.get(side) || disposed) {
            return;
        }
        if (side == Side.LEFT) {
            leftSide = result;
        } else {
            rightSide = result;
        }
        // kept for when the conflict is over; until then the tab shows the conflict
        if (!inConflict) {
            pushDiagrams(preserveView);
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // web view bridge
    // ------------------------------------------------------------------------------------------------------------

    private void pushAll(boolean preserveView) {
        pushTheme();
        pushSync();
        pushHistoryAvailability();
        pushDiagrams(preserveView);
    }

    private void pushDiagrams(boolean preserveView) {
        if (!webView.isReady()) {
            return;
        }
        if (inConflict) {
            if (conflictSides != null) {
                Map<String, Object> merge = new LinkedHashMap<>();
                merge.put("ours", conflictSides.ours().toJson());
                merge.put("base", conflictSides.base().toJson());
                merge.put("theirs", conflictSides.theirs().toJson());
                merge.put("result", null);
                call("setMerge", merge);
            }
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("left", leftSide.toJson());
        payload.put("right", rightSide.toJson());
        payload.put("preserveView", preserveView);
        if (focusOnLoad != null) {
            payload.put("focus", focusOnLoad);
            // the element may be on the side still loading - keep asking until both are there
            if (!isLoading(leftSide) && !isLoading(rightSide)) {
                focusOnLoad = null;
            }
        }
        call("setDiagrams", payload);
    }

    /** The placeholder shown until a side's content arrives: no diagram, no error, not missing. */
    private static boolean isLoading(DiagramSide side) {
        return side.xml() == null && side.error() == null && !side.missing();
    }

    /** Steps the web view to the next (+1) or previous (-1) visible change. */
    void goToChange(int step) {
        if (webView.isReady()) {
            call("goToChange", step);
        }
    }

    private void pushSync() {
        if (webView.isReady()) {
            call("setSync", syncBox.isSelected());
        }
    }

    private void pushTheme() {
        webView.pushTheme();
    }

    private void pushStatus(String side, String text) {
        if (!webView.isReady()) {
            return;
        }
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("side", side);
        args.put("text", text);
        webView.execute("window.bpmnCompare && (a => window.bpmnCompare.setStatus(a.side, a.text, false))(" + Json.write(args) + ");");
    }

    private void call(String function, Object argument) {
        webView.call(function, argument);
    }

    @Override
    public void dispose() {
        disposed = true;
        // the page is gone: a running history would wait for answers that never come
        ElementHistory running = history;
        if (running != null) {
            running.stop();
        }
    }
}
