import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { diff } from 'bpmn-js-differ';

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

/** Changes the user can actually see, in change-list order, so navigation and the chips agree. */
function visibleChanges() {
  return currentChanges.filter((change) => visibleKind(change, filter.kinds));
}

/** Everything that depends on which kinds the filter shows. */
function redrawChanges() {
  decorate(panes, currentChanges, filter.kinds);
  changeList.render(currentChanges, filter.kinds, navigation.selectedId);
  navigation.updateButtons();
}

// ---------------------------------------------------------------------------
// diagrams + diff
// ---------------------------------------------------------------------------

let pendingPayload = null;
let rendering = false;

/** Queues a render; only the most recent payload is rendered if several arrive quickly. */
function setDiagrams(payload) {
  pendingPayload = payload;

  if (!rendering) {
    pump();
  }
}

async function pump() {
  rendering = true;

  while (pendingPayload) {
    const payload = pendingPayload;
    pendingPayload = null;

    try {
      await render(payload);
    } catch (err) {
      console.error('[bpmn-compare] render failed', err);
    }

    // the import finishes long after the host's call started the last burst
    repaintFully();
  }

  rendering = false;
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
