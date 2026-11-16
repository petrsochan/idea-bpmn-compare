/**
 * How far, in diagram pixels, a shape, label or waypoint may shift and still not count as moved.
 *
 * bpmn-js-differ reports any DI difference as a layout change, so a modeller that rounds coordinates or
 * re-places labels when it saves marks half the diagram as moved. A deliberate move snaps to the
 * 10 px grid of the modeller, so it is never this small.
 */
export const LAYOUT_TOLERANCE = 5;

/** DI attributes that change how an element is drawn, not where - a difference is never noise. */
const DRAWING_ATTRS = [ 'isExpanded', 'isHorizontal', 'isMarkerVisible', 'isMessageVisible', 'participantBandKind' ];

/**
 * Removes the layout changes of elements whose drawing shifted by at most `tolerance` pixels.
 * Returns a copy of the differ result; the other buckets are left as they are.
 */
export function dropMinorLayoutChanges(changes, oldDefs, newDefs, tolerance = LAYOUT_TOLERANCE) {
  if (!changes || !changes._layoutChanged) {
    return changes;
  }

  const oldDi = diByElementId(oldDefs);
  const newDi = diByElementId(newDefs);
  const layoutChanged = {};

  for (const [ id, element ] of Object.entries(changes._layoutChanged)) {
    if (!isMinor(oldDi.get(id), newDi.get(id), tolerance)) {
      layoutChanged[id] = element;
    }
  }

  return { ...changes, _layoutChanged: layoutChanged };
}

/** Every BPMNShape / BPMNEdge of all diagrams, by the id of the element it draws. */
function diByElementId(defs) {
  const result = new Map();

  for (const diagram of (defs && defs.diagrams) || []) {
    for (const di of (diagram.plane && diagram.plane.planeElement) || []) {
      if (di.bpmnElement && di.bpmnElement.id) {
        result.set(di.bpmnElement.id, di);
      }
    }
  }

  return result;
}

function isMinor(oldDi, newDi, tolerance) {
  // without both drawings there is nothing to measure - keep what the differ said
  if (!oldDi || !newDi || oldDi.$type !== newDi.$type) {
    return false;
  }

  return DRAWING_ATTRS.every((attr) => oldDi[attr] === newDi[attr])
    && closeBounds(oldDi.bounds, newDi.bounds, tolerance)
    && closeBounds(oldDi.label && oldDi.label.bounds, newDi.label && newDi.label.bounds, tolerance)
    && closeWaypoints(oldDi.waypoint, newDi.waypoint, tolerance);
}

function closeBounds(a, b, tolerance) {
  if (!a || !b) {
    return !a && !b;
  }

  return [ 'x', 'y', 'width', 'height' ].every((key) => close(a[key], b[key], tolerance));
}

function closeWaypoints(a = [], b = [], tolerance) {
  return a.length === b.length
    && a.every((point, i) => close(point.x, b[i].x, tolerance) && close(point.y, b[i].y, tolerance));
}

function close(a, b, tolerance) {
  return Math.abs((a || 0) - (b || 0)) <= tolerance;
}
