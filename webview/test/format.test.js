import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeAttrs, displayName, formatValue, typeName } from '../src/format.js';

test('typeName strips only the bpmn namespace prefix', () => {
  assert.equal(typeName({ model: { $type: 'bpmn:ServiceTask' } }), 'ServiceTask');
  // extension namespaces stay visible - that is what tells a reader it is not plain BPMN
  assert.equal(typeName({ model: { $type: 'camunda:ExecutionListener' } }), 'camunda:ExecutionListener');
  assert.equal(typeName({}), '');
});

test('displayName prefers the element name and falls back to the id', () => {
  assert.equal(displayName({ id: 'Task_1', model: { name: 'Approve invoice' } }), 'Approve invoice');
  assert.equal(displayName({ id: 'Task_1', model: {} }), 'Task_1');
  assert.equal(displayName({ id: 'Task_1' }), 'Task_1');
  // a name of only whitespace is no name
  assert.equal(displayName({ id: 'Task_1', model: { name: '   ' } }), 'Task_1');
});

test('formatValue quotes primitives so an empty string is visible', () => {
  assert.equal(formatValue('x'), '"x"');
  assert.equal(formatValue(''), '""');
  assert.equal(formatValue(true), '"true"');
  assert.equal(formatValue(7), '"7"');
});

test('formatValue marks a missing value with the empty set sign', () => {
  assert.equal(formatValue(null), '∅');
  assert.equal(formatValue(undefined), '∅');
});

test('formatValue renders model references by type and id', () => {
  assert.equal(formatValue({ $type: 'bpmn:SequenceFlow', id: 'Flow_1' }), 'SequenceFlow#Flow_1');
  assert.equal(formatValue({ $type: 'bpmn:SequenceFlow' }), 'SequenceFlow');
  assert.equal(formatValue({ a: 1 }), '{"a":1}');
});

test('formatValue renders arrays element by element', () => {
  assert.equal(formatValue([ 'a', 'b' ]), '["a", "b"]');
});

test('formatValue truncates a very long value', () => {
  const formatted = formatValue('x'.repeat(200));

  assert.ok(formatted.length < 130, 'was ' + formatted.length + ' chars');
  assert.ok(formatted.endsWith('...\"'), formatted.slice(-10));
});

test('describeAttrs renders one old to new line per attribute', () => {
  assert.equal(
    describeAttrs({ name: { oldValue: 'A', newValue: 'B' } }),
    'name: "A" → "B"');

  assert.equal(
    describeAttrs({ name: { oldValue: 'A', newValue: 'B' }, async: { oldValue: null, newValue: true } }),
    'name: "A" → "B"\nasync: ∅ → "true"');
});

test('describeAttrs of nothing is an empty string', () => {
  assert.equal(describeAttrs(null), '');
  assert.equal(describeAttrs({}), '');
});
