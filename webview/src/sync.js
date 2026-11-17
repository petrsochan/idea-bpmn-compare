import { canvasOf, elementOf, onSamePlane, other } from './panes.js';

/*
 * Synchronization of the two panes: viewport, plane (collapsed subprocess drilled into), hovered
 * element and a ghost of the mouse cursor.
 *
 * While the page itself moves a pane - a render, a sync, a jump to a change - the pane's events must
 * not be mirrored back, or the panes would drag each other around; `quietly` marks such moves.
 */

/**
 * Wires the synchronization to both panes.
 *
 * @param {{ left, right }} panes
 */
export function createSync(panes) {
  let enabled = true;
  let applying = false;
  let pendingFrom = null;

  /**
   * Runs `fn` with the mirroring of pane events suspended; for an async `fn` until its promise settles.
   */
  function quietly(fn) {
    const was = applying;

    applying = true;

    let result;

    try {
      result = fn();
    } catch (err) {
      applying = was;
      throw err;
    }

    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        applying = was;
      });
    }

    applying = was;

    return result;
  }

  /** Sync is on, both panes are loaded and show the same plane: moving one moves the other. */
  function linked() {
    return enabled && panes.left.loaded && panes.right.loaded && onSamePlane(panes.left, panes.right);
  }

  function copyViewbox(fromPane, toPane) {

    // coordinates of different planes are unrelated places
    if (!fromPane.loaded || !toPane.loaded || !onSamePlane(fromPane, toPane)) {
      return;
    }

    const { x, y, width, height } = canvasOf(fromPane).viewbox();

    quietly(() => canvasOf(toPane).viewbox({ x, y, width, height }));
  }

  function scheduleViewSync(fromSide) {
    if (!enabled || applying || pendingFrom) {
      return;
    }

    // 'changing' fires before the new viewbox is applied - read it on the next frame
    pendingFrom = fromSide;

    requestAnimationFrame(() => {
      const from = pendingFrom;
      pendingFrom = null;

      if (enabled && !applying) {
        copyViewbox(panes[from], panes[other(from)]);
      }
    });
  }

  /**
   * Shows the plane `rootId` on the other side too. A subprocess that exists on one side only leaves
   * the other side where it is - there is nothing to show.
   *
   * The viewbox is copied right away: bpmn-js has already moved the source pane to its position on
   * the new plane, and does not always scroll it, so the usual scroll-driven sync cannot be relied on.
   */
  function syncPlane(fromSide, rootId) {
    const toPane = panes[other(fromSide)];
    const root = elementOf(toPane, rootId);

    if (!root) {
      return;
    }

    quietly(() => {
      canvasOf(toPane).setRootElement(root);
      copyViewbox(panes[fromSide], toPane);
    });
  }

  function mirrorCursor(fromPane, event) {
    const toPane = panes[other(fromPane.side)];

    // on different planes the same coordinates mean unrelated places
    if (!fromPane.loaded || !toPane.loaded || !onSamePlane(fromPane, toPane)) {
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

  function setHover(side, id, on) {
    const pane = panes[side];

    if (!elementOf(pane, id)) {
      return;
    }

    const canvas = canvasOf(pane);

    if (on) {
      canvas.addMarker(id, 'sync-hover');
    } else if (canvas.hasMarker(id, 'sync-hover')) {
      canvas.removeMarker(id, 'sync-hover');
    }
  }

  function setEnabled(value) {
    enabled = !!value;

    if (enabled) {
      if (panes.left.loaded) {
        syncPlane('left', canvasOf(panes.left).getRootElement().id);
      }

      copyViewbox(panes.left, panes.right);
    } else {
      hideGhost(panes.left);
      hideGhost(panes.right);
    }
  }

  for (const pane of Object.values(panes)) {
    const side = pane.side;
    const eventBus = pane.viewer.get('eventBus');

    eventBus.on('canvas.viewbox.changing', () => scheduleViewSync(side));

    // drilling into a collapsed subprocess (or back out through the breadcrumbs) on one side
    eventBus.on('root.set', (event) => {
      if (enabled && !applying) {
        syncPlane(side, event.element.id);
      }
    });

    eventBus.on('element.hover', (event) => {
      if (enabled) {
        setHover(other(side), event.element.id, true);
      }
    });

    eventBus.on('element.out', (event) => setHover(other(side), event.element.id, false));

    pane.canvasEl.addEventListener('mousemove', (event) => {
      if (enabled) {
        mirrorCursor(pane, event);
      }
    });

    pane.canvasEl.addEventListener('mouseleave', () => hideGhost(panes[other(side)]));
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled,
    quietly,
    linked,
    copyViewbox,
    syncPlane
  };
}
