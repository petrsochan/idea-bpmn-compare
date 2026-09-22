package com.github.bpmncompare;

import com.intellij.icons.AllIcons;
import com.intellij.ide.BrowserUtil;
import com.intellij.ide.ui.LafManagerListener;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.fileEditor.FileDocumentManager;
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
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.ColorUtil;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBCheckBox;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.util.Alarm;
import com.intellij.util.ui.JBUI;
import com.intellij.util.ui.UIUtil;
import git4idea.repo.GitRepository;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.handler.CefLifeSpanHandlerAdapter;
import org.cef.handler.CefLoadHandlerAdapter;
import org.cef.handler.CefRequestHandlerAdapter;
import org.cef.network.CefRequest;
import org.jetbrains.annotations.NotNull;

import javax.swing.*;
import java.awt.*;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
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

    private final Project project;
    private final VirtualFile file;

    private final JButton revisionButton = new JButton();
    private final JBCheckBox syncBox = new JBCheckBox("Synchronize mouse & view", BpmnCompareSettings.isSyncEnabled());
    private final Alarm documentAlarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, this);

    private JBCefBrowser browser;
    private boolean initialized;
    private boolean pageReady;
    private volatile boolean disposed;

    private GitRepository repository;
    private boolean repositoryResolved;

    private RevisionItem revision = RevisionItem.HEAD;
    private RightSide right = RightSide.message("Loading " + RevisionItem.HEAD.shortLabel() + "…");
    private int revisionRequest;

    BpmnComparePanel(Project project, VirtualFile file) {
        super(new BorderLayout());
        this.project = project;
        this.file = file;
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

        Document document = FileDocumentManager.getInstance().getDocument(file);
        if (document != null) {
            document.addDocumentListener(new DocumentListener() {
                @Override
                public void documentChanged(@NotNull DocumentEvent event) {
                    documentAlarm.cancelAllRequests();
                    documentAlarm.addRequest(() -> pushDiagrams(true), DOCUMENT_UPDATE_DELAY_MS);
                }
            }, this);
        }

        ApplicationManager.getApplication().getMessageBus().connect(this)
                .subscribe(LafManagerListener.TOPIC, source -> pushTheme());

        loadRevision(revision);
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

        JBLabel current = new JBLabel("Current: " + file.getName(), AllIcons.Actions.Diff, SwingConstants.LEFT);
        current.setToolTipText(file.getPresentableUrl());
        bar.add(current, BorderLayout.WEST);

        JPanel controls = new JPanel(new FlowLayout(FlowLayout.RIGHT, JBUI.scale(6), 0));
        controls.setOpaque(false);

        controls.add(new JBLabel("Compare with:"));
        revisionButton.setText(revision.shortLabel() + "  ▾");
        revisionButton.setIcon(AllIcons.Vcs.Branch);
        revisionButton.setToolTipText("Choose a branch, tag or commit to compare with");
        revisionButton.addActionListener(e -> chooseRevision());
        controls.add(revisionButton);

        JButton refresh = new JButton(AllIcons.Actions.Refresh);
        refresh.setToolTipText("Reload both diagrams");
        refresh.addActionListener(e -> {
            forgetRepository();
            loadRevision(revision);
        });
        controls.add(refresh);

        syncBox.setToolTipText("Mirror the mouse cursor, hover and pan/zoom between both diagrams");
        syncBox.addActionListener(e -> {
            BpmnCompareSettings.setSyncEnabled(syncBox.isSelected());
            pushSync();
        });
        controls.add(syncBox);

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
                GitRepository repo = resolveRepository();
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
                    if (getValues().get(i).equals(revision)) {
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

    private void loadRevision(RevisionItem item) {
        revision = item;
        revisionButton.setText(item.shortLabel() + "  ▾");
        int request = ++revisionRequest;
        pushStatus("right", "Loading " + item.shortLabel() + "…");

        new Task.Backgroundable(project, "Loading " + file.getName() + " at " + item.shortLabel(), false) {
            private RightSide result;

            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                GitRepository repo = resolveRepository();
                if (repo == null) {
                    result = RightSide.error("The file is not under Git version control.");
                    return;
                }
                String hash = GitRevisions.shortHash(project, repo, item.revision());
                String label = hash == null || hash.equals(item.revision()) ? item.label() : item.shortLabel() + " (" + hash + ")";
                try {
                    result = RightSide.xml(GitRevisions.content(project, repo, file, item.revision()), label);
                } catch (GitRevisions.MissingInRevisionException e) {
                    result = RightSide.missing(label, "The file does not exist in " + item.shortLabel() + ".\nEverything in the current version is new.");
                } catch (VcsException e) {
                    result = RightSide.error(label, e.getMessage());
                }
            }

            @Override
            public void onSuccess() {
                if (request == revisionRequest && !disposed) {
                    right = result;
                    pushDiagrams(false);
                }
            }
        }.queue();
    }

    private synchronized void forgetRepository() {
        repositoryResolved = false;
    }

    /** Called from background tasks. */
    private synchronized GitRepository resolveRepository() {
        if (!repositoryResolved) {
            repository = GitRevisions.repositoryFor(project, file);
            repositoryResolved = true;
        }
        return repository;
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
        Map<String, Object> left = new LinkedHashMap<>();
        String currentXml = currentText();
        if (StringUtil.isEmptyOrSpaces(currentXml)) {
            left.put("error", "The current file is empty.");
        } else {
            left.put("xml", currentXml);
        }
        left.put("label", "working copy · " + file.getName());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("left", left);
        payload.put("right", right.toJson());
        payload.put("preserveView", preserveView);
        call("setDiagrams", payload);
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

    private String currentText() {
        Document document = FileDocumentManager.getInstance().getDocument(file);
        if (document != null) {
            return document.getText();
        }
        try {
            return VfsUtilCore.loadText(file);
        } catch (IOException e) {
            return "";
        }
    }

    @Override
    public void dispose() {
        disposed = true;
        pageReady = false;
    }

    /** What the right-hand pane should display. */
    private record RightSide(String xml, String label, String error, String message, boolean missing) {

        static RightSide xml(String xml, String label) {
            return new RightSide(xml, label, null, null, false);
        }

        static RightSide missing(String label, String message) {
            return new RightSide(null, label, null, message, true);
        }

        static RightSide error(String message) {
            return error(null, message);
        }

        static RightSide error(String label, String message) {
            return new RightSide(null, label, message, null, false);
        }

        static RightSide message(String message) {
            return new RightSide(null, null, null, message, false);
        }

        Map<String, Object> toJson() {
            Map<String, Object> json = new LinkedHashMap<>();
            json.put("xml", xml);
            json.put("label", label);
            json.put("error", error);
            json.put("message", message);
            json.put("missing", missing);
            return json;
        }
    }
}
