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
  const oldDefs = before == null ? null : await parse(moddle, before);
  const newDefs = after == null ? null : await parse(moddle, after);

  return oldDefs === BROKEN || newDefs === BROKEN ? null : changeBetween(id, oldDefs, newDefs);
}

/**
 * The commits of one chunk that changed the element, in their order.
 *
 * Versions travel once per chunk, by blob id: in a linear history a commit's `before` is the next
 * commit's `after`, so sending and parsing them per commit would double both. Each version is parsed
 * once and shared by the commits that use it - the differ does not modify the definitions it reads.
 *
 * @param {Object<string, string>} blobs blob id -> BPMN XML
 * @param {Array<{ hash: string, before: string|null, after: string|null }>} commits blob ids, null = absent
 * @returns {Promise<Array<{ hash: string, kinds: string[], summary: string }>>}
 */
export async function chunkChanges(id, blobs, commits, moddle = new BpmnModdle()) {
  const parsed = new Map();
  const version = (blobId) => {
    if (blobId == null) {
      return null;
    }

    if (!parsed.has(blobId)) {
      // a blob the host could not read counts as broken
      parsed.set(blobId, typeof blobs[blobId] === 'string' ? parse(moddle, blobs[blobId]) : BROKEN);
    }

    return parsed.get(blobId);
  };
  const entries = [];

  for (const commit of commits) {
    const oldDefs = await version(commit.before);
    const newDefs = await version(commit.after);
    const change = oldDefs === BROKEN || newDefs === BROKEN ? null : changeBetween(id, oldDefs, newDefs);

    if (change) {
      entries.push({ hash: commit.hash, ...change });
    }
  }

  return entries;
}

/** Marks a version that does not parse: one broken commit must not end the whole history. */
const BROKEN = Symbol('broken');

async function parse(moddle, xml) {
  try {
    return (await moddle.fromXML(xml)).rootElement;
  } catch (err) {
    return BROKEN;
  }
}

function changeBetween(id, oldDefs, newDefs) {
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
