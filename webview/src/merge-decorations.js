import { KINDS } from './changes.js';
import { addBadge, clearDecorations, markHiddenChanges, tipOf } from './decorations.js';
import { KIND_LABEL, describeAttrs, displayName } from './format.js';
import { describeMerge, isOpen } from './merge-changes.js';
import { canvasOf, elementOf } from './panes.js';

/*
 * What the merge view draws: on ours and theirs the changes of that side against the base, on the base
 * what either side removed or changed, on the result where it stands for each change - and on every pane
 * the elements both sides changed.
 */

/** How the change list and the badges call a result state. */
export const STATE_LABEL = {
  open: 'open',
  ours: 'resolved – ours',
  theirs: 'resolved – theirs',
  both: 'resolved – both',
  base: 'open',
  other: 'resolved by hand'
};

/**
 * @param {Object<string, object>} panes the merge panes by side (`ours`, `result`, `base`, `theirs`)
 * @param entries merge entries, see merge-changes.js
 * @param {Map<string, string>} states result state per element id
 * @param resultChanges changes base → result, for the result values in the badges
 * @param {(entry) => boolean} isVisible whether the filter shows the entry
 */
export function decorateMerge(panes, entries, states, resultChanges, isVisible) {
  clearDecorations(panes);

  const drawn = { ours: [], result: [], base: [], theirs: [] };
  const hasResult = states.size > 0;

  for (const entry of entries.filter(isVisible)) {
    const resultChange = hasResult ? resultChanges.find((c) => c.id === entry.id) : null;
    const both = entry.side === 'both';
    const tip = both ? bothTip(entry, resultChange, states) : tipOf(entry.ours || entry.theirs);

    for (const side of [ 'ours', 'theirs' ]) {
      const part = entry[side];

      if (part) {
        mark(panes[side], entry.id, [ ...part.kinds ].filter((k) => k !== 'removed').map((k) => 'diff-' + k));
        addBadge(panes[side], entry.id, part.kind, tip);
        drawn[side].push({ id: entry.id, kind: part.kind });
      } else if (both) {
        addBadge(panes[side], entry.id, entry.kind, tip);
      }
    }

    // the base shows the original of what either side removed or changed
    const baseKinds = [ entry.ours, entry.theirs ]
      .filter(Boolean)
      .flatMap((part) => [ ...part.kinds ].filter((k) => k === 'removed' || k === 'changed'));

    if (baseKinds.length) {
      const kind = KINDS.find((k) => baseKinds.includes(k));
      mark(panes.base, entry.id, [ 'diff-' + kind ]);
      addBadge(panes.base, entry.id, kind, tip);
      drawn.base.push({ id: entry.id, kind });
    }

    if (hasResult) {
      mark(panes.result, entry.id, [ 'result-' + states.get(entry.id) ]);
      drawn.result.push({ id: entry.id, kind: entry.kind });
    }

    if (both) {
      const marker = entry.conflict && isOpen(entry, states) ? 'merge-conflict' : 'merge-both';

      for (const side of [ 'ours', 'result', 'base', 'theirs' ]) {
        mark(panes[side], entry.id, [ marker ]);
      }

      addBadge(panes.result, entry.id, entry.kind, tip);
    }
  }

  for (const side of Object.keys(drawn)) {
    markHiddenChanges(panes[side], drawn[side]);
  }
}

function bothTip(entry, resultChange, states) {
  const kinds = [ entry.ours, entry.theirs ].flatMap((part) => [ ...part.kinds ]);
  const label = (entry.conflict ? 'Conflict' : 'Changed on both sides') + ' – '
    + STATE_LABEL[isOpen(entry, states) ? 'open' : states.get(entry.id)];
  const details = describeMerge(entry, resultChange);

  return label + ': ' + displayName(entry)
    + '\n' + KINDS.filter((k) => kinds.includes(k)).map((k) => KIND_LABEL[k]).join(', ')
    + (details ? '\n\n' + details : '');
}

/** The attributes of a one-sided entry, for the change list. */
export function detailsOf(entry, resultChange, hasResult) {
  if (entry.side === 'both') {
    return describeMerge(entry, hasResult ? resultChange : null);
  }

  return describeAttrs((entry.ours || entry.theirs).attrs);
}

function mark(pane, id, markers) {
  const element = elementOf(pane, id);

  if (!element) {
    return;
  }

  for (const marker of markers) {
    canvasOf(pane).addMarker(element, marker);
  }
}
