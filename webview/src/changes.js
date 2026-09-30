import { compareExtensions } from './extensions.js';
import { displayName, normalizeAttrs } from './format.js';

/**
 * Change kinds in the order the filter chips use; also the sort order of the change list.
 * An element reported by several buckets is labelled with the first kind it matches here.
 */
export const KINDS = [ 'added', 'removed', 'changed', 'layout' ];

/**
 * Flattens a bpmn-js-differ result into one list of changes.
 *
 * Each entry is `{ id, kinds, model, attrs, kind }`. An element can legitimately land in several
 * buckets - typically changed *and* moved - so it becomes a single entry that keeps every kind in
 * `kinds`; otherwise the chip counts would disagree with the list. `kind` is the first matching
 * {@link KINDS} entry and decides how the element is drawn.
 */
export function toChangeList(changes, newElements = {}, oldElements = {}) {
  if (!changes) {
    return [];
  }

  const byId = new Map();

  function entry(id, model) {
    let e = byId.get(id);

    if (!e) {
      e = { id, kinds: new Set(), model, attrs: null };
      byId.set(id, e);
    }

    e.model = e.model || model;

    return e;
  }

  for (const [ id, model ] of Object.entries(changes._added || {})) {
    entry(id, model).kinds.add('added');
  }

  for (const [ id, model ] of Object.entries(changes._removed || {})) {
    entry(id, model).kinds.add('removed');
  }

  for (const [ id, change ] of Object.entries(changes._changed || {})) {
    const e = entry(id, change.model);
    e.kinds.add('changed');
    e.attrs = normalizeAttrs(change.attrs);
  }

  for (const [ id, model ] of Object.entries(changes._layoutChanged || {})) {
    entry(id, model).kinds.add('layout');
  }

  addExtensionChanges(byId, entry, newElements, oldElements);

  const list = [ ...byId.values() ];

  for (const e of list) {
    e.kind = KINDS.find((k) => e.kinds.has(k));
  }

  list.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || displayName(a).localeCompare(displayName(b)));

  return list;
}

/**
 * Adds what bpmn-js-differ cannot see: differences inside extensionElements.
 *
 * An element present on both sides gets its extension differences merged into its attributes - and
 * becomes a `changed` entry even when the differ reported nothing about it at all, which is the case
 * for a pure Camunda or Zeebe edit. An element only on one side is already reported as added or
 * removed, so its extensions add no information there.
 */
function addExtensionChanges(byId, entry, newElements, oldElements) {
  for (const [ id, newElement ] of Object.entries(newElements)) {
    const oldElement = oldElements[id];

    if (!oldElement) {
      continue;
    }

    const extensionAttrs = compareExtensions(oldElement, newElement);

    if (!Object.keys(extensionAttrs).length) {
      continue;
    }

    const e = entry(id, newElement);
    e.kinds.add('changed');
    // these are already oriented old = revision, new = current, so they bypass normalizeAttrs
    e.attrs = Object.assign(e.attrs || {}, extensionAttrs);
  }
}
