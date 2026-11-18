import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changesToMarkdown, mergeToMarkdown } from '../src/export.js';

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

// ---- merge ----

function entry(id, side, kind, name, type, extra = {}) {
  return { id, side, kind, conflict: false, model: { name, $type: 'bpmn:' + type }, ours: null, theirs: null, ...extra };
}

const mergeEntries = [
  entry('Task_Review', 'both', 'removed', 'Manual review', 'Task', { conflict: true }),
  entry('End_Hold', 'both', 'changed', 'Held', 'EndEvent'),
  entry('Task_Ship', 'theirs', 'changed', 'Ship parcel', 'Task'),
  entry('Task_Supplier', 'ours', 'added', 'Order from supplier', 'Task')
];

const mergeLabels = { ours: 'Ours · HEAD', base: 'Base', theirs: 'Theirs · MERGE_HEAD' };
const details = (e) => (e.id === 'Task_Review' ? 'Removed by ours\nname: "Manual review" → theirs "Manual check"' : '');

test('a merge starts with a heading naming the sides', () => {
  const markdown = mergeToMarkdown(mergeEntries, new Map(), mergeLabels, details);

  assert.match(markdown, /^## BPMN merge\n\n`Ours · HEAD` and `Theirs · MERGE_HEAD`, base `Base`\n/);
});

test('a merge lists what both sides changed first, with whether it is open', () => {
  const states = new Map([ [ 'Task_Review', 'base' ], [ 'End_Hold', 'theirs' ] ]);
  const markdown = mergeToMarkdown(mergeEntries, states, mergeLabels, details);

  assert.match(markdown, /### Changed on both sides \(1 open of 2\)\n\n- \*\*Task\*\* Manual review \(`Task_Review`\) – conflict, open\n  - Removed by ours\n  - name: "Manual review" → theirs "Manual check"\n- \*\*EndEvent\*\* Held \(`End_Hold`\) – both changed, resolved – theirs\n/);
});

test('a merge lists the one-sided changes with their side', () => {
  const markdown = mergeToMarkdown(mergeEntries, new Map(), mergeLabels, details);

  assert.match(markdown, /### Changed on one side \(2\)\n\n- \*\*Task\*\* Ship parcel \(`Task_Ship`\) – theirs, changed\n- \*\*Task\*\* Order from supplier \(`Task_Supplier`\) – ours, added$/);
});

test('a merge without changes says so', () => {
  assert.match(mergeToMarkdown([], new Map(), mergeLabels, details), /No differences\.$/);
});
