import { activePanes, canvasOf, elementOf, onSamePlane, othersOf } from './panes.js';

/*
 * Synchronization of the panes: viewport, plane (collapsed subprocess drilled into), hovered
 * element and a ghost of the mouse cursor.
 *
 * While the page itself moves a pane - a render, a sync, a jump to a change - the pane's events must
 * not be mirrored back, or the panes would drag each other around; `quietly` marks such moves.
 */

/**
 * Wires the synchronization to the panes; panes added to `panes` later are wired with `attach`.
 *
 * @param {Object<string, object>} panes by side
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

  /** Sync is on, at least two panes are active and all show the same plane: moving one moves the others. */
  function linked() {
    const active = activePanes(panes);

    return enabled && active.length > 1 && active.every((pane) => onSamePlane(active[0], pane));
  }

  function copyViewbox(fromPane, toPane) {

    // coordinates of different planes are unrelated places
    if (!fromPane.loaded || !toPane.loaded || !onSamePlane(fromPane, toPane)) {
      return;
    }

    const { x, y, width, height } = canvasOf(fromPane).viewbox();

    quietly(() => canvasOf(toPane).viewbox({ x, y, width, height }));
  }

  /** Copies the viewbox of `fromPane` to every other active pane on its plane. */
  function copyViewboxToOthers(fromPane) {
    for (const pane of othersOf(panes, fromPane)) {
      copyViewbox(fromPane, pane);
    }
  }

  function scheduleViewSync(fromPane) {
    if (!enabled || applying || pendingFrom || !fromPane.shown) {
      return;
    }

    // 'changing' fires before the new viewbox is applied - read it on the next frame
    pendingFrom = fromPane;

    requestAnimationFrame(() => {
      const from = pendingFrom;
      pendingFrom = null;

      if (enabled && !applying) {
        copyViewboxToOthers(from);
      }
    });
  }

  /**
   * Shows the plane `rootId` on the other panes too. A subprocess that exists on one side only leaves
   * the other sides where they are - there is nothing to show.
   *
   * The viewbox is copied right away: bpmn-js has already moved the source pane to its position on
   * the new plane, and does not always scroll it, so the usual scroll-driven sync cannot be relied on.
   */
  function syncPlane(fromSide, rootId) {
    const fromPane = panes[fromSide];

    for (const toPane of othersOf(panes, fromPane)) {
      const root = elementOf(toPane, rootId);

      if (!root) {
        continue;
      }

      quietly(() => {
        canvasOf(toPane).setRootElement(root);
        copyViewbox(fromPane, toPane);
      });
    }
  }

  function mirrorCursor(fromPane, event) {
    for (const toPane of Object.values(panes)) {
      if (toPane === fromPane) {
        continue;
      }

      // on different planes the same coordinates mean unrelated places
      if (!fromPane.loaded || !toPane.loaded || !toPane.shown || !onSamePlane(fromPane, toPane)) {
        hideGhost(toPane);
        continue;
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
        continue;
      }

      // the ghost is positioned relative to the pane, the canvas starts below the header
      const offsetTop = toPane.canvasEl.offsetTop;

      toPane.ghostEl.style.transform = 'translate(' + x + 'px,' + (y + offsetTop) + 'px)';
      toPane.ghostEl.classList.add('visible');
    }
  }

  function hideGhost(pane) {
    pane.ghostEl.classList.remove('visible');
  }

  function setHover(fromPane, id, on) {
    for (const pane of Object.values(panes)) {
      if (pane === fromPane || !elementOf(pane, id)) {
        continue;
      }

      const canvas = canvasOf(pane);

      if (on) {
        canvas.addMarker(id, 'sync-hover');
      } else if (canvas.hasMarker(id, 'sync-hover')) {
        canvas.removeMarker(id, 'sync-hover');
      }
    }
  }

  function setEnabled(value) {
    enabled = !!value;

    if (enabled) {
      const leader = activePanes(panes)[0];

      if (leader) {
        syncPlane(leader.side, canvasOf(leader).getRootElement().id);
        copyViewboxToOthers(leader);
      }
    } else {
      Object.values(panes).forEach(hideGhost);
    }
  }

  /** Wires a pane's events to the synchronization; for a pane created after `createSync`. */
  function attach(pane) {
    const eventBus = pane.viewer.get('eventBus');

    eventBus.on('canvas.viewbox.changing', () => scheduleViewSync(pane));

    // drilling into a collapsed subprocess (or back out through the breadcrumbs) on one side
    eventBus.on('root.set', (event) => {
      if (enabled && !applying && pane.shown) {
        syncPlane(pane.side, event.element.id);
      }
    });

    eventBus.on('element.hover', (event) => {
      if (enabled && pane.shown) {
        setHover(pane, event.element.id, true);
      }
    });

    eventBus.on('element.out', (event) => setHover(pane, event.element.id, false));

    pane.canvasEl.addEventListener('mousemove', (event) => {
      if (enabled) {
        mirrorCursor(pane, event);
      }
    });

    pane.canvasEl.addEventListener('mouseleave', () => {
      for (const other of Object.values(panes)) {
        if (other !== pane) {
          hideGhost(other);
        }
      }
    });
  }

  Object.values(panes).forEach(attach);

  return {
    get enabled() {
      return enabled;
    },
    setEnabled,
    quietly,
    linked,
    copyViewbox,
    copyViewboxToOthers,
    syncPlane,
    attach
  };
}
