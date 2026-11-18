import { getBBox } from 'diagram-js/lib/util/Elements';

import { activePanes, canvasOf, elementOf } from './panes.js';
import { showPlaneOf } from './planes.js';
import { setBarButtonState } from './tooltips.js';

const FOCUS_MARK_MS = 1500;

/**
 * Stepping through the changes (F7 / Shift+F7 and the arrows in the top bar) and centring an element.
 *
 * @param {object} options
 * @param {Object<string, object>} options.panes by side
 * @param {ReturnType<import('./sync.js').createSync>} options.sync
 * @param {() => object[]} options.visibleChanges changes the user can see, in change-list order
 * @param {(id: string | null, how: { fromHost: boolean }) => void} options.onSelect the change stepping is on
 *   now; `fromHost` when the IDE selected it
 * @param {() => void} options.repaint
 */
export function createNavigation({ panes, sync, visibleChanges, onSelect, repaint }) {

  /** Where stepping through changes currently is; also the highlighted row of the change list. */
  let selectedId = null;

  /** Forgets the selected change when it is not among `changes` any more. */
  function retainSelection(changes) {
    if (!changes.some((change) => change.id === selectedId)) {
      selectedId = null;
    }
  }

  /** Steps to the next (+1) or previous (-1) visible change, wrapping around. */
  function goToChange(step) {
    const changes = visibleChanges();

    if (!changes.length) {
      return;
    }

    const current = changes.findIndex((change) => change.id === selectedId);
    const next = current < 0
      ? (step > 0 ? 0 : changes.length - 1)
      : (current + step + changes.length) % changes.length;

    focusElement(changes[next].id);
  }

  /**
   * Selects and centres an element, driven by the caret position in the XML editor. The host already
   * knows where its caret is, so the selection is not reported back as one to show there.
   */
  function selectElement(id) {
    if (id && activePanes(panes).length) {
      focusElement(id, { fromHost: true });
    }
  }

  function updateButtons() {
    const inactive = !visibleChanges().length;

    setBarButtonState('change-prev', inactive, 'Previous change (Shift+F7)', 'No change to step to');
    setBarButtonState('change-next', inactive, 'Next change (F7)', 'No change to step to');
  }

  /** @param {{ fromHost?: boolean }} [options] `fromHost` when the IDE asked for it, see selectElement */
  function focusElement(id, { fromHost = false } = {}) {
    selectedId = id;
    onSelect(id, { fromHost });

    const targets = activePanes(panes).filter((pane) => elementOf(pane, id));

    if (!targets.length) {
      return;
    }

    // a change inside a collapsed subprocess is drawn on the subprocess's own plane - show that one
    // first, or centring scrolls to coordinates of a plane nobody sees. The panes may need different
    // planes (the element moved into or out of a subprocess), so the plane sync must not make them
    // drag each other back and forth.
    sync.quietly(() => {
      for (const pane of targets) {
        showPlaneOf(pane, elementOf(pane, id));
      }

      // an element on one side only: the other side follows into that plane if it has it
      if (sync.enabled && targets.length === 1) {
        sync.syncPlane(targets[0].side, canvasOf(targets[0]).getRootElement().id);
      }
    });

    // centering one side is enough only while all show the same plane - the others follow;
    // on different planes the coordinates are unrelated, so each side is centred on its own
    const together = sync.linked();
    const toCenter = together ? targets.slice(0, 1) : targets;

    for (const pane of toCenter) {
      centerOn(pane, elementOf(pane, id));
    }

    if (together) {
      sync.copyViewboxToOthers(toCenter[0]);
    }

    for (const pane of targets) {
      const canvas = canvasOf(pane);
      canvas.addMarker(id, 'diff-focus');
      setTimeout(() => {
        if (canvas.hasMarker(id, 'diff-focus')) {
          canvas.removeMarker(id, 'diff-focus');
          repaint();
        }
      }, FOCUS_MARK_MS);
    }
  }

  document.getElementById('change-prev').addEventListener('click', () => goToChange(-1));
  document.getElementById('change-next').addEventListener('click', () => goToChange(1));

  updateButtons();

  return {
    get selectedId() {
      return selectedId;
    },
    retainSelection,
    goToChange,
    selectElement,
    focusElement,
    updateButtons
  };
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
