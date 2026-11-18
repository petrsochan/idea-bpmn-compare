import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BpmnModdle } from 'bpmn-moddle';
import { diff } from 'bpmn-js-differ';

import { toChangeList } from '../src/changes.js';
import { dropMinorLayoutChanges } from '../src/layout.js';
import { describeMerge, isOpen, orderEntries, resultStates, toMergeEntries } from '../src/merge-changes.js';

/*
 * Fixtures: base = revision.bpmn, ours = current.bpmn, theirs = merge-theirs.bpmn. Against the base,
 * theirs renames Task_Check (ours renamed it differently), renames Task_Review (ours removed it),
 * renames End_Hold (ours moved it), renames Task_Ship and adds Task_Gift.
 */

const fixture = (name) => readFileSync(new URL('../e2e/fixtures/' + name, import.meta.url), 'utf8');

const BASE = fixture('revision.bpmn');
const OURS = fixture('current.bpmn');
const THEIRS = fixture('merge-theirs.bpmn');

async function parse(xml) {
  return (await new BpmnModdle().fromXML(xml)).rootElement;
}

/** id -> business object of every flow element, also inside subprocesses - what the page collects. */
function elementsOf(defs) {
  const result = {};

  function walk(container) {
    for (const element of container.flowElements || []) {
      result[element.id] = element;
      walk(element);
    }
  }

  for (const root of defs.rootElements || []) {
    walk(root);
  }

  return result;
}

/** The change list the two-pane view shows for old -> new. */
function changes(oldDefs, newDefs) {
  return toChangeList(dropMinorLayoutChanges(diff(oldDefs, newDefs), oldDefs, newDefs),
    elementsOf(newDefs), elementsOf(oldDefs));
}

async function merge(baseXml, oursXml, theirsXml, resultXml) {
  const [ base, ours, theirs ] = await Promise.all([ parse(baseXml), parse(oursXml), parse(theirsXml) ]);
  const entries = toMergeEntries(changes(base, ours), changes(base, theirs), changes(ours, theirs));

  let states = new Map();
  let fromBase = [];

  if (resultXml) {
    const result = await parse(resultXml);
    fromBase = changes(base, result);
    states = resultStates(entries, fromBase, changes(ours, result), changes(theirs, result));
  }

  const byId = Object.fromEntries(entries.map((entry) => [ entry.id, entry ]));

  return { entries, states, byId, fromBase };
}

/** A process with one task X; `attrs` go on the task, `x`/`y` place its shape. */
function oneTask({ attrs = '', x = 100, y = 100, ext = '' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P">
    <bpmn:serviceTask id="X" ${attrs}>${ext ? '<bpmn:extensionElements>' + ext + '</bpmn:extensionElements>' : ''}</bpmn:serviceTask>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="P">
    <bpmndi:BPMNShape id="X_di" bpmnElement="X"><dc:Bounds x="${x}" y="${y}" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

const EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" />
</bpmn:definitions>`;

test('same attribute changed differently is a conflict', async () => {
  const { byId } = await merge(BASE, OURS, THEIRS);

  assert.equal(byId.Task_Check.side, 'both');
  assert.equal(byId.Task_Check.conflict, true);
  assert.equal(byId.Task_Check.kind, 'changed');
});

test('removed against changed is a conflict', async () => {
  const { byId } = await merge(BASE, OURS, THEIRS);

  assert.equal(byId.Task_Review.side, 'both');
  assert.equal(byId.Task_Review.conflict, true);
  assert.equal(byId.Task_Review.kind, 'removed');
});

test('move against rename is both changed', async () => {
  const { byId } = await merge(BASE, OURS, THEIRS);

  assert.equal(byId.End_Hold.side, 'both');
  assert.equal(byId.End_Hold.conflict, false);
});

test('one-sided changes keep their side', async () => {
  const { byId } = await merge(BASE, OURS, THEIRS);

  assert.deepEqual([ byId.Task_Ship.side, byId.Task_Ship.kind, byId.Task_Ship.conflict ], [ 'theirs', 'changed', false ]);
  assert.deepEqual([ byId.Task_Gift.side, byId.Task_Gift.kind ], [ 'theirs', 'added' ]);
  assert.deepEqual([ byId.Task_Supplier.side, byId.Task_Supplier.kind ], [ 'ours', 'added' ]);
  assert.equal(byId.Task_Supplier.theirs, null);
  assert.equal(byId.Task_Gift.ours, null);
});

test('the same change on both sides is not a conflict', async () => {
  const { byId } = await merge(oneTask({ attrs: 'name="Old"' }), oneTask({ attrs: 'name="A"' }), oneTask({ attrs: 'name="A"' }));

  assert.equal(byId.X.side, 'both');
  assert.equal(byId.X.conflict, false);
});

test('both adding the same id differently is a conflict', async () => {
  const { byId } = await merge(EMPTY, oneTask({ attrs: 'name="A"' }), oneTask({ attrs: 'name="B"' }));

  assert.equal(byId.X.side, 'both');
  assert.equal(byId.X.kind, 'added');
  assert.equal(byId.X.conflict, true);
});

test('both adding the same element is not a conflict', async () => {
  const { byId } = await merge(EMPTY, oneTask({ attrs: 'name="A"' }), oneTask({ attrs: 'name="A"' }));

  assert.equal(byId.X.conflict, false);
});

test('moves on both sides within the tolerance are no change', async () => {
  const { entries } = await merge(oneTask(), oneTask({ x: 103 }), oneTask({ x: 102 }));

  assert.deepEqual(entries, []);
});

test('moves on both sides to different places are both changed, not a conflict', async () => {
  const { byId } = await merge(oneTask(), oneTask({ x: 200 }), oneTask({ x: 300 }));

  assert.equal(byId.X.side, 'both');
  assert.equal(byId.X.kind, 'layout');
  assert.equal(byId.X.conflict, false);
});

test('extension change against attribute change is both changed', async () => {
  const { byId } = await merge(
    oneTask({ attrs: 'name="Pay"', ext: '<zeebe:taskDefinition type="a" />' }),
    oneTask({ attrs: 'name="Pay"', ext: '<zeebe:taskDefinition type="b" />' }),
    oneTask({ attrs: 'name="Pay invoice"', ext: '<zeebe:taskDefinition type="a" />' }));

  assert.equal(byId.X.side, 'both');
  assert.equal(byId.X.conflict, false);
});

test('result equal to ours', async () => {
  const { states } = await merge(BASE, OURS, THEIRS, OURS);

  assert.equal(states.get('Task_Check'), 'ours');
  assert.equal(states.get('Task_Ship'), 'base');
  assert.equal(states.get('Task_Supplier'), 'ours');
});

test('result equal to theirs', async () => {
  const { states } = await merge(BASE, OURS, THEIRS, THEIRS);

  assert.equal(states.get('Task_Check'), 'theirs');
  assert.equal(states.get('Task_Gift'), 'theirs');
  assert.equal(states.get('Task_Supplier'), 'base');
});

test('result still base', async () => {
  const { entries, states } = await merge(BASE, OURS, THEIRS, BASE);

  for (const entry of entries.filter((e) => e.side === 'both')) {
    assert.equal(states.get(entry.id), 'base', entry.id);
    assert.equal(isOpen(entry, states), true, entry.id);
  }
});

test('result combining both', async () => {
  // End_Hold moved 40 px like ours and renamed like theirs
  const combined = THEIRS.replace('<dc:Bounds x="812" y="322"', '<dc:Bounds x="852" y="322"');
  const ours = fixture('current.bpmn');
  const { byId, states } = await merge(BASE, ours, THEIRS, combined);

  assert.match(ours, /End_Hold_di" bpmnElement="End_Hold"><dc:Bounds x="852" y="322"/);
  assert.equal(states.get('End_Hold'), 'both');
  assert.equal(isOpen(byId.End_Hold, states), false);
});

test('result edited by hand', async () => {
  const { byId, states } = await merge(BASE, OURS, THEIRS, BASE.replace('name="Check stock"', 'name="Check"'));

  assert.equal(states.get('Task_Check'), 'other');
  assert.equal(isOpen(byId.Task_Check, states), false);
});

test('no result means no states and every both-sided entry open', async () => {
  const { entries, states } = await merge(BASE, OURS, THEIRS);

  assert.equal(states.size, 0);
  assert.equal(isOpen(entries.find((e) => e.id === 'Task_Check'), states), true);
  assert.equal(isOpen(entries.find((e) => e.id === 'Task_Ship'), states), false);
});

test('order puts open conflicts first', async () => {
  const { entries, states } = await merge(BASE, OURS, THEIRS, BASE);
  const ids = orderEntries(entries, states).map((entry) => entry.id);

  // conflicts by kind like the change list (removed before changed), then the both-changed one
  assert.deepEqual(ids.slice(0, 3), [ 'Task_Review', 'Task_Check', 'End_Hold' ]);
  assert.ok(ids.indexOf('Task_Gift') > 2 && ids.indexOf('Task_Ship') > 2);
});

test('a resolved conflict goes after the open ones', async () => {
  const resolved = BASE.replace('name="Check stock"', 'name="Verify availability"');
  const { entries, states } = await merge(BASE, OURS, THEIRS, resolved);
  const ids = orderEntries(entries, states).map((entry) => entry.id);

  assert.deepEqual(ids.slice(0, 2), [ 'Task_Review', 'Task_Check' ]);
});

test('describeMerge lists each side and the result', async () => {
  const resolved = BASE.replace('name="Check stock"', 'name="Verify availability"');
  const { byId, fromBase } = await merge(BASE, OURS, THEIRS, resolved);

  assert.equal(describeMerge(byId.Task_Check, fromBase.find((c) => c.id === 'Task_Check')),
    'name: "Check stock" → ours "Verify availability", theirs "Check warehouse stock", result "Verify availability"');
});

test('describeMerge without a result change leaves the result out', async () => {
  const { byId } = await merge(BASE, OURS, THEIRS);

  assert.equal(describeMerge(byId.Task_Check, null),
    'name: "Check stock" → ours "Verify availability", theirs "Check warehouse stock"');
});

test('describeMerge says when the result removed the element', async () => {
  const { byId } = await merge(BASE, OURS, THEIRS);
  const removed = { id: 'Task_Check', kinds: new Set([ 'removed' ]), attrs: null };

  assert.equal(describeMerge(byId.Task_Check, removed),
    'name: "Check stock" → ours "Verify availability", theirs "Check warehouse stock", result removed');
});
