import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BpmnModdle } from 'bpmn-moddle';
import { diff } from 'bpmn-js-differ';

import { toChangeList } from '../src/changes.js';
import { describeAttrs } from '../src/format.js';

/*
 * Runs the real bpmn-js-differ on parsed BPMN, so a differ release that changes how it reports
 * values shows up here - the other tests feed toChangeList hand-made differ results.
 * bpmn-js-differ 4.0 fixed swapped oldValue / newValue; until then the plugin swapped them back.
 */

function bpmn(taskAttrs) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1">
    <bpmn:task id="Task_1" ${taskAttrs} />
  </bpmn:process>
</bpmn:definitions>`;
}

async function changeOf(revisionAttrs, currentAttrs) {
  const moddle = new BpmnModdle();
  const { rootElement: revision } = await moddle.fromXML(bpmn(revisionAttrs));
  const { rootElement: current } = await moddle.fromXML(bpmn(currentAttrs));

  // the same argument order as main.js: diff(revision, current)
  const changes = toChangeList(diff(revision, current));

  assert.equal(changes.length, 1);
  assert.equal(changes[0].id, 'Task_1');

  return changes[0];
}

test('a changed property is reported as revision value to current value', async () => {
  const change = await changeOf('name="Old"', 'name="New"');

  assert.deepEqual(change.attrs.name, { oldValue: 'Old', newValue: 'New' });
  assert.equal(describeAttrs(change.attrs), 'name: "Old" → "New"');
});

test('an added property has no old value', async () => {
  const change = await changeOf('', 'name="New"');

  assert.deepEqual(change.attrs.name, { oldValue: undefined, newValue: 'New' });
  assert.equal(describeAttrs(change.attrs), 'name: ∅ → "New"');
});

test('a removed property has no new value', async () => {
  const change = await changeOf('name="Old"', '');

  assert.deepEqual(change.attrs.name, { oldValue: 'Old', newValue: undefined });
  assert.equal(describeAttrs(change.attrs), 'name: "Old" → ∅');
});
