import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hiddenChangeCounts } from '../src/planes.js';

/*
 * Process_1 (top-level plane)
 *   Task_1
 *   Sub_A (collapsed)  -> plane Sub_A_plane
 *     Inner_1
 *     Sub_B (collapsed) -> plane Sub_B_plane
 *       Deep_1
 *       Deep_2
 */
const ROOT_OF = new Map([
  [ 'Task_1', 'Process_1' ],
  [ 'Sub_A', 'Process_1' ],
  [ 'Inner_1', 'Sub_A_plane' ],
  [ 'Sub_B', 'Sub_A_plane' ],
  [ 'Deep_1', 'Sub_B_plane' ],
  [ 'Deep_2', 'Sub_B_plane' ]
]);
const SHAPE_OF_ROOT = new Map([ [ 'Sub_A_plane', 'Sub_A' ], [ 'Sub_B_plane', 'Sub_B' ] ]);

const rootOf = (id) => ROOT_OF.get(id);
const shapeOfRoot = (id) => SHAPE_OF_ROOT.get(id);

test('changes on the top-level plane are not hidden anywhere', () => {
  assert.deepEqual(hiddenChangeCounts([ 'Task_1', 'Sub_A' ], rootOf, shapeOfRoot), new Map());
});

test('a change inside a collapsed subprocess is counted on that subprocess', () => {
  assert.deepEqual(hiddenChangeCounts([ 'Inner_1' ], rootOf, shapeOfRoot), new Map([ [ 'Sub_A', 1 ] ]));
});

test('a nested change is counted on every enclosing collapsed subprocess', () => {
  assert.deepEqual(
    hiddenChangeCounts([ 'Deep_1', 'Deep_2', 'Inner_1' ], rootOf, shapeOfRoot),
    new Map([ [ 'Sub_B', 2 ], [ 'Sub_A', 3 ] ]));
});

test('an id the pane does not know is ignored', () => {
  assert.deepEqual(hiddenChangeCounts([ 'Gone_1' ], rootOf, shapeOfRoot), new Map());
});

test('a cycle in the lookups cannot hang the view', () => {
  const loopRootOf = (id) => (id === 'X' ? 'X_plane' : 'X_plane');
  const loopShapeOfRoot = () => 'X';

  assert.deepEqual(hiddenChangeCounts([ 'X' ], loopRootOf, loopShapeOfRoot), new Map([ [ 'X', 1 ] ]));
});
