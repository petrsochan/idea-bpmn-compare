import { BpmnModdle } from 'bpmn-moddle';
import { diff } from 'bpmn-js-differ';

import { KINDS, toChangeList } from './changes.js';
import { KIND_LABEL, describeAttrs } from './format.js';
import { diByElementId, dropMinorLayoutChanges } from './layout.js';

/*
 * What one commit did to one element, for the element history. Runs the same pipeline as the view -
 * differ, extension elements, layout tolerance - so a commit is listed exactly when the diff it opens
 * shows the element as changed. No DOM here; tested in ../test/history.test.js.
 */

const SUMMARY_MAX = 120;

/**
 * @param {string} id element id
 * @param {string|null} before the file in the commit's first parent, null if it did not exist
 * @param {string|null} after the file in the commit, null if the commit deleted it
 * @returns {Promise<{ kinds: string[], summary: string } | null>} null when the commit did not touch the
 *   element, or when a side does not parse - one broken version must not end the whole history
 */
export async function commitChange(id, before, after, moddle = new BpmnModdle()) {
  let oldDefs, newDefs;

  try {
    oldDefs = before == null ? null : (await moddle.fromXML(before)).rootElement;
    newDefs = after == null ? null : (await moddle.fromXML(after)).rootElement;
  } catch (err) {
    return null;
  }

  if (!oldDefs || !newDefs) {
    const present = oldDefs || newDefs;

    return present && elementsById(present)[id] ? result([ newDefs ? 'added' : 'removed' ], null) : null;
  }

  const changes = toChangeList(dropMinorLayoutChanges(diff(oldDefs, newDefs), oldDefs, newDefs),
    elementsById(newDefs), elementsById(oldDefs));
  const change = changes.find((c) => c.id === id);

  return change ? result(KINDS.filter((k) => change.kinds.has(k)), change.attrs) : null;
}

/** Every element drawn in the diagram, by id - what the view collects from its element registry. */
export function elementsById(defs) {
  const result = {};

  for (const [ id, di ] of diByElementId(defs)) {
    result[id] = di.bpmnElement;
  }

  return result;
}

function result(kinds, attrs) {
  let summary = kinds.map((k) => KIND_LABEL[k]).join(' + ');

  if (kinds.includes('changed') && attrs && Object.keys(attrs).length) {
    summary += ': ' + describeAttrs(attrs).split('\n').join('; ');
  }

  return { kinds, summary: summary.length > SUMMARY_MAX ? summary.slice(0, SUMMARY_MAX - 1) + '…' : summary };
}
