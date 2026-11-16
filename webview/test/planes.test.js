import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hiddenChanges, leadingKind } from '../src/planes.js';

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

const change = (id, kind = 'changed') => ({ id, kind });

test('changes on the top-level plane are not hidden anywhere', () => {
  assert.deepEqual(hiddenChanges([ change('Task_1'), change('Sub_A') ], rootOf, shapeOfRoot), new Map());
});

test('a change inside a collapsed subprocess is counted on that subprocess, by kind', () => {
  assert.deepEqual(
    hiddenChanges([ change('Inner_1', 'added') ], rootOf, shapeOfRoot),
    new Map([ [ 'Sub_A', new Map([ [ 'added', 1 ] ]) ] ]));
});

test('a nested change is counted on every enclosing collapsed subprocess', () => {
  assert.deepEqual(
    hiddenChanges([ change('Deep_1', 'added'), change('Deep_2', 'changed'), change('Inner_1', 'added') ], rootOf, shapeOfRoot),
    new Map([
      [ 'Sub_B', new Map([ [ 'added', 1 ], [ 'changed', 1 ] ]) ],
      [ 'Sub_A', new Map([ [ 'added', 2 ], [ 'changed', 1 ] ]) ]
    ]));
});

test('an id the pane does not know is ignored', () => {
  assert.deepEqual(hiddenChanges([ change('Gone_1') ], rootOf, shapeOfRoot), new Map());
});

test('a cycle in the lookups cannot hang the view', () => {
  const loopRootOf = () => 'X_plane';
  const loopShapeOfRoot = () => 'X';

  assert.deepEqual(
    hiddenChanges([ change('X') ], loopRootOf, loopShapeOfRoot),
    new Map([ [ 'X', new Map([ [ 'changed', 1 ] ]) ] ]));
});

test('the leading kind follows the order of the filter chips, not the counts', () => {
  assert.equal(leadingKind(new Map([ [ 'layout', 5 ], [ 'changed', 2 ], [ 'removed', 1 ] ])), 'removed');
  assert.equal(leadingKind(new Map([ [ 'layout', 1 ] ])), 'layout');
  assert.equal(leadingKind(new Map()), undefined);
});
