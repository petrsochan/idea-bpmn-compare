import { KINDS } from './changes.js';
import { describeAttrs, displayName, typeName } from './format.js';

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
