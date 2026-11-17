import { KINDS } from './changes.js';
import { KIND_LABEL } from './format.js';
import { LAYOUT_TOLERANCE } from './layout.js';
import { setTip } from './tooltips.js';

const FILTER_KEY = 'bpmnCompare.visibleKinds';

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
      setTip(chip, (on ? 'Hide ' : 'Show ') + KIND_LABEL[kind].toLowerCase() + ' elements'
        + (kind === 'layout' ? ' (shifts of up to ' + LAYOUT_TOLERANCE + ' px are ignored)' : ''));
    }
  }

  /** Shows exactly these kinds; unknown ones are ignored. */
  function set(list) {
    kinds.clear();
    list.filter((k) => KINDS.includes(k)).forEach((k) => kinds.add(k));
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
      return new Set(stored.filter((k) => KINDS.includes(k)));
    }
  } catch (err) {

    // storage unavailable - fall back to showing everything
  }

  return new Set(KINDS);
}

function save(kinds) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify([ ...kinds ]));
  } catch (err) {

    // not persisted, filter still works for this session
  }
}
