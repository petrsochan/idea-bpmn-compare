# BPMN Compare – IntelliJ IDEA plugin

[![Build](https://github.com/petrsochan/idea-bpmn-compare/actions/workflows/build.yml/badge.svg)](https://github.com/petrsochan/idea-bpmn-compare/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/petrsochan/idea-bpmn-compare)](https://github.com/petrsochan/idea-bpmn-compare/releases/latest)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/petrsochan/idea-bpmn-compare/badge)](https://securityscorecards.dev/viewer/?uri=github.com/petrsochan/idea-bpmn-compare)

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

### Security and dependency automation
- **Build** (`build.yml`) also runs weekly and audits the bundled npm dependencies (`npm audit --omit=dev`).
- **Dependabot** (`.github/dependabot.yml`) – weekly updates of npm, Gradle (incl. the wrapper) and actions;
  security updates come immediately. Patch/minor updates are merged automatically once the checks pass
  (`dependabot-automerge.yml`) – except `bpmn-js` and `bpmn-js-differ`, which always wait for a manual review.
- **IntelliJ Platform** (`update-platform.yml`) – Dependabot cannot read `platformVersion`, so a weekly job
  opens a PR when a newer IntelliJ IDEA is released. Never merged automatically.
- **Dependency review** (`dependency-review.yml`) – fails a PR that brings in a dependency with a known
  high/critical vulnerability.
- **CodeQL** (default setup in the repository settings) – Java, JavaScript and the workflows themselves.
- **OpenSSF Scorecard** (`scorecard.yml`) – weekly supply-chain audit, results in *Security › Code scanning*.
- **Ruleset on `main`** – *Build plugin*, *Dependency review* and CodeQL must pass; repository admins may bypass
  it, so direct pushes to `main` still work.
- Actions are pinned to commit SHAs (Dependabot updates them); the Gradle distribution is pinned by checksum.

### Releasing
1. Move the `[Unreleased]` entries in `CHANGELOG.md` under `## [X.Y.Z]` and set `pluginVersion=X.Y.Z`
   in `gradle.properties`; merge that to `main`.
2. Tag the release commit and push the tag:
   ```
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
3. `release.yml` checks that the tag matches `pluginVersion` and is on `main`, builds and verifies the plugin,
   and publishes a GitHub Release with the ZIP, the changelog section as notes, its SHA-256 and a build
   provenance attestation (`gh attestation verify <zip> --repo petrsochan/idea-bpmn-compare`).

Running *Release* manually (*Actions › Release › Run workflow*) with an existing tag is a dry run: it does
everything except publishing and attaches the ZIP and the notes to the run.

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

### Things that look wrong but are not
- **The page draws its own tooltips** (`data-tip` plus the tooltips section of `main.js`), and uses no
  `title` attribute. Inside JCEF a native tooltip is handed to the client through
  `CefDisplayHandler#onTooltip`, which `JBCefClient` only forwards to display handlers a plugin
  registers – so a `title` is silently swallowed and nothing is ever shown.
- **Inactive top bar buttons use `aria-disabled`, not `disabled`.** A disabled button receives no
  pointer events, so it could not be hovered to explain why it does nothing.
- **`normalizeAttrs` swaps the differ's old and new values** on purpose: `bpmn-js-differ` walks from
  the current file to the revision, so its `oldValue` is our new one. `webview/test/format.test.js`
  pins this down.

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
