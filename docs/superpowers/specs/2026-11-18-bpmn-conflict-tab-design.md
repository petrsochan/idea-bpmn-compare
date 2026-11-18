# Conflict in the BPMN Diff tab – design

## Intent
A `.bpmn` file can be in conflict outside the IDE's merge window: after `git merge` or `rebase` on the command
line, or after the merge window was closed without resolving. The file then holds `<<<<<<<` markers, and the
BPMN Diff tab can only say "Cannot render diagram". The merge view already shows what each side did to the
diagram; the tab should show the same, and offer the way to resolve.

## Goals
- While the file is in conflict (IDE file status `MERGED_WITH_CONFLICTS`), the BPMN Diff tab switches by itself
  (decided by the user) to ours | base | theirs, read from the Git index stages `:2:`, `:1:`, `:3:`, with the
  merge view's highlights, Conflicts chip, change list and F7. No result pane – there is no result yet; the
  middle shows the base and the Result/Base switch is hidden.
- Once the conflict is gone (the file is marked resolved, or the merge is aborted), the tab switches back by
  itself to the working copy against the chosen revision.
- A **Resolve…** button in the tab's toolbar opens the IDE's merge window for the file, where the diagrams are
  shown with the live result.
- Labels say whose side is whose: while merging `Ours · HEAD` / `Theirs · MERGE_HEAD`; while rebasing
  `Upstream · HEAD` / `Your commit` (in a rebase "ours" is the branch being rebased onto); otherwise `Ours` /
  `Theirs`. The base is `Base`.

## Non-goals
- Resolving in the tab; the merge window does that.
- A result pane built from the working copy with its markers.
- Showing a conflict of a file deleted on one side (that is the IDE's own dialog, and one of the stages is
  missing – such a side shows as missing, the rest works).

## Anti-goals
- The tab flickering between modes while a merge is in progress, or staying in conflict mode after the
  conflict is gone.
- Blocking the EDT: the stages are read in the background, like a revision.

## Approaches (decided: A)
- **A – a conflict mode of the existing tab panel (chosen).** `BpmnComparePanel` watches the file status; in
  conflict it reads the stages and calls the page's `setMerge` without a result; when resolved it calls
  `setDiagrams` again. The page already switches between the two modes; one browser.
- B – a separate conflict panel the editor switches to. Cleaner split, but a second JCEF browser per tab and a
  duplicated toolbar.

## Design
- `ConflictStages` (new, small): reads stages 1–3 of a file in the background through
  `GitFileUtils.getFileContent(project, root, ":<n>", path)`; a stage git does not have (add/add has no base,
  delete/modify misses a side) becomes a missing side, other failures an error side. Labels from the
  repository state (`GitRepository.getState()`: MERGING, REBASING, other). The label choice is a pure static
  method and unit-tested.
- `BpmnComparePanel`:
  - a `FileStatusListener` (registered with the panel) re-checks `FileStatusManager.getStatus(file)` on
    `fileStatusChanged(file)` / `fileStatusesChanged()`; entering conflict loads the stages and pushes
    `setMerge`, leaving it reloads both sides and pushes `setDiagrams`; no change in conflict state does
    nothing (no flicker).
  - in conflict mode the toolbar shows **Resolve…** instead of the revision chooser
    (`AbstractVcsHelper.getInstance(project).showMergeDialog(List.of(file))`), and edits of the working copy do
    not reload anything.
  - the page's `revealInResult` (sent in merge mode) is ignored in the tab: there is no result column.
- Page: `setMerge` with no `result` (or `result: null`) shows the base in the middle, hides the Result/Base
  switch, has no result states (every both-sided entry open), and a later `setMerge` with a result shows the
  switch again.

## Testing
- Page (Playwright): merge without result → base in the middle, switch hidden, `Conflicts 3 / 3 open`, F7 walks
  open conflicts; then `setMerge` with a result → switch back; then `setDiagrams` → two panes.
- Java (JUnit): the labels per repository state; the mapping of a missing stage to a missing side.
- Manual (sandbox): `git merge` from the command line in the demo repo → the tab shows the conflict;
  Resolve… opens the merge window with diagrams; after Apply the tab returns to the working copy vs HEAD;
  `git merge --abort` returns it too.

## Calls made without the user
- Labels per repository state as above.
- Working-copy edits during a conflict do not reload the tab (the markers would not render anyway).
- `revealInResult` ignored in the tab.
