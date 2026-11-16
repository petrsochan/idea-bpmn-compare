import { test } from 'node:test';
import assert from 'node:assert/strict';

import { commitChange } from '../src/history.js';

/*
 * What one commit did to one element, with the real moddle and differ - the same pipeline the
 * view runs, so the history never disagrees with the diff a click on it opens.
 */

function bpmn({ name = 'Check stock', x = 100, other = 'Ship order', listener = '', withTask = true } = {}) {
  const extensions = listener ? `<bpmn:extensionElements>${listener}</bpmn:extensionElements>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1">
    ${withTask ? `<bpmn:task id="Task_1" name="${name}">${extensions}</bpmn:task>` : ''}
    <bpmn:task id="Task_2" name="${other}" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      ${withTask ? `<bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="${x}" y="100" width="100" height="80" /></bpmndi:BPMNShape>` : ''}
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2"><dc:Bounds x="300" y="100" width="100" height="80" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

test('a renamed task reports the rename', async () => {
  const change = await commitChange('Task_1', bpmn(), bpmn({ name: 'Verify availability' }));

  assert.deepEqual(change.kinds, [ 'changed' ]);
  assert.equal(change.summary, 'Changed: name: "Check stock" → "Verify availability"');
});

test('a commit that did not touch the element is null', async () => {
  assert.equal(await commitChange('Task_1', bpmn(), bpmn({ other: 'Ship it' })), null);
});

test('a nudge within the tolerance is null, a real move is reported', async () => {
  assert.equal(await commitChange('Task_1', bpmn(), bpmn({ x: 103 })), null);

  const moved = await commitChange('Task_1', bpmn(), bpmn({ x: 140 }));

  assert.deepEqual(moved.kinds, [ 'layout' ]);
  assert.equal(moved.summary, 'Moved');
});

test('an edit of a Camunda extension only counts', async () => {
  const listener = '<camunda:executionListener event="start" class="com.acme.Listener" />';
  const change = await commitChange('Task_1', bpmn(), bpmn({ listener }));

  assert.deepEqual(change.kinds, [ 'changed' ]);
  assert.match(change.summary, /^Changed: /);
});

test('the commit that created the file reports the element as added', async () => {
  const change = await commitChange('Task_1', null, bpmn());

  assert.deepEqual(change.kinds, [ 'added' ]);
  assert.equal(change.summary, 'Added');
});

test('reports the commit that removed the element', async () => {
  const change = await commitChange('Task_1', bpmn(), bpmn({ withTask: false }));

  assert.deepEqual(change.kinds, [ 'removed' ]);
  assert.equal(change.summary, 'Removed');
});

test('the commit that deleted the file reports the element as removed', async () => {
  assert.deepEqual((await commitChange('Task_1', bpmn(), null)).kinds, [ 'removed' ]);
});

test('skips commits that do not parse', async () => {
  assert.equal(await commitChange('Task_1', bpmn(), '<broken'), null);
});

test('a long summary is cut', async () => {
  const change = await commitChange('Task_1', bpmn(), bpmn({ name: 'x'.repeat(300) }));

  assert.ok(change.summary.length <= 120, change.summary.length);
  assert.ok(change.summary.endsWith('…'));
});
