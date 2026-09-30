import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changesToMarkdown } from '../src/export.js';

function change(id, kind, name, type, attrs) {
  return { id, kind, kinds: new Set([ kind ]), model: { name, $type: 'bpmn:' + type }, attrs: attrs || null };
}

const changes = [
  change('Task_1', 'added', 'Approve', 'ServiceTask'),
  change('Gateway_1', 'removed', undefined, 'ExclusiveGateway'),
  change('Task_2', 'changed', 'Pay', 'ServiceTask', { name: { oldValue: 'Pay out', newValue: 'Pay' } })
];

const labels = { left: 'working copy · order.bpmn', right: 'main (a1b2c3d)' };

test('starts with a heading naming both sides', () => {
  const markdown = changesToMarkdown(changes, labels);

  assert.match(markdown, /^## BPMN changes/);
  assert.match(markdown, /working copy · order\.bpmn/);
  assert.match(markdown, /main \(a1b2c3d\)/);
});

test('groups the changes under headings with counts', () => {
  const markdown = changesToMarkdown(changes, labels);

  assert.match(markdown, /### Added \(1\)/);
  assert.match(markdown, /### Removed \(1\)/);
  assert.match(markdown, /### Changed \(1\)/);
});

test('omits headings of kinds with no changes', () => {
  assert.doesNotMatch(changesToMarkdown(changes, labels), /Moved/);
});

test('renders one bullet per change with type, name and id', () => {
  const markdown = changesToMarkdown(changes, labels);

  assert.match(markdown, /- \*\*ServiceTask\*\* Approve \(`Task_1`\)/);
  // no name means the id is the name, and it must not be printed twice
  assert.match(markdown, /- \*\*ExclusiveGateway\*\* `Gateway_1`$/m);
});

test('lists changed attributes as sub-bullets', () => {
  assert.match(changesToMarkdown(changes, labels), /^ {2}- name: "Pay out" → "Pay"$/m);
});

test('keeps the headings in chip order', () => {
  const headings = changesToMarkdown(changes, labels).match(/### \w+/g);

  assert.deepEqual(headings, [ '### Added', '### Removed', '### Changed' ]);
});

test('an empty change list says so instead of printing empty headings', () => {
  const markdown = changesToMarkdown([], labels);

  assert.match(markdown, /No differences/);
  assert.doesNotMatch(markdown, /###/);
});
