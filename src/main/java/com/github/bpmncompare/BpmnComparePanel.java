package com.github.bpmncompare;

import com.intellij.icons.AllIcons;
import com.intellij.ide.BrowserUtil;
import com.intellij.ide.ui.LafManagerListener;
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
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.openapi.vcs.VcsException;
import com.intellij.openapi.vfs.VfsUtil;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileWrapper;
import com.intellij.ui.ColorUtil;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBCheckBox;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefBrowserBase;
import com.intellij.ui.jcef.JBCefJSQuery;
import com.intellij.util.Alarm;
import com.intellij.util.ui.JBUI;
import com.intellij.util.ui.UIUtil;
import git4idea.repo.GitRepository;
import git4idea.repo.GitRepositoryChangeListener;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.handler.CefLifeSpanHandlerAdapter;
import org.cef.handler.CefLoadHandlerAdapter;
import org.cef.handler.CefRequestHandlerAdapter;
import org.cef.network.CefRequest;
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

    private final JButton revisionButton = new JButton();
    private final JBCheckBox syncBox = new JBCheckBox("Synchronize mouse & view", BpmnCompareSettings.isSyncEnabled());
    private final Alarm documentAlarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, this);
    /** Separate from {@link #documentAlarm} so an edit and a repository change cannot cancel each other. */
    private final Alarm gitAlarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, this);
    /** Dragging the caret must not flood JCEF with one call per position. */
    private final Alarm caretAlarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, this);
    private final JBCheckBox followCaretBox =
            new JBCheckBox("Follow caret", BpmnCompareSettings.isFollowCaretEnabled());

    private JBCefBrowser browser;
    private JBCefJSQuery hostQuery;
    private boolean initialized;
    private boolean pageReady;
    private volatile boolean disposed;

    private BpmnContentSource leftSource;
    private BpmnContentSource rightSource;
    private DiagramSide leftSide;
    private DiagramSide rightSide;

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
        this.leftSource = left;
        this.rightSource = right;
        this.leftSide = DiagramSide.message("Loading " + left.label() + "…");
        this.rightSide = DiagramSide.message("Loading " + right.label() + "…");
        add(createToolbar(), BorderLayout.NORTH);
    }

    /** Creates the browser lazily, when the editor tab is shown for the first time. */
    void activate() {
        if (initialized) {
            return;
        }
        initialized = true;

        if (!JBCefApp.isSupported()) {
            add(centeredLabel("JCEF (embedded Chromium) is not available in this IDE runtime."), BorderLayout.CENTER);
            revalidate();
            return;
        }

        browser = JBCefBrowser.createBuilder().build();
        Disposer.register(this, browser);
        installHostBridge();
        browser.getJBCefClient().addLoadHandler(new CefLoadHandlerAdapter() {
            @Override
            public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                if (frame.isMain()) {
                    ApplicationManager.getApplication().invokeLater(() -> {
                        pageReady = true;
                        pushAll(false);
                    }, o -> disposed);
                }
            }
        }, browser.getCefBrowser());
        openExternalLinksInSystemBrowser();
        add(browser.getComponent(), BorderLayout.CENTER);
        revalidate();

        try {
            browser.loadURL(WebviewResources.indexUrl());
        } catch (IOException e) {
            LOG.error("Cannot prepare BPMN compare web view", e);
            return;
        }

        // only a live working copy changes under us; the fixed content of a diff window does not
        Document document = leftSource instanceof BpmnContentSource.Working ? documentOfFile() : null;
        if (document != null) {
            document.addDocumentListener(new DocumentListener() {
                @Override
                public void documentChanged(@NotNull DocumentEvent event) {
                    documentAlarm.cancelAllRequests();
                    documentAlarm.addRequest(() -> reloadSide(Side.LEFT, leftSource, true), DOCUMENT_UPDATE_DELAY_MS);
                }
            }, this);
            followTheCaret(document);
        }

        ApplicationManager.getApplication().getMessageBus().connect(this)
                .subscribe(LafManagerListener.TOPIC, source -> pushTheme());
        subscribeToGitChanges();

        reloadBothSides();
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
                    }, o -> disposed);
                });
    }

    private @Nullable Document documentOfFile() {
        return file == null ? null : FileDocumentManager.getInstance().getDocument(file);
    }

    // ------------------------------------------------------------------------------------------------------------
    // web view -> IDE bridge
    // ------------------------------------------------------------------------------------------------------------

    /**
     * Gives the page a {@code window.bpmnCompareHost(message)} function for talking back to the IDE.
     *
     * <p>Registered before the handler that marks the page ready, because CEF calls load handlers in
     * registration order and the page must have the bridge by the time it is told it can use it.
     */
    private void installHostBridge() {
        hostQuery = JBCefJSQuery.create((JBCefBrowserBase) browser);
        Disposer.register(this, hostQuery);
        hostQuery.addHandler(request -> {
            handleHostRequest(request);
            return null;
        });
        browser.getJBCefClient().addLoadHandler(new CefLoadHandlerAdapter() {
            @Override
            public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                if (frame.isMain()) {
                    executeScript("window.bpmnCompareHost = function(message) {"
                            + hostQuery.inject("JSON.stringify(message)") + "};");
                }
            }
        }, browser.getCefBrowser());
    }

    private void handleHostRequest(String json) {
        Map<String, Object> message = Json.read(json);
        String command = String.valueOf(message.get("command"));
        String payload = String.valueOf(message.get("payload"));
        switch (command) {
            case "openXml" -> onEdt(() -> openXml(String.valueOf(message.get("id"))));
            case "copyMarkdown" -> onEdt(() -> CopyPasteManager.getInstance().setContents(new StringSelection(payload)));
            case "saveSvg" -> onEdt(() -> saveExport("svg", payload.getBytes(StandardCharsets.UTF_8)));
            case "savePng" -> onEdt(() -> saveExport("png", decodeDataUrl(payload)));
            case "exportFailed" -> onEdt(() -> Messages.showErrorDialog(project, payload, "BPMN Compare"));
            default -> LOG.warn("Unknown web view command: " + command);
        }
    }

    private void onEdt(Runnable action) {
        ApplicationManager.getApplication().invokeLater(action, o -> disposed);
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
        if (!pageReady) {
            return;
        }
        String id = BpmnXmlLocator.elementIdAt(document.getText(), offset);
        if (id != null) {
            call("selectElement", id);
        }
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

    /**
     * Links leaving the local page (e.g. the bpmn.io watermark required by the bpmn-js license) open in the
     * system browser instead of replacing the diff view or spawning a bare Chromium window.
     */
    private void openExternalLinksInSystemBrowser() {
        browser.getJBCefClient().addLifeSpanHandler(new CefLifeSpanHandlerAdapter() {
            @Override
            public boolean onBeforePopup(CefBrowser cefBrowser, CefFrame frame, String targetUrl, String targetFrameName) {
                browseExternally(targetUrl);
                return true;
            }
        }, browser.getCefBrowser());
        browser.getJBCefClient().addRequestHandler(new CefRequestHandlerAdapter() {
            @Override
            public boolean onBeforeBrowse(CefBrowser cefBrowser, CefFrame frame, CefRequest request, boolean userGesture, boolean isRedirect) {
                String url = request.getURL();
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    browseExternally(url);
                    return true;
                }
                return false;
            }
        }, browser.getCefBrowser());
    }

    private static void browseExternally(String url) {
        if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
            BrowserUtil.browse(url);
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
        if (revision != null) {
            controls.add(new JBLabel("Compare with:"));
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
        pushStatus(side.key(), "Loading " + source.label() + "…");

        new Task.Backgroundable(project, "Loading " + source.label(), false) {
            private DiagramSide result;

            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                result = source.load();
            }

            @Override
            public void onSuccess() {
                // a newer request for this side has been started meanwhile - its result wins
                if (request != requests.get(side) || disposed) {
                    return;
                }
                if (side == Side.LEFT) {
                    leftSide = result;
                } else {
                    rightSide = result;
                }
                pushDiagrams(preserveView);
            }
        }.queue();
    }

    // ------------------------------------------------------------------------------------------------------------
    // web view bridge
    // ------------------------------------------------------------------------------------------------------------

    private void pushAll(boolean preserveView) {
        pushTheme();
        pushSync();
        pushDiagrams(preserveView);
    }

    private void pushDiagrams(boolean preserveView) {
        if (!pageReady) {
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("left", leftSide.toJson());
        payload.put("right", rightSide.toJson());
        payload.put("preserveView", preserveView);
        call("setDiagrams", payload);
    }

    /** Steps the web view to the next (+1) or previous (-1) visible change. */
    void goToChange(int step) {
        if (pageReady) {
            call("goToChange", step);
        }
    }

    private void pushSync() {
        if (pageReady) {
            call("setSync", syncBox.isSelected());
        }
    }

    private void pushTheme() {
        if (!pageReady) {
            return;
        }
        Map<String, Object> theme = new LinkedHashMap<>();
        theme.put("dark", !JBColor.isBright());
        theme.put("bg", "#" + ColorUtil.toHex(UIUtil.getPanelBackground()));
        theme.put("fg", "#" + ColorUtil.toHex(UIUtil.getLabelForeground()));
        theme.put("border", "#" + ColorUtil.toHex(JBColor.border()));
        call("setTheme", theme);
    }

    private void pushStatus(String side, String text) {
        if (!pageReady) {
            return;
        }
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("side", side);
        args.put("text", text);
        executeScript("window.bpmnCompare && (a => window.bpmnCompare.setStatus(a.side, a.text, false))(" + Json.write(args) + ");");
    }

    private void call(String function, Object argument) {
        executeScript("window.bpmnCompare && window.bpmnCompare." + function + "(" + Json.write(argument) + ");");
    }

    private void executeScript(String script) {
        CefBrowser cefBrowser = browser.getCefBrowser();
        cefBrowser.executeJavaScript(script, cefBrowser.getURL(), 0);
    }

    @Override
    public void dispose() {
        disposed = true;
        pageReady = false;
    }
}
