import { diff } from 'bpmn-js-differ';

import { toChangeList } from './changes.js';
import { dropMinorLayoutChanges } from './layout.js';
import { resultStates, toMergeEntries } from './merge-changes.js';
import {
  activePanes, canvasOf, collectFlowElements, createPane, importInto, importKeepingLast, viewOf
} from './panes.js';
import { setTip } from './tooltips.js';

/*
 * Merge mode: the IDE's merge window shows ours | result | theirs, with the base behind a switch in the
 * middle. The result is the merge window's result document and is replaced while the user resolves.
 */

export const MERGE_SIDES = [ 'ours', 'result', 'base', 'theirs' ];

const INVALID_RESULT = 'The result is not valid BPMN right now – showing the last valid state.';

/**
 * @param {object} options
 * @param {Object<string, object>} options.panes the page's panes by side; the merge panes are added on first use
 * @param {ReturnType<import('./sync.js').createSync>} options.sync
 * @param {ReturnType<import('./zoom.js').createZoom>} options.zoom
 * @param {Function} options.Viewer the bpmn-js viewer class
 * @param {(merge: { entries, states, resultChanges, fresh, note }) => void} options.onRendered after every render;
 *   `fresh` for a new merge, `note` says why the changes are incomplete ('' when they are not)
 * @param {(id: string) => void} options.onElementClick an element (or its label) was clicked in a merge pane
 * @param {(id: string) => void} options.onElementDblClick an element (or its label) was double-clicked
 */
export function createMergeView({ panes, sync, zoom, Viewer, onRendered, onElementClick, onElementDblClick }) {
  let middle = 'result';

  /** What the user picked in the middle; a merge without a result shows the base regardless. */
  let preferredMiddle = 'result';

  /** Definitions and elements of ours, base and theirs, and the entries computed from them. */
  let fixed = null;

  /** The last valid result. */
  let result = null;

  /** Labels of ours, base and theirs, for naming a side that cannot be read. */
  let labels = {};

  function ensurePanes() {
    if (panes.ours) {
      return;
    }

    for (const side of MERGE_SIDES) {
      const pane = createPane(side, Viewer);
      panes[side] = pane;
      sync.attach(pane);
      zoom.attach(pane);

      // a click on the empty canvas is a click on the root element - that selects nothing
      pane.viewer.get('eventBus').on('element.click', (event) => {
        const element = event.element;

        if (element.parent && element.businessObject) {
          onElementClick(element.businessObject.id);
        }
      });

      pane.viewer.get('eventBus').on('element.dblclick', (event) => {
        const element = event.element;

        if (element.parent && element.businessObject) {
          onElementDblClick(element.businessObject.id);
        }
      });
    }

    for (const button of document.querySelectorAll('[data-middle]')) {
      button.addEventListener('click', () => {
        preferredMiddle = button.dataset.middle;
        setMiddle(button.dataset.middle);
      });
    }
  }

  /** Which panes take part: the merge panes in merge mode, left and right otherwise. */
  function setMode(mode) {
    document.body.dataset.mode = mode;

    for (const side of [ 'left', 'right' ]) {
      panes[side].shown = mode !== 'merge';
    }

    if (panes.ours) {
      panes.ours.shown = panes.theirs.shown = mode === 'merge';
      panes.result.shown = mode === 'merge' && middle === 'result';
      panes.base.shown = mode === 'merge' && middle === 'base';
    }
  }

  /** Shows the result or the base in the middle, on the plane and region the other panes show. */
  function setMiddle(which) {
    if (which !== 'result' && which !== 'base') {
      return;
    }

    middle = which;

    if (!panes.ours) {
      return;
    }

    panes.result.root.hidden = which !== 'result';
    panes.base.root.hidden = which !== 'base';
    setMode(document.body.dataset.mode);

    for (const button of document.querySelectorAll('[data-middle]')) {
      button.setAttribute('aria-pressed', String(button.dataset.middle === which));
    }

    const shown = panes[which];
    const leader = activePanes(panes).find((pane) => pane !== shown);

    if (shown.loaded) {
      canvasOf(shown).resized();

      if (leader) {
        sync.syncPlane(leader.side, canvasOf(leader).getRootElement().id);
        sync.copyViewbox(leader, shown);
      }
    }

    zoom.updateControls();
  }

  /** Renders a whole merge: `{ ours, base, theirs, result }`, each like a side of setDiagrams. */
  async function setMerge(payload) {
    ensurePanes();
    setMode('merge');

    // a conflict that nobody has resolved yet (the BPMN Diff tab) has no result: the base is the middle
    const withResult = !!(payload.result && (payload.result.xml || payload.result.error || payload.result.message));
    document.body.dataset.mergeResult = String(withResult);
    setMiddle(withResult ? preferredMiddle : 'base');

    const [ ours, base, theirs ] = await Promise.all([
      importInto(panes.ours, payload.ours || {}),
      importInto(panes.base, payload.base || {}),
      importInto(panes.theirs, payload.theirs || {})
    ]);

    labels = {
      ours: (payload.ours && payload.ours.label) || 'Ours',
      base: (payload.base && payload.base.label) || 'Base',
      theirs: (payload.theirs && payload.theirs.label) || 'Theirs'
    };

    const elements = (pane) => (pane.loaded ? collectFlowElements(pane) : {});
    fixed = {
      ours: ours && { defs: ours, elements: elements(panes.ours) },
      base: base && { defs: base, elements: elements(panes.base) },
      theirs: theirs && { defs: theirs, elements: elements(panes.theirs) }
    };
    fixed.entries = toMergeEntries(
      changesBetween(fixed.base, fixed.ours),
      changesBetween(fixed.base, fixed.theirs),
      changesBetween(fixed.ours, fixed.theirs));

    // a new merge: forget the result of the previous one, so a broken result is reported, not kept
    panes.result.viewer.clear();
    panes.result.loaded = false;
    result = null;
    await importResult(payload.result || {});

    for (const pane of activePanes(panes)) {
      canvasOf(pane).resized();
      canvasOf(pane).zoom('fit-viewport', 'auto');
    }

    const leader = activePanes(panes)[0];

    if (sync.enabled && leader) {
      sync.copyViewboxToOthers(leader);
    }

    // the base is hidden but must already be at the same place when it is switched in
    if (leader && panes.base.loaded && !panes.base.shown) {
      sync.copyViewbox(leader, panes.base);
    }

    rendered(true);
  }

  /** Replaces the result, keeping where each pane looks. */
  async function setMergeResult(spec) {
    if (!fixed) {
      return;
    }

    const view = panes.result.loaded ? viewOf(panes.result) : null;

    await importResult(spec || {});

    if (view && panes.result.loaded) {
      const canvas = canvasOf(panes.result);
      const root = view.rootId && panes.result.viewer.get('elementRegistry').get(view.rootId);

      if (root) {
        canvas.setRootElement(root);
      }

      canvas.viewbox({ x: view.x, y: view.y, width: view.width, height: view.height });
    } else if (panes.result.loaded) {
      canvasOf(panes.result).zoom('fit-viewport', 'auto');
    }

    rendered();
  }

  async function importResult(spec) {
    const { defs, warnings, kept } = await importKeepingLast(panes.result, spec);
    const notice = panes.result.root.querySelector('.notice');

    let text = '';

    if (kept) {
      text = INVALID_RESULT;
    } else if (warnings.length) {
      text = 'The result has ' + warnings.length + (warnings.length === 1 ? ' problem' : ' problems')
        + ' – parts of it may not be drawn.';
    }

    notice.textContent = text;
    setTip(notice, warnings.map((w) => w && w.message || String(w)).join('\n'));

    if (!kept) {
      result = defs ? { defs, elements: collectFlowElements(panes.result) } : null;
    }
  }

  /** @param {boolean} [fresh] a new merge, not just a new result */
  function rendered(fresh = false) {
    const { entries } = fixed;
    let states = new Map();
    let resultChanges = [];

    if (result && fixed.base) {
      resultChanges = changesBetween(fixed.base, result);
      states = resultStates(entries, resultChanges,
        fixed.ours ? changesBetween(fixed.ours, result) : [],
        fixed.theirs ? changesBetween(fixed.theirs, result) : []);
    }

    onRendered({ entries, states, resultChanges, fresh, labels, note: unavailableNote() });
  }

  /** Why the changes are incomplete, or '' when ours, base and theirs could all be read. */
  function unavailableNote() {
    if (!fixed.base) {
      return 'The base is not available – the changes cannot be classified.';
    }

    const unreadable = [ 'ours', 'theirs' ].filter((side) => !fixed[side]);

    if (unreadable.length === 2) {
      return 'Neither side can be read – there are no changes to show.';
    }

    return unreadable.length ? labels[unreadable[0]] + " cannot be read – only the other side's changes are shown." : '';
  }

  return { setMerge, setMergeResult, setMiddle, setMode };
}

/** The change list the two-pane view would show for old → new; empty when either is missing. */
function changesBetween(oldSide, newSide) {
  if (!oldSide || !newSide) {
    return [];
  }

  return toChangeList(dropMinorLayoutChanges(diff(oldSide.defs, newSide.defs), oldSide.defs, newSide.defs),
    newSide.elements, oldSide.elements);
}
