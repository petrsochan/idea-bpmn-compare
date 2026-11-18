import { KINDS } from './changes.js';
import { KIND_LABEL } from './format.js';
import { LAYOUT_TOLERANCE } from './layout.js';
import { setTip } from './tooltips.js';

const FILTER_KEY = 'bpmnCompare.visibleKinds';

/** What the chips filter: the change kinds, and in merge mode the elements both sides changed. */
const FILTERS = [ ...KINDS, 'conflict' ];

const CHIP_TIPS = { conflict: 'elements both sides changed' };

/**
 * The filter chips of the top bar: which change kinds are shown. The choice is remembered across views.
 *
 * @param {() => void} onChange the set of shown kinds changed
 */
export function createFilter(onChange) {
  const kinds = load();
  const chips = document.querySelectorAll('#summary .chip');

  function updateChips() {
    for (const chip of chips) {
      const kind = chip.dataset.kind;
      const on = kinds.has(kind);

      chip.classList.toggle('off', !on);
      chip.setAttribute('aria-pressed', String(on));
      setTip(chip, (on ? 'Hide ' : 'Show ') + (CHIP_TIPS[kind] || KIND_LABEL[kind].toLowerCase() + ' elements')
        + (kind === 'layout' ? ' (shifts of up to ' + LAYOUT_TOLERANCE + ' px are ignored)' : ''));
    }
  }

  /** Shows exactly these kinds; unknown ones are ignored. */
  function set(list) {
    kinds.clear();
    list.filter((k) => FILTERS.includes(k)).forEach((k) => kinds.add(k));
    save(kinds);
    updateChips();
    onChange();
  }

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const kind = chip.dataset.kind;
      const next = new Set(kinds);

      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }

      set([ ...next ]);
    });
  }

  updateChips();

  return { kinds, set };
}

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(FILTER_KEY));

    if (Array.isArray(stored)) {
      const kinds = new Set(stored.filter((k) => FILTERS.includes(k)));

      // a filter stored before the conflict chip existed shows conflicts
      if (!stored.includes('conflict-off')) {
        kinds.add('conflict');
      }

      return kinds;
    }
  } catch (err) {

    // storage unavailable - fall back to showing everything
  }

  return new Set(FILTERS);
}

function save(kinds) {
  try {
    // 'conflict-off' tells a hidden conflict chip from a filter stored before the chip existed
    localStorage.setItem(FILTER_KEY, JSON.stringify([ ...kinds, ...(kinds.has('conflict') ? [] : [ 'conflict-off' ]) ]));
  } catch (err) {

    // not persisted, filter still works for this session
  }
}
