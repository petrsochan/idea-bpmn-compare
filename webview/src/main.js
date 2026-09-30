import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { diff } from 'bpmn-js-differ';
import { getBBox } from 'diagram-js/lib/util/Elements';

import { KINDS, toChangeList } from './changes.js';
import { changesToMarkdown, svgToPng, viewerToSvg } from './export.js';
import { describeAttrs, displayName, typeName } from './format.js';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import './styles.css';

/*
 * Left pane  = current working copy ("new" side of the diff).
 * Right pane = selected Git revision ("old" side of the diff).
 *
 * The host (IntelliJ plugin) drives this page through window.bpmnCompare.
 */

const KIND_LABEL = { added: 'Added', removed: 'Removed', changed: 'Changed', layout: 'Moved' };
const KIND_BADGE = { added: '+', removed: '−', changed: '✎', layout: '⇄' };

const panes = {
  left: createPane('left'),
  right: createPane('right')
};

let syncEnabled = true;
let applyingSync = false;
let pendingSyncFrom = null;
let currentChanges = [];

const FILTER_KEY = 'bpmnCompare.visibleKinds';
const visibleKinds = loadVisibleKinds();

// ---------------------------------------------------------------------------
// panes
// ---------------------------------------------------------------------------

function createPane(side) {
  const root = document.getElementById('pane-' + side);
  const canvasEl = root.querySelector('.canvas');

  const pane = {
    side,
    root,
    canvasEl,
    labelEl: root.querySelector('.label'),
    messageEl: root.querySelector('.message'),
    ghostEl: root.querySelector('.ghost-cursor'),
    viewer: new NavigatedViewer({ container: canvasEl }),
    loaded: false
  };

  const eventBus = pane.viewer.get('eventBus');

  eventBus.on('canvas.viewbox.changing', () => scheduleViewSync(side));

  eventBus.on('canvas.viewbox.changed', () => updateZoomControls());

  eventBus.on('element.hover', (event) => {
    if (syncEnabled) {
      setSyncHover(other(side), event.element.id, true);
    }
  });

  eventBus.on('element.out', (event) => setSyncHover(other(side), event.element.id, false));

  // double-click opens the element in the XML editor; only the working copy has a document to open,
  // a past revision has none
  eventBus.on('element.dblclick', (event) => {
    if (side === 'left') {
      sendToHost({ command: 'openXml', id: event.element.id });
    }
  });

  canvasEl.addEventListener('mousemove', (event) => {
    if (syncEnabled) {
      mirrorCursor(pane, event);
    }
  });

  canvasEl.addEventListener('mouseleave', () => hideGhost(panes[other(side)]));

  return pane;
}

function other(side) {
  return side === 'left' ? 'right' : 'left';
}

/** Sends a message to the IDE. The bridge is absent until the host injects it, and in a plain browser. */
function sendToHost(message) {
  if (window.bpmnCompareHost) {
    window.bpmnCompareHost(message);
  }
}

function canvasOf(pane) {
  return pane.viewer.get('canvas');
}

function showMessage(pane, text, isError) {
  pane.messageEl.textContent = text || '';
  pane.messageEl.classList.toggle('error', !!isError);
}

async function importInto(pane, spec) {
  pane.labelEl.textContent = spec.label || '';
  pane.labelEl.title = spec.label || '';

  if (!spec.xml) {
    pane.viewer.clear();
    pane.loaded = false;
    showMessage(pane, spec.error || spec.message || 'Nothing to show', !!spec.error);
    return null;
  }

  try {
    await pane.viewer.importXML(spec.xml);
    pane.loaded = true;
    showMessage(pane, '');
    return pane.viewer.getDefinitions();
  } catch (err) {
    pane.viewer.clear();
    pane.loaded = false;
    showMessage(pane, 'Cannot render diagram:\n' + (err && err.message || err), true);
    return null;
  }
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
  }

  rendering = false;
}

async function render(payload) {
  const previousView = payload.preserveView ? {
    left: panes.left.loaded ? { ...canvasOf(panes.left).viewbox() } : null,
    right: panes.right.loaded ? { ...canvasOf(panes.right).viewbox() } : null
  } : null;

  applyingSync = true;

  try {
    const [ newDefs, oldDefs ] = await Promise.all([
      importInto(panes.left, payload.left || {}),
      importInto(panes.right, payload.right || {})
    ]);

    let changes = null;

    if (newDefs && oldDefs) {
      changes = diff(oldDefs, newDefs);
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
    selectedChangeId = currentChanges.some((change) => change.id === selectedChangeId) ? selectedChangeId : null;

    decorate(currentChanges);
    renderSummary(currentChanges, newDefs, oldDefs);
    renderChangeList(currentChanges);

    restoreOrFit(previousView);
    updateZoomControls();
    updateChangeNav();
  } finally {
    applyingSync = false;
  }
}

function collectFlowElements(pane) {
  const result = {};

  pane.viewer.get('elementRegistry').forEach((element) => {
    if (element.businessObject && element.type !== 'label' && element.parent) {
      result[element.id] = element.businessObject;
    }
  });

  return result;
}

function restoreOrFit(previousView) {
  for (const side of [ 'left', 'right' ]) {
    const pane = panes[side];

    if (!pane.loaded) {
      continue;
    }

    const canvas = canvasOf(pane);
    canvas.resized();

    const view = previousView && previousView[side];

    if (view) {
      canvas.viewbox({ x: view.x, y: view.y, width: view.width, height: view.height });
    } else {
      canvas.zoom('fit-viewport', 'auto');
    }
  }

  // with sync on, start both sides from the same viewport
  if (syncEnabled && panes.left.loaded && panes.right.loaded && !(previousView && previousView.left)) {
    copyViewbox(panes.left, panes.right);
  }
}

/** Sides a change kind is drawn on. */
function sidesFor(kind) {
  if (kind === 'added') {
    return [ 'left' ];
  }

  if (kind === 'removed') {
    return [ 'right' ];
  }

  return [ 'left', 'right' ];
}

/** Kind the element is shown as: the most important kind that is not filtered out. */
function visibleKind(change) {
  return KINDS.find((k) => change.kinds.has(k) && visibleKinds.has(k));
}

function clearDecorations() {
  for (const pane of Object.values(panes)) {
    if (!pane.loaded) {
      continue;
    }

    const canvas = canvasOf(pane);

    pane.viewer.get('elementRegistry').forEach((element) => {
      for (const kind of KINDS) {
        if (canvas.hasMarker(element, 'diff-' + kind)) {
          canvas.removeMarker(element, 'diff-' + kind);
        }
      }
    });

    pane.viewer.get('overlays').remove({ type: 'diff' });
  }
}

function decorate(changeList) {
  clearDecorations();

  for (const change of changeList) {
    for (const kind of change.kinds) {
      if (!visibleKinds.has(kind)) {
        continue;
      }

      for (const side of sidesFor(kind)) {
        const pane = panes[side];

        if (!pane.loaded) {
          continue;
        }

        const element = pane.viewer.get('elementRegistry').get(change.id);

        if (!element) {
          continue;
        }

        canvasOf(pane).addMarker(element, 'diff-' + kind);
      }
    }

    // one badge per element and side, showing the most important visible kind
    const kind = visibleKind(change);

    if (kind) {
      for (const side of sidesFor(kind)) {
        addBadge(panes[side], change, kind);
      }
    }
  }
}

function addBadge(pane, change, kind) {
  const element = pane.loaded && pane.viewer.get('elementRegistry').get(change.id);

  if (!element) {
    return;
  }

  const badge = document.createElement('span');
  badge.className = 'diff-badge ' + kind;
  badge.textContent = KIND_BADGE[kind];

  const details = describeAttrs(change.attrs);
  badge.title = [ ...change.kinds ].map((k) => KIND_LABEL[k]).join(', ') + ': ' + displayName(change) + (details ? '\n\n' + details : '');

  try {
    pane.viewer.get('overlays').add(change.id, 'diff', {
      position: badgePosition(element),
      html: badge
    });
  } catch (err) {

    // some elements (e.g. the root) cannot carry overlays
  }
}

/** Top-right corner for shapes, middle of the path for connections. */
function badgePosition(element) {
  if (!element.waypoints) {
    return { top: -8, right: 8 };
  }

  const bbox = getBBox(element);
  const mid = pathMiddle(element.waypoints);

  return { left: mid.x - bbox.x - 8, top: mid.y - bbox.y - 8 };
}

function pathMiddle(waypoints) {
  const segments = [];
  let total = 0;

  for (let i = 1; i < waypoints.length; i++) {
    const length = Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].y - waypoints[i - 1].y);
    segments.push(length);
    total += length;
  }

  let remaining = total / 2;

  for (let i = 0; i < segments.length; i++) {
    if (remaining <= segments[i] && segments[i] > 0) {
      const t = remaining / segments[i];
      const a = waypoints[i], b = waypoints[i + 1];

      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    remaining -= segments[i];
  }

  return waypoints[0];
}

function renderSummary(changeList, newDefs, oldDefs) {
  const counts = { added: 0, removed: 0, changed: 0, layout: 0 };

  for (const change of changeList) {
    counts[change.kind]++;
  }

  for (const kind of KINDS) {
    document.querySelector('.chip.' + kind + ' b').textContent = counts[kind];
  }

  let note = '';

  if (newDefs && oldDefs && !changeList.length) {
    note = 'No differences';
  } else if (!newDefs || !oldDefs) {
    note = changeList.length ? '' : 'Comparison not available';
  }

  document.getElementById('summary-note').textContent = note;
}

function renderChangeList(changeList) {
  const list = document.getElementById('change-list');
  list.textContent = '';

  const shown = changeList.filter(visibleKind);

  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = changeList.length ? 'All changes are hidden by the filter.' : 'No changes.';
    list.appendChild(li);
    return;
  }

  for (const change of shown) {
    const li = document.createElement('li');

    const kind = document.createElement('span');
    kind.className = 'kind ' + visibleKind(change);
    kind.textContent = [ ...change.kinds ].map((k) => KIND_LABEL[k]).join(' + ');

    const name = document.createElement('span');
    name.textContent = displayName(change);
    name.title = change.id;

    const type = document.createElement('span');
    type.className = 'type';
    type.textContent = typeName(change);

    li.append(kind, name, type);

    const details = describeAttrs(change.attrs);

    if (details) {
      const attrs = document.createElement('span');
      attrs.className = 'attrs';
      attrs.textContent = details;
      li.append(document.createElement('span'), attrs);
    }

    li.dataset.changeId = change.id;
    li.addEventListener('click', () => focusElement(change.id));
    list.appendChild(li);
  }

  markSelectedRow(selectedChangeId);
}

/** Shows in the change list which change stepping is on, so F7 is not a blind jump. */
function markSelectedRow(id) {
  for (const li of document.querySelectorAll('#change-list li[data-change-id]')) {
    li.classList.toggle('selected', li.dataset.changeId === id);
  }
}

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------

/** Where stepping through changes currently is; also the highlighted row of the change list. */
let selectedChangeId = null;

/** Changes the user can actually see, in change-list order, so navigation and the chips agree. */
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
  const next = current < 0
    ? (step > 0 ? 0 : changes.length - 1)
    : (current + step + changes.length) % changes.length;

  focusElement(changes[next].id);
}

/** Selects and centres an element, driven by the caret position in the XML editor. */
function selectElement(id) {
  if (id && (panes.left.loaded || panes.right.loaded)) {
    focusElement(id);
  }
}

function updateChangeNav() {
  const disabled = !navigableChanges().length;

  document.getElementById('change-prev').disabled = disabled;
  document.getElementById('change-next').disabled = disabled;
}

function focusElement(id) {
  selectedChangeId = id;
  markSelectedRow(id);

  const targets = [ 'left', 'right' ]
    .map((side) => panes[side])
    .filter((pane) => pane.loaded && pane.viewer.get('elementRegistry').get(id));

  if (!targets.length) {
    return;
  }

  // with sync on, centering one side is enough - the other follows
  const toCenter = syncEnabled ? targets.slice(0, 1) : targets;

  for (const pane of toCenter) {
    centerOn(pane, pane.viewer.get('elementRegistry').get(id));
  }

  if (syncEnabled) {
    copyViewbox(toCenter[0], panes[other(toCenter[0].side)]);
  }

  for (const pane of targets) {
    const canvas = canvasOf(pane);
    canvas.addMarker(id, 'diff-focus');
    setTimeout(() => canvas.hasMarker(id, 'diff-focus') && canvas.removeMarker(id, 'diff-focus'), 1500);
  }
}

function centerOn(pane, element) {
  const canvas = canvasOf(pane);
  const viewbox = canvas.viewbox();
  const bbox = getBBox(element);

  canvas.viewbox({
    x: bbox.x + bbox.width / 2 - viewbox.width / 2,
    y: bbox.y + bbox.height / 2 - viewbox.height / 2,
    width: viewbox.width,
    height: viewbox.height
  });
}

// ---------------------------------------------------------------------------
// zoom
// ---------------------------------------------------------------------------

const ZOOM_STEP = 1.2;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;

function loadedPanes() {
  return [ 'left', 'right' ].map((side) => panes[side]).filter((pane) => pane.loaded);
}

/**
 * Runs a zoom action on the diagrams. With sync on, zooming one side is enough - the other follows,
 * so both keep showing the same region; with sync off each side zooms around its own centre.
 */
function applyZoom(action) {
  const loaded = loadedPanes();

  if (!loaded.length) {
    return;
  }

  const targets = syncEnabled ? loaded.slice(0, 1) : loaded;

  for (const pane of targets) {
    action(canvasOf(pane));
  }

  if (syncEnabled) {
    copyViewbox(targets[0], panes[other(targets[0].side)]);
  }

  updateZoomControls();
}

function zoomBy(factor) {
  applyZoom((canvas) => {
    const level = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, canvas.zoom() * factor));

    // no centre argument -> diagram-js zooms around the middle of the viewport
    canvas.zoom(level);
  });
}

function zoomTo(level) {
  applyZoom((canvas) => canvas.zoom(level));
}

function zoomFit() {
  applyZoom((canvas) => canvas.zoom('fit-viewport', 'auto'));
}

/** Zoom level shown in the toolbar - the left pane leads, the right one stands in when it is empty. */
function currentZoom() {
  const pane = loadedPanes()[0];

  return pane ? canvasOf(pane).zoom() : null;
}

function updateZoomControls() {
  const zoom = currentZoom();

  document.getElementById('zoom-reset').textContent = zoom ? Math.round(zoom * 100) + '%' : '—';

  for (const button of document.querySelectorAll('#zoom .bar-button')) {
    button.disabled = !zoom;
  }
}

document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
document.getElementById('zoom-in').addEventListener('click', () => zoomBy(ZOOM_STEP));
document.getElementById('zoom-reset').addEventListener('click', () => zoomTo(1));
document.getElementById('zoom-fit').addEventListener('click', () => zoomFit());

updateZoomControls();

// ---------------------------------------------------------------------------
// synchronization
// ---------------------------------------------------------------------------

function scheduleViewSync(fromSide) {
  if (!syncEnabled || applyingSync || pendingSyncFrom) {
    return;
  }

  // 'changing' fires before the new viewbox is applied - read it on the next frame
  pendingSyncFrom = fromSide;

  requestAnimationFrame(() => {
    const from = pendingSyncFrom;
    pendingSyncFrom = null;

    if (syncEnabled && !applyingSync) {
      copyViewbox(panes[from], panes[other(from)]);
    }
  });
}

function copyViewbox(fromPane, toPane) {
  if (!fromPane.loaded || !toPane.loaded) {
    return;
  }

  const { x, y, width, height } = canvasOf(fromPane).viewbox();
  const wasApplying = applyingSync;

  applyingSync = true;

  try {
    canvasOf(toPane).viewbox({ x, y, width, height });
  } finally {
    applyingSync = wasApplying;
  }
}

function mirrorCursor(fromPane, event) {
  const toPane = panes[other(fromPane.side)];

  if (!fromPane.loaded || !toPane.loaded) {
    hideGhost(toPane);
    return;
  }

  const fromRect = fromPane.canvasEl.getBoundingClientRect();
  const fromBox = canvasOf(fromPane).viewbox();

  // screen -> diagram coordinates
  const diagramX = fromBox.x + (event.clientX - fromRect.left) / fromBox.scale;
  const diagramY = fromBox.y + (event.clientY - fromRect.top) / fromBox.scale;

  // diagram -> screen coordinates of the other pane
  const toBox = canvasOf(toPane).viewbox();
  const x = (diagramX - toBox.x) * toBox.scale;
  const y = (diagramY - toBox.y) * toBox.scale;

  const inside = x >= 0 && y >= 0 && x <= toPane.canvasEl.clientWidth && y <= toPane.canvasEl.clientHeight;

  if (!inside) {
    hideGhost(toPane);
    return;
  }

  // the ghost is positioned relative to the pane, the canvas starts below the header
  const offsetTop = toPane.canvasEl.offsetTop;

  toPane.ghostEl.style.transform = 'translate(' + x + 'px,' + (y + offsetTop) + 'px)';
  toPane.ghostEl.classList.add('visible');
}

function hideGhost(pane) {
  pane.ghostEl.classList.remove('visible');
}

function setSyncHover(side, id, on) {
  const pane = panes[side];

  if (!pane.loaded || !pane.viewer.get('elementRegistry').get(id)) {
    return;
  }

  const canvas = canvasOf(pane);

  if (on) {
    canvas.addMarker(id, 'sync-hover');
  } else if (canvas.hasMarker(id, 'sync-hover')) {
    canvas.removeMarker(id, 'sync-hover');
  }
}

function setSync(enabled) {
  syncEnabled = !!enabled;

  if (syncEnabled) {
    copyViewbox(panes.left, panes.right);
  } else {
    hideGhost(panes.left);
    hideGhost(panes.right);
  }
}

// ---------------------------------------------------------------------------
// host API + chrome
// ---------------------------------------------------------------------------

function setTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme && theme.dark ? 'dark' : 'light';

  if (theme && theme.bg) {
    root.style.setProperty('--bg', theme.bg);
  }

  if (theme && theme.fg) {
    root.style.setProperty('--fg', theme.fg);
  }

  if (theme && theme.border) {
    root.style.setProperty('--border', theme.border);
  }
}

function setStatus(side, text, isError) {
  const pane = panes[side];

  if (!pane) {
    return;
  }

  if (!pane.loaded || isError) {
    showMessage(pane, text, isError);
  }
}

function resizeAll() {
  for (const pane of Object.values(panes)) {
    if (pane.loaded) {
      canvasOf(pane).resized();
    }
  }
}

window.addEventListener('resize', resizeAll);

// ---------------------------------------------------------------------------
// filter
// ---------------------------------------------------------------------------

function loadVisibleKinds() {
  try {
    const stored = JSON.parse(localStorage.getItem(FILTER_KEY));

    if (Array.isArray(stored)) {
      return new Set(stored.filter((k) => KINDS.includes(k)));
    }
  } catch (err) {

    // storage unavailable - fall back to showing everything
  }

  return new Set(KINDS);
}

function saveVisibleKinds() {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify([ ...visibleKinds ]));
  } catch (err) {

    // not persisted, filter still works for this session
  }
}

function updateFilterChips() {
  for (const chip of document.querySelectorAll('#summary .chip')) {
    const on = visibleKinds.has(chip.dataset.kind);
    chip.classList.toggle('off', !on);
    chip.setAttribute('aria-pressed', String(on));
    chip.title = (on ? 'Hide ' : 'Show ') + KIND_LABEL[chip.dataset.kind].toLowerCase() + ' elements';
  }
}

function setVisibleKinds(kinds) {
  visibleKinds.clear();
  kinds.filter((k) => KINDS.includes(k)).forEach((k) => visibleKinds.add(k));
  saveVisibleKinds();
  updateFilterChips();
  decorate(currentChanges);
  renderChangeList(currentChanges);
  updateChangeNav();
}

for (const chip of document.querySelectorAll('#summary .chip')) {
  chip.addEventListener('click', () => {
    const kind = chip.dataset.kind;
    const next = new Set(visibleKinds);

    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }

    setVisibleKinds([ ...next ]);
  });
}

updateFilterChips();

document.getElementById('toggle-changes').addEventListener('click', () => setChangeListVisible(isChangeListHidden()));

function isChangeListHidden() {
  return document.getElementById('changes').hidden;
}

function setChangeListVisible(visible) {
  document.getElementById('changes').hidden = !visible;
  document.getElementById('toggle-changes').classList.toggle('active', visible);
  resizeAll();
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/** Labels of the two sides, kept for the markdown header. */
let currentLabels = { left: '', right: '' };

const exportMenu = document.getElementById('export-menu');

document.getElementById('export').addEventListener('click', (event) => {
  event.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
  document.getElementById('export').classList.toggle('active', !exportMenu.hidden);
});

document.addEventListener('click', () => closeExportMenu());

for (const item of exportMenu.querySelectorAll('li')) {
  item.addEventListener('click', async () => {
    closeExportMenu();

    try {
      await runExport(item.dataset.command);
    } catch (err) {
      console.error('[bpmn-compare] export failed', err);
      sendToHost({ command: 'exportFailed', payload: String(err && err.message || err) });
    }
  });
}

function closeExportMenu() {
  exportMenu.hidden = true;
  document.getElementById('export').classList.remove('active');
}

async function runExport(command) {
  if (command === 'copyMarkdown') {
    // only what the user can see, so the export matches the change list on screen
    sendToHost({ command, payload: changesToMarkdown(navigableChanges(), currentLabels) });
    return;
  }

  if (!panes.left.loaded) {
    return;
  }

  const svg = await viewerToSvg(panes.left.viewer);

  sendToHost({ command, payload: command === 'savePng' ? await svgToPng(svg) : svg });
}

document.getElementById('change-prev').addEventListener('click', () => goToChange(-1));
document.getElementById('change-next').addEventListener('click', () => goToChange(1));

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (event.key === 'F7') {
    event.preventDefault();
    goToChange(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape' && !isChangeListHidden()) {
    event.preventDefault();
    setChangeListVisible(false);
  }
});

window.bpmnCompare = {
  setDiagrams,
  setSync,
  setTheme,
  setStatus,
  setVisibleKinds,
  focusElement,
  goToChange,
  selectElement
};
