package com.github.bpmncompare;

import com.intellij.ide.util.PropertiesComponent;

/** Application-wide preferences of the compare view. */
final class BpmnCompareSettings {

    private static final String SYNC_KEY = "bpmnCompare.syncNavigation";

    private BpmnCompareSettings() {
    }

    static boolean isSyncEnabled() {
        return PropertiesComponent.getInstance().getBoolean(SYNC_KEY, true);
    }

    static void setSyncEnabled(boolean enabled) {
        PropertiesComponent.getInstance().setValue(SYNC_KEY, enabled, true);
    }
}
