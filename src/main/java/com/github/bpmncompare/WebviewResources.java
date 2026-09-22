package com.github.bpmncompare;

import com.intellij.openapi.application.PathManager;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * Copies the bundled web view (built from {@code webview/}) to a temp directory so JCEF can load it
 * as a regular page with relative script and style references.
 */
final class WebviewResources {

    private static final String RESOURCE_DIR = "/bpmn-compare/";
    private static final String[] FILES = {"index.html", "bundle.js", "bundle.css", "THIRD-PARTY-NOTICES.txt"};

    private static Path indexFile;

    private WebviewResources() {
    }

    static synchronized String indexUrl() throws IOException {
        if (indexFile == null || !Files.exists(indexFile)) {
            Path dir = Files.createDirectories(Path.of(PathManager.getTempPath(), "bpmn-compare-webview"));
            for (String name : FILES) {
                try (InputStream in = WebviewResources.class.getResourceAsStream(RESOURCE_DIR + name)) {
                    if (in == null) {
                        throw new IOException("Missing plugin resource " + RESOURCE_DIR + name);
                    }
                    // overwrite once per IDE session so plugin updates take effect
                    Files.copy(in, dir.resolve(name), StandardCopyOption.REPLACE_EXISTING);
                }
            }
            indexFile = dir.resolve("index.html");
        }
        return indexFile.toUri().toString();
    }
}
