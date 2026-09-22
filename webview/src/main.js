import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { diff } from 'bpmn-js-differ';
import { getBBox } from 'diagram-js/lib/util/Elements';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import './styles.css';

/*
 * Left pane  = current working copy ("new" side of the diff).
 * Right pane = selected Git revision ("old" side of the diff).
 *
 * The host (IntelliJ plugin) drives this page through window.bpmnCompare.
 */

const KINDS = [ 'added', 'removed', 'changed', 'layout' ];
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

  eventBus.on('element.hover', (event) => {
    if (syncEnabled) {
      setSyncHover(other(side), event.element.id, true);
    }
  });

  eventBus.on('element.out', (event) => setSyncHover(other(side), event.element.id, false));

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

    currentChanges = toChangeList(changes);

    decorate(currentChanges);
    renderSummary(currentChanges, newDefs, oldDefs);
    renderChangeList(currentChanges);

    restoreOrFit(previousView);
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

/**
 * Merges the differ output into one entry per element id.
 */
function toChangeList(changes) {
  if (!changes) {
    return [];
  }

  const byId = new Map();

  function entry(id, model) {
    let e = byId.get(id);

    if (!e) {
      e = { id, kinds: new Set(), model, attrs: null };
      byId.set(id, e);
    }

    e.model = e.model || model;

    return e;
  }

  for (const [ id, model ] of Object.entries(changes._added || {})) {
    entry(id, model).kinds.add('added');
  }

  for (const [ id, model ] of Object.entries(changes._removed || {})) {
    entry(id, model).kinds.add('removed');
  }

  for (const [ id, change ] of Object.entries(changes._changed || {})) {
    const e = entry(id, change.model);
    e.kinds.add('changed');
    e.attrs = normalizeAttrs(change.attrs);
  }

  for (const [ id, model ] of Object.entries(changes._layoutChanged || {})) {
    entry(id, model).kinds.add('layout');
  }

  const list = [ ...byId.values() ];

  for (const e of list) {
    e.kind = KINDS.find((k) => e.kinds.has(k));
  }

  list.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || displayName(a).localeCompare(displayName(b)));

  return list;
}

/**
 * bpmn-js-differ reports property values from the perspective of its internal model walk, which ends up
 * with oldValue taken from the second (new) definitions - swap them so old = revision, new = current.
 */
function normalizeAttrs(attrs) {
  const result = {};

  for (const [ name, { oldValue, newValue } ] of Object.entries(attrs || {})) {
    result[name] = { oldValue: newValue, newValue: oldValue };
  }

  return result;
}

function displayName(change) {
  const model = change.model || {};

  return (model.name || '').trim() || change.id;
}

function typeName(change) {
  const type = change.model && change.model.$type || '';

  return type.replace(/^bpmn:/, '');
}

function formatValue(value) {
  if (value === undefined || value === null) {
    return '∅';
  }

  if (Array.isArray(value)) {
    return '[' + value.map(formatValue).join(', ') + ']';
  }

  if (typeof value === 'object') {
    if (value.$type) {
      return value.$type.replace(/^bpmn:/, '') + (value.id ? '#' + value.id : '');
    }

    return JSON.stringify(value);
  }

  const text = String(value);

  return text.length > 120 ? JSON.stringify(text.slice(0, 117) + '...') : JSON.stringify(text);
}

function describeAttrs(attrs) {
  if (!attrs) {
    return '';
  }

  return Object.entries(attrs)
    .map(([ name, { oldValue, newValue } ]) => name + ': ' + formatValue(oldValue) + ' → ' + formatValue(newValue))
    .join('\n');
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

    li.addEventListener('click', () => focusElement(change.id));
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------

function focusElement(id) {
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

document.getElementById('toggle-changes').addEventListener('click', (event) => {
  const aside = document.getElementById('changes');
  aside.hidden = !aside.hidden;
  event.currentTarget.classList.toggle('active', !aside.hidden);
  resizeAll();
});

window.bpmnCompare = {
  setDiagrams,
  setSync,
  setTheme,
  setStatus,
  setVisibleKinds,
  focusElement
};
