import { KINDS } from './changes.js';
import { displayName, formatValue } from './format.js';

/*
 * A three-way merge in terms of the diagram: what ours and theirs each changed against the base, which
 * elements both sides touched, and where the result stands for each of them. Pure - the input is change
 * lists from toChangeList, so the per-side changes are exactly what the two-pane view would show.
 */

/**
 * @typedef {{ id: string, side: 'ours'|'theirs'|'both', conflict: boolean, kind: string,
 *             ours: object|null, theirs: object|null, model: object }} MergeEntry
 */

/** How the change list, the badges and the export call a result state. */
export const STATE_LABEL = {
  open: 'open',
  ours: 'resolved – ours',
  theirs: 'resolved – theirs',
  both: 'resolved – both',
  base: 'open',
  other: 'resolved by hand'
};

/** The states of an element in the result, see {@link resultStates}. */
export const RESULT_STATES = [ 'ours', 'theirs', 'both', 'base', 'other' ];

/**
 * @param ours changes base → ours
 * @param theirs changes base → theirs
 * @param between changes ours → theirs, to tell whether both sides added the same element
 * @returns {MergeEntry[]} one entry per element either side changed
 */
export function toMergeEntries(ours, theirs, between) {
  const oursById = byId(ours);
  const theirsById = byId(theirs);
  const betweenById = byId(between);
  const ids = new Set([ ...oursById.keys(), ...theirsById.keys() ]);

  return [ ...ids ].map((id) => {
    const o = oursById.get(id) || null;
    const t = theirsById.get(id) || null;
    const side = o && t ? 'both' : o ? 'ours' : 'theirs';
    const kinds = new Set([ ...(o ? o.kinds : []), ...(t ? t.kinds : []) ]);

    return {
      id,
      side,
      conflict: side === 'both' && isConflict(o, t, betweenById.get(id)),
      kind: KINDS.find((k) => kinds.has(k)),
      ours: o,
      theirs: t,
      model: (o && o.model) || (t && t.model)
    };
  });
}

function isConflict(o, t, between) {
  if (o.kinds.has('removed') !== t.kinds.has('removed')) {
    return true;
  }

  if (o.kinds.has('added') && t.kinds.has('added')) {
    return !!between && between.kinds.has('changed');
  }

  if (o.kinds.has('changed') && t.kinds.has('changed')) {
    return Object.keys(o.attrs || {}).some((key) => t.attrs && key in t.attrs
      && JSON.stringify(o.attrs[key].newValue) !== JSON.stringify(t.attrs[key].newValue));
  }

  // a layout change on one or both sides never contradicts anything
  return false;
}

/**
 * Where the result stands for each entry: taken from `ours`, from `theirs`, from `both` (the sides agree, or
 * the result combines them), still `base`, or `other` (edited by hand).
 *
 * @param fromBase changes base → result
 * @param fromOurs changes ours → result; no entry for an element means the result has ours' version
 * @param fromTheirs changes theirs → result
 * @returns {Map<string, string>} by element id
 */
export function resultStates(entries, fromBase, fromOurs, fromTheirs) {
  const base = byId(fromBase);
  const ours = byId(fromOurs);
  const theirs = byId(fromTheirs);
  const states = new Map();

  for (const entry of entries) {
    const eqOurs = !ours.has(entry.id);
    const eqTheirs = !theirs.has(entry.id);
    const eqBase = !base.has(entry.id);
    let state;

    if (entry.side === 'ours') {
      state = eqOurs ? 'ours' : eqBase ? 'base' : 'other';
    } else if (entry.side === 'theirs') {
      state = eqTheirs ? 'theirs' : eqBase ? 'base' : 'other';
    } else if (eqOurs && eqTheirs) {
      state = 'both';
    } else if (eqOurs) {
      state = 'ours';
    } else if (eqTheirs) {
      state = 'theirs';
    } else if (eqBase) {
      state = 'base';
    } else {
      state = combines(entry, base.get(entry.id)) ? 'both' : 'other';
    }

    states.set(entry.id, state);
  }

  return states;
}

/** The result changed the element only in ways one of the sides did. */
function combines(entry, fromBase) {
  if (fromBase.kinds.has('added') || fromBase.kinds.has('removed')) {
    return false;
  }

  return Object.entries(fromBase.attrs || {}).every(([ key, { newValue } ]) =>
    [ entry.ours, entry.theirs ].some((part) => part.attrs && key in part.attrs
      && JSON.stringify(part.attrs[key].newValue) === JSON.stringify(newValue)));
}

/** A conflict or both-changed element the result has not taken a side on yet. */
export function isOpen(entry, states) {
  if (entry.side !== 'both') {
    return false;
  }

  const state = states.get(entry.id);

  return !state || state === 'base';
}

/**
 * The order of the change list and of F7: open conflicts, resolved conflicts, open both-changed,
 * resolved both-changed, then the one-sided changes; within a group by kind like the two-pane change list,
 * then by name.
 */
export function orderEntries(entries, states) {
  const group = (entry) => {
    if (entry.side !== 'both') {
      return 4;
    }

    return (entry.conflict ? 0 : 2) + (isOpen(entry, states) ? 0 : 1);
  };

  return [ ...entries ].sort((a, b) => group(a) - group(b)
    || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
    || displayName(a).localeCompare(displayName(b)));
}

/**
 * What each side made of the element, one line per attribute:
 * `name: "Check stock" → ours "Verify availability", theirs "Check warehouse stock", result "Verify availability"`.
 * A side that did not touch an attribute is left out of its line; `result` only with a result change list
 * (`null` leaves it out, an entry without that attribute means the result kept the base value).
 */
export function describeMerge(entry, resultChange, hasResult = resultChange !== null) {
  const lines = [];

  for (const [ name, part ] of [ [ 'ours', entry.ours ], [ 'theirs', entry.theirs ] ]) {
    if (part && part.kinds.has('removed')) {
      lines.push('Removed by ' + name);
    }
  }

  const keys = new Set([ ...attrKeys(entry.ours), ...attrKeys(entry.theirs) ]);

  for (const key of keys) {
    const base = [ entry.ours, entry.theirs ].find((part) => part && part.attrs && key in part.attrs).attrs[key].oldValue;
    const values = [];

    for (const [ name, part ] of [ [ 'ours', entry.ours ], [ 'theirs', entry.theirs ] ]) {
      if (part && part.attrs && key in part.attrs) {
        values.push(name + ' ' + formatValue(part.attrs[key].newValue));
      }
    }

    if (hasResult && resultChange && resultChange.kinds.has('removed')) {
      values.push('result removed');
    } else if (hasResult) {
      const changed = resultChange && resultChange.attrs && key in resultChange.attrs;
      values.push('result ' + formatValue(changed ? resultChange.attrs[key].newValue : base));
    }

    lines.push(key + ': ' + formatValue(base) + ' → ' + values.join(', '));
  }

  return lines.join('\n');
}

function attrKeys(part) {
  return part && part.attrs ? Object.keys(part.attrs) : [];
}

function byId(list) {
  return new Map((list || []).map((change) => [ change.id, change ]));
}
