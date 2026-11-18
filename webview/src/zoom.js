import { activePanes, canvasOf } from './panes.js';
import { setBarButtonState } from './tooltips.js';

const ZOOM_STEP = 1.2;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;

const ZOOM_TITLES = {
  'zoom-out': 'Zoom out',
  'zoom-in': 'Zoom in',
  'zoom-reset': 'Reset zoom to 100%',
  'zoom-fit': 'Fit the diagram into the window'
};

/**
 * The zoom buttons of the top bar.
 *
 * @param {Object<string, object>} panes by side; panes added later are wired with `attach`
 * @param {ReturnType<import('./sync.js').createSync>} sync
 */
export function createZoom(panes, sync) {

  /**
   * Runs a zoom action on the diagrams. With sync on and both sides on the same plane, zooming one side
   * is enough - the other follows, so both keep showing the same region; otherwise each side zooms
   * around its own centre.
   */
  function applyZoom(action) {
    const loaded = activePanes(panes);

    if (!loaded.length) {
      return;
    }

    const together = sync.linked();
    const targets = together ? loaded.slice(0, 1) : loaded;

    for (const pane of targets) {
      action(canvasOf(pane));
    }

    if (together) {
      sync.copyViewboxToOthers(targets[0]);
    }

    updateControls();
  }

  function zoomBy(factor) {
    applyZoom((canvas) => {
      const level = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, canvas.zoom() * factor));

      // no centre argument -> diagram-js zooms around the middle of the viewport
      canvas.zoom(level);
    });
  }

  /** Zoom level shown in the toolbar - the left pane leads, the right one stands in when it is empty. */
  function currentZoom() {
    const pane = activePanes(panes)[0];

    return pane ? canvasOf(pane).zoom() : null;
  }

  function updateControls() {
    const zoom = currentZoom();

    document.getElementById('zoom-reset').textContent = zoom ? Math.round(zoom * 100) + '%' : '—';

    for (const [ id, title ] of Object.entries(ZOOM_TITLES)) {
      setBarButtonState(id, !zoom, title, 'No diagram loaded');
    }
  }

  document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
  document.getElementById('zoom-in').addEventListener('click', () => zoomBy(ZOOM_STEP));
  document.getElementById('zoom-reset').addEventListener('click', () => applyZoom((canvas) => canvas.zoom(1)));
  document.getElementById('zoom-fit').addEventListener('click', () => applyZoom((canvas) => canvas.zoom('fit-viewport', 'auto')));

  function attach(pane) {
    pane.viewer.get('eventBus').on('canvas.viewbox.changed', () => updateControls());
  }

  Object.values(panes).forEach(attach);

  updateControls();

  return { updateControls, attach };
}
