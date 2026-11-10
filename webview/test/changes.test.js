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

test('a changed element carries its attributes as the differ reports them', () => {
  const changes = toChangeList({
    ...empty,
    _changed: { Task_1: { model: task, attrs: { name: { oldValue: 'revision', newValue: 'current' } } } }
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

const serviceTask = { id: 'Task_1', name: 'Approve', $type: 'bpmn:ServiceTask' };

function withListener(clazz) {
  return {
    ...serviceTask,
    extensionElements: { values: [ { $type: 'camunda:ExecutionListener', event: 'start', class: clazz } ] }
  };
}

test('an element differing only in its extension elements is reported as changed', () => {
  // bpmn-js-differ sees nothing here, so without the extension pass this edit would be invisible
  const changes = toChangeList(empty, { Task_1: withListener('com.acme.New') }, { Task_1: serviceTask });

  assert.deepEqual(changes.map((c) => [ c.id, c.kind ]), [ [ 'Task_1', 'changed' ] ]);
  assert.ok(changes[0].attrs['camunda:ExecutionListener'], 'the extension difference must be reported');
});

test('extension differences are merged into an element the differ already reported', () => {
  const changes = toChangeList(
    {
      ...empty,
      _changed: { Task_1: { model: withListener('new'), attrs: { name: { oldValue: 'revision', newValue: 'current' } } } }
    },
    { Task_1: withListener('new') },
    { Task_1: withListener('old') });

  assert.equal(changes.length, 1);
  assert.ok(changes[0].attrs.name, 'the differ attribute must survive');
  assert.ok(changes[0].attrs['camunda:ExecutionListener'], 'the extension difference must be added');
});

test('an element only on one side is left to the added and removed buckets', () => {
  const changes = toChangeList({ ...empty, _added: { Task_1: withListener('x') } }, { Task_1: withListener('x') }, {});

  assert.deepEqual(changes.map((c) => c.kind), [ 'added' ]);
  assert.equal(changes[0].attrs, null);
});

test('identical extensions on both sides report nothing', () => {
  assert.deepEqual(toChangeList(empty, { Task_1: withListener('same') }, { Task_1: withListener('same') }), []);
});
