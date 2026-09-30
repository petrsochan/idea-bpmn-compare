import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareExtensions } from '../src/extensions.js';

function task(extensions) {
  return {
    id: 'Task_1',
    $type: 'bpmn:ServiceTask',
    extensionElements: extensions ? { values: extensions } : undefined
  };
}

test('no extension elements on either side means no differences', () => {
  assert.deepEqual(compareExtensions(task(null), task(null)), {});
  assert.deepEqual(compareExtensions(null, null), {});
  assert.deepEqual(compareExtensions(undefined, task(null)), {});
});

test('reports an added extension element as new with no old value', () => {
  const diff = compareExtensions(
    task(null),
    task([ { $type: 'camunda:ExecutionListener', event: 'start', class: 'com.acme.Listener' } ]));

  assert.deepEqual(Object.keys(diff), [ 'camunda:ExecutionListener' ]);
  assert.equal(diff['camunda:ExecutionListener'].oldValue, undefined);
  assert.match(diff['camunda:ExecutionListener'].newValue, /start/);
  assert.match(diff['camunda:ExecutionListener'].newValue, /com\.acme\.Listener/);
});

test('reports a removed extension element as old with no new value', () => {
  const diff = compareExtensions(task([ { $type: 'camunda:ExecutionListener', event: 'start' } ]), task(null));

  assert.match(diff['camunda:ExecutionListener'].oldValue, /start/);
  assert.equal(diff['camunda:ExecutionListener'].newValue, undefined);
});

test('old is the revision and new is the current file, matching the rest of the change list', () => {
  const diff = compareExtensions(
    task([ { $type: 'camunda:ExecutionListener', event: 'start', class: 'com.acme.Old' } ]),
    task([ { $type: 'camunda:ExecutionListener', event: 'start', class: 'com.acme.New' } ]));

  assert.match(diff['camunda:ExecutionListener'].oldValue, /com\.acme\.Old/);
  assert.match(diff['camunda:ExecutionListener'].newValue, /com\.acme\.New/);
});

test('identical extension elements are not reported', () => {
  const listener = { $type: 'camunda:ExecutionListener', event: 'start', class: 'com.acme.Listener' };

  assert.deepEqual(compareExtensions(task([ listener ]), task([ { ...listener } ])), {});
});

test('property order is not a difference', () => {
  assert.deepEqual(
    compareExtensions(
      task([ { $type: 'camunda:ExecutionListener', event: 'start', class: 'C' } ]),
      task([ { $type: 'camunda:ExecutionListener', class: 'C', event: 'start' } ])),
    {});
});

test('the cyclic moddle parent link is ignored', () => {
  // moddle adds $parent back-references; walking into them would never terminate
  const one = { $type: 'camunda:ExecutionListener', event: 'start' };
  const other = { $type: 'camunda:ExecutionListener', event: 'start' };
  one.$parent = task([ one ]);
  other.$parent = task([ other ]);

  assert.deepEqual(compareExtensions(task([ one ]), task([ other ])), {});
});

test('distinguishes several elements of the same type', () => {
  const diff = compareExtensions(
    task([ { $type: 'camunda:ExecutionListener', event: 'start' },
      { $type: 'camunda:ExecutionListener', event: 'end' } ]),
    task([ { $type: 'camunda:ExecutionListener', event: 'start' } ]));

  assert.match(diff['camunda:ExecutionListener'].oldValue, /end/);
  assert.doesNotMatch(String(diff['camunda:ExecutionListener'].newValue), /end/);
});

test('compares nested input and output mappings', () => {
  const diff = compareExtensions(
    task([ { $type: 'camunda:InputOutput', inputParameters: [ { $type: 'camunda:InputParameter', name: 'amount', value: '${old}' } ] } ]),
    task([ { $type: 'camunda:InputOutput', inputParameters: [ { $type: 'camunda:InputParameter', name: 'amount', value: '${new}' } ] } ]));

  assert.match(diff['camunda:InputOutput'].oldValue, /\$\{old}/);
  assert.match(diff['camunda:InputOutput'].newValue, /\$\{new}/);
});

test('keeps the id of a form field, which the author wrote and cares about', () => {
  const diff = compareExtensions(
    task([ { $type: 'camunda:FormData', fields: [ { $type: 'camunda:FormField', id: 'approved', type: 'boolean' } ] } ]),
    task([ { $type: 'camunda:FormData', fields: [ { $type: 'camunda:FormField', id: 'rejected', type: 'boolean' } ] } ]));

  assert.match(diff['camunda:FormData'].oldValue, /approved/);
  assert.match(diff['camunda:FormData'].newValue, /rejected/);
});

test('works for Zeebe extensions too', () => {
  const diff = compareExtensions(
    task([ { $type: 'zeebe:taskDefinition', type: 'old-worker' } ]),
    task([ { $type: 'zeebe:taskDefinition', type: 'new-worker' } ]));

  assert.match(diff['zeebe:taskDefinition'].oldValue, /old-worker/);
  assert.match(diff['zeebe:taskDefinition'].newValue, /new-worker/);
});

test('an element with extensions on neither side but other properties is untouched', () => {
  assert.deepEqual(compareExtensions({ id: 'A', $type: 'bpmn:Task', name: 'x' }, { id: 'A', $type: 'bpmn:Task', name: 'y' }), {});
});
