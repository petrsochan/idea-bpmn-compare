import { KINDS } from './changes.js';
import { KIND_LABEL, describeAttrs, displayName, typeName } from './format.js';
import { STATE_LABEL, isOpen } from './merge-changes.js';

const KIND_TITLE = { added: 'Added', removed: 'Removed', changed: 'Changed', layout: 'Moved' };

/**
 * The change list as markdown, ready to paste into a pull request or an issue.
 *
 * Pure, so it is unit-tested in ../test/export.test.js; the caller decides which changes to pass,
 * which is how the filter chips are honoured.
 */
export function changesToMarkdown(changes, labels) {
  const lines = [ '## BPMN changes', '', '`' + labels.left + '` vs `' + labels.right + '`', '' ];

  if (!changes.length) {
    lines.push('No differences.');

    return lines.join('\n');
  }

  for (const kind of KINDS) {
    const group = changes.filter((change) => change.kind === kind);

    if (!group.length) {
      continue;
    }

    lines.push('### ' + KIND_TITLE[kind] + ' (' + group.length + ')', '');

    for (const change of group) {
      lines.push('- **' + typeName(change) + '** ' + nameAndId(change));

      for (const attr of describeAttrs(change.attrs).split('\n').filter(Boolean)) {
        lines.push('  - ' + attr);
      }
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * The change list of a merge as markdown, for the pull request or commit that resolves it: first what
 * both sides changed, with whether the result has taken a side yet, then what one side changed.
 *
 * @param entries merge entries in change-list order, already filtered like the list on screen
 * @param {Map<string, string>} states result state per element id (empty without a result)
 * @param {{ ours: string, base: string, theirs: string }} labels
 * @param {(entry) => string} details the attribute lines of an entry, as the change list shows them
 */
export function mergeToMarkdown(entries, states, labels, details) {
  const lines = [ '## BPMN merge', '',
    '`' + labels.ours + '` and `' + labels.theirs + '`, base `' + labels.base + '`', '' ];

  if (!entries.length) {
    lines.push('No differences.');

    return lines.join('\n');
  }

  const both = entries.filter((entry) => entry.side === 'both');
  const oneSided = entries.filter((entry) => entry.side !== 'both');

  if (both.length) {
    const open = both.filter((entry) => isOpen(entry, states)).length;
    lines.push('### Changed on both sides (' + open + ' open of ' + both.length + ')', '');

    for (const entry of both) {
      const state = isOpen(entry, states) ? 'open' : STATE_LABEL[states.get(entry.id)];
      lines.push('- **' + typeName(entry) + '** ' + nameAndId(entry) + ' – '
        + (entry.conflict ? 'conflict' : 'both changed') + ', ' + state);
      pushDetails(lines, details(entry));
    }

    lines.push('');
  }

  if (oneSided.length) {
    lines.push('### Changed on one side (' + oneSided.length + ')', '');

    for (const entry of oneSided) {
      lines.push('- **' + typeName(entry) + '** ' + nameAndId(entry) + ' – '
        + entry.side + ', ' + KIND_LABEL[entry.kind].toLowerCase());
      pushDetails(lines, details(entry));
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function pushDetails(lines, text) {
  for (const line of (text || '').split('\n').filter(Boolean)) {
    lines.push('  - ' + line);
  }
}

/** An unnamed element is shown by its id alone, rather than having it printed twice. */
function nameAndId(change) {
  const name = displayName(change);

  return name === change.id ? '`' + change.id + '`' : name + ' (`' + change.id + '`)';
}

/**
 * SVG of one pane, change markers included - they are plain SVG overlays, so they come along.
 *
 * `saveSVG` is on the bpmn-js viewer, not on the canvas.
 */
export async function viewerToSvg(viewer) {
  const { svg } = await viewer.saveSVG();

  return svg;
}

/** PNG data URL rendered from an SVG at `scale` times its natural size. */
export async function svgToPng(svg, scale = 2) {
  const image = new Image();
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Cannot rasterize the diagram'));
  });

  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await loaded;

  const canvas = document.createElement('canvas');

  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
}
