import { getBBox } from 'diagram-js/lib/util/Elements';

import { KINDS } from './changes.js';
import { KIND_LABEL, describeAttrs, displayName } from './format.js';
import { hiddenChanges, leadingKind, rootIdOf, shapeIdOfRoot } from './planes.js';
import { canvasOf, elementOf } from './panes.js';
import { setTip } from './tooltips.js';

/*
 * What the diff draws onto the diagrams: a marker per change kind, a badge per changed element and
 * a count on each collapsed subprocess that hides changes.
 */

const KIND_BADGE = { added: '+', removed: '−', changed: '✎', layout: '⇄' };

/** Sides a change kind is drawn on. */
export function sidesFor(kind) {
  if (kind === 'added') {
    return [ 'left' ];
  }

  if (kind === 'removed') {
    return [ 'right' ];
  }

  return [ 'left', 'right' ];
}

/** Kind the element is shown as: the most important kind that is not filtered out. */
export function visibleKind(change, visibleKinds) {
  return KINDS.find((k) => change.kinds.has(k) && visibleKinds.has(k));
}

/** Every marker the diff and the merge view draw. */
const MARKERS = [
  ...KINDS.flatMap((kind) => [ 'diff-' + kind, 'diff-nested-' + kind ]),
  'merge-conflict', 'merge-both',
  'result-ours', 'result-theirs', 'result-both', 'result-base', 'result-other'
];

/** Removes every marker and badge the diff or the merge view drew. */
export function clearDecorations(panes) {
  for (const pane of Object.values(panes)) {
    if (!pane.loaded) {
      continue;
    }

    const canvas = canvasOf(pane);

    pane.viewer.get('elementRegistry').forEach((element) => {
      for (const marker of MARKERS) {
        if (canvas.hasMarker(element, marker)) {
          canvas.removeMarker(element, marker);
        }
      }
    });

    pane.viewer.get('overlays').remove({ type: 'diff' });
  }
}

/** Redraws the changes of the kinds in `visibleKinds` on both panes. */
export function decorate(panes, changeList, visibleKinds) {
  clearDecorations(panes);

  for (const change of changeList) {
    for (const kind of change.kinds) {
      if (!visibleKinds.has(kind)) {
        continue;
      }

      for (const side of sidesFor(kind)) {
        const element = elementOf(panes[side], change.id);

        if (element) {
          canvasOf(panes[side]).addMarker(element, 'diff-' + kind);
        }
      }
    }

    // one badge per element and side, showing the most important visible kind
    const kind = visibleKind(change, visibleKinds);

    if (kind) {
      for (const side of sidesFor(kind)) {
        addBadge(panes[side], change.id, kind, tipOf(change));
      }
    }
  }

  for (const side of [ 'left', 'right' ]) {
    const drawn = [];

    for (const change of changeList) {
      const kind = visibleKind(change, visibleKinds);

      if (kind && sidesFor(kind).includes(side)) {
        drawn.push({ id: change.id, kind });
      }
    }

    markHiddenChanges(panes[side], drawn);
  }
}

/** The tooltip of a change's badge: its kinds, its name and what changed. */
export function tipOf(change, details = describeAttrs(change.attrs)) {
  return [ ...change.kinds ].map((k) => KIND_LABEL[k]).join(', ') + ': ' + displayName(change)
    + (details ? '\n\n' + details : '');
}

/** Puts a badge of `kind` with the tooltip `tip` on element `id`, when the pane has it. */
export function addBadge(pane, id, kind, tip) {
  const element = elementOf(pane, id);

  if (!element) {
    return;
  }

  const badge = document.createElement('span');
  badge.className = 'diff-badge ' + kind;
  badge.textContent = KIND_BADGE[kind];
  setTip(badge, tip);

  try {
    pane.viewer.get('overlays').add(id, 'diff', {
      position: badgePosition(element),
      html: badge
    });
  } catch (err) {

    // some elements (e.g. the root) cannot carry overlays
  }
}

/**
 * Marks each collapsed subprocess that hides changes drawn on this pane: a dashed outline and a
 * count, both in the colour of the most important kind inside. Dashed, so it does not read as a
 * change of the subprocess itself.
 *
 * @param {{ id: string, kind: string }[]} drawn the changes drawn on the pane, each with the kind it is drawn as
 */
export function markHiddenChanges(pane, drawn) {
  if (!pane.loaded) {
    return;
  }

  const hidden = hiddenChanges(drawn, (id) => rootIdOf(pane, id), (rootId) => shapeIdOfRoot(pane, rootId));

  for (const [ shapeId, byKind ] of hidden) {
    const kind = leadingKind(byKind);
    const count = [ ...byKind.values() ].reduce((sum, n) => sum + n, 0);
    const breakdown = KINDS.filter((k) => byKind.has(k)).map((k) => byKind.get(k) + ' ' + KIND_LABEL[k].toLowerCase());

    canvasOf(pane).addMarker(shapeId, 'diff-nested-' + kind);

    const badge = document.createElement('span');
    badge.className = 'diff-badge nested ' + kind;
    badge.textContent = String(count);
    setTip(badge, (count === 1 ? '1 change' : count + ' changes') + ' inside this subprocess: '
      + breakdown.join(', ') + '\n\nOpen it with the drill-down button, or step to it with F7.');

    try {
      // bottom left: the top right carries the subprocess's own badge, the bottom right the drill-down button
      pane.viewer.get('overlays').add(shapeId, 'diff', { position: { bottom: 8, left: -8 }, html: badge });
    } catch (err) {

      // the shape cannot carry an overlay
    }
  }
}

/** Top-right corner for shapes, middle of the path for connections. */
export function badgePosition(element) {
  if (!element.waypoints) {
    return { top: -8, right: 8 };
  }

  const bbox = getBBox(element);
  const mid = pathMiddle(element.waypoints);

  return { left: mid.x - bbox.x - 8, top: mid.y - bbox.y - 8 };
}

/** The point halfway along a polyline. */
export function pathMiddle(waypoints) {
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
