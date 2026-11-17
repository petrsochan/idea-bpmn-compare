import { BpmnModdle } from 'bpmn-moddle';

import { chunkChanges } from './history.js';
import { sendToHost } from './host.js';
import { setTip } from './tooltips.js';

/*
 * The right-click menu of a diagram element and the page's half of the element history: the host
 * reads the commits from Git, the page works out which of them changed the element.
 */

/**
 * @param {object} options
 * @param {{ left, right }} options.panes
 * @param {() => void} options.beforeOpen closes whatever else is open
 */
export function createElementMenu({ panes, beforeOpen }) {
  const menu = document.getElementById('element-menu');
  const historyItem = document.getElementById('element-history');

  /** Per pane: whether the host can read the history; until it says so, there is no menu at all. */
  let historyState = {};
  let target = null;

  /**
   * @param state `{ left: { available, reason }, right: { available, reason } }` - each pane reads the
   *   history of its own file, and in a diff of two files those are different files
   */
  function setHistoryAvailable(state) {
    historyState = {};

    for (const side of [ 'left', 'right' ]) {
      const sideState = state && state[side];

      historyState[side] = { available: !!(sideState && sideState.available), reason: sideState && sideState.reason || '' };
    }
  }

  function open(side, event) {
    const original = event.originalEvent;
    const element = event.element.type === 'label' && event.element.labelTarget ? event.element.labelTarget : event.element;

    if (original) {
      original.preventDefault();
    }

    // the plane itself (a process, a subprocess drilled into) is not an element of the diagram
    const state = historyState[side];

    if (!element.parent || !element.businessObject || !state || (!state.available && !state.reason) || !original) {
      return;
    }

    beforeOpen();

    const name = (element.businessObject.name || '').trim() || element.id;

    // strings only: the host reads flat objects of string values
    target = { id: element.id, name, side, x: String(Math.round(original.clientX)), y: String(Math.round(original.clientY)) };
    historyItem.textContent = 'History of "' + name + '"';
    historyItem.setAttribute('aria-disabled', String(!state.available));
    setTip(historyItem, state.available ? 'Commits that changed this element' : state.reason);

    menu.hidden = false;

    const box = menu.getBoundingClientRect();

    menu.style.left = Math.max(0, Math.min(original.clientX, window.innerWidth - box.width - 4)) + 'px';
    menu.style.top = Math.max(0, Math.min(original.clientY, window.innerHeight - box.height - 4)) + 'px';
  }

  function close() {
    menu.hidden = true;
  }

  function isOpen() {
    return !menu.hidden;
  }

  historyItem.addEventListener('click', (event) => {
    event.stopPropagation();

    if (historyItem.getAttribute('aria-disabled') === 'true') {
      return;
    }

    close();
    sendToHost({ command: 'elementHistory', ...target });
  });

  window.addEventListener('blur', close);

  for (const pane of Object.values(panes)) {
    const eventBus = pane.viewer.get('eventBus');

    eventBus.on('element.contextmenu', (event) => open(pane.side, event));
    eventBus.on('canvas.viewbox.changing', close);
  }

  return { setHistoryAvailable, close, isOpen };
}

const historyModdle = new BpmnModdle();

/**
 * Works out which of the given commits changed the element, one after the other so the page stays
 * responsive, and answers the host exactly once per call - the host waits for that answer.
 *
 * The host reads flat objects of string values only, so the entries travel as one string: entries
 * separated by U+001E, fields (hash, comma-separated kinds, summary) by U+001F. Neither can occur
 * inside a field - ids and kinds never contain them, and the summary quotes values with
 * JSON.stringify, which escapes every control character.
 */
export async function computeHistory({ token, id, blobs, commits }) {
  try {
    const entries = (await chunkChanges(id, blobs || {}, commits || [], historyModdle))
      .map((entry) => [ entry.hash, entry.kinds.join(','), entry.summary ].join('\u001f'));

    sendToHost({ command: 'historyChunk', token, entries: entries.join('\u001e') });
  } catch (err) {
    console.error('[bpmn-compare] history failed', err);
    sendToHost({ command: 'historyChunk', token, error: String(err && err.message || err) });
  }
}
