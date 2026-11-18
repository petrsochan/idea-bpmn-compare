import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { diff } from 'bpmn-js-differ';
import { BpmnModdle } from 'bpmn-moddle';

import { createChangeList } from './change-list.js';
import { toChangeList } from './changes.js';
import { decorate, visibleKind } from './decorations.js';
import { computeHistory, createElementMenu } from './element-menu.js';
import { changesToMarkdown } from './export.js';
import { createExportMenu } from './export-menu.js';
import { createFilter } from './filter.js';
import { sendToHost } from './host.js';
import { dropMinorLayoutChanges } from './layout.js';
import { createNavigation } from './navigation.js';
import {
  activePanes, canvasOf, collectFlowElements, createPane, elementOf, importInto, resizeAll, showMessage, viewOf
} from './panes.js';
import { orderEntries } from './merge-changes.js';
import { decorateMerge, detailsOf } from './merge-decorations.js';
import { createMergeView } from './merge-view.js';
import { createFullRepaint } from './repaint.js';
import { createSync } from './sync.js';
import { hideTip, installTooltips } from './tooltips.js';
import { createZoom } from './zoom.js';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import './styles.css';

/*
 * The diff view: wires the parts together, renders what the host sends and answers its calls.
 *
 * The host (IntelliJ plugin) drives this page through window.bpmnCompare.
 */

// see repaint.js - without it JCEF in the IDE keeps pieces of earlier frames on screen
const repaintFully = createFullRepaint(document.getElementById('repaint'));

for (const type of [ 'pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup' ]) {
  window.addEventListener(type, repaintFully, { capture: true, passive: true });
}
window.addEventListener('resize', repaintFully);
window.addEventListener('blur', repaintFully);

installTooltips(repaintFully);

const panes = {
  left: createPane('left', NavigatedViewer),
  right: createPane('right', NavigatedViewer)
};

for (const pane of Object.values(panes)) {
  pane.viewer.get('eventBus').on('canvas.viewbox.changing', repaintFully);

  // double-click opens the element in the XML editor; only the working copy has a document to open,
  // a past revision has none
  if (pane.side === 'left') {
    pane.viewer.get('eventBus').on('element.dblclick', (event) => sendToHost({ command: 'openXml', id: event.element.id }));
  }
}

window.addEventListener('resize', () => resizeAll(panes));

/** The changes of the current diff, in change-list order. */
let currentChanges = [];

/** Labels of the two sides, kept for the markdown header. */
let currentLabels = { left: '', right: '' };

const sync = createSync(panes);
const zoom = createZoom(panes, sync);
const filter = createFilter(redrawChanges);
const changeList = createChangeList({
  onPick: (id) => navigation.focusElement(id),
  onToggle: () => resizeAll(panes)
});
const navigation = createNavigation({
  panes,
  sync,
  visibleChanges,
  onSelect: (id) => changeList.markSelected(id),
  repaint: repaintFully
});
const exportMenu = createExportMenu({
  panes,

  // only what the user can see, so the export matches the change list on screen
  markdown: () => changesToMarkdown(visibleChanges(), currentLabels)
});
const elementMenu = createElementMenu({
  panes,
  beforeOpen: () => {
    exportMenu.close();
    hideTip();
  }
});

const mergeView = createMergeView({
  panes,
  sync,
  zoom,
  Viewer: NavigatedViewer,
  parse: (xml) => new BpmnModdle().fromXML(xml),
  onRendered: (merge) => {
    // the order is set when a merge is shown and kept while the user resolves it: rows that jumped
    // as their conflict got resolved would make F7 skip the open conflicts after the current one
    const entries = merge.fresh || !currentMerge
      ? orderEntries(merge.entries, merge.states)
      : inOrderOf(currentMerge.entries, merge.entries);

    currentMerge = { ...merge, entries };
    navigation.retainSelection(currentMerge.entries);
    changeList.renderMergeSummary(currentMerge.entries, currentMerge.states, merge.note);
    redrawChanges();
    zoom.updateControls();
  }
});

/** `entries` in the order of `ordered` (the same elements, as they do not change during a merge). */
function inOrderOf(ordered, entries) {
  const byId = new Map(entries.map((entry) => [ entry.id, entry ]));

  return ordered.map((entry) => byId.get(entry.id)).filter(Boolean);
}

/** The merge shown in merge mode: entries in change-list order, result states, changes base → result. */
let currentMerge = null;

function inMerge() {
  return document.body.dataset.mode === 'merge' && currentMerge;
}

/** In merge mode, whether the filter shows an entry: both-sided ones by the conflict chip, the others by kind. */
function isMergeEntryVisible(entry) {
  return entry.side === 'both' ? filter.kinds.has('conflict') : filter.kinds.has(entry.kind);
}

/** Changes the user can actually see, in change-list order, so navigation and the chips agree. */
function visibleChanges() {
  if (inMerge()) {
    return currentMerge.entries.filter(isMergeEntryVisible);
  }

  return currentChanges.filter((change) => visibleKind(change, filter.kinds));
}

/** Everything that depends on which kinds the filter shows. */
function redrawChanges() {
  if (inMerge()) {
    const { entries, states, resultChanges } = currentMerge;
    const hasResult = states.size > 0;

    decorateMerge(panes, entries, states, resultChanges, isMergeEntryVisible);
    changeList.renderMerge(entries, states, isMergeEntryVisible, navigation.selectedId,
      (entry) => detailsOf(entry, resultChanges.find((c) => c.id === entry.id), hasResult));
    navigation.updateButtons();
    return;
  }

  decorate(panes, currentChanges, filter.kinds);
  changeList.render(currentChanges, filter.kinds, navigation.selectedId);
  navigation.updateButtons();
}

// ---------------------------------------------------------------------------
// diagrams + diff
// ---------------------------------------------------------------------------

/** Renders waiting to run, oldest first; see enqueue. */
const queue = [];
let rendering = false;
let renders = 0;

/**
 * Queues a render. Renders run one at a time, in order; a render that waits behind another one of the
 * same type is replaced, so of several quick updates only the most recent is rendered.
 */
function enqueue(type, run) {
  const last = queue[queue.length - 1];

  if (last && last.type === type) {
    last.run = run;
  } else {
    queue.push({ type, run });
  }

  if (!rendering) {
    pump();
  }
}

async function pump() {
  rendering = true;

  while (queue.length) {
    const { run } = queue.shift();

    try {
      await run();
    } catch (err) {
      console.error('[bpmn-compare] render failed', err);
    }

    // tells tests (and anyone watching) that a render has finished
    document.body.dataset.renders = String(++renders);

    // the import finishes long after the host's call started the last burst
    repaintFully();
  }

  rendering = false;
}

function setDiagrams(payload) {
  enqueue('diagrams', () => {
    mergeView.setMode('diff');
    return render(payload);
  });
}

function setMerge(payload) {
  enqueue('merge', () => sync.quietly(() => mergeView.setMerge(payload)));
}

function setMergeResult(spec) {
  enqueue('result', () => sync.quietly(() => mergeView.setMergeResult(spec)));
}

function render(payload) {
  const previousView = payload.preserveView ? {
    left: panes.left.loaded ? viewOf(panes.left) : null,
    right: panes.right.loaded ? viewOf(panes.right) : null
  } : null;

  return sync.quietly(async () => {
    const [ newDefs, oldDefs ] = await Promise.all([
      importInto(panes.left, payload.left || {}),
      importInto(panes.right, payload.right || {})
    ]);

    let changes = null;

    if (newDefs && oldDefs) {
      // a modeller that rounds coordinates on save would otherwise mark half the diagram as moved
      changes = dropMinorLayoutChanges(diff(oldDefs, newDefs), oldDefs, newDefs);
    } else if (newDefs && payload.right && payload.right.missing) {

      // file does not exist in the revision -> everything is new
      changes = { _added: collectFlowElements(panes.left), _removed: {}, _changed: {}, _layoutChanged: {} };
    }

    currentLabels = {
      left: payload.left && payload.left.label || 'current',
      right: payload.right && payload.right.label || 'revision'
    };

    // the element maps let toChangeList also compare extensionElements, which the differ ignores
    currentChanges = toChangeList(changes,
      panes.left.loaded ? collectFlowElements(panes.left) : {},
      panes.right.loaded ? collectFlowElements(panes.right) : {});

    // the change we were stepping on may not exist any more
    navigation.retainSelection(currentChanges);

    changeList.renderSummary(currentChanges, newDefs, oldDefs);
    redrawChanges();

    restoreOrFit(previousView);

    // a diff window opened from the element history shows the element it was opened for
    if (payload.focus) {
      navigation.focusElement(payload.focus);
    }
    zoom.updateControls();
    navigation.updateButtons();
  });
}

function restoreOrFit(previousView) {
  for (const pane of activePanes(panes)) {
    const side = pane.side;
    const canvas = canvasOf(pane);
    canvas.resized();

    const view = previousView && previousView[side];

    if (view) {
      // the subprocess may have been deleted meanwhile - then the top-level plane stays
      const root = view.rootId && elementOf(pane, view.rootId);

      if (root) {
        canvas.setRootElement(root);
      }

      canvas.viewbox({ x: view.x, y: view.y, width: view.width, height: view.height });
    } else {
      canvas.zoom('fit-viewport', 'auto');
    }
  }

  // with sync on, start all sides from the same viewport
  const leader = activePanes(panes)[0];

  if (sync.enabled && leader && !(previousView && previousView[leader.side])) {
    sync.copyViewboxToOthers(leader);
  }
}

// ---------------------------------------------------------------------------
// host API + chrome
// ---------------------------------------------------------------------------

function setTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme && theme.dark ? 'dark' : 'light';

  for (const name of [ 'bg', 'fg', 'border' ]) {
    if (theme && theme[name]) {
      root.style.setProperty('--' + name, theme[name]);
    }
  }
}

function setStatus(side, text, isError) {
  const pane = panes[side];

  if (pane && (!pane.loaded || isError)) {
    showMessage(pane, text, isError);
  }
}

document.addEventListener('click', () => {
  exportMenu.close();
  elementMenu.close();
});

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (event.key === 'F7') {
    event.preventDefault();
    navigation.goToChange(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape' && elementMenu.isOpen()) {
    event.preventDefault();
    elementMenu.close();
  } else if (event.key === 'Escape' && !changeList.isHidden()) {
    event.preventDefault();
    changeList.setVisible(false);
  }
});

const hostApi = {
  setDiagrams,
  setMerge,
  setMergeResult,
  setMiddle: mergeView.setMiddle,
  isRendering: () => rendering,
  setHistoryAvailable: elementMenu.setHistoryAvailable,
  computeHistory,
  setSync: sync.setEnabled,
  setTheme,
  setStatus,
  setVisibleKinds: filter.set,
  focusElement: navigation.focusElement,
  goToChange: navigation.goToChange,
  selectElement: navigation.selectElement
};

// whatever the host asks for may change the picture
window.bpmnCompare = Object.fromEntries(Object.entries(hostApi).map(([ name, fn ]) => [ name, (...args) => {
  repaintFully();
  return fn(...args);
} ]));
