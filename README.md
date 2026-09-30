# BPMN Compare – IntelliJ IDEA plugin

[![Build](https://github.com/petrsochan/idea-bpmn-compare/actions/workflows/build.yml/badge.svg)](https://github.com/petrsochan/idea-bpmn-compare/actions/workflows/build.yml)

Visual comparison of BPMN diagrams with any Git revision, powered by [bpmn.io](https://bpmn.io)
(`bpmn-js` for rendering, `bpmn-js-differ` for computing the differences).

- **Left:** the current content of the file (including unsaved changes, refreshed while you edit).
- **Right:** the same file from a chosen branch (local/remote), tag, commit that changed the file,
  or any revision expression (`HEAD~3`, a hash, …).
- Highlighting: 🟢 added (left), 🔴 removed (right), 🟠 changed attributes, 🟣 moved (layout change).
  The Added / Removed / Changed / Moved chips in the top bar work as a filter – click one to hide that kind
  of change from the diagrams and the change list (counts stay visible, the selection is remembered).
  The badge on an element has a tooltip with details; the *Changes list* button shows all changes –
  click an entry to center the element.
- **Camunda / Zeebe extensions** are compared too – execution listeners, input/output mappings, form fields,
  `zeebe:taskDefinition`. `bpmn-js-differ` ignores `extensionElements`, so an edit touching only a Camunda
  listener would otherwise show no change at all.
- **F7 / Shift+F7** step through the visible changes (wrapping around, skipping kinds hidden by a chip);
  the same two buttons are in the top bar, and Escape closes the change list.
- **Diagram ↔ XML** – double-click an element to open the XML editor on it; **Follow caret** (off by default)
  does the reverse and selects the element the caret is in.
- **Export** – the change list as Markdown into the clipboard, or the left diagram as SVG/PNG with the markers.
- **Synchronize mouse & view** – mirrors the cursor (a blue "ghost" cursor in the other diagram), hover and
  pan/zoom. The setting is remembered.
- The compared revision reloads by itself after a commit, checkout, fetch or rebase.

## Usage
Open a `.bpmn` file and switch to the **BPMN Diff** tab at the bottom of the editor,
or right-click the file → **Compare BPMN with Branch or Commit…**.

Any IDE diff of a `.bpmn` file can be switched to the BPMN view as well – open a diff from the commit dialog,
the Git log, *Compare with Branch…* or *Compare Two Files*, and pick **BPMN diagram** in the diff tool selector.
That is also the way to compare two revisions with each other; the editor tab always has the working copy on the left.

## Build
Requires JDK 21+ and Node.js (npm) – the web part in `webview/` is bundled with esbuild automatically during the build.

```
./gradlew runIde        # sandbox IDE with the plugin
./gradlew buildPlugin   # build/distributions/idea-bpmn-compare-*.zip → Settings | Plugins | Install Plugin from Disk
```

By default IntelliJ IDEA `platformVersion` from `gradle.properties` is downloaded. To build against a locally
installed IDEA instead (no download), set its path in `~/.gradle/gradle.properties`:

```
localIdePath=C:/Program Files/JetBrains/IntelliJ IDEA 2026.2
```

Every push to `main` and every pull request is built by GitHub Actions (`.github/workflows/build.yml`);
the plugin ZIP is attached to the workflow run as an artifact.

Target: IntelliJ IDEA 2026.2+ (build 262) – in this version JCEF and DVCS are separate platform modules.
Those IDEs run on JBR 21, so the plugin is compiled to Java 21 bytecode. Earlier IDEs are not supported;
compatibility is checked by the IntelliJ Plugin Verifier (`./gradlew verifyPlugin`) as part of the build.

## Structure
`src/main/java/com/github/bpmncompare/`
- `BpmnCompareEditorProvider`, `BpmnCompareEditor` – the **BPMN Diff** editor tab
- `BpmnDiffTool`, `BpmnDiffViewer` – the same view as a tool in the IDE's own diff windows
- `BpmnComparePanel` – toolbar, JCEF browser and the bridge in both directions
- `BpmnContentSource` – where a pane's content comes from: working copy, Git revision, or text from the platform
- `DiagramSide` – what a pane shows, and its JSON shape for the page
- `GitRevisions`, `GitLogParser` – Git access and parsing of the revision chooser entries
- `BpmnXmlLocator` – element id ↔ offset in the XML, for navigating between diagram and editor
- `GoToChangeAction` – the F7 / Shift+F7 actions
- `Json` – the minimal JSON written to and read from the page

`webview/src/` – page with two `NavigatedViewer`s, markers, synchronization, zoom and filters (`main.js`),
plus the pure modules it is built from: `changes.js` (change list), `extensions.js` (Camunda/Zeebe
extension elements), `format.js` (names and values), `export.js` (Markdown, SVG, PNG).

Tests: `src/test/java/…` (JUnit) and `webview/test/` (`node:test`). Both run in `./gradlew check`.

## License
The plugin is licensed under the [MIT License](LICENSE). The `LICENSE` file is included in the root of the plugin
ZIP and in `META-INF` of the plugin jar.

## Third-party licenses
The web part bundles [bpmn-js](https://github.com/bpmn-io/bpmn-js) (© Camunda Services GmbH, bpmn.io license),
[bpmn-js-differ](https://github.com/bpmn-io/bpmn-js-differ) (MIT) and their dependencies (MIT / ISC).

- The build (`webview/build.mjs`) generates `THIRD-PARTY-NOTICES.txt` with the copyright and full license text
  of every package that actually ends up in the bundle. The file is in the root of the plugin ZIP and in the jar
  next to the bundle, and the headers of `bundle.js`/`bundle.css` refer to it. A bundled package without
  a license file fails the build.
- The bpmn.io license requires the "bpmn.io" watermark in the diagram to stay **unchanged and fully visible**
  and not overlapped by other elements – `.bjs-powered-by` must therefore never be restyled or hidden.
  Links from the watermark open in the system browser.
