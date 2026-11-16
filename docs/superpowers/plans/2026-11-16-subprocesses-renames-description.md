# Collapsed subprocesses, renamed files, Marketplace description – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make changes inside collapsed subprocesses findable and navigable, keep the revision chooser and the revision content working after a `.bpmn` file was renamed or moved, and bring the Marketplace description up to date with what the plugin does.

**Architecture:** Three independent parts, one commit series each, all in one branch and one PR.
(1) The web view learns about bpmn-js *planes*: a pure module `planes.js` counts the changes hidden inside each collapsed subprocess; `main.js` uses it for a count badge, switches planes before centring a change, keeps both panes on the same plane while synchronized, and keeps the plane across a re-render.
(2) `GitRevisions` adds `--follow` to the file history and, when the file is missing under its current path in a revision, retries with the earlier paths from `git log --follow --name-only`; the parsing of those paths goes into `GitLogParser` so it is unit-tested.
(3) `plugin.xml` `<description>` is rewritten.

**Tech Stack:** Java 21, IntelliJ Platform 2026.2, Git4Idea; bpmn-js 18.31 (`NavigatedViewer` includes the drill-down module), diagram-js `Canvas` (`findRoot`, `getRootElement`, `setRootElement`, event `root.set`); JUnit 6; `node:test` with `bpmn-moddle` + `bpmn-js-differ`.

**Verified facts** (checked in `webview/node_modules` and with a probe run, 2026-11-16):
- A collapsed subprocess `Sub_1` is drawn as a shape `Sub_1` on its parent plane; its content lives on a separate root element with id `Sub_1_plane` whose `businessObject` is the same `bpmn:SubProcess` (`bpmn-js/lib/util/DrilldownUtil.js`, `planeSuffix = '_plane'`).
- Root elements are in the `elementRegistry`; `canvas.findRoot(element)` returns the root an element is drawn on; `canvas.setRootElement(root)` is a no-op for the current root and otherwise fires `root.set`.
- `DrilldownCentering` listens to `root.set` and scrolls the viewbox to the position remembered for that plane, so any viewbox we set *after* `setRootElement` wins.
- `bpmn-js-differ` reports an element inside a collapsed subprocess like any other: renaming `Inner_1` inside collapsed `Sub_1` gives `_changed: { Inner_1 }`. So the change is in the list – the bug is only that it cannot be seen or reached.
- `collectFlowElements` already skips root elements (they have no `parent`), so planes never show up as changes.

---

## File Structure

| File | Change |
|---|---|
| `webview/src/planes.js` | **New.** `hiddenChangeCounts(ids, rootOf, shapeOfRoot)` – pure, no DOM. |
| `webview/test/planes.test.js` | **New.** Unit tests of `hiddenChangeCounts`. |
| `webview/test/differ.test.js` | One more test: the real differ reports an element inside a collapsed subprocess. |
| `webview/src/main.js` | Plane helpers, count badges, plane switch in `focusElement`, plane sync, plane kept across re-render, ghost cursor hidden across planes. |
| `webview/src/styles.css` | `.diff-badge.nested` colour. |
| `src/main/java/com/github/bpmncompare/GitLogParser.java` | `historicalPaths(lines, currentPath)`. |
| `src/test/java/com/github/bpmncompare/GitLogParserTest.java` | Tests of `historicalPaths`. |
| `src/main/java/com/github/bpmncompare/GitRevisions.java` | `--follow` in `fileHistory`; `content` falls back to earlier paths and returns `RevisionContent`. |
| `src/main/java/com/github/bpmncompare/BpmnContentSource.java` | `Revision.load` uses `RevisionContent`, label says which earlier name was used. |
| `src/main/resources/META-INF/plugin.xml` | New `<description>`. |
| `README.md`, `CHANGELOG.md` | Document the behaviour; `[Unreleased]` entries. |

---

## Task 0: Branch

- [ ] **Step 1: Create the branch from an up-to-date `main`**

```bash
git checkout main && git pull --ff-only
git checkout -b subprocesses-renames-description
```

- [ ] **Step 2: Check that the baseline is green**

Run: `./gradlew check`
Expected: `BUILD SUCCESSFUL` (Java tests and `testWebview` both run as part of `check`).

---

## Part 1 – Collapsed subprocesses

### Task 1: Pin down that the differ sees inside collapsed subprocesses

**Files:**
- Modify: `webview/test/differ.test.js` (append at the end)

This is a guard, not new behaviour: if a future differ stopped reporting nested elements, the whole plane handling below would silently become dead code.

- [ ] **Step 1: Add the test**

Append to `webview/test/differ.test.js`:

```js
function collapsedSubprocess(innerName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1">
    <bpmn:subProcess id="Sub_1">
      <bpmn:task id="Inner_1" name="${innerName}" />
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Sub_1_di" bpmnElement="Sub_1" isExpanded="false">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diagram_2">
    <bpmndi:BPMNPlane id="Plane_2" bpmnElement="Sub_1">
      <bpmndi:BPMNShape id="Inner_1_di" bpmnElement="Inner_1">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

test('an element inside a collapsed subprocess is reported like any other', async () => {
  const moddle = new BpmnModdle();
  const { rootElement: revision } = await moddle.fromXML(collapsedSubprocess('Old'));
  const { rootElement: current } = await moddle.fromXML(collapsedSubprocess('New'));

  const changes = toChangeList(diff(revision, current));

  assert.deepEqual(changes.map((change) => change.id), [ 'Inner_1' ]);
  assert.deepEqual(changes[0].attrs.name, { oldValue: 'Old', newValue: 'New' });
});
```

- [ ] **Step 2: Run it**

Run: `cd webview && npm test`
Expected: all tests pass, including `an element inside a collapsed subprocess is reported like any other` (verified with a probe – it pins existing behaviour, so it passes immediately).

- [ ] **Step 3: Commit**

```bash
git add webview/test/differ.test.js
git commit -m "Test that the differ reports elements inside collapsed subprocesses"
```

### Task 2: `hiddenChangeCounts` – pure counting of changes per collapsed subprocess

**Files:**
- Create: `webview/src/planes.js`
- Test: `webview/test/planes.test.js`

The function gets the lookups as callbacks so it needs no viewer: `main.js` backs them with a pane's `elementRegistry` and `canvas`, the test with plain maps.

- [ ] **Step 1: Write the failing tests**

Create `webview/test/planes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hiddenChangeCounts } from '../src/planes.js';

/*
 * Process_1 (top-level plane)
 *   Task_1
 *   Sub_A (collapsed)  -> plane Sub_A_plane
 *     Inner_1
 *     Sub_B (collapsed) -> plane Sub_B_plane
 *       Deep_1
 *       Deep_2
 */
const ROOT_OF = new Map([
  [ 'Task_1', 'Process_1' ],
  [ 'Sub_A', 'Process_1' ],
  [ 'Inner_1', 'Sub_A_plane' ],
  [ 'Sub_B', 'Sub_A_plane' ],
  [ 'Deep_1', 'Sub_B_plane' ],
  [ 'Deep_2', 'Sub_B_plane' ]
]);
const SHAPE_OF_ROOT = new Map([ [ 'Sub_A_plane', 'Sub_A' ], [ 'Sub_B_plane', 'Sub_B' ] ]);

const rootOf = (id) => ROOT_OF.get(id);
const shapeOfRoot = (id) => SHAPE_OF_ROOT.get(id);

test('changes on the top-level plane are not hidden anywhere', () => {
  assert.deepEqual(hiddenChangeCounts([ 'Task_1', 'Sub_A' ], rootOf, shapeOfRoot), new Map());
});

test('a change inside a collapsed subprocess is counted on that subprocess', () => {
  assert.deepEqual(hiddenChangeCounts([ 'Inner_1' ], rootOf, shapeOfRoot), new Map([ [ 'Sub_A', 1 ] ]));
});

test('a nested change is counted on every enclosing collapsed subprocess', () => {
  assert.deepEqual(
    hiddenChangeCounts([ 'Deep_1', 'Deep_2', 'Inner_1' ], rootOf, shapeOfRoot),
    new Map([ [ 'Sub_B', 2 ], [ 'Sub_A', 3 ] ]));
});

test('an id the pane does not know is ignored', () => {
  assert.deepEqual(hiddenChangeCounts([ 'Gone_1' ], rootOf, shapeOfRoot), new Map());
});

test('a cycle in the lookups cannot hang the view', () => {
  const loopRootOf = (id) => (id === 'X' ? 'X_plane' : 'X_plane');
  const loopShapeOfRoot = () => 'X';

  assert.deepEqual(hiddenChangeCounts([ 'X' ], loopRootOf, loopShapeOfRoot), new Map([ [ 'X', 1 ] ]));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd webview && npm test`
Expected: FAIL – `Cannot find module '…/webview/src/planes.js'`.

- [ ] **Step 3: Implement**

Create `webview/src/planes.js`:

```js
/*
 * Planes of a diagram, the part of bpmn-js that hides changes.
 *
 * bpmn-js draws the content of a collapsed subprocess on a plane of its own, reached through the
 * drill-down button on the subprocess shape. A change on such a plane is in the change list, but
 * the diagram the user looks at shows nothing - so the shape that leads to it gets a count.
 */

/**
 * How many of the changes `ids` each collapsed subprocess hides, nested levels included: a change
 * two levels deep is counted on both subprocesses on the way to it.
 *
 * @param {string[]} ids changes drawn on one pane
 * @param {(id: string) => string | undefined} rootOf id of the plane an element is drawn on
 * @param {(rootId: string) => string | undefined} shapeOfRoot id of the collapsed subprocess shape
 *   that opens a plane; undefined for a top-level plane (process or collaboration)
 * @returns {Map<string, number>} collapsed subprocess shape id -> number of changes inside
 */
export function hiddenChangeCounts(ids, rootOf, shapeOfRoot) {
  const counts = new Map();

  for (const id of ids) {
    const visited = new Set();
    let root = rootOf(id);

    while (root !== undefined && !visited.has(root)) {
      visited.add(root);

      const shape = shapeOfRoot(root);

      if (shape === undefined) {
        break;
      }

      counts.set(shape, (counts.get(shape) || 0) + 1);
      root = rootOf(shape);
    }
  }

  return counts;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd webview && npm test`
Expected: PASS, all `planes.test.js` tests included.

- [ ] **Step 5: Commit**

```bash
git add webview/src/planes.js webview/test/planes.test.js
git commit -m "Count the changes hidden inside collapsed subprocesses"
```

### Task 3: Count badge on collapsed subprocesses

**Files:**
- Modify: `webview/src/main.js` (imports at the top; `decorate` around line 382; new helpers after `addBadge`)
- Modify: `webview/src/styles.css` (after `.diff-badge.layout` around line 269)

- [ ] **Step 1: Import the module**

In `webview/src/main.js`, after `import { describeAttrs, displayName, typeName } from './format.js';` add:

```js
import { hiddenChangeCounts } from './planes.js';
```

- [ ] **Step 2: Add the plane helpers**

Insert directly after the `addBadge` function (before `/** Top-right corner for shapes, middle of the path for connections. */`):

```js
// ---------------------------------------------------------------------------
// planes (collapsed subprocesses)
// ---------------------------------------------------------------------------

/** Id of the plane an element is drawn on, or undefined if the pane does not have it. */
function rootIdOf(pane, id) {
  const element = pane.viewer.get('elementRegistry').get(id);
  const root = element && canvasOf(pane).findRoot(element);

  return root ? root.id : undefined;
}

/**
 * Id of the collapsed subprocess shape that opens a plane, or undefined for a top-level plane.
 *
 * The plane of subprocess `Sub_1` is the root `Sub_1_plane` sharing its business object, so the
 * shape is the registry entry under the business object's id - for a process plane that entry is
 * the root itself.
 */
function shapeIdOfRoot(pane, rootId) {
  const registry = pane.viewer.get('elementRegistry');
  const root = registry.get(rootId);
  const shape = root && root.businessObject && registry.get(root.businessObject.id);

  return shape && shape !== root ? shape.id : undefined;
}

/** Switches the pane to the plane the element is drawn on; nothing happens if it is already shown. */
function showPlaneOf(pane, element) {
  const canvas = canvasOf(pane);
  const root = canvas.findRoot(element);

  if (root) {
    canvas.setRootElement(root);
  }
}

/** A count on each collapsed subprocess that hides visible changes of this pane. */
function addHiddenChangeBadges(pane, changeList) {
  if (!pane.loaded) {
    return;
  }

  const ids = changeList
    .filter((change) => {
      const kind = visibleKind(change);

      return kind && sidesFor(kind).includes(pane.side);
    })
    .map((change) => change.id);

  const counts = hiddenChangeCounts(ids, (id) => rootIdOf(pane, id), (rootId) => shapeIdOfRoot(pane, rootId));

  for (const [ shapeId, count ] of counts) {
    const badge = document.createElement('span');
    badge.className = 'diff-badge nested';
    badge.textContent = String(count);
    setTip(badge, (count === 1 ? '1 change' : count + ' changes') + ' inside this subprocess'
      + '\n\nOpen it with the drill-down button, or step to it with F7.');

    try {
      // bottom right: the top right carries the subprocess's own badge, the bottom left the drill-down button
      pane.viewer.get('overlays').add(shapeId, 'diff', { position: { bottom: 10, right: 8 }, html: badge });
    } catch (err) {

      // the shape cannot carry an overlay
    }
  }
}
```

- [ ] **Step 3: Call it from `decorate`**

At the end of `decorate(changeList)`, after the closing brace of the `for (const change of changeList)` loop and before the function's closing brace, add:

```js
  for (const pane of Object.values(panes)) {
    addHiddenChangeBadges(pane, changeList);
  }
```

`clearDecorations` already removes every overlay of type `'diff'`, so the count badges go away with the others on each re-render and filter change.

- [ ] **Step 4: Style the badge**

In `webview/src/styles.css`, after `.diff-badge.layout { background: var(--layout); }` add:

```css
/* count of changes hidden inside a collapsed subprocess: neutral, the kinds are on the plane itself */
.diff-badge.nested { background: var(--fg); color: var(--bg); box-shadow: 0 0 0 1.5px var(--bg); }
```

- [ ] **Step 5: Build and run the tests**

Run: `./gradlew check`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add webview/src/main.js webview/src/styles.css
git commit -m "Show how many changes a collapsed subprocess hides"
```

### Task 4: Switch planes when stepping to a change

**Files:**
- Modify: `webview/src/main.js` – `focusElement` (around line 602)

- [ ] **Step 1: Switch planes before centring**

In `focusElement`, replace

```js
  // with sync on, centering one side is enough - the other follows
  const toCenter = syncEnabled ? targets.slice(0, 1) : targets;
```

with

```js
  // a change inside a collapsed subprocess is drawn on the subprocess's own plane - show that one
  // first, or centring scrolls to coordinates of a plane nobody sees
  for (const pane of targets) {
    showPlaneOf(pane, pane.viewer.get('elementRegistry').get(id));
  }

  // with sync on, centering one side is enough - the other follows
  const toCenter = syncEnabled ? targets.slice(0, 1) : targets;
```

Order matters: `setRootElement` triggers `DrilldownCentering`, which scrolls to the plane's remembered position; `centerOn` runs afterwards and wins.

- [ ] **Step 2: Build and run the tests**

Run: `./gradlew check`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add webview/src/main.js
git commit -m "Open the subprocess plane when stepping to a change inside it"
```

### Task 5: Keep both panes on the same plane while synchronized

**Files:**
- Modify: `webview/src/main.js` – `createPane` (around line 54), `mirrorCursor` (around line 769), `setSync` (around line 823), new `syncPlane` next to `copyViewbox`

- [ ] **Step 1: Listen for plane changes**

In `createPane`, after `eventBus.on('canvas.viewbox.changed', () => updateZoomControls());` add:

```js
  // drilling into a collapsed subprocess (or back out through the breadcrumbs) on one side
  eventBus.on('root.set', (event) => {
    if (syncEnabled && !applyingSync) {
      syncPlane(side, event.element.id);
    }
  });
```

- [ ] **Step 2: Add `syncPlane`**

Insert directly after the `copyViewbox` function:

```js
/**
 * Shows the plane `rootId` on the other side too. A subprocess that exists on one side only leaves
 * the other side where it is - there is nothing to show.
 *
 * The viewbox follows by itself: the plane switch scrolls the source pane, which schedules the
 * usual viewbox sync for the next frame.
 */
function syncPlane(fromSide, rootId) {
  const toPane = panes[other(fromSide)];

  if (!toPane.loaded) {
    return;
  }

  const root = toPane.viewer.get('elementRegistry').get(rootId);

  if (!root) {
    return;
  }

  const wasApplying = applyingSync;

  applyingSync = true;

  try {
    canvasOf(toPane).setRootElement(root);
  } finally {
    applyingSync = wasApplying;
  }
}
```

- [ ] **Step 3: Hide the ghost cursor across different planes**

In `mirrorCursor`, replace

```js
  if (!fromPane.loaded || !toPane.loaded) {
    hideGhost(toPane);
    return;
  }
```

with

```js
  // on different planes the same coordinates mean unrelated places
  if (!fromPane.loaded || !toPane.loaded
      || canvasOf(fromPane).getRootElement().id !== canvasOf(toPane).getRootElement().id) {
    hideGhost(toPane);
    return;
  }
```

- [ ] **Step 4: Align planes when sync is switched on**

In `setSync`, replace

```js
  if (syncEnabled) {
    copyViewbox(panes.left, panes.right);
  } else {
```

with

```js
  if (syncEnabled) {
    if (panes.left.loaded) {
      syncPlane('left', canvasOf(panes.left).getRootElement().id);
    }

    copyViewbox(panes.left, panes.right);
  } else {
```

- [ ] **Step 5: Build and run the tests**

Run: `./gradlew check`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add webview/src/main.js
git commit -m "Keep both diagrams on the same subprocess plane while synchronized"
```

### Task 6: Stay on the plane across a re-render

Typing in the XML editor re-renders the left side with `preserveView`; `importXML` resets to the top-level plane, so today the user is thrown out of the subprocess on every keystroke pause.

**Files:**
- Modify: `webview/src/main.js` – `render` (around line 257), `restoreOrFit` (around line 318)

- [ ] **Step 1: Remember the plane with the viewbox**

In `render`, replace

```js
  const previousView = payload.preserveView ? {
    left: panes.left.loaded ? { ...canvasOf(panes.left).viewbox() } : null,
    right: panes.right.loaded ? { ...canvasOf(panes.right).viewbox() } : null
  } : null;
```

with

```js
  const previousView = payload.preserveView ? {
    left: panes.left.loaded ? viewOf(panes.left) : null,
    right: panes.right.loaded ? viewOf(panes.right) : null
  } : null;
```

and add right before `function restoreOrFit(previousView) {`:

```js
/** Viewbox plus the plane it belongs to, to come back to after a re-render. */
function viewOf(pane) {
  const canvas = canvasOf(pane);

  return { ...canvas.viewbox(), rootId: canvas.getRootElement().id };
}
```

- [ ] **Step 2: Restore the plane before the viewbox**

In `restoreOrFit`, replace

```js
    if (view) {
      canvas.viewbox({ x: view.x, y: view.y, width: view.width, height: view.height });
```

with

```js
    if (view) {
      // the subprocess may have been deleted meanwhile - then the top-level plane stays
      const root = view.rootId && pane.viewer.get('elementRegistry').get(view.rootId);

      if (root) {
        canvas.setRootElement(root);
      }

      canvas.viewbox({ x: view.x, y: view.y, width: view.width, height: view.height });
```

`render` holds `applyingSync = true` for its whole run, so this does not trigger `syncPlane`.

- [ ] **Step 3: Build and run the tests**

Run: `./gradlew check`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add webview/src/main.js
git commit -m "Stay inside a subprocess when the diagram re-renders"
```

### Task 7: Manual check in the sandbox IDE and docs

The DOM glue has no automated tests (the web view tests are DOM-free by design), so this task is the verification of Tasks 3–6.

**Files:**
- Modify: `README.md` (feature list), `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Prepare a sample**

Run: `./gradlew runIde`. In the sandbox IDE create a Git project with `order.bpmn` holding the XML of `collapsedSubprocess('Old')` from Task 1 (replace `${innerName}` with `Old`), plus a second task `Deep_1` in a nested collapsed subprocess if you want to check nesting. Commit it. Then rename `Inner_1` to `New` in the editor without committing.

- [ ] **Step 2: Check each behaviour**

Open the **BPMN Diff** tab and confirm:
1. `Sub_1` carries a neutral badge `1` at the bottom right; its tooltip says `1 change inside this subprocess`.
2. F7 (or clicking `Inner_1` in the change list) switches both panes into `Sub_1` and centres `Inner_1`, highlighted orange on both sides.
3. With *Synchronize mouse & view* on, the breadcrumb back to `Process_1` on the left takes the right side back too; drilling in via the drill-down button on the right takes the left side in.
4. While inside `Sub_1`, type in the XML editor (e.g. change the name again): after the re-render you are still inside `Sub_1` at the same position.
5. Switch sync off, drill in on the left only: the blue ghost cursor does not appear on the right.
6. Hiding *Changed* with its chip removes the `1` badge.

If any check fails, fix it in the task it belongs to (re-run `./gradlew check`, amend nothing – add a fix commit).

- [ ] **Step 3: Document**

In `README.md`, after the bullet that starts with `- **Camunda / Zeebe extensions**`, add:

```markdown
- **Collapsed subprocesses** – a badge on a collapsed subprocess counts the changes inside it. Stepping to
  such a change opens the subprocess, and while synchronized both diagrams drill in and out together.
  The SVG/PNG export contains the level of the diagram currently shown.
```

In `CHANGELOG.md`, under `## [Unreleased]`, add:

```markdown
### Fixed
- Changes inside collapsed subprocesses can be found. A collapsed subprocess shows how many changes it hides, F7 and the change list open the subprocess and centre the element instead of scrolling the top-level diagram to an empty spot, both diagrams drill in and out together while synchronized, and editing the XML no longer throws you out of the subprocess you are looking at.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "Document the collapsed subprocess handling"
```

---

## Part 2 – Renamed and moved files

### Task 8: Parse the earlier paths of a file

**Files:**
- Modify: `src/main/java/com/github/bpmncompare/GitLogParser.java`
- Test: `src/test/java/com/github/bpmncompare/GitLogParserTest.java`

Input is the output of `git log --follow --name-only --format= -z -- <path>`: one path per commit, newest first, NUL-separated. `-z` matters: without it git quotes non-ASCII names (`"procesy/schv\303\241len\303\255.bpmn"`), which would never match a real path. `GitLineHandler` splits on newlines only, so NULs arrive inside lines; the parser splits on both.

- [ ] **Step 1: Write the failing tests**

Add to `GitLogParserTest` (it already imports `List`, `assertEquals`):

```java
    @Test
    void historicalPathsAreTheEarlierNamesNewestFirst() {
        List<String> output = List.of("diagrams/order.bpmn\0\0diagrams/order.bpmn\0\0old/order-process.bpmn\0\0order.bpmn\0");

        assertEquals(List.of("old/order-process.bpmn", "order.bpmn"),
                GitLogParser.historicalPaths(output, "diagrams/order.bpmn"));
    }

    @Test
    void historicalPathsAcceptNewlineSeparatedOutputToo() {
        assertEquals(List.of("old.bpmn"),
                GitLogParser.historicalPaths(List.of("new.bpmn", "", "old.bpmn", "old.bpmn"), "new.bpmn"));
    }

    @Test
    void historicalPathsKeepNonAsciiNamesAsTheyAre() {
        assertEquals(List.of("procesy/schválení.bpmn"),
                GitLogParser.historicalPaths(List.of("procesy/schválení-v2.bpmn\0procesy/schválení.bpmn\0"),
                        "procesy/schválení-v2.bpmn"));
    }

    @Test
    void historicalPathsOfANeverRenamedFileAreEmpty() {
        assertEquals(List.of(), GitLogParser.historicalPaths(List.of("a.bpmn\0a.bpmn\0"), "a.bpmn"));
        assertEquals(List.of(), GitLogParser.historicalPaths(List.of(), "a.bpmn"));
    }
```

- [ ] **Step 2: Run them to see them fail**

Run: `./gradlew test --tests "com.github.bpmncompare.GitLogParserTest"`
Expected: compilation FAIL – `cannot find symbol … historicalPaths`.

- [ ] **Step 3: Implement**

In `GitLogParser.java`, add `import java.util.LinkedHashSet;` next to the other imports, and add this method after `parse`:

```java
    /**
     * Paths a file had before, newest first, without the current one.
     *
     * @param lines output of {@code git log --follow --name-only --format= -z -- <path>}; NUL- or
     *              newline-separated, blank entries are skipped
     */
    static List<String> historicalPaths(List<String> lines, String currentPath) {
        LinkedHashSet<String> paths = new LinkedHashSet<>();
        for (String line : lines) {
            for (String path : line.split("[\\x00\\n]")) {
                if (!path.isBlank() && !path.equals(currentPath)) {
                    paths.add(path);
                }
            }
        }
        return List.copyOf(paths);
    }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `./gradlew test --tests "com.github.bpmncompare.GitLogParserTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/github/bpmncompare/GitLogParser.java src/test/java/com/github/bpmncompare/GitLogParserTest.java
git commit -m "Parse the earlier paths of a renamed file from git log"
```

### Task 9: Follow renames in the history and when reading a revision

**Files:**
- Modify: `src/main/java/com/github/bpmncompare/GitRevisions.java` – `fileHistory` (line 74), `content` (line 100), new `read`, `historicalPaths`, `RevisionContent`
- Modify: `src/main/java/com/github/bpmncompare/BpmnContentSource.java` – `Revision.load` (line 92)

No automated test: `GitRevisions` runs Git through the IntelliJ platform, which the plain JUnit setup does not start. Task 10 checks it by hand.

- [ ] **Step 1: `--follow` in the chooser's commit list**

In `fileHistory`, replace

```java
        handler.addParameters("--max-count=" + MAX_COMMITS, "--date=short", GitLogParser.FORMAT);
```

with

```java
        // --follow: commits from before a rename or move are listed too
        handler.addParameters("--follow", "--max-count=" + MAX_COMMITS, "--date=short", GitLogParser.FORMAT);
```

- [ ] **Step 2: Replace `content` with a rename-aware version**

Replace the whole `content` method (Javadoc included) with:

```java
    /**
     * Content of {@code file} at {@code revision}.
     *
     * <p>If the file is not at its current path in that revision, the paths it had before - from the
     * history of the current branch - are tried, so a renamed or moved diagram is still compared
     * with its own past instead of being shown as entirely new.
     *
     * @throws MissingInRevisionException if the file exists in that revision under none of its names
     */
    static RevisionContent content(Project project, GitRepository repository, VirtualFile file, String revision) throws VcsException {
        String relativePath = VfsUtilCore.getRelativePath(file, repository.getRoot(), '/');
        if (relativePath == null) {
            throw new VcsException("File is outside of the repository root " + repository.getRoot().getPresentableUrl());
        }
        if (shortHash(project, repository, revision) == null) {
            throw new VcsException("Unknown revision '" + revision + "'");
        }
        try {
            return new RevisionContent(read(project, repository, revision, relativePath), null);
        } catch (MissingInRevisionException missing) {
            for (String path : historicalPaths(project, repository, file, relativePath)) {
                try {
                    return new RevisionContent(read(project, repository, revision, path), path);
                } catch (MissingInRevisionException notUnderThisName) {
                    // try the next older name
                }
            }
            throw missing;
        }
    }

    private static String read(Project project, GitRepository repository, String revision, String path) throws VcsException {
        try {
            byte[] bytes = GitFileUtils.getFileContent(project, repository.getRoot(), revision, path);
            return stripBom(new String(bytes, StandardCharsets.UTF_8));
        } catch (VcsException e) {
            String message = String.valueOf(e.getMessage());
            if (message.contains("does not exist") || message.contains("exists on disk, but not in")) {
                throw new MissingInRevisionException(path, revision);
            }
            throw e;
        }
    }

    /** Earlier paths of the file, newest first; empty when it was never renamed or git fails. */
    private static List<String> historicalPaths(Project project, GitRepository repository, VirtualFile file, String currentPath) {
        GitLineHandler handler = new GitLineHandler(project, repository.getRoot(), GitCommand.LOG);
        handler.setSilent(true);
        // -z: no quoting of non-ASCII names, see GitLogParser#historicalPaths
        handler.addParameters("--follow", "--name-only", "--format=", "-z");
        handler.endOptions();
        handler.addRelativeFiles(List.of(file));
        GitCommandResult result = Git.getInstance().runCommand(handler);
        return result.success() ? GitLogParser.historicalPaths(result.getOutput(), currentPath) : List.of();
    }

    /**
     * @param xml         the file's content
     * @param earlierPath the repository-relative path it was read from, when that is not the current one
     */
    record RevisionContent(String xml, @Nullable String earlierPath) {
    }
```

The earlier paths are only looked up when the current path is missing, so an ordinary comparison costs no extra Git call.

- [ ] **Step 3: Use it in `Revision.load`**

In `BpmnContentSource.java`, inside `Revision.load`, replace

```java
            try {
                return DiagramSide.xml(GitRevisions.content(project, repository, file, item.revision()), label);
            } catch (GitRevisions.MissingInRevisionException e) {
```

with

```java
            try {
                GitRevisions.RevisionContent content = GitRevisions.content(project, repository, file, item.revision());
                return DiagramSide.xml(content.xml(), content.earlierPath() == null
                        ? label
                        : label + " · as " + content.earlierPath());
            } catch (GitRevisions.MissingInRevisionException e) {
```

- [ ] **Step 4: Build, test, verify**

Run: `./gradlew check verifyPlugin`
Expected: `BUILD SUCCESSFUL`, the Plugin Verifier reports `Compatible`.

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/github/bpmncompare/GitRevisions.java src/main/java/com/github/bpmncompare/BpmnContentSource.java
git commit -m "Compare a renamed BPMN file with its history under the earlier name"
```

### Task 10: Manual check and docs for renames

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Check in the sandbox IDE**

In the `runIde` sandbox project from Task 7:
1. Commit a change to `order.bpmn` (commit A).
2. Rename it with *Refactor › Rename* to `process/order-v2.bpmn` (a move plus a rename) and commit (commit B).
3. Open the **BPMN Diff** tab of `process/order-v2.bpmn`, open the revision chooser: commits A and B and the original commit are all under *Commits Changing This File*.
4. Pick commit A: the right side shows the diagram, its label ends with `· as order.bpmn`, and only real differences are highlighted (not everything as added).
5. Pick `HEAD`: label without `· as …`.
6. Repeat 2–4 once with a non-ASCII name (`schválení.bpmn` → `schválení-v2.bpmn`).
7. Create a brand-new, uncommitted `new.bpmn`: the right side still says the file does not exist in `HEAD`.

- [ ] **Step 2: Document**

In `README.md`, extend the bullet that starts with `- **Right:**` so it reads:

```markdown
- **Right:** the same file from a chosen branch (local/remote), tag, commit that changed the file,
  or any revision expression (`HEAD~3`, a hash, …). A renamed or moved file is followed to its earlier
  names, both in the list of commits and when reading an older revision.
```

In `CHANGELOG.md`, under `## [Unreleased]` → `### Fixed`, add:

```markdown
- A renamed or moved diagram keeps its history. The revision chooser lists the commits from before the rename, and an older revision is read under the name the file had then, instead of the file being reported as missing and every element as added. The label of such a revision says which name was used.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "Document that renamed files are followed"
```

---

## Part 3 – Marketplace description

### Task 11: Rewrite `<description>`

**Files:**
- Modify: `src/main/resources/META-INF/plugin.xml` (the `<description>` element)

- [ ] **Step 1: Replace the description**

Replace the whole `<description><![CDATA[ … ]]></description>` element with:

```xml
    <description><![CDATA[
    Visual comparison of BPMN 2.0 diagrams with any Git revision, powered by
    <a href="https://bpmn.io">bpmn.io</a> (bpmn-js and bpmn-js-differ).
    <ul>
      <li><b>Side by side</b> – the current diagram, unsaved edits included, next to a branch, tag, commit or any
          revision expression such as <code>HEAD~3</code>. Renamed and moved files are followed.</li>
      <li><b>In every IDE diff</b> – pick <b>BPMN diagram</b> in the diff tool selector of the commit dialog, the Git log,
          <i>Compare with Branch</i> or <i>Compare Two Files</i>; also the way to compare two revisions with each other.</li>
      <li><b>Highlighting</b> of added, removed, changed and moved elements, with filter chips, a change list and
          badges listing the changed attributes. Collapsed subprocesses show how many changes they hide.</li>
      <li><b>Camunda and Zeebe extensions</b> are compared too – execution listeners, input/output mappings,
          form fields, task definitions – which bpmn-js-differ alone does not see.</li>
      <li><b>Navigation</b> – F7 / Shift+F7 step through the changes; double-click an element to open it in the XML,
          and <i>Follow caret</i> selects the element you are editing.</li>
      <li><b>Export</b> – the change list as Markdown for a pull request, or the diagram with its markers as SVG or PNG.</li>
      <li><b>Synchronized</b> cursor, hover, pan and zoom between both diagrams.</li>
    </ul>
    Open a <code>.bpmn</code> file and switch to the <b>BPMN Diff</b> tab, or use
    <b>Compare BPMN with Branch or Commit…</b> from the context menu.
    <p>
    The plugin is open source under the MIT license.
    Diagram rendering and diffing uses <a href="https://github.com/bpmn-io/bpmn-js">bpmn-js</a>
    (© Camunda Services GmbH, <a href="https://github.com/bpmn-io/bpmn-js/blob/develop/LICENSE">bpmn.io license</a>)
    and <a href="https://github.com/bpmn-io/bpmn-js-differ">bpmn-js-differ</a> (MIT). Copyright and license notices
    of all bundled third-party packages are included in <code>THIRD-PARTY-NOTICES.txt</code> of the plugin distribution.
    </p>
    ]]></description>
```

The license paragraph is unchanged on purpose – it carries the third-party attribution.

- [ ] **Step 2: Verify the plugin configuration**

Run: `./gradlew verifyPluginProjectConfiguration buildPlugin`
Expected: `BUILD SUCCESSFUL` with no warning about the description (the Marketplace requires at least 40 Latin characters and no `TODO`/placeholder text).

- [ ] **Step 3: Look at it**

Run: `./gradlew runIde`, open *Settings › Plugins › Installed › BPMN Compare*: the description renders as a list, links are clickable, no raw HTML is visible.

- [ ] **Step 4: Commit**

```bash
git add src/main/resources/META-INF/plugin.xml
git commit -m "Describe all current features on the Marketplace page"
```

---

## Task 12: Finish

- [ ] **Step 1: Full verification**

Run: `./gradlew check verifyPlugin buildPlugin`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: Open the PR**

```bash
git push -u origin subprocesses-renames-description
gh pr create --title "Collapsed subprocesses, renamed files, Marketplace description" --body-file -
```

The body summarises the three parts and the manual checks from Tasks 7, 10 and 11, and ends with the attribution line. Releasing (moving `[Unreleased]` under a version, bumping `pluginVersion`, tagging) follows the *Releasing* section of the README and is not part of this plan.
