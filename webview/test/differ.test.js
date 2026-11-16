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

function collapsedSubprocess(innerName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1">
    <bpmn:subProcess id="Sub_1">
      <bpmn:task id="Inner_1" name="${innerName}" />
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Sub_1_di" bpmnElement="Sub_1" isExpanded="false">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diagram_2">
    <bpmndi:BPMNPlane id="Plane_2" bpmnElement="Sub_1">
      <bpmndi:BPMNShape id="Inner_1_di" bpmnElement="Inner_1">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

test('an element inside a collapsed subprocess is reported like any other', async () => {
  const moddle = new BpmnModdle();
  const { rootElement: revision } = await moddle.fromXML(collapsedSubprocess('Old'));
  const { rootElement: current } = await moddle.fromXML(collapsedSubprocess('New'));

  const changes = toChangeList(diff(revision, current));

  assert.deepEqual(changes.map((change) => change.id), [ 'Inner_1' ]);
  assert.deepEqual(changes[0].attrs.name, { oldValue: 'Old', newValue: 'New' });
});
