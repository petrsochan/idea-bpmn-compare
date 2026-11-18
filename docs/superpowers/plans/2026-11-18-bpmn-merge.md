# BPMN Merge View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the IDE's merge window for a `.bpmn` file, show ours | result (live) / base | theirs diagrams above the unchanged text merge, with each side's changes, conflicts and the result's state highlighted.

**Architecture:** A `diff.merge.MergeTool` wraps the platform's text merge viewer (found through the public `DiffManagerEx.getMergeTools()`) in a vertical splitter with a JCEF panel above it. The JCEF browser/bridge code moves out of `BpmnComparePanel` into a shared `BpmnWebView`, fixing the modality bug on the way. The web page gets a second mode, `merge`, with its own panes, a pure `merge-changes.js` that classifies changes from five bpmn-js-differ runs, and merge-specific decorations, chips and change-list rows; the two-pane diff mode stays as it is.

**Tech Stack:** Java / IntelliJ Platform 2026.2–2026.3 (JCEF, diff API), bpmn-js 18 + bpmn-js-differ 4 + bpmn-moddle 10, esbuild, node:test, Playwright 1.65.1.

**Spec:** `docs/superpowers/specs/2026-11-18-bpmn-merge-design.md`

## Global Constraints

- Plugin since-build stays `262`; compiled against `2026.3`. Nothing from `@ApiStatus.Internal` (e.g. `TextMergeTool`) – Plugin Verifier must list no internal API usage.
- The text merge must behave exactly as without the plugin: Accept Left/Right, Apply, Cancel, toolbar, undo, the conflict counter.
- Per-side changes must equal what the two-pane view shows for the same pair: `toChangeList(dropMinorLayoutChanges(diff(old, new), old, new), newElements, oldElements)`.
- Pane order ours | middle | theirs; middle shows Result (default) or Base; titles come from `request.getContentTitles()` (`[ours, base, theirs]`); the result pane's label is `Result`.
- Result debounce: 300 ms. Default splitter proportion: 0.4 for the diagrams.
- Every `invokeLater`/`Alarm` request coming from JCEF or document callbacks in a panel runs with the panel's `ModalityState.stateForComponent(...)`.
- Badge text for an element both sides changed: `name: "Check stock" → ours "Verify availability", theirs "Check warehouse stock", result "Verify availability"` (one line per attribute; `result "…"` omitted when there is no result).
- Both themes (light/dark) for every new colour; new colours go into `styles.css` as variables next to the existing `diff-*` ones.
- Work on a new branch `feature/bpmn-merge` from `main`; the branch `spike/bpmn-merge` is reference only, nothing is merged from it.

## Review Focus

1. **JCEF not available** (or the page fails to load) – the merge window must still show the full text merge, with the toggle action harmless. Owner: Task 6 (manual check step).
2. **Rapid result edits** – several `setMergeResult` calls within one render must end with the last one rendered and the view kept. Owner: Task 4 (`renders only the last of quick result updates`).
3. **Result invalid between edits** – last valid diagram stays, header shows the notice; a later valid result clears it. Owner: Task 4 (`keeps the last valid result while the XML is broken`).
4. **One side unparsable** (e.g. ours) – the other panes render and highlights between the parseable ones still work, no exception. Owner: Task 4 (`an unparsable side leaves the others working`).
5. **The hidden middle pane** (Base while Result is shown, or the reverse) must not take part in sync, F7 centring or ghost cursor, and when switched in must show the same viewport as the others. Owner: Task 4 (`switching to Base shows it at the same viewport`).

---

### Task 1: Shared `BpmnWebView` with the modality fix

**Files:**
- Create: `src/main/java/com/github/bpmncompare/BpmnWebView.java`
- Modify: `src/main/java/com/github/bpmncompare/BpmnComparePanel.java` (browser creation, `installHostBridge`, `openExternalLinksInSystemBrowser`, `browseExternally`, `pushTheme`, `call`, `executeScript`, `onEdt`, `reloadSide`)
- Copy into the repo: `docs/superpowers/specs/2026-11-18-bpmn-merge-design.md`, this plan (both currently untracked on `spike/bpmn-merge`)

**Interfaces:**
- Produces:
  ```java
  final class BpmnWebView implements Disposable {
      /** @param owner the Swing component the browser sits in, for the modality
       *  @param onPageReady runs on the EDT, in owner's modality, every time the page finished loading
       *  @param onHostMessage receives each parsed message of window.bpmnCompareHost, on the JCEF thread */
      BpmnWebView(JComponent owner, Runnable onPageReady, Consumer<Map<String, Object>> onHostMessage);
      /** Creates the browser and loads index.html; null when JCEF is not supported (caller shows a label). */
      @Nullable JComponent create();
      boolean isReady();
      void call(String function, Object argument);   // no-op until ready
      void execute(String script);                    // no-op until ready
      void pushTheme();                               // setTheme with the IDE colours
      ModalityState modality();                       // ModalityState.stateForComponent(owner)
      void onEdt(Runnable action);                    // invokeLater(action, modality(), disposed)
  }
  ```
  Register it as a child disposable of its panel (`Disposer.register(panel, webView)`).

- [ ] **Step 1:** On `spike/bpmn-merge`, commit only the spike code (`BpmnMergeTool.java`, `BpmnComparePanel.java`, `plugin.xml`) as `Spike: BPMN diagrams above the text merge` so it stays for reference; the spec and plan stay untracked and travel along. `git switch main && git switch -c feature/bpmn-merge`, then commit the spec and plan: `BPMN merge view: design and plan`.
- [ ] **Step 2:** Create `BpmnWebView` from the code now in `BpmnComparePanel` (browser, `JBCefJSQuery` bridge, `onLoadEnd` handlers, external links, theme, `call`/`execute`), with `modality()` used for every `invokeLater` it issues.
- [ ] **Step 3:** Make `BpmnComparePanel` use it: `activate()` calls `create()`; `pageReady` becomes `webView.isReady()`; `handleHostRequest` becomes the `onHostMessage` consumer (`historyChunk` stays on the JCEF thread, everything else through `webView.onEdt`); the `VCS_REPOSITORY_MAPPING_UPDATED` and `GIT_REPO_CHANGE` `invokeLater`s pass `webView.modality()`. Keep the spike's `Fixed`-content shortcut in `reloadSide` (load `BpmnContentSource.Fixed` synchronously, everything else in the `Task.Backgroundable`), via a private `applyLoaded(Side, int request, DiagramSide, boolean preserveView)`.
- [ ] **Step 4:** Run `./gradlew test e2eWebview` – expected: all Java tests and 53 Playwright tests pass.
- [ ] **Step 5:** Manual: `./gradlew runIde`, open a `.bpmn` in Git, BPMN Diff tab shows both sides; Compare with Branch → diff window → *BPMN diagram* shows both sides; dark/light switch recolours the page.
- [ ] **Step 6:** Commit: `Share the JCEF bridge and run its callbacks in the panel's modality`.

### Task 2: Page panes beyond left/right

**Files:**
- Modify: `webview/src/panes.js`, `webview/src/sync.js`, `webview/src/navigation.js`, `webview/src/zoom.js`, `webview/src/main.js`

**Interfaces:**
- Produces (panes.js):
  ```js
  // pane gets a `shown` flag (true for left/right in diff mode); loaded && shown = takes part
  export function activePanes(panes): Pane[]          // shown && loaded, in insertion order of `panes`
  export function othersOf(panes, pane): Pane[]       // activePanes without `pane`
  ```
  `SIDES`, `other()` and `loadedPanes()` are removed; callers use the two functions above.
- Produces (sync.js): `createSync(panes)` additionally returns `attach(pane)` (wires the event handlers of a pane created later) and `copyViewboxToOthers(fromPane)`. `copyViewbox(from, to)`, `syncPlane(fromSide, rootId)`, `linked()` keep their names; `linked()` means "sync on and every active pane on the same plane"; `syncPlane` sets the plane on every other active pane that has `rootId`; hover and ghost cursor go to every other active pane.
- Produces (navigation.js): targets are `activePanes(panes)` containing the id; with `sync.linked()` centre the first target and `copyViewboxToOthers` it.

- [ ] **Step 1:** Implement the two panes.js functions and switch sync, navigation, zoom, `main.js` `restoreOrFit` and `setEnabled` to them (`createPane` sets `shown: true`).
- [ ] **Step 2:** `npm test` and `npm run e2e` in `webview/` – expected: all unit tests and all 53 Playwright tests pass unchanged.
- [ ] **Step 3:** Commit: `Web view: panes as a list, not a left/right pair`.

### Task 3: `merge-changes.js` – classifying a three-way merge

**Files:**
- Create: `webview/src/merge-changes.js`, `webview/test/merge-changes.test.js`, `webview/e2e/fixtures/merge-theirs.bpmn`
- Modify: `webview/package.json` only if the test glob needs it (it does not: `test/**/*.test.js`)

**Fixture `merge-theirs.bpmn`** = `e2e/fixtures/revision.bpmn` (the base) with exactly these edits; ours is `current.bpmn`:
- `Task_Check` name `"Check warehouse stock"` – ours renamed it to `"Verify availability"` → **conflict** (same attribute);
- `Task_Review` name `"Manual check"` – ours removed it → **conflict** (removed vs changed);
- `End_Hold` name `"Held"` – ours only moved it 40 px → **both changed**, not a conflict;
- `Task_Ship` name `"Ship parcel"` → theirs only, changed;
- new top-level `Task_Gift` (name `"Add gift"`, a `BPMNShape` at x 700 y 300, no flows) → theirs only, added.

**Interfaces:**
- Consumes: `toChangeList` entries `{ id, kinds: Set, model, attrs, kind }` from `changes.js`.
- Produces:
  ```js
  /** @typedef {{ id, side: 'ours'|'theirs'|'both', conflict: boolean, kind: string,
   *              ours: Change|null, theirs: Change|null, model }} MergeEntry */
  export function toMergeEntries(ours, theirs, between): MergeEntry[]
      // ours = changes base→ours, theirs = base→theirs, between = ours→theirs (all toChangeList results)
  export function resultStates(entries, fromBase, fromOurs, fromTheirs): Map<string, 'ours'|'theirs'|'both'|'base'|'other'>
      // fromX = toChangeList(diff(X, result)); empty Map when there is no result
  export function isOpen(entry, states): boolean      // side 'both' and state 'base' (or no state)
  export function orderEntries(entries, states): MergeEntry[]
      // open conflicts, resolved conflicts, open both-changed, resolved both-changed, then one-sided by KINDS order;
      // within a group by displayName
  export function describeMerge(entry, resultChange): string   // the badge/tooltip text, see Global Constraints
  ```
  Rules (the algorithm the tests pin):
  - one part only → `side` of that part, `conflict: false`, `kind` = the part's kind.
  - both parts → `side: 'both'`; `conflict` is true when: exactly one part has `removed`; or both have `changed` and some attribute key is in both `attrs` with different `newValue` (compare with `JSON.stringify`); or both have `added` and `between` has an entry for the id with `changed`. Layout-only overlap is never a conflict. `kind` = first of `KINDS` in the union of both parts' kinds.
  - state, with `eqX` = no entry for the id in `fromX`: one-sided ours entry → `eqOurs ? 'ours' : eqBase ? 'base' : 'other'` (theirs symmetric); both-sided → `eqOurs && eqTheirs ? 'both' : eqOurs ? 'ours' : eqTheirs ? 'theirs' : eqBase ? 'base' : combined ? 'both' : 'other'`, where `combined` = the `fromBase` entry has neither `added` nor `removed` and every attribute in its `attrs` has the `newValue` of ours' or theirs' attribute of that key.

- [ ] **Step 1:** Create the fixture as listed; check it with the existing two-pane page if in doubt (`npm run build`, open `build/generated/webview/bpmn-compare/index.html` through a Playwright snippet or the IDE).
- [ ] **Step 2: Write the failing tests** in `merge-changes.test.js`, parsing fixtures with `BpmnModdle` and building change lists with `toChangeList(dropMinorLayoutChanges(diff(a, b), a, b), elementsOf(b), elementsOf(a))` (a small local helper mapping `id → businessObject` over `flowElements`, recursively into subprocesses):
  ```js
  test('same attribute changed differently is a conflict', ...)   // Task_Check: side 'both', conflict true, kind 'changed'
  test('removed against changed is a conflict', ...)              // Task_Review: side 'both', conflict true, kind 'removed'
  test('move against rename is both changed', ...)                // End_Hold: side 'both', conflict false
  test('one-sided changes keep their side', ...)                  // Task_Ship theirs/changed, Task_Gift theirs/added, Task_Supplier ours/added
  test('the same change on both sides is not a conflict', ...)    // inline: both rename X to "A" -> both, conflict false
  test('both adding the same id differently is a conflict', ...)  // inline: X added with name "A" vs "B"
  test('moves on both sides within the tolerance are no change', ...) // inline: 3 px vs 2 px -> no entry
  test('extension change against attribute change is both changed', ...) // inline: zeebe:taskDefinition type vs name
  test('result equal to ours', ...)        // result = current.bpmn: Task_Check 'ours', Task_Ship 'base', Task_Supplier 'ours'
  test('result equal to theirs', ...)      // result = merge-theirs: Task_Check 'theirs', Task_Gift 'theirs', Task_Supplier 'base'
  test('result still base', ...)           // result = revision: every both-sided entry 'base', isOpen true
  test('result combining both', ...)       // End_Hold moved like ours and renamed like theirs -> 'both'; isOpen false
  test('result edited by hand', ...)       // Task_Check name "Check" -> 'other', isOpen false
  test('order puts open conflicts first', ...) // with result = base: Task_Check, Task_Review, End_Hold, then one-sided
  test('describeMerge lists each side and the result', ...)
      // assert.equal(describeMerge(taskCheck, resultChange),
      //   'name: "Check stock" → ours "Verify availability", theirs "Check warehouse stock", result "Verify availability"')
  ```
- [ ] **Step 3:** `npm test` – expected: the new tests fail with "Cannot find module '../src/merge-changes.js'" or missing exports.
- [ ] **Step 4:** Implement `merge-changes.js` per the rules above; `describeMerge` reuses the value formatting of `format.js` (`describeAttrs`' quoting of values).
- [ ] **Step 5:** `npm test` – expected: all pass.
- [ ] **Step 6:** Commit: `Web view: classify the changes of a three-way merge`.

### Task 4: Page merge mode – panes, live result, Base switch

**Files:**
- Modify: `webview/src/index.html` (four new pane sections with a `.notice` line in the header, middle header switch, `Conflicts` chip), `webview/src/styles.css` (`body[data-mode]` visibility rules: in merge mode the left/right panes and `#export-wrap` are hidden; the merge panes get no element menu and no double-click to XML), `webview/src/main.js` (host API), `webview/src/panes.js` (new `importKeepingLast(pane, spec, parse)` → `{ defs, warnings, kept }`: `kept` true when the XML did not parse and the previous diagram stays)
- Create: `webview/src/merge-view.js`, `webview/e2e/merge.spec.js`
- Modify: `webview/e2e/view.js` (merge helpers)

**Interfaces:**
- Consumes: `activePanes`, `othersOf`, `sync.attach`, `sync.copyViewboxToOthers` (Task 2); `toMergeEntries`, `resultStates`, `orderEntries` (Task 3).
- Produces (host API on `window.bpmnCompare`):
  - `setMerge({ ours, base, theirs, result })` – each `{ xml, label, error, message, missing }` like `setDiagrams` sides; switches `document.body.dataset.mode` to `merge`, creates the panes `ours`, `result`, `base`, `theirs` on first use (`pane-ours` … sections, `createPane` + `sync.attach`), renders all four, fits once.
  - `setMergeResult(result)` – re-imports only the result pane, keeping its view (and the others'); runs through the same latest-payload-wins queue as `setDiagrams`.
  - `setMiddle('result' | 'base')` – also bound to the switch in the middle header; the hidden one gets `shown: false`, the newly shown one takes the viewport of the ours pane.
  - `setDiagrams` switches `data-mode` back to `diff`.
- Produces (merge-view.js): `createMergeView({ panes, sync, Viewer, onRendered(entries, states, resultChanges) })` → `{ setMerge, setMergeResult, setMiddle }`. It owns the five diffs: base→ours, base→theirs, ours→theirs (on `setMerge`), and base→result, ours→result, theirs→result (on every result). `onRendered` is what Task 5 decorates from.
- Invalid result: parse with `BpmnModdle#fromXML` before importing; on a parse error keep the shown diagram and set `pane-result .notice` to `The result is not valid BPMN right now – showing the last valid state.`; import warnings set it to `The result has N problem(s) – see the change list.` (plural as written, `N` the count); a clean import clears it.
- e2e helpers (`view.js`): `MERGE_THEIRS` fixture text, `openMerge(page, { result } = {})` calling `setMerge` with ours = `CURRENT`, base = `REVISION`, theirs = `MERGE_THEIRS`, result default `REVISION`, labels `Changes from main`, `Base`, `Changes from theirs`.

- [ ] **Step 1: Write the failing e2e tests** in `merge.spec.js`:
  ```js
  test('shows ours, result and theirs with their titles', ...)   // three visible panes, headers contain the labels, base pane hidden
  test('setDiagrams returns to two panes', ...)                  // after openMerge, showDiagrams -> #pane-left/#pane-right visible, merge panes hidden
  test('the middle switch shows the base', ...)                  // click Base -> #pane-base visible, #pane-result hidden; element Task_Review present in base
  test('switching to Base shows it at the same viewport', ...)   // pan ours, switch -> viewbox(base) ≈ viewbox(ours) (toBeCloseTo, 0)
  test('panning one pane moves the other two', ...)              // sync across ours/result/theirs; the hidden base not touched
  test('drilling into a subprocess takes all panes along', ...)  // Sub_Payment plane in ours -> breadcrumbs of result and theirs show it
  test('setMergeResult updates the result and keeps the view', ...) // result -> CURRENT; Task_Supplier exists in result; viewbox unchanged
  test('renders only the last of quick result updates', ...)     // setMergeResult(A); setMergeResult(B) without awaiting -> result shows B
  test('keeps the last valid result while the XML is broken', ...) // valid, then '<bpmn:definitions' -> diagram still there, notice text as specified; valid again -> notice empty
  test('an unparsable side leaves the others working', ...)      // ours xml '<broken' -> ours shows an error message, result and theirs render, no page error
  ```
- [ ] **Step 2:** `npm run e2e -- e2e/merge.spec.js` – expected: all fail (`setMerge` is not a function).
- [ ] **Step 3:** Implement the markup, CSS, `merge-view.js` and the host API as specified.
- [ ] **Step 4:** `npm run e2e` – expected: the new tests and the 53 existing pass.
- [ ] **Step 5:** Commit: `Web view: merge mode with ours, live result, base and theirs`.

### Task 5: Merge highlights, Conflicts chip, change list, F7

**Files:**
- Modify: `webview/src/decorations.js` (export `clearDecorations(panes)`, `addBadge(pane, id, kind, tipText)`, and `markHiddenChanges(pane, drawn)` taking `[{ id, kind }]`), `webview/src/filter.js` (accept `conflict` besides `KINDS`; the chip only exists in merge mode), `webview/src/change-list.js` (`renderMerge(entries, states, isVisible, selectedId)`, `renderMergeSummary(entries, states)`), `webview/src/main.js` (`visibleChanges` per mode), `webview/src/styles.css`, `webview/src/index.html`
- Create: `webview/src/merge-decorations.js`
- Modify: `webview/e2e/merge.spec.js`, `webview/e2e/view.js`

**Interfaces:**
- Consumes: `onRendered(entries, states, resultChanges)` (Task 4), `orderEntries`, `isOpen`, `describeMerge` (Task 3).
- Produces: `decorateMerge(panes, entries, states, isVisible)` in `merge-decorations.js`:
  - ours pane: for an entry with an `ours` part, markers `diff-<k>` for its kinds except `removed`, a badge of the part's kind; theirs pane symmetric;
  - base pane: `diff-removed` / `diff-changed` for removed or changed parts of either side;
  - result pane: marker `result-<state>` on every entry's element present in the result;
  - every pane: `merge-conflict` (entry.conflict and open) or `merge-both` (side both, not a conflict, or a resolved conflict) on the element if present; their badge text is `describeMerge`;
  - collapsed subprocesses: `markHiddenChanges` with what this pane drew.
- Visibility: `isVisible(entry)` = `entry.side === 'both' ? kinds.has('conflict') : kinds.has(entry.kind)`. Kind chips count one-sided entries; the `Conflicts` chip shows `Conflicts <open> / <total>` over both-sided entries. In diff mode the chip is hidden and `conflict` in the stored filter is ignored.
- Change list rows in merge mode: kind label, element name, a side tag `ours` / `theirs` / `both`, and for both-sided entries the result state (`open`, `resolved – ours`, `resolved – theirs`, `resolved – both`, `resolved by hand`). Order and F7 = `orderEntries(entries, states)` filtered by `isVisible`.

- [ ] **Step 1: Write the failing e2e tests** (append to `merge.spec.js`; `badge()` and `changeListIds()` helpers from `view.js` reused):
  ```js
  test('ours and theirs show their own changes', ...)      // badge Task_Supplier in ours (added), none in theirs; Task_Gift in theirs (added), none in ours
  test('a conflict is marked in every pane that has it', ...) // Task_Check has class merge-conflict in ours, result, theirs
  test('both changed is quieter than a conflict', ...)     // End_Hold: merge-both, not merge-conflict
  test('the conflicts chip counts open and total', ...)    // 'Conflicts 3 / 3'; after setMergeResult(CURRENT) -> 'Conflicts 0 / 3'
  test('the result shows where each change stands', ...)   // result = CURRENT: Task_Check result-ours, Task_Ship result-base
  test('the change list starts with open conflicts', ...)  // changeListIds()[0..2] = ['Task_Check','Task_Review','End_Hold']
  test('F7 walks open conflicts first', ...)               // F7 ×1 -> selectedChange 'Task_Check'
  test('hiding conflicts leaves the one-sided changes', ...) // click Conflicts chip -> list has no Task_Check, has Task_Ship
  test('the badge of a conflict lists both sides', ...)    // tooltip text of Task_Check's badge equals describeMerge output
  test('diff mode has no conflicts chip', ...)             // showDiagrams -> chip hidden, 53-test chips unchanged
  ```
- [ ] **Step 2:** `npm run e2e -- e2e/merge.spec.js` – expected: the new tests fail.
- [ ] **Step 3:** Implement as specified; colours for `merge-conflict`, `merge-both`, `result-*` as CSS variables in both themes (conflict: a red distinct from `removed`, e.g. a thicker outline; result states reuse the side's tone – the exact look is the implementer's call).
- [ ] **Step 4:** `npm test && npm run e2e` – expected: all pass.
- [ ] **Step 5:** Commit: `Web view: conflicts, result state and change list of a merge`.

### Task 6: The merge tool in the IDE

**Files:**
- Create: `src/main/java/com/github/bpmncompare/BpmnMergeTool.java`, `BpmnMergeViewer.java`, `BpmnMergePanel.java`, `src/test/java/com/github/bpmncompare/BpmnMergeToolTest.java`
- Modify: `src/main/java/com/github/bpmncompare/BpmnCompareSettings.java`, `src/main/resources/META-INF/plugin.xml` (extension + description bullet), `README.md` (feature list)

**Interfaces:**
- Consumes: `BpmnWebView` (Task 1); host calls `setMerge`, `setMergeResult`, `setSync`, `setTheme` (Task 4).
- Produces:
  ```java
  public final class BpmnMergeTool implements MergeTool {
      boolean canShow(MergeContext, MergeRequest);   // project != null, TextMergeRequest, BpmnFiles.isBpmn(output highlight file), delegate != null
      MergeViewer createComponent(MergeContext, MergeRequest);
      /** First tool that is not a BpmnMergeTool and can show the request; null if none. */
      static @Nullable MergeTool delegate(List<MergeTool> tools, Predicate<MergeTool> canShow);
  }
  final class BpmnMergeViewer implements MergeTool.MergeViewer   // splitter, toggle, delegation
  final class BpmnMergePanel extends JPanel implements Disposable {
      BpmnMergePanel(Project project, List<String> sideTexts /* ours, base, theirs */, List<String> titles, Document result);
      void activate();             // creates the web view (or a "JCEF is not available" label)
      void setLive(boolean live);  // false: result edits ignored; true: pushes the current result now
  }
  // BpmnCompareSettings
  static boolean isMergeDiagramsVisible();            // default true, key "bpmnCompare.mergeDiagramsVisible"
  static void setMergeDiagramsVisible(boolean visible);
  ```
- Viewer: `new OnePixelSplitter(true, "bpmnCompare.mergeSplitter", 0.4f)`; first component the panel (created on first show), second the delegate's component. `init()` calls the delegate's `init()`, then sets `toolbarActions` to the delegate's list plus a `ToggleAction` "Show BPMN Diagrams" (icon `AllIcons.Actions.Preview`, `DumbAware`, EDT update thread). Hiding removes the first component and calls `setLive(false)`; showing adds it, `activate()`s on first time and `setLive(true)`. `getResolveAction`, `getPreferredFocusedComponent` delegate. `dispose()` disposes delegate and panel.
- Panel: toolbar with only the sync checkbox (`BpmnCompareSettings.isSyncEnabled`); on page ready `pushTheme`, `setSync`, `setMerge` with `DiagramSide.xml(text, title)` per side and `DiagramSide.xml(result.getText(), "Result")`; a `DocumentListener` on `result` (registered with the panel as disposable) restarts an `Alarm(SWING_THREAD, panel)` request of 300 ms with `webView.modality()` that calls `setMergeResult` when live and ready.

- [ ] **Step 1: Write the failing test** `BpmnMergeToolTest`:
  ```java
  @Test void skipsItselfAndPicksTheFirstToolThatCanShow()   // [bpmnTool, cannot, text, other] -> text
  @Test void noDelegateWhenNothingElseCanShow()            // [bpmnTool, cannot] -> null
  ```
  (fake `MergeTool`s as small lambdas/anonymous classes; `canShow` predicate passed in.)
- [ ] **Step 2:** `./gradlew test --tests '*BpmnMergeToolTest'` – expected: compilation failure (class missing).
- [ ] **Step 3:** Implement the three classes, the settings, register `<diff.merge.MergeTool implementation="com.github.bpmncompare.BpmnMergeTool"/>` after the `diff.DiffTool` line, add the plugin.xml description bullet (**Merge conflicts** – ours, the result as it is being resolved, and theirs as diagrams above the IDE's text merge, with conflicting elements marked) and the same in `README.md`.
- [ ] **Step 4:** `./gradlew test` – expected: pass.
- [ ] **Step 5:** `./gradlew buildPlugin check verifyPluginStructure verifyPlugin` – expected: BUILD SUCCESSFUL, verifier "Compatible" for both IDEs and no "internal API" line.
- [ ] **Step 6: Manual check** with a conflict repository (recreate: base = `webview/e2e/fixtures/revision.bpmn`, branch `theirs` = `merge-theirs.bpmn`, `main` = `current.bpmn`, `git merge theirs`), in `./gradlew runIde`:
  1. Git → Resolve Conflicts → Merge: three diagrams above the text merge, Conflicts `3 / 3`.
  2. Accept Left on the `Task_Check` chunk: within a second the result pane shows "Verify availability" and the chip drops by one.
  3. Typing quickly in the result column does not lag; Base switch works.
  4. Toggle hides the diagrams (text merge fills the window); reopening the merge window keeps it hidden; toggle back.
  5. Apply resolves the file (`git status` shows it staged); a second run with Cancel leaves it conflicted; no plugin error in `idea.log`.
  6. With `-Dide.browser.jcef.enabled=false` in `runIde` JVM args the merge window shows the text merge with a "JCEF is not available" label above it, and resolving works.
- [ ] **Step 7:** Commit: `Show BPMN diagrams in the merge window`.
