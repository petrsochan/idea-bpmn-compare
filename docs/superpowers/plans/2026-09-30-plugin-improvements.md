# BPMN Compare – plugin improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working prototype into a publishable plugin: visible in the IDE's own diff windows, aware of Camunda extension elements, navigable by keyboard and linked to the XML editor, with release metadata and a test safety net.

**Architecture:** The panel is generalized from "left = working copy, right = revision" into two independent *sides*, each fed by a `BpmnContentSource`. That single refactor unlocks branch↔branch comparison and lets the same panel be reused as a `FrameDiffTool.DiffViewer` inside the platform diff framework. In the web view, pure logic (change list building, value formatting, extension-element comparison, export) moves out of `main.js` into small ES modules so it can be unit-tested with `node:test` without a DOM.

**Tech Stack:** Java 21, IntelliJ Platform 2026.2 (build 262) with Gradle IntelliJ Platform plugin 2.19, Git4Idea, JCEF; bpmn-js 18 + bpmn-js-differ 3 bundled by esbuild; tests with JUnit 6 (Java) and `node:test` (web view).

**Decisions taken up front:**
- Compatibility stays at 2026.2+ (`sinceBuild=262`). No 2025.x back-support.
- DMN/CMMN support is out of scope for this plan.

**Verified platform facts** (checked against `IntelliJ IDEA 2026.1.3`, build `IU-262.9437.185`):
- `com.intellij.diff.FrameDiffTool` lives in `lib/intellij.platform.diff.jar`; EP name is `com.intellij.diff.DiffTool` (`DiffTool.EP_NAME`).
- `FrameDiffTool`: `DiffViewer createComponent(DiffContext, DiffRequest)`; `DiffTool`: `String getName()`, `boolean canShow(DiffContext, DiffRequest)`.
- `FrameDiffTool.DiffViewer extends Disposable`: `getComponent()`, `getPreferredFocusedComponent()`, `ToolbarComponents init()`, `dispose()`.
- `ContentDiffRequest`: `List<DiffContent> getContents()`, `List<String> getContentTitles()`. Content types include `DocumentContent`, `FileContent`, `EmptyContent`.

---

## File Structure

**New Java files** (`src/main/java/com/github/bpmncompare/`)

| File | Responsibility |
|---|---|
| `DiagramSide.java` | Immutable content of one pane (xml / label / error / message / missing) plus its JSON shape. Extracted from `BpmnComparePanel.RightSide`, now shared with the diff tool. |
| `BpmnContentSource.java` | Where a side's XML comes from: the live document (`Working`), a Git revision (`Revision`), or text handed over by the platform (`Fixed`). |
| `GitLogParser.java` | Pure parsing of `git log --pretty=format:…` output into `RevisionItem`s. Pulled out of `GitRevisions` so it is testable without Git. |
| `BpmnXmlLocator.java` | Maps a BPMN element `id` to a text offset in the XML and back. Plain string scanning — works for a Git revision's text too, and needs no read action. |
| `BpmnDiffTool.java` | `FrameDiffTool` on the `com.intellij.diff.DiffTool` EP; accepts two-content requests where at least one side is a BPMN file. |
| `BpmnDiffViewer.java` | `FrameDiffTool.DiffViewer` wrapping `BpmnComparePanel` for the diff window. |
| `GoToChangeAction.java` | `Next` / `Previous` change actions bound to F7 / Shift+F7. |

**Modified Java files**

| File | Change |
|---|---|
| `BpmnComparePanel.java` | Two `BpmnContentSource` sides instead of hardcoded working copy + revision; revision chooser only for a revision-backed side; Git repository change subscription; JCEF→IDE bridge for XML navigation and export; next/previous change. |
| `GitRevisions.java` | Delegates log parsing to `GitLogParser`. |
| `BpmnCompareEditor.java` | Passes the working-copy/HEAD source pair; exposes `panel()` for the actions. |
| `BpmnCompareSettings.java` | Adds the remembered "follow caret" flag. |
| `Json.java` | Adds a reader for the flat messages the web view sends. |
| `plugin.xml` | `intellij.platform.diff` module dependency, `diff.DiffTool` extension, the two change-navigation actions. |
| `build.gradle.kts` | `changeNotes` from `CHANGELOG.md`, `pluginVerification`, `testWebview` task, honest Java-release comment. |

**New web view modules** (`webview/src/`)

| File | Responsibility |
|---|---|
| `format.js` | `displayName`, `typeName`, `formatValue`, `describeAttrs`, `normalizeAttrs` — pure, no DOM. |
| `changes.js` | `toChangeList(diff, newElements, oldElements)` → flat change array. Pure. |
| `extensions.js` | `compareExtensions(oldElement, newElement)` for Camunda/Zeebe `extensionElements`. Pure. |
| `export.js` | `changesToMarkdown`, `paneToSvg`, `svgToPng`. |
| `main.js` | Stays the DOM/bpmn-js glue: panes, decorations, sync, filters, zoom, keyboard, export menu. |

**New test files**

| File | Covers |
|---|---|
| `src/test/java/com/github/bpmncompare/GitLogParserTest.java` | Log parsing incl. separators inside commit subjects, truncation, malformed lines. |
| `src/test/java/com/github/bpmncompare/BpmnXmlLocatorTest.java` | id → offset, offset → id, quoting variants, prefix and absence. |
| `src/test/java/com/github/bpmncompare/DiagramSideTest.java` | JSON shape of each side state. |
| `webview/test/format.test.js` | Value formatting and names. |
| `webview/test/changes.test.js` | Change list from a synthetic differ result, dedupe, extension merge. |
| `webview/test/extensions.test.js` | Camunda/Zeebe extension comparison. |
| `webview/test/export.test.js` | Markdown export. |

**Other new files**

- `src/main/resources/META-INF/pluginIcon.svg` + `pluginIcon_dark.svg` — 40×40, required by the Marketplace.
- `CHANGELOG.md` — Keep a Changelog format; its version sections feed `changeNotes`.

---

## Task 0: Start from a clean tree

**Files:** `webview/src/{index.html,main.js,styles.css}`, `gradle.properties`

The zoom controls and `pluginVersion=1.0.1` are already built into `idea-bpmn-compare-1.0.1.zip` but are not committed. Task 2 assumes a released 1.0.1 changelog section exists.

- [ ] **Step 1: Commit the zoom feature**

```bash
git add webview/src/index.html webview/src/main.js webview/src/styles.css
git commit -m "Add zoom controls to the compare view"
```

- [ ] **Step 2: Commit the version bump**

```bash
git add gradle.properties
git commit -m "Bump version to 1.0.1"
```

Leave `.idea/gradle.xml`, `.idea/AndroidProjectSystem.xml` and `.idea/vcs.xml` out of every commit — IDE-local noise.

---

## Phase 1 – Release hygiene (items 5, 6, 7, 8)

### Task 1: Plugin icon

**Files:**
- Create: `src/main/resources/META-INF/pluginIcon.svg`
- Create: `src/main/resources/META-INF/pluginIcon_dark.svg`

- [ ] **Step 1: Write the icon**

The Marketplace requires exactly `META-INF/pluginIcon.svg` with a 40×40 viewBox. Two BPMN-ish task boxes joined by an arrow: green (added) and red (removed), matching the plugin's own highlight palette so the icon says "BPMN diff" at a glance. The dark variant only lightens the connector stroke.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <rect x="2.5" y="6.5" width="14" height="10" rx="2.5" fill="none" stroke="#6C9E3F" stroke-width="2"/>
  <rect x="23.5" y="23.5" width="14" height="10" rx="2.5" fill="none" stroke="#C7614F" stroke-width="2"/>
  <path d="M16.5 11.5h7a3 3 0 0 1 3 3v6" fill="none" stroke="#7F8B91" stroke-width="2" stroke-linecap="round"/>
  <path d="M23.5 20.5l3 3 3-3" fill="none" stroke="#7F8B91" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

`pluginIcon_dark.svg` is the same with `#7F8B91` replaced by `#9DA6AB`.

- [ ] **Step 2: Verify the icon is picked up**

Run: `./gradlew verifyPluginStructure`
Expected: `BUILD SUCCESSFUL` with no "plugin icon" warning in the output. Record whether the warning appeared *before* this task, to prove the task did something.

- [ ] **Step 3: Commit**

```bash
git add src/main/resources/META-INF/pluginIcon.svg src/main/resources/META-INF/pluginIcon_dark.svg
git commit -m "Add plugin icon"
```

### Task 2: CHANGELOG and change notes

**Files:**
- Create: `CHANGELOG.md`
- Modify: `build.gradle.kts` (`pluginConfiguration` block + helper functions at the end)

- [ ] **Step 1: Write the changelog**

Keep a Changelog format, newest first, with an `[Unreleased]` section that later phases append to.

```markdown
# Changelog

All notable changes to the BPMN Compare plugin are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.1]

### Added
- Zoom controls in the toolbar (zoom in/out, 100 %, fit); with synchronization on, both diagrams zoom together.

## [1.0.0]

### Added
- Side-by-side comparison of a BPMN file with any Git revision — branch, tag, commit touching the file, or a revision expression.
- Highlighting of added, removed, changed and moved elements, with filter chips and a change list.
- Optional synchronization of mouse cursor, hover and pan/zoom between both diagrams.
```

- [ ] **Step 2: Feed the changelog into the descriptor**

`<change-notes>` is what the Marketplace shows as "What's new", and it is HTML. Read the section for the version being built so `CHANGELOG.md` stays the single source of truth. Add inside `pluginConfiguration`, next to the existing `version =`:

```kotlin
        // "What's new" on the Marketplace = the CHANGELOG.md section of the version being built
        changeNotes = providers.provider {
            val file = layout.projectDirectory.file("CHANGELOG.md").asFile
            val version = providers.gradleProperty("pluginVersion").get()
            val section = Regex("(?ms)^## \\[${Regex.escape(version)}]\\s*(.*?)(?=^## \\[|\\z)")
                .find(file.readText())?.groupValues?.get(1)?.trim()
                ?: error("CHANGELOG.md has no section for version $version")
            markdownToHtml(section)
        }
```

Add `markdownToHtml` as a top-level function at the end of `build.gradle.kts`, handling `### heading`, `- item` lists and `[text](url)` links, escaping `&<>` and closing an open `<ul>` at the end. Raw markdown would render as one blob in the plugin manager, so this conversion is not cosmetic.

- [ ] **Step 3: Verify the notes reach the built descriptor**

Run: `./gradlew patchPluginXml && grep -A3 change-notes build/patchedPluginXmlFiles/plugin.xml`
Expected: a `<change-notes>` element containing `<ul><li>Zoom controls`.

- [ ] **Step 4: Verify a missing section fails the build**

Run: `./gradlew patchPluginXml -PpluginVersion=9.9.9`
Expected: `BUILD FAILED` with `CHANGELOG.md has no section for version 9.9.9` — this is the guard against publishing a version with no release notes.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md build.gradle.kts
git commit -m "Generate plugin change notes from CHANGELOG.md"
```

### Task 3: Plugin Verifier in the build and CI

**Files:**
- Modify: `build.gradle.kts` (`intellijPlatform` block, `intellijPlatform` dependencies)
- Modify: `.github/workflows/build.yml` (the build step)

- [ ] **Step 1: Configure the verifier**

`verifyPluginStructure` only checks the descriptor; the real Plugin Verifier checks that every platform API the plugin calls exists in the target IDEs — which is what actually breaks a plugin after an IDE update. Add `pluginVerifier()` to the `intellijPlatform` dependencies block and to the `intellijPlatform` extension:

```kotlin
    pluginVerification {
        ides {
            recommended()
        }
    }
```

Leave `failureLevel` at its default; only widen it if the default lets a real problem through.

- [ ] **Step 2: Run it locally**

Run: `./gradlew verifyPlugin`
Expected: `BUILD SUCCESSFUL`. If it reports compatibility problems, replace the offending API — do not lower `failureLevel` to make it pass.

- [ ] **Step 3: Add it to the workflow**

Replace `./gradlew buildPlugin test verifyPluginStructure` with `./gradlew buildPlugin check verifyPluginStructure verifyPlugin` (`check` also runs the web view tests added in Task 6), and add a failure-only upload of `build/reports/pluginVerifier`.

- [ ] **Step 4: Commit**

```bash
git add build.gradle.kts .github/workflows/build.yml
git commit -m "Run IntelliJ Plugin Verifier in the build"
```

### Task 4: Resolve the compatibility contradiction

**Files:**
- Modify: `build.gradle.kts` (the `JavaCompile` block comment)
- Modify: `README.md` (Build / Target sections)

- [ ] **Step 1: Fix the dead claim**

The comment says Java 21 bytecode is needed "so the plugin also loads in 2025.x IDEs", but `pluginSinceBuild=262` forbids installing it there. 2026.2 runs on JBR 21, so `release = 21` stays — for the real reason:

```kotlin
// 2026.2 runs on JBR 21; targeting 21 keeps the bytecode loadable across the supported range.
```

- [ ] **Step 2: State the supported range once**

In `README.md`, keep the "Target: IntelliJ IDEA 2026.2+ (build 262)" line, add the JBR 21 note next to it, and remove any wording that implies 2025.x support.

- [ ] **Step 3: Verify**

Run: `./gradlew buildPlugin`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add build.gradle.kts README.md
git commit -m "State the supported IDE range consistently"
```

---

## Phase 2 – Test foundation (item 10)

### Task 5: Extract and test the Git log parser

**Files:**
- Create: `src/main/java/com/github/bpmncompare/GitLogParser.java`
- Create: `src/test/java/com/github/bpmncompare/GitLogParserTest.java`
- Modify: `src/main/java/com/github/bpmncompare/GitRevisions.java:76-99` (`fileHistory`), drop its `FIELD_SEPARATOR` and `abbreviate`

- [ ] **Step 1: Write the failing test**

```java
package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GitLogParserTest {

    private static final String US = "\u001f";

    private static String line(String hash, String shortHash, String date, String author, String subject) {
        return String.join(US, hash, shortHash, date, author, subject);
    }

    @Test
    void parsesOneCommitPerLine() {
        List<RevisionItem> items = GitLogParser.parse(List.of(
                line("abc1234def", "abc1234", "2026-09-30", "Petr", "Fix the gateway"),
                line("0badc0ffee", "0badc0f", "2026-09-29", "Petr", "Add a task")));

        assertEquals(2, items.size());
        assertEquals("abc1234def", items.get(0).revision());
        assertEquals(RevisionItem.Group.COMMIT, items.get(0).group());
        assertTrue(items.get(0).label().contains("Fix the gateway"), items.get(0).label());
        assertTrue(items.get(0).shortLabel().startsWith("abc1234"), items.get(0).shortLabel());
    }

    @Test
    void keepsSeparatorsThatAppearInsideTheCommitSubject() {
        // the subject is the last field, so a separator inside it must not shift the other fields
        List<RevisionItem> items = GitLogParser.parse(List.of(
                line("abc1234def", "abc1234", "2026-09-30", "Petr", "Weird" + US + "subject")));

        assertEquals(1, items.size());
        assertEquals("abc1234def", items.get(0).revision());
        assertTrue(items.get(0).label().contains("Weird" + US + "subject"), items.get(0).label());
    }

    @Test
    void skipsLinesWithTooFewFields() {
        assertEquals(List.of(), GitLogParser.parse(List.of("", "abc1234def" + US + "abc1234")));
    }

    @Test
    void abbreviatesLongSubjects() {
        RevisionItem item = GitLogParser.parse(List.of(
                line("abc1234def", "abc1234", "2026-09-30", "Petr", "x".repeat(200)))).get(0);

        assertTrue(item.label().length() < 150, "label was " + item.label().length() + " chars");
        assertTrue(item.label().endsWith("\u2026"), item.label());
        assertTrue(item.shortLabel().length() < 45, item.shortLabel());
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./gradlew test --tests '*GitLogParserTest*'`
Expected: compilation failure — `cannot find symbol: class GitLogParser`.

- [ ] **Step 3: Write the parser**

`GitLogParser` holds the `--pretty=format:` string as `FORMAT` (so the format and its parser live together), splits each line with `split(SEP, 5)` — the limit is what keeps a separator inside the subject harmless — skips lines with fewer than 5 fields, and builds the same labels `fileHistory` builds today (`%h  date  author  —  subject` truncated at 90, short label `%h subject` truncated at 30).

- [ ] **Step 4: Run the test to verify it passes**

Run: `./gradlew test --tests '*GitLogParserTest*'`
Expected: PASS, 4 tests.

- [ ] **Step 5: Use the parser from GitRevisions**

`fileHistory` keeps building the `GitLineHandler` (now passing `GitLogParser.FORMAT`) and ends with `return GitLogParser.parse(result.getOutput());`. Delete the now-unused `FIELD_SEPARATOR` constant and private `abbreviate`.

- [ ] **Step 6: Verify nothing else broke**

Run: `./gradlew test compileJava`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit**

```bash
git add src/main/java/com/github/bpmncompare/GitLogParser.java src/test/java/com/github/bpmncompare/GitLogParserTest.java src/main/java/com/github/bpmncompare/GitRevisions.java
git commit -m "Extract git log parsing into a tested GitLogParser"
```

### Task 6: Web view test harness

**Files:**
- Modify: `webview/package.json` (`scripts.test`)
- Create: `webview/src/format.js`
- Create: `webview/test/format.test.js`
- Modify: `webview/src/main.js:278-332` (remove the moved functions, import them)
- Modify: `build.gradle.kts` (`testWebview` task wired into `check`)

- [ ] **Step 1: Add a test script with no new dependency**

`node:test` ships with Node, so the web view keeps its two runtime dependencies and the bundle is unaffected. In `webview/package.json`:

```json
    "test": "node --test test/"
```

- [ ] **Step 2: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeAttrs, displayName, formatValue, normalizeAttrs, typeName } from '../src/format.js';

test('typeName strips the BPMN namespace prefix', () => {
  assert.equal(typeName({ $type: 'bpmn:ServiceTask' }), 'ServiceTask');
  assert.equal(typeName({ $type: 'ServiceTask' }), 'ServiceTask');
  assert.equal(typeName(null), '');
});

test('displayName prefers the element name over its id', () => {
  assert.equal(displayName({ id: 'Task_1', name: 'Approve invoice', $type: 'bpmn:Task' }), 'Approve invoice');
  assert.equal(displayName({ id: 'Task_1', $type: 'bpmn:Task' }), 'Task_1');
  assert.equal(displayName({ $type: 'bpmn:Task' }), 'Task');
  assert.equal(displayName(null), '');
});

test('formatValue renders primitives, empties and objects readably', () => {
  assert.equal(formatValue('x'), 'x');
  assert.equal(formatValue(''), '(empty)');
  assert.equal(formatValue(null), '(none)');
  assert.equal(formatValue(undefined), '(none)');
  assert.equal(formatValue(true), 'true');
  assert.equal(formatValue({ id: 'Flow_1', $type: 'bpmn:SequenceFlow' }), 'SequenceFlow Flow_1');
});

test('normalizeAttrs turns the differ payload into old/new pairs', () => {
  assert.deepEqual(
    normalizeAttrs({ name: { oldValue: 'A', newValue: 'B' } }),
    { name: { oldValue: 'A', newValue: 'B' } });

  // the differ also reports a bare value for some attributes
  assert.deepEqual(normalizeAttrs({ name: 'B' }), { name: { oldValue: undefined, newValue: 'B' } });
  assert.deepEqual(normalizeAttrs(null), {});
});

test('describeAttrs renders one old to new line per attribute', () => {
  assert.deepEqual(
    describeAttrs({ name: { oldValue: 'A', newValue: 'B' } }),
    [ 'name: A \u2192 B' ]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd webview && npm test`
Expected: FAIL — `Cannot find module '../src/format.js'`.

- [ ] **Step 4: Create the module by moving the functions out of main.js**

Move `normalizeAttrs` (`main.js:278`), `displayName` (`main.js:288`), `typeName` (`main.js:294`), `formatValue` (`main.js:300`) and `describeAttrs` (`main.js:322`) into `webview/src/format.js` with `export` on each, keeping their current behaviour and making the null/empty handling the test pins down explicit. In `main.js` delete them and add:

```js
import { describeAttrs, displayName, formatValue, normalizeAttrs, typeName } from './format.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd webview && npm test`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify the bundle still builds**

Run: `./gradlew buildWebview`
Expected: `BUILD SUCCESSFUL`, `bundle.js` within a few hundred bytes of its previous 221.7 kB (esbuild inlines the modules).

- [ ] **Step 7: Make `./gradlew check` run the JS tests**

Register an `Exec` task `testWebview` in group `verification` that depends on `npmInstall`, runs `npm test` in `webviewDir`, declares `src` and `test` as inputs and `outputs.upToDateWhen { false }`, then `tasks.check { dependsOn(testWebview) }`.

- [ ] **Step 8: Verify**

Run: `./gradlew check`
Expected: `BUILD SUCCESSFUL` with both `test` and `testWebview` executed.

- [ ] **Step 9: Commit**

```bash
git add webview/package.json webview/src/format.js webview/test/format.test.js webview/src/main.js build.gradle.kts
git commit -m "Extract web view formatting into a tested module"
```

### Task 7: Test the change list builder

**Files:**
- Create: `webview/src/changes.js`
- Create: `webview/test/changes.test.js`
- Modify: `webview/src/main.js:225-277` (remove `toChangeList`, import it)

- [ ] **Step 1: Write the failing test**

The differ returns maps keyed by element id (`_added`, `_removed`, `_changed`, `_layoutChanged`); `_changed` holds `{ model, attrs }`, the others hold the model element.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toChangeList } from '../src/changes.js';

const task = { id: 'Task_1', name: 'Approve', $type: 'bpmn:Task' };
const gateway = { id: 'Gateway_1', $type: 'bpmn:ExclusiveGateway' };
const empty = { _added: {}, _removed: {}, _changed: {}, _layoutChanged: {} };

test('flattens the differ result into one list', () => {
  const changes = toChangeList({ ...empty, _added: { Task_1: task }, _removed: { Gateway_1: gateway } });

  assert.deepEqual(changes.map((c) => [ c.id, c.kind ]), [ [ 'Task_1', 'added' ], [ 'Gateway_1', 'removed' ] ]);
  assert.equal(changes[0].name, 'Approve');
  assert.equal(changes[0].type, 'Task');
  assert.equal(changes[0].element, task);
});

test('carries the changed attributes as old/new pairs', () => {
  const changes = toChangeList({
    ...empty,
    _changed: { Task_1: { model: task, attrs: { name: { oldValue: 'Old', newValue: 'Approve' } } } }
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'changed');
  assert.deepEqual(changes[0].attrs.name, { oldValue: 'Old', newValue: 'Approve' });
});

test('an element that only moved is reported as a layout change', () => {
  assert.deepEqual(
    toChangeList({ ...empty, _layoutChanged: { Task_1: task } }).map((c) => c.kind),
    [ 'layout' ]);
});

test('an element both changed and moved is reported once, as changed', () => {
  const changes = toChangeList({
    ...empty,
    _changed: { Task_1: { model: task, attrs: { name: { oldValue: 'Old', newValue: 'Approve' } } } },
    _layoutChanged: { Task_1: task }
  });

  assert.deepEqual(changes.map((c) => [ c.id, c.kind ]), [ [ 'Task_1', 'changed' ] ]);
});

test('tolerates a missing or empty differ result', () => {
  assert.deepEqual(toChangeList(null), []);
  assert.deepEqual(toChangeList({}), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd webview && npm test`
Expected: FAIL — `Cannot find module '../src/changes.js'`.

- [ ] **Step 3: Move `toChangeList` into the module**

Move `toChangeList` and its nested `entry` helper out of `main.js` into `webview/src/changes.js`, importing `displayName`/`normalizeAttrs`/`typeName` from `./format.js`. Keep the bucket order (added, removed, changed, layout) that the filter chips use, and add a `Set` of seen ids so an element in two buckets appears once — double-counting would make the chip counts disagree with the list. In `main.js` delete both functions and `import { toChangeList } from './changes.js';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd webview && npm test`
Expected: PASS, 10 tests total.

- [ ] **Step 5: Verify the view still works end to end**

Run: `./gradlew runIde`
In the sandbox: open a `.bpmn` file, switch to **BPMN Diff**, pick a revision with known changes and confirm the chip counts and the change list match what they showed before the refactor. Close the sandbox.

- [ ] **Step 6: Commit**

```bash
git add webview/src/changes.js webview/test/changes.test.js webview/src/main.js
git commit -m "Extract the change list builder into a tested module"
```

### Task 8: XML locator for the editor link

**Files:**
- Create: `src/main/java/com/github/bpmncompare/BpmnXmlLocator.java`
- Create: `src/test/java/com/github/bpmncompare/BpmnXmlLocatorTest.java`

- [ ] **Step 1: Write the failing test**

```java
package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BpmnXmlLocatorTest {

    private static final String XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1">
              <bpmn:process id="Process_1" isExecutable="true">
                <bpmn:startEvent id="StartEvent_1" name="Start"/>
                <bpmn:serviceTask id='Task_1' name='Approve'/>
              </bpmn:process>
              <bpmndi:BPMNDiagram id="BPMNDiagram_1">
                <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"/>
              </bpmndi:BPMNDiagram>
            </bpmn:definitions>
            """;

    @Test
    void findsTheOffsetOfADoubleQuotedId() {
        int offset = BpmnXmlLocator.offsetOfElement(XML, "StartEvent_1");

        assertTrue(offset > 0, "not found");
        assertTrue(XML.startsWith("<bpmn:startEvent", offset), XML.substring(offset, offset + 20));
    }

    @Test
    void findsTheOffsetOfASingleQuotedId() {
        int offset = BpmnXmlLocator.offsetOfElement(XML, "Task_1");

        assertTrue(XML.startsWith("<bpmn:serviceTask", offset), XML.substring(offset, offset + 20));
    }

    @Test
    void doesNotMatchTheDiShapeThatOnlyReferencesTheElement() {
        // BPMNShape carries bpmnElement="Task_1" and id="Task_1_di"; neither may win over the model element
        assertTrue(BpmnXmlLocator.offsetOfElement(XML, "Task_1") < XML.indexOf("BPMNShape"));
    }

    @Test
    void returnsMinusOneForAnUnknownId() {
        assertEquals(-1, BpmnXmlLocator.offsetOfElement(XML, "Nope_1"));
    }

    @Test
    void doesNotMatchAnIdThatIsOnlyAPrefixOfAnother() {
        assertEquals(-1, BpmnXmlLocator.offsetOfElement(XML, "Task_"));
    }

    @Test
    void readsTheIdOfTheElementSurroundingAnOffset() {
        assertEquals("Task_1", BpmnXmlLocator.elementIdAt(XML, XML.indexOf("name='Approve'")));
        assertEquals("Process_1", BpmnXmlLocator.elementIdAt(XML, XML.indexOf("isExecutable")));
    }

    @Test
    void elementIdAtToleratesPositionsOutsideAnyTag() {
        assertNull(BpmnXmlLocator.elementIdAt(XML, 0));
        assertNull(BpmnXmlLocator.elementIdAt("", 0));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./gradlew test --tests '*BpmnXmlLocatorTest*'`
Expected: compilation failure — `cannot find symbol: class BpmnXmlLocator`.

- [ ] **Step 3: Write the locator**

Plain regex scanning, on purpose: the same code serves the working copy and a Git revision's text, and needs no read action.

- `offsetOfElement(xml, id)` matches `\bid\s*=\s*(["'])<quoted id>\1` — the back-reference forces matching quotes and `Pattern.quote` plus the closing quote is what makes `Task_` not match `Task_1`. Returns the offset of the preceding `<`, or `-1`. The first match wins, which is the model element, since DI shapes come after the model in every BPMN file and their own id differs.
- `elementIdAt(xml, offset)` takes the text from the preceding `<` to the next `>` and returns the first `id="…"` in it, or `null`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `./gradlew test --tests '*BpmnXmlLocatorTest*'`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/github/bpmncompare/BpmnXmlLocator.java src/test/java/com/github/bpmncompare/BpmnXmlLocatorTest.java
git commit -m "Add a tested BPMN id to XML offset locator"
```

---

## Phase 3 – Two independent sides and the native diff tool (item 1)

### Task 9: Extract `DiagramSide`

**Files:**
- Create: `src/main/java/com/github/bpmncompare/DiagramSide.java`
- Create: `src/test/java/com/github/bpmncompare/DiagramSideTest.java`
- Modify: `src/main/java/com/github/bpmncompare/BpmnComparePanel.java:466-495` (delete `RightSide`, use `DiagramSide`)

- [ ] **Step 1: Write the failing test**

```java
package com.github.bpmncompare;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DiagramSideTest {

    @Test
    void xmlSideCarriesContentAndLabel() {
        Map<String, Object> json = DiagramSide.xml("<definitions/>", "main").toJson();

        assertEquals("<definitions/>", json.get("xml"));
        assertEquals("main", json.get("label"));
        assertNull(json.get("error"));
        assertEquals(Boolean.FALSE, json.get("missing"));
    }

    @Test
    void missingSideIsFlaggedAndHasNoXml() {
        Map<String, Object> json = DiagramSide.missing("main", "not there").toJson();

        assertNull(json.get("xml"));
        assertEquals(Boolean.TRUE, json.get("missing"));
        assertEquals("not there", json.get("message"));
    }

    @Test
    void errorSideCarriesTheMessage() {
        Map<String, Object> json = DiagramSide.error("main", "boom").toJson();

        assertEquals("boom", json.get("error"));
        assertEquals("main", json.get("label"));
    }

    @Test
    void jsonAlwaysHasEveryKeySoTheWebViewCanResetItsState() {
        // the web view overwrites its pane state from this map; a missing key would keep a stale value
        assertTrue(DiagramSide.message("loading").toJson().keySet()
                .containsAll(List.of("xml", "label", "error", "message", "missing")));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./gradlew test --tests '*DiagramSideTest*'`
Expected: compilation failure — `cannot find symbol: class DiagramSide`.

- [ ] **Step 3: Write `DiagramSide`**

Move the `RightSide` record verbatim into its own package-private top-level record `DiagramSide` with the same components (`xml, label, error, message, missing`), factories `xml`, `missing`, `error(label, message)`, `message`, and the same `toJson()`. Drop the one-argument `error(message)` overload — both of its call sites already have a label.

- [ ] **Step 4: Replace the old record in the panel**

Delete `RightSide` from `BpmnComparePanel.java`; replace every use with `DiagramSide`, passing a label at the two `error(…)` call sites.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./gradlew test`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/github/bpmncompare/DiagramSide.java src/test/java/com/github/bpmncompare/DiagramSideTest.java src/main/java/com/github/bpmncompare/BpmnComparePanel.java
git commit -m "Extract DiagramSide out of BpmnComparePanel"
```

### Task 10: Introduce `BpmnContentSource`

**Files:**
- Create: `src/main/java/com/github/bpmncompare/BpmnContentSource.java`
- Modify: `src/main/java/com/github/bpmncompare/BpmnComparePanel.java` (both sides go through a source)
- Modify: `src/main/java/com/github/bpmncompare/BpmnCompareEditor.java:20-24`

- [ ] **Step 1: Write the source abstraction**

A sealed-by-convention interface with three records; `load()` blocks and never throws — failures come back as an error `DiagramSide`.

```java
interface BpmnContentSource {

    String label();

    /** Reads the current content. Never throws; failures come back as an error side. */
    DiagramSide load();

    /** The revision this side shows, or null when it is not revision-backed (no chooser then). */
    default @Nullable RevisionItem revision() {
        return null;
    }

    /** The same source pinned to another revision; only revision-backed sources support this. */
    default BpmnContentSource at(RevisionItem item) {
        throw new UnsupportedOperationException(getClass().getSimpleName() + " is not revision-backed");
    }

    record Working(VirtualFile file) implements BpmnContentSource { /* live document, unsaved changes included */ }

    record Revision(Project project, VirtualFile file, RevisionItem item) implements BpmnContentSource { /* git */ }

    record Fixed(String xml, String label) implements BpmnContentSource { /* text from the platform */ }
}
```

- `Working.label()` is `"working copy · " + file.getName()`; `load()` moves the body of the panel's current `currentText()` plus its empty-file check.
- `Revision.load()` moves the body of the current `loadRevision` background task: resolve the repository (error side if absent), resolve the short hash for the label, then `GitRevisions.content`, mapping `MissingInRevisionException` to `DiagramSide.missing` and `VcsException` to `DiagramSide.error`. `revision()` returns the item and `at(other)` returns a new `Revision`.
- `Fixed.load()` returns `DiagramSide.xml` or, for a `null` xml, `DiagramSide.missing` — that is the added/deleted-file case in a diff window.

- [ ] **Step 2: Rework the panel around two sources**

In `BpmnComparePanel.java`:
- constructor becomes `BpmnComparePanel(Project project, @Nullable VirtualFile file, BpmnContentSource left, BpmnContentSource right)`; `file` is kept only for the document listener and the toolbar title and may be `null` in a diff window;
- fields `revision` / `right` become `leftSource`, `rightSource`, `leftSide`, `rightSide`, plus `private enum Side { LEFT, RIGHT }`;
- `pushDiagrams` sends `leftSide.toJson()` / `rightSide.toJson()`; the inline left-map building goes away;
- `loadRevision(item)` becomes `reloadSide(Side side, BpmnContentSource source)` which runs `source.load()` in the existing `Task.Backgroundable`, keeps a per-side request counter as the current `revisionRequest` guard does, and assigns the resulting side before `pushDiagrams(false)`;
- the revision chooser button and its `Compare with:` label are only added to the toolbar when `rightSource.revision() != null`; choosing an item calls `reloadSide(RIGHT, rightSource.at(item))`;
- the document listener calls `reloadSide(LEFT, leftSource)` (same 600 ms debounce), Refresh reloads both sides after `forgetRepository()`.

- [ ] **Step 3: Update the editor tab**

```java
        this.panel = new BpmnComparePanel(project, file,
                new BpmnContentSource.Working(file),
                new BpmnContentSource.Revision(project, file, RevisionItem.HEAD));
```

- [ ] **Step 4: Verify the tab behaves exactly as before**

Run: `./gradlew check runIde`
In the sandbox: the **BPMN Diff** tab shows working copy vs HEAD; editing the file refreshes the left pane after ~600 ms; the chooser still lists branches/tags/commits and switching reloads only the right pane; a nonexistent custom revision still reports an error rather than hanging; Refresh works. Close the sandbox.

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/github/bpmncompare/BpmnContentSource.java src/main/java/com/github/bpmncompare/BpmnComparePanel.java src/main/java/com/github/bpmncompare/BpmnCompareEditor.java
git commit -m "Feed both panes from a BpmnContentSource"
```

### Task 11: Register a BPMN diff tool in the platform diff framework

**Files:**
- Create: `src/main/java/com/github/bpmncompare/BpmnDiffTool.java`
- Create: `src/main/java/com/github/bpmncompare/BpmnDiffViewer.java`
- Modify: `src/main/resources/META-INF/plugin.xml` (module dependency + `diff.DiffTool` extension)
- Modify: `build.gradle.kts` (`bundledModule("intellij.platform.diff")`)

- [ ] **Step 1: Add the platform module dependency**

`FrameDiffTool` lives in `intellij.platform.diff.jar`, a separate module in 2026.2. Add `bundledModule("intellij.platform.diff")` to the `intellijPlatform` dependencies and `<module name="intellij.platform.diff"/>` to `plugin.xml`'s `<dependencies>`. If compilation still fails, add `intellij.platform.diff.impl` the same way — check what the jar list actually contains rather than guessing further.

- [ ] **Step 2: Write the diff tool**

```java
public final class BpmnDiffTool implements FrameDiffTool {

    @Override
    public @NotNull String getName() {
        return "BPMN diagram";
    }

    @Override
    public boolean canShow(@NotNull DiffContext context, @NotNull DiffRequest request) {
        if (context.getProject() == null || !(request instanceof ContentDiffRequest contentRequest)) {
            return false;
        }
        List<DiffContent> contents = contentRequest.getContents();
        // exactly two sides, at least one a BPMN file - the other may be an EmptyContent
        // for a file that was added or deleted in the compared revision
        return contents.size() == 2 && contents.stream().anyMatch(BpmnDiffTool::isBpmn);
    }

    @Override
    public @NotNull DiffViewer createComponent(@NotNull DiffContext context, @NotNull DiffRequest request) {
        return new BpmnDiffViewer(context, (ContentDiffRequest) request);
    }

    static boolean isBpmn(DiffContent content) {
        return BpmnFiles.isBpmn(fileOf(content));
    }

    static @Nullable VirtualFile fileOf(DiffContent content) {
        return content instanceof DocumentContent documentContent ? documentContent.getHighlightFile() : null;
    }
}
```

- [ ] **Step 3: Write the viewer**

`BpmnDiffViewer implements FrameDiffTool.DiffViewer` and holds a `BpmnComparePanel` built from two `BpmnContentSource.Fixed` sources:
- the platform orders contents as `[before, after]`; put **after on the left**, matching the editor tab where the left pane is the newer version;
- the text of a `DocumentContent` is read with `ReadAction.compute(() -> content.getDocument().getText())`; any other content type (notably `EmptyContent`) yields `null`, which `Fixed` turns into a "missing" side;
- labels come from `request.getContentTitles()` with `"After"` / `"Before"` fallbacks for null or blank entries;
- `init()` calls `panel.activate()` and returns a bare `new FrameDiffTool.ToolbarComponents()`;
- `dispose()` calls `Disposer.dispose(panel)`.

- [ ] **Step 4: Register the extension**

```xml
        <diff.DiffTool implementation="com.github.bpmncompare.BpmnDiffTool"/>
```

- [ ] **Step 5: Verify compilation and the descriptor**

Run: `./gradlew check verifyPluginStructure verifyPlugin`
Expected: `BUILD SUCCESSFUL`. A missing module dependency surfaces here as `cannot find symbol: FrameDiffTool` — fix the `bundledModule` name, do not drop the dependency.

- [ ] **Step 6: Verify in a sandbox IDE**

Run: `./gradlew runIde`
In a project with a committed `.bpmn` file:
1. change the file, open the commit dialog, double-click it — the diff window opens on the text diff;
2. in the diff window's tool selector, pick **BPMN diagram** — both diagrams appear with the changes highlighted;
3. in the Git log, open a commit touching the file — same;
4. **Git | Compare with Branch…** against another branch — the BPMN tool works there too; this is the branch↔branch case that was impossible before;
5. open a commit that *added* the file — the "before" side reports the file as missing instead of erroring out.
Close the sandbox.

- [ ] **Step 7: Commit**

```bash
git add src/main/java/com/github/bpmncompare/BpmnDiffTool.java src/main/java/com/github/bpmncompare/BpmnDiffViewer.java src/main/resources/META-INF/plugin.xml build.gradle.kts
git commit -m "Show BPMN diagrams in the IDE diff windows"
```

- [ ] **Step 8: Document the new entry point**

Add to `README.md`'s Usage section that any IDE diff of a `.bpmn` file (commit dialog, Git log, Compare with Branch, Compare Two Files) can be switched to the **BPMN diagram** tool, and add the entry to `CHANGELOG.md`'s `[Unreleased]`. Commit as `Document the diff window integration`.

---

## Phase 4 – Auto-refresh on Git changes (item 9)

### Task 12: Reload the revision side when the repository changes

**Files:**
- Modify: `src/main/java/com/github/bpmncompare/BpmnComparePanel.java` (`activate()` subscriptions, `resolveRepository`)

- [ ] **Step 1: Subscribe to repository changes**

Checkout, commit, fetch and rebase publish `GitRepository.GIT_REPO_CHANGE`. Without it a view pinned to `HEAD` keeps showing the previous commit until the user presses Refresh. Subscribe in `activate()` next to the existing `LafManagerListener` subscription, and:
- ignore events from other repositories by comparing `repository.getRoot()` with a `volatile VirtualFile gitRoot` field set in `resolveRepository()` (so the listener does no Git work on the EDT), skipping while it is still `null`;
- only act when `rightSource.revision() != null`;
- call `forgetRepository()` before reloading, because the `GitRepository` instance itself can be replaced.

- [ ] **Step 2: Coalesce bursts**

A rebase fires many events. Use a second `Alarm gitAlarm` (not the document one, so an edit and a repository change cannot cancel each other) with `GIT_UPDATE_DELAY_MS = 400`, cancelling previous requests before adding `() -> reloadSide(Side.RIGHT, rightSource)`.

- [ ] **Step 3: Verify**

Run: `./gradlew runIde`
In the sandbox with **BPMN Diff** open on HEAD:
1. commit a change to the `.bpmn` file from the IDE — the right pane reloads by itself and the highlights disappear (working copy now equals HEAD);
2. check out another branch — the right pane reloads to that branch's content;
3. type in the editor — only the left pane refreshes, undisturbed by the new alarm.

- [ ] **Step 4: Commit**

```bash
git add src/main/java/com/github/bpmncompare/BpmnComparePanel.java CHANGELOG.md
git commit -m "Reload the compared revision when the Git repository changes"
```

---

## Phase 5 – Camunda / Zeebe extension elements in the diff (item 2)

### Task 13: Compare extension elements

**Files:**
- Create: `webview/src/extensions.js`
- Create: `webview/test/extensions.test.js`
- Modify: `webview/src/changes.js` (merge extension differences into the change list)
- Modify: `webview/test/changes.test.js` (two more cases)
- Modify: `webview/src/main.js:175` (pass both element maps to `toChangeList`)

- [ ] **Step 1: Write the failing test**

`bpmn-js-differ` diffs only a fixed set of BPMN attributes, so a changed execution listener or input mapping currently produces **no change at all** — the most misleading failure mode the plugin has for Camunda projects. The new module returns differences in the same `{ oldValue, newValue }` shape the change list already renders, keyed by extension type.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareExtensions } from '../src/extensions.js';

function task(extensions) {
  return {
    id: 'Task_1',
    $type: 'bpmn:ServiceTask',
    extensionElements: extensions ? { values: extensions } : undefined
  };
}

test('no extension elements on either side means no differences', () => {
  assert.deepEqual(compareExtensions(task(null), task(null)), {});
  assert.deepEqual(compareExtensions(null, null), {});
});

test('reports an added extension element', () => {
  const diff = compareExtensions(
    task(null),
    task([ { $type: 'camunda:ExecutionListener', event: 'start', class: 'com.acme.Listener' } ]));

  assert.deepEqual(Object.keys(diff), [ 'camunda:ExecutionListener' ]);
  assert.equal(diff['camunda:ExecutionListener'].oldValue, undefined);
  assert.match(diff['camunda:ExecutionListener'].newValue, /start/);
  assert.match(diff['camunda:ExecutionListener'].newValue, /com\.acme\.Listener/);
});

test('reports a removed extension element', () => {
  const diff = compareExtensions(task([ { $type: 'camunda:ExecutionListener', event: 'start' } ]), task(null));

  assert.match(diff['camunda:ExecutionListener'].oldValue, /start/);
  assert.equal(diff['camunda:ExecutionListener'].newValue, undefined);
});

test('reports a changed property of an extension element', () => {
  const diff = compareExtensions(
    task([ { $type: 'camunda:ExecutionListener', event: 'start', class: 'com.acme.Old' } ]),
    task([ { $type: 'camunda:ExecutionListener', event: 'start', class: 'com.acme.New' } ]));

  assert.match(diff['camunda:ExecutionListener'].oldValue, /com\.acme\.Old/);
  assert.match(diff['camunda:ExecutionListener'].newValue, /com\.acme\.New/);
});

test('identical extension elements are not reported', () => {
  const listener = { $type: 'camunda:ExecutionListener', event: 'start', class: 'com.acme.Listener' };

  assert.deepEqual(compareExtensions(task([ listener ]), task([ { ...listener } ])), {});
});

test('property order does not matter', () => {
  assert.deepEqual(
    compareExtensions(
      task([ { $type: 'camunda:ExecutionListener', event: 'start', class: 'C' } ]),
      task([ { $type: 'camunda:ExecutionListener', class: 'C', event: 'start' } ])),
    {});
});

test('the moddle parent link is ignored', () => {
  // $parent is a cyclic back-reference added by moddle; including it would recurse forever
  const one = { $type: 'camunda:ExecutionListener', event: 'start' };
  const other = { $type: 'camunda:ExecutionListener', event: 'start' };

  one.$parent = task([ one ]);
  other.$parent = task([ other ]);

  assert.deepEqual(compareExtensions(task([ one ]), task([ other ])), {});
});

test('distinguishes several elements of the same type', () => {
  const diff = compareExtensions(
    task([ { $type: 'camunda:ExecutionListener', event: 'start' },
           { $type: 'camunda:ExecutionListener', event: 'end' } ]),
    task([ { $type: 'camunda:ExecutionListener', event: 'start' } ]));

  assert.match(diff['camunda:ExecutionListener'].oldValue, /end/);
  assert.doesNotMatch(String(diff['camunda:ExecutionListener'].newValue), /end/);
});

test('compares nested input/output mappings', () => {
  const diff = compareExtensions(
    task([ { $type: 'camunda:InputOutput', inputParameters: [ { name: 'amount', value: '${old}' } ] } ]),
    task([ { $type: 'camunda:InputOutput', inputParameters: [ { name: 'amount', value: '${new}' } ] } ]));

  assert.match(diff['camunda:InputOutput'].oldValue, /\$\{old}/);
  assert.match(diff['camunda:InputOutput'].newValue, /\$\{new}/);
});

test('works for Zeebe extensions too', () => {
  const diff = compareExtensions(
    task([ { $type: 'zeebe:taskDefinition', type: 'old-worker' } ]),
    task([ { $type: 'zeebe:taskDefinition', type: 'new-worker' } ]));

  assert.match(diff['zeebe:taskDefinition'].oldValue, /old-worker/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd webview && npm test`
Expected: FAIL — `Cannot find module '../src/extensions.js'`.

- [ ] **Step 3: Write the comparison**

`compareExtensions(oldElement, newElement)` renders each side's `extensionElements.values` to a stable string per extension type and reports a difference where the strings differ:
- `byType(element)` groups values by `$type`, joining several of the same type with `', '` in document order;
- `describe(value)` renders `ExecutionListener(class=com.acme.X, event=start)` — properties sorted by name, so property order never shows up as a difference; `$parent`, `$type` and `id` are skipped, and skipping `$parent` is what stops the cyclic moddle back-reference from recursing;
- arrays and nested objects recurse through `describe`, which is what makes `camunda:InputOutput` comparable.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd webview && npm test`
Expected: PASS, 10 new tests.

- [ ] **Step 5: Feed the differences into the change list**

In `changes.js`, `toChangeList(diff, newElements = {}, oldElements = {})`:
- in `entry`, when `kind === 'changed'` and both versions of the element are known, `Object.assign(attrs, compareExtensions(oldElement, newElement))` — the differ's own attributes must survive;
- after the bucket loop, walk `newElements` and, for an id not already seen whose old version exists and whose `compareExtensions` is non-empty, push a `changed` entry — that is the element the differ misses entirely.

- [ ] **Step 6: Extend the change list test**

Add two cases to `webview/test/changes.test.js`: an element differing *only* in extensions is reported as `changed` with the extension attribute present; an element the differ already reported keeps its `name` attribute *and* gains the extension one.

- [ ] **Step 7: Pass the element maps from main.js**

`main.js:184` already has `collectFlowElements(pane)`. At the `toChangeList` call in `render` pass both sides' elements keyed by id. Check what `collectFlowElements` returns — if it is an array, convert it to an id-keyed object in `main.js` rather than changing the pure module's contract.

- [ ] **Step 8: Verify**

Run: `cd webview && npm test` then `./gradlew runIde`
In the sandbox: commit a `.bpmn` file with a Camunda service task, then change only the `camunda:class` of its execution listener. The element must now be highlighted as **Changed**, with the listener difference in the badge tooltip and the change list. Before this task the same edit showed no change at all — confirm that contrast explicitly by also checking the chip counts.

- [ ] **Step 9: Commit**

```bash
git add webview/src/extensions.js webview/test/extensions.test.js webview/src/changes.js webview/test/changes.test.js webview/src/main.js CHANGELOG.md
git commit -m "Report Camunda and Zeebe extension element changes"
```

---

## Phase 6 – Keyboard navigation between changes (item 4)

### Task 14: Next / previous change

**Files:**
- Modify: `webview/src/main.js` (navigation state, keyboard, `bpmnCompare.goToChange`)
- Modify: `webview/src/index.html` (previous/next buttons)
- Modify: `webview/src/styles.css` (`#change-nav`, selected change-list row)
- Create: `src/main/java/com/github/bpmncompare/GoToChangeAction.java`
- Modify: `src/main/java/com/github/bpmncompare/BpmnComparePanel.java` (`goToChange`), `BpmnCompareEditor.java` (`panel()`)
- Modify: `src/main/resources/META-INF/plugin.xml` (two actions with shortcuts)

- [ ] **Step 1: Add the navigation core to the web view**

Only *visible* changes may be stepped through, so navigation and the filter chips agree:

```js
let selectedChangeId = null;

function navigableChanges() {
  return currentChanges.filter(visibleKind);
}

/** Steps to the next (+1) or previous (-1) visible change, wrapping around. */
function goToChange(step) {
  const changes = navigableChanges();

  if (!changes.length) {
    return;
  }

  const current = changes.findIndex((change) => change.id === selectedChangeId);
  const next = current < 0 ? (step > 0 ? 0 : changes.length - 1) : (current + step + changes.length) % changes.length;

  focusElement(changes[next].id);
}
```

`focusElement` records `selectedChangeId = id` at its start, so repeated steps advance; `render` resets it to `null` when new diagrams arrive. `renderChangeList` marks the selected row with a class so the user sees where they are.

- [ ] **Step 2: Wire the keyboard and the buttons**

A `keydown` listener on `document` handles `F7` / `Shift+F7` (ignoring events with Ctrl/Meta/Alt or `defaultPrevented`) and `Escape` to close the change list — extract the closing from the existing `toggle-changes` handler into `closeChangeList()` so both paths share it. Add the two buttons to `index.html` in their own `#change-nav` group before `#zoom`, reusing `.bar-button`, titled "Previous change (Shift+F7)" / "Next change (F7)".

- [ ] **Step 3: Disable the buttons when there is nothing to step through**

`updateChangeNav()` sets `disabled = !navigableChanges().length` on both buttons; call it at the end of `render` and from `updateFilterChips`, so filtering everything out also disables them.

- [ ] **Step 4: Expose it to the host**

Add `goToChange,` to the `window.bpmnCompare` object.

- [ ] **Step 5: Add IDE actions**

JCEF swallows keys only while the browser has focus, and an IDE action also puts the commands in *Find Action* and the keymap. `GoToChangeAction` is an abstract `AnAction` holding a `step`, with public `Next`/`Previous` subclasses (the action system instantiates them, so they must be public); it finds the panel via `e.getData(PlatformDataKeys.FILE_EDITOR)` cast to `BpmnCompareEditor` and calls a new `panel.goToChange(step)`, which forwards to `call("goToChange", step)` when `pageReady`. `update` enables the action only when such an editor is selected. `BpmnCompareEditor` gains a package-private `panel()` accessor. Register both in `plugin.xml` with `<keyboard-shortcut keymap="$default" first-keystroke="F7"/>` and `shift F7`.

- [ ] **Step 6: Verify**

Run: `./gradlew check runIde`
In the sandbox, on a file with several changes: F7 centres each visible change in turn and wraps; Shift+F7 goes back; filtering out a kind makes F7 skip it; the toolbar buttons do the same and are disabled when nothing is visible; Escape closes the change list; F7 works both with the diagram focused and right after clicking the toolbar.

- [ ] **Step 7: Commit**

```bash
git add webview/src/main.js webview/src/index.html webview/src/styles.css src/main/java/com/github/bpmncompare/GoToChangeAction.java src/main/java/com/github/bpmncompare/BpmnComparePanel.java src/main/java/com/github/bpmncompare/BpmnCompareEditor.java src/main/resources/META-INF/plugin.xml CHANGELOG.md
git commit -m "Step through changes with F7 and Shift+F7"
```

---

## Phase 7 – Diagram ↔ XML navigation (item 3)

### Task 15: Jump from an element to its XML

**Files:**
- Modify: `webview/src/main.js` (report double-clicks to the host)
- Modify: `src/main/java/com/github/bpmncompare/BpmnComparePanel.java` (`JBCefJSQuery` bridge, `openXml`)
- Modify: `src/main/java/com/github/bpmncompare/Json.java` (reader)
- Modify: `src/test/java/com/github/bpmncompare/JsonTest.java`

- [ ] **Step 1: Write the failing test for the JSON reader**

`Json` currently only writes. The page needs to send flat `{ "command": …, "id": … }` messages back; a full parser would be dead code, so the reader is deliberately limited to flat string objects — and the test says so.

```java
    @Test
    void readsAFlatObject() {
        assertEquals(Map.of("command", "openXml", "id", "Task_1"),
                Json.read("{\"command\":\"openXml\",\"id\":\"Task_1\"}"));
    }

    @Test
    void readsEscapedValues() {
        assertEquals(Map.of("id", "a\"b"), Json.read("{\"id\":\"a\\\"b\"}"));
    }

    @Test
    void readingGarbageYieldsAnEmptyMap() {
        assertEquals(Map.of(), Json.read("not json"));
    }

    @Test
    void readsALargeValueUnchanged() {
        // PNG exports arrive as one long data URL string
        String payload = "x".repeat(2_000_000);

        assertEquals(payload, Json.read("{\"payload\":\"" + payload + "\"}").get("payload"));
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./gradlew test --tests '*JsonTest*'`
Expected: FAIL — `cannot find symbol: method read(String)`.

- [ ] **Step 3: Write the reader**

`Json.read(String)` returns a `LinkedHashMap<String, Object>` filled by matching `"key"\s*:\s*"value"` pairs with escape-aware quoted-string groups, unescaping `\"`, `\\` and `\n`. Non-string values are not supported and are simply skipped.

- [ ] **Step 4: Run it to verify it passes**

Run: `./gradlew test --tests '*JsonTest*'`
Expected: PASS.

- [ ] **Step 5: Send double-clicks from the page**

In `createPane`, next to the existing `element.hover` subscription:

```js
  // double-click opens the element in the XML editor; only the working-copy pane has a document to open
  eventBus.on('element.dblclick', (event) => {
    if (side === 'left' && window.bpmnCompareHost) {
      window.bpmnCompareHost({ command: 'openXml', id: event.element.id });
    }
  });
```

- [ ] **Step 6: Receive it in the panel**

In `activate()`, create `hostQuery = JBCefJSQuery.create((JBCefBrowserBase) browser)`, register it with `Disposer.register(this, hostQuery)` (it leaks a JS callback otherwise) and add a handler that parses the message with `Json.read` and dispatches on `command`. Inject the bridge from a load handler registered **before** the existing `pageReady` one (CEF calls them in registration order, so the page has `window.bpmnCompareHost` before it is told it is ready):

```java
        executeScript("window.bpmnCompareHost = function(message) {"
                + hostQuery.inject("JSON.stringify(message)") + "};");
```

`openXml(id)` takes the document of `file` (skip when `file == null`, i.e. in a diff window), asks `BpmnXmlLocator.offsetOfElement` for the offset, and on a hit calls `new OpenFileDescriptor(project, file, offset).navigate(true)`.

- [ ] **Step 7: Verify**

Run: `./gradlew check runIde`
In the sandbox: open a `.bpmn` file, go to **BPMN Diff**, double-click a task in the **left** diagram — the editor tab opens with the caret on that element's opening tag. Double-clicking in the right diagram does nothing (a past revision has no document). Double-clicking a sequence flow also navigates.

- [ ] **Step 8: Commit**

```bash
git add webview/src/main.js src/main/java/com/github/bpmncompare/BpmnComparePanel.java src/main/java/com/github/bpmncompare/Json.java src/test/java/com/github/bpmncompare/JsonTest.java CHANGELOG.md
git commit -m "Open the XML of an element on double-click"
```

### Task 16: Highlight the element under the caret

**Files:**
- Modify: `webview/src/main.js` (`selectElement`)
- Modify: `src/main/java/com/github/bpmncompare/BpmnComparePanel.java` (caret listener, checkbox)
- Modify: `src/main/java/com/github/bpmncompare/BpmnCompareSettings.java` (remembered flag)

- [ ] **Step 1: Add the web view entry point**

```js
/** Selects and centres an element, driven by the caret position in the XML editor. */
function selectElement(id) {
  if (id && panes.left.loaded) {
    focusElement(id);
  }
}
```

plus `selectElement,` in `window.bpmnCompare`. `focusElement` already centres both panes and highlights, so nothing else is needed.

- [ ] **Step 2: Make it opt-in**

Following the caret helps when the diff sits in a split next to the editor and distracts otherwise, so it is off by default and remembered like the sync flag: `BpmnCompareSettings.isFollowCaretEnabled()` / `setFollowCaretEnabled` on key `bpmnCompare.followCaret`, default `false`, driving a `JBCheckBox("Follow caret")` in the toolbar with the tooltip "Select the element the XML caret is in".

- [ ] **Step 3: Follow the caret**

Add a `CaretListener` via `EditorFactory.getInstance().getEventMulticaster().addCaretListener(…, this)`, ignoring events whose `event.getEditor().getDocument()` is not this file's document. Debounce with its own `Alarm caretAlarm` at `CARET_DELAY_MS = 250` so dragging the caret does not flood JCEF, and skip the work unless `pageReady` and the checkbox is selected. The request resolves `BpmnXmlLocator.elementIdAt(document.getText(), caretOffset)` and, on a non-null id, `call("selectElement", id)`.

- [ ] **Step 4: Verify**

Run: `./gradlew runIde`
In the sandbox: split the editor so the XML and the **BPMN Diff** tab are both visible, tick **Follow caret**, move the caret between elements — the matching element is highlighted and centred in both diagrams. Untick it and confirm the diagrams stop moving. Confirm the setting survives closing and reopening the tab.

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/github/bpmncompare/BpmnComparePanel.java src/main/java/com/github/bpmncompare/BpmnCompareSettings.java webview/src/main.js CHANGELOG.md
git commit -m "Optionally follow the XML caret in the diagrams"
```

---

## Phase 8 – Export (item 11)

### Task 17: Export a diagram and the change list

**Files:**
- Create: `webview/src/export.js`
- Create: `webview/test/export.test.js`
- Modify: `webview/src/main.js` (export menu), `index.html`, `styles.css`
- Modify: `src/main/java/com/github/bpmncompare/BpmnComparePanel.java` (save file / copy to clipboard)

- [ ] **Step 1: Write the failing test for the markdown export**

The markdown export is pure and is what a reviewer pastes into a pull request, so it gets the test; SVG/PNG are thin wrappers over bpmn-js and are verified by hand in step 7.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changesToMarkdown } from '../src/export.js';

const changes = [
  { id: 'Task_1', kind: 'added', name: 'Approve', type: 'ServiceTask', attrs: {} },
  { id: 'Gateway_1', kind: 'removed', name: 'Gateway_1', type: 'ExclusiveGateway', attrs: {} },
  {
    id: 'Task_2',
    kind: 'changed',
    name: 'Pay',
    type: 'ServiceTask',
    attrs: { name: { oldValue: 'Pay out', newValue: 'Pay' } }
  }
];

test('groups the changes under headings with counts', () => {
  const markdown = changesToMarkdown(changes, { left: 'working copy', right: 'main' });

  assert.match(markdown, /^## BPMN changes/m);
  assert.match(markdown, /working copy.*main/);
  assert.match(markdown, /### Added \(1\)/);
  assert.match(markdown, /### Removed \(1\)/);
  assert.match(markdown, /### Changed \(1\)/);
});

test('renders one bullet per change with type, name and id', () => {
  assert.match(changesToMarkdown(changes, { left: 'a', right: 'b' }),
    /- \*\*ServiceTask\*\* Approve \(`Task_1`\)/);
});

test('lists changed attributes as sub-bullets', () => {
  assert.match(changesToMarkdown(changes, { left: 'a', right: 'b' }), /  - name: Pay out \u2192 Pay/);
});

test('omits headings of kinds that have no changes', () => {
  assert.doesNotMatch(changesToMarkdown(changes, { left: 'a', right: 'b' }), /Moved/);
});

test('an empty change list says so instead of printing empty headings', () => {
  assert.match(changesToMarkdown([], { left: 'a', right: 'b' }), /No differences/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd webview && npm test`
Expected: FAIL — `Cannot find module '../src/export.js'`.

- [ ] **Step 3: Write the export module**

- `changesToMarkdown(changes, labels)` — `## BPMN changes`, a `` `left` vs `right` `` line, then `### Added/Removed/Changed/Moved (n)` sections in chip order, skipping empty ones, one `- **Type** Name (\`id\`)` bullet per change and `describeAttrs` entries as two-space sub-bullets; `No differences.` for an empty list.
- `paneToSvg(viewer)` — `const { svg } = await viewer.saveSVG(); return svg;`. Note `saveSVG` is on the bpmn-js viewer, **not** on the canvas, so the call site passes `pane.viewer`.
- `svgToPng(svg, scale = 2)` — loads the SVG into an `Image` via a `data:` URL, draws it into a `<canvas>` at `scale` and returns `toDataURL('image/png')`, rejecting on load error.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd webview && npm test`
Expected: PASS, 5 new tests.

- [ ] **Step 5: Add the export menu**

An `Export` `.bar-button` in `index.html` opens a small absolutely-positioned list (reusing the change-list styling) with three commands, each handing its payload to the host, since the page cannot write files:
- *Copy change list as Markdown* → `changesToMarkdown(currentChanges.filter(visibleKind), currentLabels)` — only what the user can see, matching the on-screen list;
- *Save left diagram as SVG* → `await paneToSvg(panes.left.viewer)`;
- *Save left diagram as PNG* → `await svgToPng(await paneToSvg(panes.left.viewer))`.

`currentLabels` is set in `render` from the two sides' labels. The bpmn.io watermark stays in the exported SVG — the licence requires it.

- [ ] **Step 6: Handle the commands on the IDE side**

Extend the `handleHostRequest` dispatch added in Task 15 with a `switch` over `command`:
- `copyMarkdown` → `CopyPasteManager.getInstance().setContents(new StringSelection(payload))`;
- `saveSvg` → `saveExport("svg", payload.getBytes(UTF_8))`;
- `savePng` → `saveExport("png", Base64-decoded data URL payload)`;
- `default` → `LOG.warn` with the unknown command.

`saveExport(extension, bytes)` runs on the EDT, proposes `<file name>-diff.<ext>`, asks via `FileChooserFactory.createSaveFileDialog(new FileSaverDescriptor(…), project)`, writes with `Files.write`, refreshes the VFS and reports an `IOException` with `Messages.showErrorDialog` rather than swallowing it.

- [ ] **Step 7: Verify**

Run: `cd webview && npm test` then `./gradlew runIde`
On a file with several changes:
1. **Export | Copy change list as Markdown**, paste into a scratch file — headings and bullets match the change list, and a kind filtered out by a chip is absent;
2. **Save left diagram as SVG** — the file opens in a browser showing the diagram *with* the coloured change markers and the bpmn.io watermark;
3. **Save left diagram as PNG** on a 50+ element diagram — the image is complete, which also proves the long data URL survived the bridge (the `readsALargeValueUnchanged` test covers the parser, not the transport).

- [ ] **Step 8: Commit**

```bash
git add webview/src/export.js webview/test/export.test.js webview/src/main.js webview/src/index.html webview/src/styles.css src/main/java/com/github/bpmncompare/BpmnComparePanel.java CHANGELOG.md
git commit -m "Export the diagrams as SVG or PNG and the change list as Markdown"
```

---

## Phase 9 – Release

### Task 18: Cut version 1.1.0

**Files:** `gradle.properties`, `CHANGELOG.md`, `README.md`

- [ ] **Step 1: Close the changelog section**

Rename `[Unreleased]` to `## [1.1.0]` and add a fresh empty `## [Unreleased]` above it. The entries collected in phases 3–8 are the release notes.

- [ ] **Step 2: Bump the version**

`pluginVersion=1.1.0` — minor, not patch: the release adds features.

- [ ] **Step 3: Update the README**

Add the diff-window entry point, extension-element awareness, keyboard navigation, caret following and export to the feature list, and refresh `## Structure` with the new files (`DiagramSide`, `BpmnContentSource`, `GitLogParser`, `BpmnXmlLocator`, `BpmnDiffTool`, `BpmnDiffViewer`, `GoToChangeAction`, `webview/src/{format,changes,extensions,export}.js`, `webview/test/`).

- [ ] **Step 4: Full verification**

Run: `./gradlew clean check buildPlugin verifyPluginStructure verifyPlugin`
Expected: `BUILD SUCCESSFUL`, `build/distributions/idea-bpmn-compare-1.1.0.zip` produced, no verifier problems.

- [ ] **Step 5: Confirm the change notes made it in**

Run: `grep -c Camunda build/patchedPluginXmlFiles/plugin.xml`
Expected: at least `1` — proof the 1.1.0 section reached `<change-notes>`.

- [ ] **Step 6: Install the built ZIP into a real IDE**

Settings | Plugins | Install Plugin from Disk, pick the ZIP, restart, and repeat Task 11 step 6 in a real project. A sandbox pass is not evidence that the packaged plugin works.

- [ ] **Step 7: Commit**

```bash
git add gradle.properties CHANGELOG.md README.md
git commit -m "Release 1.1.0"
```

---

## Notes for the implementer

- **`./gradlew runIde` uses `localIdePath`** from `~/.gradle/gradle.properties` — currently `C:/Program Files/JetBrains/IntelliJ IDEA 2026.1.3`, whose `build.txt` says `IU-262.9437.185`, so it is build 262 and matches `pluginSinceBuild`. If the sandbox fails to start, unset the property to fall back to the downloaded 2026.2.1.
- **Never restyle or hide `.bjs-powered-by`** — the bpmn.io licence requires the watermark to stay unchanged and fully visible, including in the Task 17 export.
- **Each phase leaves the plugin working.** Do not start a phase before the previous one's verification actually passed; a failing sandbox check is a stop signal, not a note for later.
- **Items covered:** 1 (Task 11), 2 (Task 13), 3 (Tasks 15–16), 4 (Task 14), 5 (Task 1), 6 (Task 2), 7 (Task 3), 8 (Task 4), 9 (Task 12), 10 (Tasks 5–8), 11 (Task 17). Item 12 (DMN/CMMN) is out of scope by decision.
