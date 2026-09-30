# Changelog

All notable changes to the BPMN Compare plugin are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- The BPMN view is available in every IDE diff window - the commit dialog, the Git log, *Compare with Branch*, *Compare Two Files*. Pick **BPMN diagram** in the diff tool selector; the text diff stays the default. This is also the only way to compare two revisions of a diagram with each other.
- Changes inside `extensionElements` are reported too - Camunda execution listeners, input/output mappings and form fields, and Zeebe task definitions. bpmn-js-differ ignores them, so until now an edit that only touched a Camunda listener showed no change at all.
- **F7** / **Shift+F7** step through the visible changes, wrapping around; the change list highlights where you are. The toolbar has the same two buttons, and Escape closes the change list. Filtered-out kinds are skipped.
- Double-clicking an element in the left diagram opens the XML editor with the caret on that element.
- **Follow caret** (off by default) selects and centres the element the XML caret is in, which is useful with the diff view in a split next to the editor.

### Changed
- The compared revision reloads by itself after a commit, checkout, fetch or rebase, instead of showing the previous content until Refresh was pressed.

## [1.0.1]

### Added
- Zoom controls in the toolbar (zoom in/out, 100 %, fit). With synchronization on, zooming one side is enough — the other follows, so both diagrams keep showing the same region.

## [1.0.0]

### Added
- Side-by-side comparison of a BPMN file with any Git revision — branch, tag, commit touching the file, or a revision expression such as `HEAD~3`.
- Highlighting of added, removed, changed and moved elements, with filter chips and a change list that centres an element on click.
- Optional synchronization of mouse cursor, hover and pan/zoom between both diagrams.
