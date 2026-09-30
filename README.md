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
- **Synchronize mouse & view** – mirrors the cursor (a blue "ghost" cursor in the other diagram), hover and
  pan/zoom. The setting is remembered.

## Usage
Open a `.bpmn` file and switch to the **BPMN Diff** tab at the bottom of the editor,
or right-click the file → **Compare BPMN with Branch or Commit…**.

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
- `src/main/java/com/github/bpmncompare/` – editor tab (`BpmnCompareEditorProvider`), UI + JCEF bridge (`BpmnComparePanel`), Git (`GitRevisions`)
- `webview/src/` – page with two `NavigatedViewer`s, diff, markers, synchronization

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
