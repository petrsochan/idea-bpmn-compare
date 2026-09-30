import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KINDS, toChangeList } from '../src/changes.js';

const task = { name: 'Approve', $type: 'bpmn:ServiceTask' };
const gateway = { $type: 'bpmn:ExclusiveGateway' };
const empty = { _added: {}, _removed: {}, _changed: {}, _layoutChanged: {} };

test('the kind order drives both the chips and the sorting', () => {
  assert.deepEqual(KINDS, [ 'added', 'removed', 'changed', 'layout' ]);
});

test('flattens the differ buckets into one list', () => {
  const changes = toChangeList({ ...empty, _added: { Task_1: task }, _removed: { Gateway_1: gateway } });

  assert.deepEqual(changes.map((c) => [ c.id, c.kind ]), [ [ 'Task_1', 'added' ], [ 'Gateway_1', 'removed' ] ]);
  assert.equal(changes[0].model, task);
  assert.equal(changes[0].attrs, null, 'an added element has no attribute changes');
});

test('a changed element carries its attributes with old and new swapped', () => {
  const changes = toChangeList({
    ...empty,
    _changed: { Task_1: { model: task, attrs: { name: { oldValue: 'current', newValue: 'revision' } } } }
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'changed');
  assert.deepEqual(changes[0].attrs.name, { oldValue: 'revision', newValue: 'current' });
});

test('an element that only moved is reported as a layout change', () => {
  assert.deepEqual(
    toChangeList({ ...empty, _layoutChanged: { Task_1: task } }).map((c) => c.kind),
    [ 'layout' ]);
});

test('an element in several buckets becomes one entry keeping every kind', () => {
  const changes = toChangeList({
    ...empty,
    _changed: { Task_1: { model: task, attrs: { name: { oldValue: 'a', newValue: 'b' } } } },
    _layoutChanged: { Task_1: task }
  });

  assert.equal(changes.length, 1, 'the element must not be counted twice');
  // kind is the first matching KIND, but both kinds stay available so the filter chips can hide either
  assert.equal(changes[0].kind, 'changed');
  assert.deepEqual([ ...changes[0].kinds ].sort(), [ 'changed', 'layout' ]);
});

test('sorts by kind first and by displayed name within a kind', () => {
  const changes = toChangeList({
    ...empty,
    _added: { B: { name: 'Beta', $type: 'bpmn:Task' }, A: { name: 'Alpha', $type: 'bpmn:Task' } },
    _removed: { C: { name: 'Gamma', $type: 'bpmn:Task' } }
  });

  assert.deepEqual(changes.map((c) => c.id), [ 'A', 'B', 'C' ]);
});

test('tolerates a missing or empty differ result', () => {
  assert.deepEqual(toChangeList(null), []);
  assert.deepEqual(toChangeList(undefined), []);
  assert.deepEqual(toChangeList({}), []);
});
