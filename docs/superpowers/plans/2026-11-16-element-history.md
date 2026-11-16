# Element history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click an element → the commits that changed it (who, when, why, what), and from each one the BPMN diff of that commit centred on the element.

**Architecture:** The host reads the file history with `git log --follow --raw` (blob ids of the file before/after every commit, against its first parent) and the unique blobs with one `git cat-file --batch`. It feeds the page commit by commit in chunks; the page diffs each pair with the view's own pipeline (`diff` → `dropMinorLayoutChanges` → `toChangeList`) and answers which commits touched the element. The host shows them in a list popup; a click opens a platform diff window forced to the BPMN tool and focused on the element.

**Tech Stack:** Java 21, IntelliJ Platform 2026.2 (Git4Idea `GitLineHandler`/`GitBinaryHandler`, diff API), JCEF bridge; bpmn-js 18 / bpmn-moddle 10 / bpmn-js-differ 4; JUnit 6, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-16-element-history-design.md`

## Global Constraints

- History depth: same as the revision chooser – `--follow`, at most 300 commits (`GitRevisions.MAX_COMMITS`).
- "Changed" = what the view reports: bpmn-js-differ + extension elements + 5 px layout tolerance (`layout.js`).
- Each commit is compared with its **first parent**, never with the neighbouring log entry.
- The IDE must never block: Git and the page round-trips run in a cancellable `Task.Backgroundable`.
- Do not restyle or cover `.bjs-powered-by` (bpmn.io license). The page draws its own menus/tooltips; no `title` attributes, no native menus.
- Platform facts (verified against IU-262 jars): `DiffUserDataKeysEx.FORCE_DIFF_TOOL` is not `@ApiStatus.Internal`; `DiffRequestProcessor` reads it from the **context**, and for `DiffManager.showDiff(project, chain, hints)` the context is the `DiffRequestChain` itself → put the key on a `SimpleDiffRequestChain`. `GitHandler.setInputProcessor(ThrowableConsumer<OutputStream, IOException>)` feeds stdin; `GitBinaryHandler.run()` returns stdout bytes; `GitCommand.CAT_FILE` exists.

## Review Focus

1. A history with branches: a commit made on a side branch must be attributed to that commit only (first-parent pairs) – covered by the parser test on raw records and by `history.test.js` operating per commit.
2. A rename of the `.bpmn` file in the history: the commit keeps old/new blob ids; nothing may report the element as added at the rename – covered by `parsesRenameRecords`.
3. A large file and long history: blobs sent at most once per chunk, chunks of 10 commits; the IDE stays responsive and Cancel stops the task – manual check in Task 5.
4. A version that does not parse (broken XML committed): that commit is skipped, history continues – test `skipsCommitsThatDoNotParse`.
5. The element exists only in the right (revision) pane, e.g. deleted in the working copy: the menu works there too and the history includes the deleting commit – test `reportsTheCommitThatRemovedTheElement`.

---

## File Structure

| File | Change |
|---|---|
| `src/main/java/com/github/bpmncompare/GitLogParser.java` | `HISTORY_FORMAT`, `parseHistory(String)`, `parseCatFileBatch(byte[])` |
| `src/main/java/com/github/bpmncompare/FileHistory.java` | **New.** records `FileHistory`, `HistoryCommit` |
| `src/main/java/com/github/bpmncompare/GitRevisions.java` | `fileHistoryWithBlobs(...)` |
| `src/main/java/com/github/bpmncompare/ElementHistory.java` | **New.** background run with page round-trips, popup, opening the diff |
| `src/main/java/com/github/bpmncompare/BpmnComparePanel.java` | commands `elementHistory` / `historyChunk`, `setHistoryAvailable`, `focus` in `setDiagrams` |
| `src/main/java/com/github/bpmncompare/BpmnDiffViewer.java` | reads `ElementHistory.FOCUS_ELEMENT` from the request |
| `webview/src/history.js` | **New.** `commitChange(id, before, after)` |
| `webview/src/layout.js` | export `diByElementId` |
| `webview/src/main.js`, `index.html`, `styles.css` | context menu, `computeHistory`, `setHistoryAvailable`, `focus` |
| `webview/package.json` | `bpmn-moddle` moves from devDependencies to dependencies (same version) |
| tests | `GitLogParserTest`, `webview/test/history.test.js` |
| `README.md`, `CHANGELOG.md`, `plugin.xml` | documentation |

---

## Task 0: Branch

- [ ] Commit the spec and this plan on `layout-tolerance-screenshots` (the branch already carries the unreleased 1.3.0 work; one PR for both).
- [ ] `./gradlew check` → `BUILD SUCCESSFUL`.

---

## Task 1: Parse the history log and the cat-file batch (Java)

**Files:** Modify `GitLogParser.java`; Create `FileHistory.java`; Test `GitLogParserTest.java`

**Interfaces – Produces:**
```java
record HistoryCommit(String hash, String shortHash, String date, String author, String subject,
                     @Nullable String beforeBlob, @Nullable String afterBlob) {}   // null = file absent on that side
record FileHistory(List<HistoryCommit> commits, Map<String, String> blobs) {}       // blob id -> UTF-8 text, BOM stripped
static final String GitLogParser.HISTORY_FORMAT = "--format=%x1e%H%x1f%h%x1f%ad%x1f%an%x1f%s";
static List<HistoryCommit> GitLogParser.parseHistory(String output);   // output of: log --follow --raw --no-abbrev -z HISTORY_FORMAT --date=short
static Map<String, byte[]> GitLogParser.parseCatFileBatch(byte[] output); // id -> content; "missing" ids absent
```

Raw record (with `-z`): `:<oldmode> <newmode> <oldblob> <newblob> <status>\0<path>\0` (+ `<newpath>\0` for `R`/`C`). An all-zero blob id means absent → `null`. A commit without a raw record (merge) is **dropped**. Split commits on `\x1e`, header fields on `\x1f` with limit 5 (subject last, like `parse`).

- [ ] **Step 1: Failing tests** in `GitLogParserTest`:
  - `parsesHistoryWithBlobIds` – two commits, `M` records → hashes, author, subject, before/after blob ids as given.
  - `fileCreatedInACommitHasNoBeforeBlob` – status `A`, old blob `0000…0000` (40 zeros) → `beforeBlob == null`.
  - `parsesRenameRecords` – `R100\0old.bpmn\0new.bpmn\0` → blobs kept, the next commit still parsed.
  - `dropsCommitsWithoutARawRecord` – a merge header followed directly by the next `\x1e` → not in the list.
  - `parsesCatFileBatch` – `"<id> blob 5\nhello\n<id2> missing\n<id3> blob 7\nčau\n\n"`-style bytes (use a multi-byte UTF-8 payload and one whose content contains `"blob 3\n"`) → sizes are byte counts; `id2` absent.
- [ ] **Step 2:** `./gradlew test --tests '*GitLogParserTest'` → new tests FAIL (compile error).
- [ ] **Step 3:** Implement. Batch parsing reads the header line up to `\n`, then exactly `<size>` bytes, then skips one `\n`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `Parse the file history with blob ids and git cat-file output`.

---

## Task 2: Read the history with blobs (Java, Git)

**Files:** Modify `GitRevisions.java`

**Interfaces – Consumes:** Task 1. **Produces:**
```java
static FileHistory GitRevisions.fileHistoryWithBlobs(Project, GitRepository, VirtualFile, ProgressIndicator) throws VcsException;
```

- [ ] **Step 1:** `GitLineHandler` LOG with `--follow --raw --no-abbrev -z --date=short --max-count=MAX_COMMITS HISTORY_FORMAT`, `endOptions()`, relative path (as `fileHistory` does). Join `getOutput()` with `"\n"` and pass to `parseHistory` (the parser must therefore tolerate `\n` around `\x1e`; add that case to `parsesHistoryWithBlobIds` if needed).
- [ ] **Step 2:** Unique non-null blob ids → `GitBinaryHandler(project, root, GitCommand.CAT_FILE)`, `addParameters("--batch")`, `setSilent(true)`, `setInputProcessor(out -> { write "<id>\n" per blob; close })`, `run()` → `parseCatFileBatch` → decode UTF-8, `stripBom`. Check `indicator.checkCanceled()` between steps.
- [ ] **Step 3:** `./gradlew compileJava` → success. (Behaviour is checked end-to-end in Task 5.)
- [ ] **Step 4:** Commit `Read a file's history with every version in one git call`.

---

## Task 3: Which commits changed an element (web view, pure)

**Files:** Create `webview/src/history.js`, `webview/test/history.test.js`; Modify `webview/src/layout.js` (export `diByElementId`), `webview/package.json`

**Interfaces – Produces:**
```js
// before/after: BPMN XML or null (file absent). Resolves to null when the commit did not touch `id`
// or a side does not parse.
export async function commitChange(id, before, after, moddle = new BpmnModdle())
  // -> { kinds: string[] /* KINDS order */, summary: string } | null
export function elementsById(defs) // id -> businessObject of every drawn element (bpmnElement of each plane element, planes' own roots excluded)
```

Pipeline: parse both sides (`moddle.fromXML`); `after` null → only the before side exists → if it has `id`, `{ kinds: ['removed'] }`; `before` null → `added` likewise. Otherwise `toChangeList(dropMinorLayoutChanges(diff(old, new), old, new), elementsById(new), elementsById(old))` and pick the entry with `id`. `summary`: kinds joined with `' + '` using the view's labels (`Added`, `Removed`, `Changed`, `Moved`), then for `changed` `': ' + describeAttrs(attrs).split('\n').join('; ')`, cut to 120 chars with `…`. Move `KIND_LABEL` from `main.js` to `format.js` and export it so both use one copy.

- [ ] **Step 1: Failing tests** (`history.test.js`, real moddle + differ, XML built like `layout.test.js`):
  - `aRenamedTaskReportsTheRename` → kinds `['changed']`, summary `Changed: name: "Check stock" → "Verify availability"`.
  - `aCommitThatDidNotTouchTheElementIsNull` – another task renamed → `null`.
  - `aNudgeWithinTheToleranceIsNull` – task moved 3 px → `null`; moved 40 px → `['layout']`, summary `Moved`.
  - `anExtensionOnlyEditCounts` – a `camunda:executionListener` added (namespace as in `extensions.test.js`) → `['changed']`.
  - `theCommitThatCreatedTheFileReportsAdded` – `before = null` → `['added']`.
  - `reportsTheCommitThatRemovedTheElement` – task absent in `after` → `['removed']`.
  - `skipsCommitsThatDoNotParse` – `after = '<broken'` → `null`, no throw.
- [ ] **Step 2:** `cd webview && node --test test/history.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement; move `bpmn-moddle` to `dependencies`.
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Commit `Find out what a commit did to one element`.

---

## Task 4: Context menu, history round-trip and focus in the page

**Files:** Modify `webview/src/main.js`, `webview/src/index.html`, `webview/src/styles.css`

**Interfaces – Consumes:** `commitChange`. **Produces (page ↔ host contract, used by Task 5):**
- page → host: `{ command: 'elementHistory', id, name, x, y }` (x/y = client coordinates of the click)
- host → page: `bpmnCompare.setHistoryAvailable({ available: boolean, reason: string })` (default before any call: unavailable, reason `''` → no menu at all)
- host → page: `bpmnCompare.computeHistory({ token, id, commits: [{ hash, before, after }] })`
- page → host (one per `computeHistory` call): `{ command: 'historyChunk', token, entries: [{ hash, kinds, summary }] }`, or `{ command: 'historyChunk', token, error }`
- `setDiagrams` payload may carry `focus: '<id>'` → after the render, `focusElement(id)`.

- [ ] **Step 1:** `#element-menu` (`<ul hidden>`, styled like `#export-menu` but `position: fixed`) with one item `History of "<name>"`; unavailable → item gets `aria-disabled="true"` and `setTip(item, reason)`. Open on `element.contextmenu` of either viewer (`event.originalEvent.preventDefault()`; a `label` resolves to `element.labelTarget`; a root element opens nothing). Close on Escape, outside click, scroll/zoom and window blur.
- [ ] **Step 2:** `computeHistory` processes the commits sequentially with `await commitChange(...)`, collects non-null results, and always answers exactly once per call (catch → `error`).
- [ ] **Step 3:** `focus` in `render()` after `restoreOrFit`.
- [ ] **Step 4:** `npm run build` succeeds; then in a browser (as for the screenshots: serve the build plus `docs/screenshots/*.bpmn`, stub `window.bpmnCompareHost = (m) => console.log(JSON.stringify(m))`): right-click "Verify availability" → menu; with `setHistoryAvailable({available:true})` the click logs `elementHistory`; `computeHistory` with the two sample files as one commit logs an entry `Changed: name: "Check stock" → "Verify availability"`; a `setDiagrams` with `focus: 'Task_Receipt'` opens the payment subprocess.
- [ ] **Step 5:** Commit `Element context menu and history computation in the page`.

---

## Task 5: History popup and the commit diff (Java)

**Files:** Create `ElementHistory.java`; Modify `BpmnComparePanel.java`, `BpmnDiffViewer.java`

**Interfaces – Consumes:** Tasks 1, 2, 4. **Produces:**
```java
static final Key<String> ElementHistory.FOCUS_ELEMENT = Key.create("bpmnCompare.focusElement");
```

- [ ] **Step 1: Panel.** `pushAll` also calls `setHistoryAvailable`: available iff `file != null` and `GitRevisions.repositoryFor` is non-null; reasons `"The diagram is not a file in the project."` / `"The file is not under Git version control."`. Commands: `elementHistory` → `ElementHistory.start(...)` on the EDT; `historyChunk` → hand the raw message to the running `ElementHistory` (a `BlockingQueue<Map<String,Object>>` it owns; ignore other tokens). `BpmnComparePanel` gets an optional `focusOnFirstLoad` id (setter used by `BpmnDiffViewer`), sent once as `focus` in `pushDiagrams`.
- [ ] **Step 2: Run.** `Task.Backgroundable(project, "Reading history of <file name>", true)`: `fileHistoryWithBlobs`; then chunks of 10 commits → `call("computeHistory", …)` with a fresh token per chunk → `queue.poll(60 s)` (timeout → error), `indicator.setFraction(done / total)`, `checkCanceled()`. Collect entries in log order.
- [ ] **Step 3: Popup** (`onSuccess`, EDT): empty → balloon/hint `No change to "<name>" in the last <N> commits of <file>`; else `BaseListPopupStep<Row>` titled `History of "<name>"`, speed search on, row text `<short>  <date>  <author>  —  <subject, max 70>   ·  <summary>`, icon `AllIcons.Actions.Commit`, shown at `new RelativePoint(browser component, new Point(x, y))`. Errors → `Messages.showErrorDialog(..., "BPMN Compare")`.
- [ ] **Step 4: Diff.** On choice: `DiffContentFactory.getInstance().create(project, text, file)` per side (`createEmpty()` when the blob is null); `SimpleDiffRequest(title, before, after, "<short>^", "<short>  <subject>")` with `putUserData(FOCUS_ELEMENT, id)`; `SimpleDiffRequestChain chain` with `putUserData(DiffUserDataKeysEx.FORCE_DIFF_TOOL, new BpmnDiffTool())`; `DiffManager.getInstance().showDiff(project, chain, DiffDialogHints.DEFAULT)`. `BpmnDiffViewer` passes `request.getUserData(FOCUS_ELEMENT)` to the panel.
- [ ] **Step 5:** `./gradlew check verifyPlugin` → `BUILD SUCCESSFUL`, no internal/deprecated API problems for the new code. If `FORCE_DIFF_TOOL` is reported, drop the line and note it in README (spec fallback).
- [ ] **Step 6: Manual check** in `./gradlew runIde` on a repository with a renamed `.bpmn` file and a side branch: menu → popup lists the right commits with author/subject; click → BPMN diff of that commit centred on the element; Cancel during "Reading history" stops it; the IDE stays responsive.
- [ ] **Step 7:** Commit `Show the commits that changed an element and open their diff`.

---

## Task 6: Documentation

- [ ] README: a bullet **Element history** under the feature list (right-click → commits with author, date, message and what changed; click → BPMN diff of that commit; first parent, 300 commits, same notion of change as the view); `history.js` and `ElementHistory` in *Structure*.
- [ ] CHANGELOG `[Unreleased]` → `### Added` entry in the same voice as the existing ones.
- [ ] `plugin.xml` description: one bullet.
- [ ] `./gradlew check` → `BUILD SUCCESSFUL`; commit `Document the element history`.
