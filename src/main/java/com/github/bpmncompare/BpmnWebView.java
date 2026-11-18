package com.github.bpmncompare;

import com.intellij.ide.BrowserUtil;
import com.intellij.ide.ui.LafManagerListener;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.util.Disposer;
import com.intellij.ui.ColorUtil;
import com.intellij.ui.JBColor;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefBrowserBase;
import com.intellij.ui.jcef.JBCefJSQuery;
import com.intellij.util.ui.UIUtil;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.handler.CefLifeSpanHandlerAdapter;
import org.cef.handler.CefLoadHandlerAdapter;
import org.cef.handler.CefRequestHandlerAdapter;
import org.cef.network.CefRequest;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.event.HierarchyEvent;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * The bpmn.io page in JCEF and the bridge to it: {@code window.bpmnCompare} for calls into the page,
 * {@code window.bpmnCompareHost} for the messages it sends back.
 *
 * <p>Everything the browser thread hands to the EDT runs in the modality of the window the page is in. A
 * plain {@code invokeLater} would run as non-modal and, in a modal window such as the merge window, wait
 * until that window closes.
 */
final class BpmnWebView implements Disposable {

    private static final Logger LOG = Logger.getInstance(BpmnWebView.class);

    private final JComponent owner;
    private final Runnable onPageReady;
    private final Consumer<Map<String, Object>> onHostMessage;

    private JBCefBrowser browser;
    private JBCefJSQuery hostQuery;
    private boolean ready;
    private volatile boolean disposed;
    /** The modality of the owner's window, kept from when it was last shown; see {@link #modality()}. */
    private volatile @Nullable ModalityState modality;

    /**
     * @param owner         the Swing component the browser is shown in, for the modality
     * @param onPageReady   runs on the EDT every time the page has finished loading
     * @param onHostMessage receives each message the page sends, parsed, on the browser thread
     */
    BpmnWebView(JComponent owner, Runnable onPageReady, Consumer<Map<String, Object>> onHostMessage) {
        this.owner = owner;
        this.onPageReady = onPageReady;
        this.onHostMessage = onHostMessage;
        // read on the EDT while the owner is in its window: the browser thread asks later, possibly after
        // the owner was taken out of the window (the merge window can hide the diagrams), when there is
        // no window to read it from any more
        owner.addHierarchyListener(event -> {
            if ((event.getChangeFlags() & HierarchyEvent.SHOWING_CHANGED) != 0 && owner.isShowing()) {
                modality = ModalityState.stateForComponent(owner);
            }
        });
    }

    /**
     * Creates the browser and loads the page; {@code null} when JCEF is not available in this IDE or the
     * browser cannot be created - the caller shows a note instead, and must keep working without the page.
     */
    @Nullable JComponent create() {
        if (!JBCefApp.isSupported()) {
            return null;
        }
        if (owner.isShowing()) {
            modality = ModalityState.stateForComponent(owner);
        }
        // JCEF can be supported and still fail to start (GPU, sandbox, a broken runtime); in the merge window
        // nothing catches that, and the text merge must not go down with the diagrams
        return createOrNull(this::createBrowser, e -> LOG.warn("Cannot create the BPMN web view", e));
    }

    /** {@code create.get()}, or {@code null} after handing its failure to {@code onFailure}. */
    static <T> @Nullable T createOrNull(Supplier<T> create, Consumer<Throwable> onFailure) {
        try {
            return create.get();
        } catch (Throwable e) {
            onFailure.accept(e);
            return null;
        }
    }

    private JComponent createBrowser() {
        browser = JBCefBrowser.createBuilder().build();
        Disposer.register(this, browser);
        installHostBridge();
        browser.getJBCefClient().addLoadHandler(new CefLoadHandlerAdapter() {
            @Override
            public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                if (frame.isMain()) {
                    onEdt(() -> {
                        ready = true;
                        onPageReady.run();
                    });
                }
            }
        }, browser.getCefBrowser());
        openExternalLinksInSystemBrowser();
        ApplicationManager.getApplication().getMessageBus().connect(this)
                .subscribe(LafManagerListener.TOPIC, source -> pushTheme());

        try {
            browser.loadURL(WebviewResources.indexUrl());
        } catch (IOException e) {
            LOG.error("Cannot prepare BPMN compare web view", e);
        }
        return browser.getComponent();
    }

    /** The page has loaded and can be called. */
    boolean isReady() {
        return ready && !disposed;
    }

    /** {@code window.bpmnCompare.<function>(<argument as JSON>)}; nothing before the page is ready. */
    void call(String function, Object argument) {
        execute("window.bpmnCompare && window.bpmnCompare." + function + "(" + Json.write(argument) + ");");
    }

    /** Runs a script in the page; nothing before the page is ready. */
    void execute(String script) {
        if (isReady()) {
            executeNow(script);
        }
    }

    /** Hands the IDE's colours to the page. */
    void pushTheme() {
        Map<String, Object> theme = new LinkedHashMap<>();
        theme.put("dark", !JBColor.isBright());
        theme.put("bg", "#" + ColorUtil.toHex(UIUtil.getPanelBackground()));
        theme.put("fg", "#" + ColorUtil.toHex(UIUtil.getLabelForeground()));
        theme.put("border", "#" + ColorUtil.toHex(JBColor.border()));
        call("setTheme", theme);
    }

    /** The modality of the window the page is shown in, as of when it was last shown. */
    ModalityState modality() {
        ModalityState known = modality;
        return known != null ? known : ModalityState.stateForComponent(owner);
    }

    /** Runs {@code action} on the EDT in the page's modality, unless the view is gone by then. */
    void onEdt(Runnable action) {
        ApplicationManager.getApplication().invokeLater(action, modality(), o -> disposed);
    }

    /** The browser component, for anchoring popups; {@code null} without JCEF. */
    @Nullable JComponent component() {
        return browser == null ? null : browser.getComponent();
    }

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
            onHostMessage.accept(Json.read(request));
            return null;
        });
        browser.getJBCefClient().addLoadHandler(new CefLoadHandlerAdapter() {
            @Override
            public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                if (frame.isMain()) {
                    executeNow("window.bpmnCompareHost = function(message) {"
                            + hostQuery.inject("JSON.stringify(message)") + "};");
                }
            }
        }, browser.getCefBrowser());
    }

    private void executeNow(String script) {
        CefBrowser cefBrowser = browser.getCefBrowser();
        cefBrowser.executeJavaScript(script, cefBrowser.getURL(), 0);
    }

    /**
     * Links leaving the local page (e.g. the bpmn.io watermark required by the bpmn-js license) open in the
     * system browser instead of replacing the view or spawning a bare Chromium window.
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

    @Override
    public void dispose() {
        disposed = true;
        ready = false;
    }
}
