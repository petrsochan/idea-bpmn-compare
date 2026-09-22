package com.github.bpmncompare;

/**
 * An entry of the "compare with" chooser.
 *
 * @param group    section of the chooser the item belongs to
 * @param revision anything {@code git show <revision>:<path>} understands; {@code null} for the "enter revision" item
 * @param label    text shown in the chooser
 * @param shortLabel text shown on the chooser button once selected
 */
record RevisionItem(Group group, String revision, String label, String shortLabel) {

    enum Group {
        HEAD(null),
        LOCAL("Local Branches"),
        REMOTE("Remote Branches"),
        TAG("Tags"),
        COMMIT("Commits Changing This File"),
        CUSTOM("Other");

        final String title;

        Group(String title) {
            this.title = title;
        }
    }

    static final RevisionItem HEAD = new RevisionItem(Group.HEAD, "HEAD", "HEAD (last commit)", "HEAD");
    static final RevisionItem ENTER_REVISION = new RevisionItem(Group.CUSTOM, null, "Enter revision (hash, branch, tag, HEAD~3, …)", null);

    static RevisionItem custom(String revision) {
        return new RevisionItem(Group.CUSTOM, revision, revision, revision);
    }
}
