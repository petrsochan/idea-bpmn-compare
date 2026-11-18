import { KINDS } from './changes.js';
import { visibleKind } from './decorations.js';
import { KIND_LABEL, describeAttrs, displayName, typeName } from './format.js';
import { isOpen } from './merge-changes.js';
import { STATE_LABEL } from './merge-decorations.js';
import { setTip } from './tooltips.js';

/**
 * The counts in the top bar and the side list of all changes.
 *
 * @param {object} options
 * @param {(id: string) => void} options.onPick a row was clicked
 * @param {() => void} options.onToggle the list was shown or hidden, so the panes changed size
 */
export function createChangeList({ onPick, onToggle }) {
  const list = document.getElementById('change-list');
  const aside = document.getElementById('changes');
  const toggle = document.getElementById('toggle-changes');

  function renderSummary(changeList, newDefs, oldDefs) {
    const counts = { added: 0, removed: 0, changed: 0, layout: 0 };

    for (const change of changeList) {
      counts[change.kind]++;
    }

    for (const kind of KINDS) {
      document.querySelector('.chip.' + kind + ' b').textContent = counts[kind];
    }

    let note = '';

    if (newDefs && oldDefs && !changeList.length) {
      note = 'No differences';
    } else if (!newDefs || !oldDefs) {
      note = changeList.length ? '' : 'Comparison not available';
    }

    document.getElementById('summary-note').textContent = note;
  }

  function render(changeList, visibleKinds, selectedId) {
    list.textContent = '';

    const shown = changeList.filter((change) => visibleKind(change, visibleKinds));

    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = changeList.length ? 'All changes are hidden by the filter.' : 'No changes.';
      list.appendChild(li);
      return;
    }

    for (const change of shown) {
      const li = document.createElement('li');

      const kind = document.createElement('span');
      kind.className = 'kind ' + visibleKind(change, visibleKinds);
      kind.textContent = [ ...change.kinds ].map((k) => KIND_LABEL[k]).join(' + ');

      const name = document.createElement('span');
      name.textContent = displayName(change);
      setTip(name, change.id);

      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = typeName(change);

      li.append(kind, name, type);

      const details = describeAttrs(change.attrs);

      if (details) {
        const attrs = document.createElement('span');
        attrs.className = 'attrs';
        attrs.textContent = details;
        li.append(document.createElement('span'), attrs);
      }

      li.dataset.changeId = change.id;
      li.addEventListener('click', () => onPick(change.id));
      list.appendChild(li);
    }

    markSelected(selectedId);
  }

  /**
   * The counts of a merge: the kind chips count what one side changed, the conflict chip the elements
   * both sides changed - how many of them the result has not taken a side on yet, of how many.
   * `note` replaces the summary note, e.g. when a side could not be read.
   */
  function renderMergeSummary(entries, states, note = '') {
    const counts = { added: 0, removed: 0, changed: 0, layout: 0 };
    let both = 0;
    let open = 0;

    for (const entry of entries) {
      if (entry.side === 'both') {
        both++;
        open += isOpen(entry, states) ? 1 : 0;
      } else {
        counts[entry.kind]++;
      }
    }

    for (const kind of KINDS) {
      document.querySelector('.chip.' + kind + ' b').textContent = counts[kind];
    }

    document.querySelector('.chip.conflict b').textContent = open + ' / ' + both;
    document.getElementById('summary-note').textContent = note || (entries.length ? '' : 'No differences');
  }

  /**
   * The change list of a merge, in `entries` order: kind, name, which side changed it and, for an element
   * both sides changed, whether the result has taken a side.
   *
   * @param {(entry) => string} details the attribute lines of an entry
   */
  function renderMerge(entries, states, isVisible, selectedId, details) {
    list.textContent = '';

    const shown = entries.filter(isVisible);

    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = entries.length ? 'All changes are hidden by the filter.' : 'No changes.';
      list.appendChild(li);
      return;
    }

    for (const entry of shown) {
      const li = document.createElement('li');
      li.className = 'merge';

      const kinds = new Set([ ...(entry.ours ? entry.ours.kinds : []), ...(entry.theirs ? entry.theirs.kinds : []) ]);
      const kind = document.createElement('span');
      kind.className = 'kind ' + entry.kind + (entry.conflict ? ' conflict' : '');
      kind.textContent = entry.side === 'both'
        ? (entry.conflict ? 'Conflict' : 'Both changed')
        : KINDS.filter((k) => kinds.has(k)).map((k) => KIND_LABEL[k]).join(' + ');

      const name = document.createElement('span');
      name.textContent = displayName(entry);
      setTip(name, entry.id);

      const side = document.createElement('span');
      side.className = 'side ' + entry.side;
      side.textContent = entry.side;

      const state = document.createElement('span');
      state.className = 'state';

      if (entry.side === 'both') {
        state.textContent = isOpen(entry, states) ? 'open' : STATE_LABEL[states.get(entry.id)];
        state.classList.toggle('open', isOpen(entry, states));
      }

      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = typeName(entry);

      li.append(kind, name, side, state, type);

      const text = details(entry);

      if (text) {
        const attrs = document.createElement('span');
        attrs.className = 'attrs';
        attrs.textContent = text;
        li.append(document.createElement('span'), attrs);
      }

      li.dataset.changeId = entry.id;
      li.addEventListener('click', () => onPick(entry.id));
      list.appendChild(li);
    }

    markSelected(selectedId);
  }

  /** Shows in the change list which change stepping is on, so F7 is not a blind jump. */
  function markSelected(id) {
    for (const li of list.querySelectorAll('li[data-change-id]')) {
      li.classList.toggle('selected', li.dataset.changeId === id);
    }
  }

  function isHidden() {
    return aside.hidden;
  }

  function setVisible(visible) {
    aside.hidden = !visible;
    toggle.classList.toggle('active', visible);
    updateTooltip();
    onToggle();
  }

  /** The tooltip follows the state, the way the filter chips do. */
  function updateTooltip() {
    setTip(toggle, isHidden()
      ? 'Show the list of all changes; click an entry to centre that element'
      : 'Hide the list of changes (Escape)');
  }

  toggle.addEventListener('click', () => setVisible(isHidden()));
  updateTooltip();

  return { renderSummary, render, renderMergeSummary, renderMerge, markSelected, isHidden, setVisible };
}
