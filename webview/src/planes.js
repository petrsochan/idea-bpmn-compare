import { KINDS } from './changes.js';

/*
 * Planes of a diagram, the part of bpmn-js that hides changes.
 *
 * bpmn-js draws the content of a collapsed subprocess on a plane of its own, reached through the
 * drill-down button on the subprocess shape. A change on such a plane is in the change list, but
 * the diagram the user looks at shows nothing - so the shape that leads to it is marked.
 */

/**
 * The changes each collapsed subprocess hides, counted by kind, nested levels included: a change
 * two levels deep is counted on both subprocesses on the way to it.
 *
 * @param {{ id: string, kind: string }[]} changes changes drawn on one pane, each with the kind it is drawn as
 * @param {(id: string) => string | undefined} rootOf id of the plane an element is drawn on
 * @param {(rootId: string) => string | undefined} shapeOfRoot id of the collapsed subprocess shape
 *   that opens a plane; undefined for a top-level plane (process or collaboration)
 * @returns {Map<string, Map<string, number>>} collapsed subprocess shape id -> kind -> number of changes inside
 */
export function hiddenChanges(changes, rootOf, shapeOfRoot) {
  const hidden = new Map();

  for (const { id, kind } of changes) {
    const visited = new Set();
    let root = rootOf(id);

    while (root !== undefined && !visited.has(root)) {
      visited.add(root);

      const shape = shapeOfRoot(root);

      if (shape === undefined) {
        break;
      }

      const byKind = hidden.get(shape) || new Map();
      byKind.set(kind, (byKind.get(kind) || 0) + 1);
      hidden.set(shape, byKind);

      root = rootOf(shape);
    }
  }

  return hidden;
}

/** The kind a subprocess is marked as: the first one present in the order of the filter chips. */
export function leadingKind(byKind) {
  return KINDS.find((kind) => byKind.has(kind));
}

// ---------------------------------------------------------------------------
// planes of a pane
// ---------------------------------------------------------------------------

/** Id of the plane an element is drawn on, or undefined if the pane does not have it. */
export function rootIdOf(pane, id) {
  const element = pane.viewer.get('elementRegistry').get(id);
  const root = element && pane.viewer.get('canvas').findRoot(element);

  return root ? root.id : undefined;
}

/**
 * Id of the collapsed subprocess shape that opens a plane, or undefined for a top-level plane.
 *
 * The plane of subprocess `Sub_1` is the root `Sub_1_plane` sharing its business object, so the
 * shape is the registry entry under the business object's id - for a process plane that entry is
 * the root itself.
 */
export function shapeIdOfRoot(pane, rootId) {
  const registry = pane.viewer.get('elementRegistry');
  const root = registry.get(rootId);
  const shape = root && root.businessObject && registry.get(root.businessObject.id);

  return shape && shape !== root ? shape.id : undefined;
}

/** Switches the pane to the plane the element is drawn on; nothing happens if it is already shown. */
export function showPlaneOf(pane, element) {
  const canvas = pane.viewer.get('canvas');
  const root = canvas.findRoot(element);

  if (root) {
    canvas.setRootElement(root);
  }
}
