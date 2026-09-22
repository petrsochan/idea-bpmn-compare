package com.github.bpmncompare;

import com.intellij.openapi.vfs.VirtualFile;

import java.util.Locale;

final class BpmnFiles {

    private BpmnFiles() {
    }

    static boolean isBpmn(VirtualFile file) {
        if (file == null || file.isDirectory()) {
            return false;
        }
        String name = file.getName().toLowerCase(Locale.ROOT);
        return name.endsWith(".bpmn") || name.endsWith(".bpmn2") || name.endsWith(".bpmn20.xml");
    }
}
