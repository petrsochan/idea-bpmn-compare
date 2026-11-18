import { setTip } from './tooltips.js';

/*
 * The diagram panes, kept in an object by side in the order they appear on the page.
 *
 * Diff mode:  left = current working copy ("new" side), right = selected Git revision ("old" side).
 * Merge mode: ours, result, base, theirs - of result and base only one is shown at a time.
 *
 * A pane takes part in synchronization, navigation and zoom while it is shown and has a diagram.
 */

/**
 * @param {string} side e.g. `left`, matching the `pane-<side>` section of the page
 * @param {Function} Viewer the bpmn-js viewer class; passed in, so this module loads without bpmn-js
 */
export function createPane(side, Viewer) {
  const root = document.getElementById('pane-' + side);
  const canvasEl = root.querySelector('.canvas');

  return {
    side,
    root,
    canvasEl,
    labelEl: root.querySelector('.label'),
    messageEl: root.querySelector('.message'),
    ghostEl: root.querySelector('.ghost-cursor'),
    viewer: new Viewer({ container: canvasEl }),
    loaded: false,
    shown: true
  };
}

/** Panes that are shown and have a diagram, in page order. */
export function activePanes(panes) {
  return Object.values(panes).filter((pane) => pane.shown && pane.loaded);
}

/** The other active panes. */
export function othersOf(panes, pane) {
  return activePanes(panes).filter((p) => p !== pane);
}

export function canvasOf(pane) {
  return pane.viewer.get('canvas');
}

/** The element `id` of a loaded pane, or undefined. */
export function elementOf(pane, id) {
  return pane.loaded ? pane.viewer.get('elementRegistry').get(id) : undefined;
}

export function showMessage(pane, text, isError) {
  pane.messageEl.textContent = text || '';
  pane.messageEl.classList.toggle('error', !!isError);
}

/**
 * Shows one side of the diff.
 *
 * @param spec `{ label, xml }`, or without `xml` an `error` or `message` to show instead
 * @returns the definitions of the imported diagram, or null when there is none
 */
export async function importInto(pane, spec) {
  pane.labelEl.textContent = spec.label || '';
  setTip(pane.labelEl, spec.label || '');

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

/** Business objects of every drawn element except the planes and labels, by id. */
export function collectFlowElements(pane) {
  const result = {};

  pane.viewer.get('elementRegistry').forEach((element) => {
    if (element.businessObject && element.type !== 'label' && element.parent) {
      result[element.id] = element.businessObject;
    }
  });

  return result;
}

/** Viewbox plus the plane it belongs to, to come back to after a re-render. */
export function viewOf(pane) {
  const canvas = canvasOf(pane);

  return { ...canvas.viewbox(), rootId: canvas.getRootElement().id };
}

/** Two panes show the same plane, so the same coordinates mean the same place. */
export function onSamePlane(a, b) {
  return canvasOf(a).getRootElement().id === canvasOf(b).getRootElement().id;
}

export function resizeAll(panes) {
  for (const pane of activePanes(panes)) {
    canvasOf(pane).resized();
  }
}
