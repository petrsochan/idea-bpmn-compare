# Changelog

All notable changes to the BPMN Compare plugin are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Element history** – right-click an element and pick *History of "…"* to see the commits that changed it: author, date, commit message and what happened to the element, such as a rename or a move. A click opens that commit's diff in the BPMN view, centred on the element. A commit is listed exactly when its diff shows the element changed – the same comparison as the view, Camunda and Zeebe extensions and the tolerance for tiny shifts included – and renames of the file are followed.
- **Merge conflicts in diagrams** – the IDE's merge window of a `.bpmn` file shows the diagrams of ours, the result and theirs above the unchanged text merge, with the base behind a switch in the middle. Each side's changes against the base are highlighted, and elements both sides changed are outlined in every diagram – loudly while the conflict is open. They come first in the change list and in F7 order, and a *Conflicts* chip counts how many are still open. The result diagram follows every Accept, Apply and edit and shows which side each change was taken from; a result that is not valid BPMN for a moment keeps the last valid diagram. F7, a click on an element or on a change-list row puts the caret of the result column on that element, and moving the caret in the result column selects the element in the diagrams. *Export* copies the change list of the merge as Markdown, ready for the pull request that resolves it. Resolving stays in the text merge; *Show BPMN Diagrams* in its toolbar hides the diagrams, and the choice is remembered. The diagrams help with merging smaller changes – a few renamed, moved or added elements; they make no claim to untangle complex merges, where the text merge remains the tool.
- **Conflict in the BPMN Diff tab** – while a `.bpmn` file is in conflict outside the merge window, for example after a merge or rebase on the command line, the tab switches by itself to ours, base and theirs from the Git index, with the same highlights. *Resolve…* opens the merge window, and once the conflict is gone the tab compares with the chosen revision again.

### Changed
- Panning or zooming a large diagram, or moving the mouse while the diagrams are synchronized, no longer leaves pieces of earlier frames on screen – white blocks over the diagram, a strip of it repeated below, ghost cursors that stayed where the mouse had been. The IDE's embedded browser copied only the last of several quickly drawn frames, so the page now repaints the whole view while something moves.
- Tiny layout shifts are no longer reported as moves. A shape, label or bend point that shifted by at most 5 px – typically a modeller rounding coordinates or re-placing labels when it saves – is left out of the *Moved* count, the markers and the change list. A changed number of bend points and an expanded or collapsed subprocess are still reported.

### Fixed
- The *BPMN diagram* view of a diff shown in a modal dialog no longer stays empty until the dialog is closed.

## [1.2.0]

### Added
- A collapsed subprocess with changes inside is marked with a dashed outline and a badge counting them, coloured by the most important kind of change inside, and while synchronized both diagrams drill in and out of subprocesses together.

### Fixed
- Changes inside collapsed subprocesses can be reached. F7 and the change list open the subprocess and centre the element instead of scrolling the top-level diagram to an empty spot, and editing the XML no longer throws you out of the subprocess you are looking at.
- A renamed or moved diagram keeps its history. The revision chooser lists the commits from before the rename, and an older revision is read under the name the file had then, instead of the file being reported as missing and every element as added. The rename is followed before it is committed too, so renaming or moving the file in the IDE and comparing with HEAD or picking an older commit still shows what changed. The label of such a revision says which name was used. A diagram copied from another one is still shown as new, not compared with the file it was copied from.
- The synchronized ghost cursor no longer leaves a trail of half-drawn circles over the diagram as it moves.

## [1.1.1]

### Changed
- Diagrams are rendered with `bpmn-js` 18.31, which fixes the layout of external labels and of long element names.

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
