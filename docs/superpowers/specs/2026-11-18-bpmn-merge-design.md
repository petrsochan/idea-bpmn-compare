# BPMN merge view – design

## Intent
A conflict in a `.bpmn` file is the worst moment of working with it: the IDE's merge window shows three columns
of XML in which a renamed task, a moved shape and a rewired flow all look the same, and the DI section makes
almost every edit a conflict. Today the plugin only compares two versions. In the merge window it should show
what each side actually did to the **diagram**, which elements both sides touched, and – live, as the user
resolves – what the merged diagram will look like.

The decision stays in the IDE's text merge (from the user): the diagrams are for looking, not for resolving.
Of the improvement ideas this one brings the most and costs the most.

## Goals
- Merging a `.bpmn` file in the IDE (Git → Resolve Conflicts → Merge…, or the merge window opened by a
  conflicting merge, rebase, cherry-pick or unstash) shows BPMN diagrams above the unchanged text merge.
- Layout (decided by the user): **ours | result | theirs**, column for column like the text merge below. The
  middle pane has a **Result / Base** switch; Result is the default. Pane titles come from the merge request's
  content titles, not hard-coded "ours/theirs": during a rebase "ours" is the upstream, and the IDE already
  names the sides correctly.
- **Live result.** The result pane renders the merge window's result document and re-renders (debounced, keeping
  pan and zoom) whenever it changes: Accept of a chunk, Apply non-conflicting changes, a manual edit, undo.
- Highlighting:
  - ours pane: the changes base → ours (added, changed, moved), with the same colours and badges as the diff view;
  - theirs pane: the changes base → theirs, likewise;
  - result pane: for each element either side changed, where the result stands – *taken from ours*, *taken from
    theirs*, *both* (the two sides agree, or the result combines them), *still base* (neither side's change is in
    yet) or *other* (the result matches neither side – a manual edit). Conflicts still unresolved are the
    loudest marker;
  - base pane (via the switch): what either side removed or changed, so the original of a changed element can
    be read there.
- **Changed on both sides** is the point of the view: an element that both sides changed gets a distinct
  conflict marker in the panes, a "Conflicts" chip with its count, and comes first in the change list and in F7
  order. Within it:
  - *conflict* – both sides changed the same attribute to different values, one side removed an element the
    other changed, or both added an element with the same id but different content;
  - *both changed* – both sides touched the element but not in a contradicting way (different attributes, or
    the same new value). Shown, but quieter than a conflict.
  A conflict counts as **resolved** once the result holds a value other than base for it; the chip shows
  `Conflicts 1 / 3 open` style counts.
- The change list says per entry which side made the change (ours / theirs / both), each side's value of each
  attribute for "both", and the result's current state.
- Synchronized pan, zoom, hover, cursor and subprocess plane across all three panes, as the two-pane view does.
- A toolbar toggle hides the diagrams and gives the whole window back to the text merge; the choice and the
  splitter position are remembered across merges.
- Works in 2026.2 (since-build 262) and 2026.3; no internal IDE API.

## Non-goals
- Resolving in the diagrams (accept a side per element, edit). The text merge does that.
- Following the text merge from the diagrams' side only (added after the first sandbox check, at the user's
  request): F7, a click on a change-list row or on an element in a diagram puts the caret of the result column
  on that element and selects its line; the focus stays in the diagrams. Selecting a chunk in the text does
  not move the diagrams.
- Showing the conflict outside the merge window (from the conflicted file's index stages `:1:/:2:/:3:`) –
  a later step that reuses this work.
- Export to Markdown/SVG/PNG and element history in the merge view.
- Merges without three text sides: binary conflicts, a file deleted on one side (the IDE shows its own dialog
  for those; the platform only gives a text merge request for real 3-way content).

## Anti-goals
- Breaking or slowing the text merge. If the diagrams fail (no JCEF, unparsable side, script error), the text
  merge must work exactly as without the plugin: Accept Left/Right, Apply, Cancel, the toolbar, undo, the
  "N changes, M conflicts" counter. Typing in the result must not lag because of re-rendering.
- A highlighting that disagrees with the diff view: the per-side changes must be exactly what the two-pane view
  would show for base ↔ ours and base ↔ theirs (same differ, extension comparison, 5 px layout tolerance).
- Reporting as a conflict what is not one – e.g. both sides moving a shape by 2 px, or the same rename on both
  sides.
- A result pane that goes blank or jumps while the user works: an intermediate unparsable state keeps the last
  good diagram.

## Constraints and spike findings
A throwaway spike (branch `spike/bpmn-merge`) answered the risky questions:

- **The merge window has no tool selector.** `MergeRequestProcessor.getFittedTool` takes the first `MergeTool`
  whose `canShow` is true; `DiffManagerImpl.getMergeTools()` lists registered `diff.merge.MergeTool`
  extensions **before** the built-in text and binary tools – checked in the bytecode of 2026.3 (263.7307) and
  2026.2.1. A tool registered for `.bpmn` therefore replaces the text merge, so it must **wrap** it.
- **Wrapping works.** The spike created the text merge viewer inside its own `MergeViewer`, put a
  `BpmnComparePanel` above it in a vertical `OnePixelSplitter`, and delegated `init()` (toolbar),
  `getResolveAction()` and `getPreferredFocusedComponent()`. The window kept its full toolbar and buttons;
  Apply resolved the file (`UU` → `M`); no errors in the log.
- **`TextMergeTool` is `@ApiStatus.Internal`.** The spike referenced `TextMergeTool.INSTANCE`; the real
  implementation must not. `DiffManagerEx.getInstance().getMergeTools()` is public: take the first tool that
  is not ours and whose `canShow` is true. That is the text merge – or another plugin's tool, which then keeps
  working too.
- **The merge window is modal.** Callbacks from the JCEF thread scheduled with plain `invokeLater` run as
  non-modal and wait until the window closes – the diagrams stayed empty. `BpmnComparePanel` must schedule
  with the modality of its own window (`ModalityState.stateForComponent(panel)`), and load content the
  platform already supplied without a background task. The spike did both and the diagrams loaded. This also
  is a latent bug of the existing diff integration whenever a diff is shown in a modal dialog. Any `Alarm`
  used for the result's debounce must run in that modality too.
- A `TextMergeRequest` gives `getContents()` = `[ours, base, theirs]` as `DocumentContent`s, their titles, and
  `getOutputContent()` – the result document of the file being merged.
- **The result document has no conflict markers.** The text merge fills unresolved conflict chunks with the base
  text (seen in the spike: the result line of the conflicting task held base's `name="Check stock"`), so the
  result is ordinary XML from the start. It can still become invalid between edits – accepting only part of a
  chunk, or a half-typed manual edit – or reference elements that a chunk removed; bpmn-js reports the latter as
  import warnings and renders the rest.

## Approaches (decided: A)
- **A – own `MergeTool` that wraps the text merge, diagrams in a splitter above it (chosen).** Diagrams are in
  sight while resolving; the text merge is untouched. Costs a JCEF browser per BPMN merge and screen height
  (hence the toggle). Risk of wrapping a platform viewer was removed by the spike.
- B – a toolbar button in the merge window opening the diagrams in a separate window. Doesn't touch the merge,
  but the diagrams sit in another floating window over a modal one, and an action has no clean access to the
  merge request's contents.
- (Rejected) replacing the text merge with a diagram-based resolver – the decision is to stay in text.

Layouts considered for the panes (decided: 1): **1 – ours | result/base | theirs** (chosen: mirrors the text merge
column for column, base is looked at less and fits behind a switch); 2 – four panes side by side (too narrow on a
normal monitor); 3 – a 2×2 grid (takes even more height from the text merge).

## The design

### IDE side (Java)
- `BpmnMergeTool implements MergeTool`, registered as `<diff.merge.MergeTool>`.
  - `canShow`: project present, request is a `TextMergeRequest`, output file is BPMN, and a delegate tool
    exists (see below) that can show it.
  - `createComponent`: the delegate's viewer wrapped in a `BpmnMergeViewer`.
  - Delegate: first entry of `DiffManagerEx.getInstance().getMergeTools()` that is not a `BpmnMergeTool` and
    `canShow`s the request.
- `BpmnMergeViewer implements MergeTool.MergeViewer`: vertical `OnePixelSplitter` – diagrams first, text merge
  second; every `MergeViewer` method that concerns resolving delegates to the text viewer. The toolbar gets one
  extra toggle action (show/hide diagrams), appended to the delegate's `ToolbarComponents`; its state and the
  splitter proportion are stored in `BpmnCompareSettings` (`PropertiesComponent`, like sync and follow caret).
  When hidden, the browser is not created at all; showing it later creates it.
- The diagram panel is a merge mode of the existing panel, not a copy of it: the toolbar parts that make no
  sense here (revision chooser, refresh, follow caret, export, history) are left out. Whether this is a
  constructor flag on `BpmnComparePanel` or a small sibling class sharing the browser/bridge code is the
  builder's call – the panel is 750 lines and mostly bridge and toolbar.
- Ours, base and theirs are read once on the EDT from the request's documents; they do not change during the
  merge. The result is read from the output document on open and then on every change: a `DocumentListener`
  on the output document (disposed with the viewer) restarts a debounce (about 300 ms, like the working-copy
  listener of the diff tab) and then pushes the new result text. While the diagrams are hidden, no re-render.
- Disposal: the wrapper disposes the delegate viewer, the panel and the listener.
- The modality fix in `BpmnComparePanel` (see constraints) is part of this work.

### Page side (web view)
- New host calls `setMerge({ ours, base, theirs, result })` – each side shaped like today's `setDiagrams` sides
  (`xml | error | missing`, `label`) – and `setMergeResult(result)` for the live updates, which keeps the view.
  The page switches to a three-pane layout; `setDiagrams` keeps the two-pane layout. One bundle, one
  `index.html`.
- `panes.js`: the side list becomes the page's current layout (`['left', 'right']` or
  `['ours', 'middle', 'theirs']`) instead of a constant; `other(side)` becomes "the other panes". The middle
  pane holds two viewers (result, base) and the switch shows one of them; sync and decorations act on the one
  shown.
- `sync.js`: pan/zoom/hover/cursor/plane are copied from the source pane to **all** other panes; the existing
  "quietly" guard prevents echoes.
- New pure module `merge-changes.js`:
  - from `diff(base, ours)` and `diff(base, theirs)`, turned into change lists by the existing `toChangeList`
    (+ extension comparison, + `dropMinorLayoutChanges`), produce merge entries
    `{ id, side: 'ours'|'theirs'|'both', conflict: boolean, ours, theirs }` with the conflict rules from Goals; a
    layout-only change on both sides is "both changed", not a conflict;
  - from `diff(base, result)` the same way, the result state of each entry: `ours | theirs | both | base | other`,
    by comparing the result's changed attributes with each side's;
  - unit-tested with node like the other pure modules.
- Result re-render: parse the new XML first; on failure keep the shown diagram and show a non-blocking
  message in the pane header ("The result is not valid BPMN right now – showing the last valid state"); import
  warnings (dangling references) are listed the same way but the diagram is shown.
- `decorations.js`: per pane, which entries and which colour: ours pane ← entries with an ours part, theirs
  pane ← theirs part, result pane ← result state, base pane ← removed/changed parts of either side; plus the
  conflict marker (a distinct outline colour and a badge, exact look is the builder's call within the existing
  palette and both themes).
- Filter chips gain **Conflicts** (open / total), the change list groups conflicts first and labels each entry
  with its side and result state; F7 walks the same order, open conflicts first.
- Element badges/tooltips for a "both" entry show each side's value and the result's: `name: "Check stock" →
  ours "Verify availability", theirs "Check warehouse stock", result "Verify availability"`.

### Testing
- `merge-changes.js` unit tests: one side only, both same change, both different attribute, both same
  attribute different value, removed vs changed, both added the same id, layout on both within/over tolerance,
  extension conflict; result states ours / theirs / both / base / other.
- Playwright: four fixtures (base/ours/theirs derived from the existing order diagrams, with a real conflict, a
  "both changed" and one-sided changes, plus a result with the conflict resolved to ours); tests for the
  three-pane render, the Result/Base switch, per-pane highlights, the Conflicts chip and list, F7 order, sync
  across three panes, the plane following, `setMergeResult` updating the result while keeping the view, an
  invalid result keeping the last diagram, and `setDiagrams` still giving two panes.
- Manual check (documented in the plan): the demo repository with a conflicting rename; the merge window shows
  the diagrams; Accept Left changes the result diagram and resolves the conflict in the chip; typing in the
  result stays smooth; the toggle hides/shows the diagrams; Accept/Apply/Cancel behave as without the plugin;
  the window works with JCEF disabled (text merge only, no error).
- Plugin Verifier must report no internal API usage.

## Left to the builder
- How the merge mode splits from `BpmnComparePanel` (flag vs. sibling class).
- The colours for result states and the conflict marker, within the existing palette, in light and dark theme.
- The default splitter proportion (the spike used 60 % diagrams; the text merge needs its room – something
  like 40 % is a reasonable start).
- What a pane shows when ours, base or theirs fails to parse: the existing per-pane message; the other panes and
  the highlights between the parseable ones still work.

## Calls made without the user
- Titles from the request; Result is the middle pane's default, Base behind the switch.
- Base view highlights removals and changes of both sides.
- The "conflict" vs "both changed" distinction; a shape moved by both sides is "both changed", never a
  conflict, even when the positions differ (the text merge will still show its DI lines as a conflict).
- A conflict counts as resolved when the result no longer holds the base value.
- An invalid intermediate result keeps the last valid diagram.
- Toggle remembered across merges; diagrams shown by default.
- No export/history in merge mode.
