import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BpmnModdle } from 'bpmn-moddle';
import { diff } from 'bpmn-js-differ';

import { LAYOUT_TOLERANCE, dropMinorLayoutChanges } from '../src/layout.js';

/*
 * Runs the real differ: it reports any DI difference at all as a layout change, so a modeller that
 * nudges a shape by a pixel or re-places a label on save marks it as moved. dropMinorLayoutChanges
 * must leave only moves somebody would call a move.
 */

function bpmn({ task = 'x="100" y="100" width="100" height="80"', label = '', flow = '<di:waypoint x="200" y="140" /><di:waypoint x="300" y="140" />', expanded = '' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1">
    <bpmn:task id="Task_1" />
    <bpmn:task id="Task_2" />
    <bpmn:subProcess id="Sub_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Task_1" targetRef="Task_2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds ${task} />${label}</bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2"><dc:Bounds x="300" y="100" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_1_di" bpmnElement="Sub_1" ${expanded}><dc:Bounds x="500" y="100" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">${flow}</bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

const labelAt = (x, y) => `<bpmndi:BPMNLabel><dc:Bounds x="${x}" y="${y}" width="40" height="14" /></bpmndi:BPMNLabel>`;

/** Ids of the layout changes left after filtering, comparing the revision with the current file. */
async function movedIds(revision, current) {
  const moddle = new BpmnModdle();
  const { rootElement: oldDefs } = await moddle.fromXML(bpmn(revision));
  const { rootElement: newDefs } = await moddle.fromXML(bpmn(current));

  const changes = dropMinorLayoutChanges(diff(oldDefs, newDefs), oldDefs, newDefs);

  return Object.keys(changes._layoutChanged).sort();
}

test('the tolerance is a few pixels, below one step of the modeller grid', () => {
  assert.ok(LAYOUT_TOLERANCE > 0 && LAYOUT_TOLERANCE < 10);
});

test('a shape nudged within the tolerance is not a move', async () => {
  assert.deepEqual(await movedIds({}, { task: 'x="103" y="98" width="100" height="80"' }), []);
});

test('a shape moved further than the tolerance is a move', async () => {
  assert.deepEqual(await movedIds({}, { task: 'x="130" y="100" width="100" height="80"' }), [ 'Task_1' ]);
});

test('a resize beyond the tolerance is a move', async () => {
  assert.deepEqual(await movedIds({}, { task: 'x="100" y="100" width="140" height="80"' }), [ 'Task_1' ]);
});

test('a label re-placed by a few pixels is not a move, a label dragged away is', async () => {
  assert.deepEqual(await movedIds({ label: labelAt(130, 190) }, { label: labelAt(132, 193) }), []);
  assert.deepEqual(await movedIds({ label: labelAt(130, 190) }, { label: labelAt(130, 240) }), [ 'Task_1' ]);
});

test('a label that appears or disappears is a move', async () => {
  assert.deepEqual(await movedIds({}, { label: labelAt(130, 190) }), [ 'Task_1' ]);
});

test('waypoints shifted within the tolerance are not a move', async () => {
  const current = { flow: '<di:waypoint x="201" y="142" /><di:waypoint x="298" y="142" />' };

  assert.deepEqual(await movedIds({}, current), []);
});

test('a bend point added to a flow is a move, however close it is', async () => {
  const current = { flow: '<di:waypoint x="200" y="140" /><di:waypoint x="250" y="140" /><di:waypoint x="300" y="140" />' };

  assert.deepEqual(await movedIds({}, current), [ 'Flow_1' ]);
});

test('expanding a subprocess is a change of the drawing, not noise', async () => {
  assert.deepEqual(await movedIds({ expanded: 'isExpanded="false"' }, { expanded: 'isExpanded="true"' }), [ 'Sub_1' ]);
});

test('the other kinds of changes are left alone', async () => {
  const moddle = new BpmnModdle();
  const { rootElement: oldDefs } = await moddle.fromXML(bpmn());
  const { rootElement: newDefs } = await moddle.fromXML(bpmn({ task: 'x="101" y="100" width="100" height="80"' }));
  const changes = diff(oldDefs, newDefs);
  changes._changed.Task_2 = { model: {}, attrs: {} };

  const filtered = dropMinorLayoutChanges(changes, oldDefs, newDefs);

  assert.deepEqual(Object.keys(filtered._changed), [ 'Task_2' ]);
  assert.deepEqual(filtered._layoutChanged, {});
});
