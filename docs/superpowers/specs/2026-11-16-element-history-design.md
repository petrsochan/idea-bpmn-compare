# Element history – design

## Intent
When a reviewer or modeller looks at a task in the BPMN view, the question is usually *who changed this, and why*.
Today the answer means scrolling `git log` of the whole file and guessing which commit touched the element.
The plugin should answer it for one element: the commits that changed it, with author, date and message,
and from each commit a click into the BPMN diff of that commit, centred on the element.

Priority (from the user): first **who and why** (author, date, commit message), then **jump to the diff**.

## Goals
- Right-click an element in either diagram → *History of "&lt;name&gt;"*.
- A list of the commits that changed that element, newest first: short hash, date, author, subject, and what
  happened to the element in that commit (added, removed, renamed `"Check stock" → "Verify availability"`,
  moved, …).
- Clicking a commit opens an IDE diff window: the file before that commit ↔ after it, in the BPMN view,
  centred on the element.
- "Changed" means exactly what the BPMN view calls a change: bpmn-js-differ, Camunda/Zeebe extensions, the
  5 px layout tolerance. A commit that only reformatted XML is not in the list; a commit that only moved
  the shape is.

## Non-goals
- Uncommitted changes – the BPMN Diff tab against HEAD already shows them.
- Following an element whose **id** changed – a new id is a new element (the differ sees it the same way).
- More than the file history the revision chooser already reads (300 commits, `--follow`).
- History from the XML editor's caret.

## Anti-goals
- A result that disagrees with the diff view (a commit listed whose diff shows nothing on the element, or
  the reverse). That is why line-based `git log -L` was rejected.
- Blocking the IDE while history is computed.

## Approaches (decided: A)
- **A – diff every pair of consecutive versions with the view's own differ (chosen).** The host reads all
  versions of the file in one `git cat-file --batch`, the page parses and diffs consecutive pairs with the
  same code the view uses. Exact and consistent with the view; costs seconds on long histories, so it runs
  with a progress indicator.
- B – `git log -L` over the element's XML lines. Fast, but blind to DI (shape/position lives elsewhere in the
  file) and to extension elements, fooled by reformatting, and cannot say *what* changed.
- (Rejected outright) parsing BPMN in Java – would duplicate the differ logic and drift from the view.

## Design

### Flow
1. **Page**: `element.contextmenu` on a pane opens a small page-drawn menu (the page draws its own UI anyway,
   see tooltips) with *History of "&lt;name&gt;"*. The native context menu is suppressed. Choosing it sends
   `{ command: 'elementHistory', id }` to the host. Labels resolve to their owner element; the process/plane
   root has no menu entry.
2. **Host** (`BpmnComparePanel`, background task "Reading history of &lt;file&gt;", cancellable):
   - `git log --follow --max-count=300 --raw --no-abbrev -z --format=<fields>` → per commit: hash, short
     hash, date, author, subject, and the **blob ids of the file before and after the commit** against its
     first parent (renames included). An all-zero id is an absent side (the commit created or deleted the
     file); a merge has no raw record and is left out.
   - `git cat-file --batch` (stdin via `GitBinaryHandler.setInputProcessor`) with the unique blob ids → every
     version once, in one process.
   - Each commit is compared with its **first parent**, never with the neighbouring entry of the log: in a
     history with branches the log interleaves commits of different branches by date, and diffing
     neighbours would attribute one branch's changes to the other. It is also exactly what the diff window
     opened by a click shows.
   - Sends `{ token, id, commits: [{ hash, before, after }] }` to the page via `bpmnCompare.computeHistory`
     in chunks of 10 commits, newest first, waiting for the page's answer to each chunk – one call with
     every version of a large diagram would be tens of MB of JavaScript.
3. **Page** (new pure module `history.js`): for each commit parses `before` and `after` with `bpmn-moddle`
   and runs `diff` → `dropMinorLayoutChanges` → `toChangeList` (with element maps built from the
   definitions, so extension elements are compared). An empty `before` makes every element of `after`
   added. Keeps the commits whose change list contains `id`, with the kinds and a one-line summary
   (`describeAttrs` / `displayName`). Parsing yields between commits (`await`), so the page stays
   responsive. Result → host `{ command: 'elementHistoryResult', id, entries }`.
4. **Host**: a popup like the revision chooser, title *History of "Check stock"*, one row per entry:
   `a1b2c3d  2026-11-02  Jan Novák  —  subject` plus the summary. Nothing found → a balloon
   "No change to this element in the last N commits of the file".
   A pane with no Git file behind it (e.g. *Compare Two Files* outside a repository) shows the menu entry
   disabled with the reason in its tooltip.
5. **Click** → `DiffManager.showDiff` with a `SimpleDiffRequest`: left = `before` (first parent), right =
   `after` (both `DocumentContent` with the `.bpmn` file as highlight file so `BpmnDiffTool.canShow`
   accepts them; an element added by the commit → `EmptyContent` on the left), titles `<short>^` / `<short>`,
   `DiffUserDataKeysEx.FORCE_DIFF_TOOL` = the BPMN tool, and a plugin key `FOCUS_ELEMENT` = id that
   `BpmnDiffViewer` hands to the panel, which calls `focusElement(id)` after the first render.

### Parts
| Part | What |
|---|---|
| `webview/src/history.js` (new) | `elementHistory(id, versions, parse)` – pure, tested with the real differ |
| `webview/src/main.js` | context menu, `computeHistory` entry point, result back to host |
| `webview/package.json` | `bpmn-moddle` moves to `dependencies` (already bundled through bpmn-js) |
| `GitLogParser` | format + parser for log entries with path; parser for `cat-file --batch` output |
| `GitRevisions` | `fileVersions(...)` – log + cat-file |
| `ElementHistory` (new, Java) | background task, popup, opening the diff |
| `BpmnDiffViewer` / `BpmnComparePanel` | `FOCUS_ELEMENT` support; `elementHistory` / `elementHistoryResult` commands |
| README, CHANGELOG, plugin.xml | document the feature |

### Tests
- `history.test.js`: commits as before/after pairs (create task, rename it, move another element) → exactly
  the commits that touched the task, with the right kinds; a nudge within 5 px is not a commit; an
  extension-only edit is; an empty `before` reports the task as added.
- `GitLogParserTest`: log entries with `--name-status`, incl. a rename (path before ≠ path after); `cat-file --batch` parsing incl. `missing`,
  multi-byte UTF-8 content and a content containing the header-like lines.

## Risks / left to the builder
- `DiffUserDataKeysEx` lives in the diff impl module. If the Plugin Verifier reports it as internal API,
  fall back to not forcing the tool (the IDE's remembered order applies) and say so in the README.
- Exact wording and layout of the popup rows; the context-menu styling (reuse the export menu's look).
- Whether to cache the last history per file+HEAD – only if it proves slow in practice.
