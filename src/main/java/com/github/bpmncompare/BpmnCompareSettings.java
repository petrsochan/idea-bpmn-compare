package com.github.bpmncompare;

import com.intellij.ide.util.PropertiesComponent;

/** Application-wide preferences of the compare view. */
final class BpmnCompareSettings {

    private static final String SYNC_KEY = "bpmnCompare.syncNavigation";
    private static final String FOLLOW_CARET_KEY = "bpmnCompare.followCaret";

    private BpmnCompareSettings() {
    }

    static boolean isSyncEnabled() {
        return PropertiesComponent.getInstance().getBoolean(SYNC_KEY, true);
    }

    static void setSyncEnabled(boolean enabled) {
        PropertiesComponent.getInstance().setValue(SYNC_KEY, enabled, true);
    }

    /** Off by default: helpful next to the editor in a split, distracting otherwise. */
    static boolean isFollowCaretEnabled() {
        return PropertiesComponent.getInstance().getBoolean(FOLLOW_CARET_KEY, false);
    }

    static void setFollowCaretEnabled(boolean enabled) {
        PropertiesComponent.getInstance().setValue(FOLLOW_CARET_KEY, enabled, false);
    }
}
