# Changelog

All notable changes to the BPMN Compare plugin are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- An attribute that was added or removed is shown the right way round in the badge tooltip, the change list and the Markdown export. An added attribute appeared as if it had been removed (`"New" → ∅`), and a removed one as changed to `"0"`; now they read `∅ → "New"` and `"Old" → ∅`. The fix comes with `bpmn-js-differ` 4.0, which reports old and new values correctly, so the plugin no longer swaps them itself.

## [1.1.0]

### Added
- The BPMN view is available in every IDE diff window — the commit dialog, the Git log, *Compare with Branch*, *Compare Two Files*. Pick **BPMN diagram** in the diff tool selector; the text diff stays the default. This is also the only way to compare two revisions of a diagram with each other, which the editor tab cannot do.
- Changes inside `extensionElements` are reported too — Camunda execution listeners, input/output mappings and form fields, and Zeebe task definitions. `bpmn-js-differ` ignores them, so until now an edit that touched only a Camunda listener showed no change at all.
- **F7** / **Shift+F7** step through the visible changes, wrapping around and skipping kinds hidden by a filter chip; the change list highlights where you are, the top bar has the same two buttons, and Escape closes the list.
- Navigation between the diagram and the XML: double-click an element to open the editor with the caret on it, and **Follow caret** (off by default) does the reverse, selecting the element the caret is in.
- **Export**: the change list as Markdown into the clipboard, ready for a pull request and honouring the filter chips, or the left diagram as SVG or PNG with the change markers included.

### Changed
- The compared revision reloads by itself after a commit, checkout, fetch or rebase, instead of showing the previous content until Refresh was pressed.

### Fixed
- Tooltips in the diff view are shown at last. None of them had ever been visible — not on the top bar buttons or the filter chips, and not on the change badges, even though the badge tooltip listing the changed attributes is a documented feature. Inside JCEF a native tooltip only appears if the host draws it, so the view now draws its own.

## [1.0.1]

### Added
- Zoom controls in the toolbar (zoom in/out, 100 %, fit). With synchronization on, zooming one side is enough — the other follows, so both diagrams keep showing the same region.

## [1.0.0]

### Added
- Side-by-side comparison of a BPMN file with any Git revision — branch, tag, commit touching the file, or a revision expression such as `HEAD~3`.
- Highlighting of added, removed, changed and moved elements, with filter chips and a change list that centres an element on click.
- Optional synchronization of mouse cursor, hover and pan/zoom between both diagrams.
