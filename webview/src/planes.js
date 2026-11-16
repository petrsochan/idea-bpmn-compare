/*
 * Planes of a diagram, the part of bpmn-js that hides changes.
 *
 * bpmn-js draws the content of a collapsed subprocess on a plane of its own, reached through the
 * drill-down button on the subprocess shape. A change on such a plane is in the change list, but
 * the diagram the user looks at shows nothing - so the shape that leads to it gets a count.
 */

/**
 * How many of the changes `ids` each collapsed subprocess hides, nested levels included: a change
 * two levels deep is counted on both subprocesses on the way to it.
 *
 * @param {string[]} ids changes drawn on one pane
 * @param {(id: string) => string | undefined} rootOf id of the plane an element is drawn on
 * @param {(rootId: string) => string | undefined} shapeOfRoot id of the collapsed subprocess shape
 *   that opens a plane; undefined for a top-level plane (process or collaboration)
 * @returns {Map<string, number>} collapsed subprocess shape id -> number of changes inside
 */
export function hiddenChangeCounts(ids, rootOf, shapeOfRoot) {
  const counts = new Map();

  for (const id of ids) {
    const visited = new Set();
    let root = rootOf(id);

    while (root !== undefined && !visited.has(root)) {
      visited.add(root);

      const shape = shapeOfRoot(root);

      if (shape === undefined) {
        break;
      }

      counts.set(shape, (counts.get(shape) || 0) + 1);
      root = rootOf(shape);
    }
  }

  return counts;
}
