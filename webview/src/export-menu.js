import { svgToPng, viewerToSvg } from './export.js';
import { sendToHost } from './host.js';

/**
 * The Export button and its menu. The host saves or copies what the page sends it.
 *
 * @param {object} options
 * @param {{ left, right }} options.panes
 * @param {() => string} options.markdown the change list as the user sees it, as Markdown
 */
export function createExportMenu({ panes, markdown }) {
  const button = document.getElementById('export');
  const menu = document.getElementById('export-menu');

  function close() {
    menu.hidden = true;
    button.classList.remove('active');
  }

  async function run(command) {
    if (command === 'copyMarkdown') {
      sendToHost({ command, payload: markdown() });
      return;
    }

    if (!panes.left.loaded) {
      return;
    }

    const svg = await viewerToSvg(panes.left.viewer);

    sendToHost({ command, payload: command === 'savePng' ? await svgToPng(svg) : svg });
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    button.classList.toggle('active', !menu.hidden);
  });

  for (const item of menu.querySelectorAll('li')) {
    item.addEventListener('click', async () => {
      close();

      try {
        await run(item.dataset.command);
      } catch (err) {
        console.error('[bpmn-compare] export failed', err);
        sendToHost({ command: 'exportFailed', payload: String(err && err.message || err) });
      }
    });
  }

  return { close };
}
