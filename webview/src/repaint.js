/*
 * Makes every frame the page draws while something moves repaint the whole view.
 *
 * Why: the IDE runs JCEF out of process and off-screen. Chromium hands each frame over in shared
 * memory together with the rectangles that changed since the previous frame, and the IDE copies
 * only those rectangles into its own picture of the page - but it does that when Swing paints, from
 * whichever frame is the latest at that moment (JBCefNativeOsrHandler). When Chromium produces two
 * frames between two Swing paints, the rectangles of the first one are never copied. Panning a
 * large diagram or moving the mouse while the panes are synchronized produces frames faster than
 * that, so the IDE's picture kept pieces of earlier frames: white blocks over the diagram, a strip
 * of it repeated below, ghost cursors left behind.
 *
 * A frame whose changed rectangle is the whole view cannot lose anything, whatever came before it.
 * So for a short while after anything that can change the picture - input, a scroll, a message from
 * the host - an overlay over the whole page flips between two practically invisible tints on every
 * animation frame, which makes Chromium report the whole view as changed in each of those frames.
 * Afterwards nothing runs, so an idle view costs nothing.
 */

/** How long frames keep repainting fully after the last trigger. */
export const REPAINT_BURST_MS = 500;

/**
 * The two tints: black and white at the lowest alpha a colour keeps (1/255 - smaller ones round to
 * the same value, and an unchanged colour repaints nothing). They shift a pixel by one level at most.
 */
const TINTS = [ 'rgba(0, 0, 0, 0.004)', 'rgba(255, 255, 255, 0.004)' ];

/**
 * @param {HTMLElement} overlay a fixed, full-page element that takes no pointer events
 * @param {{ requestFrame?: (cb: () => void) => void, now?: () => number }} [clock] injectable for tests
 * @returns {() => void} call whenever the picture may change; frames repaint fully for REPAINT_BURST_MS
 */
export function createFullRepaint(overlay, clock = {}) {
  const requestFrame = clock.requestFrame || ((cb) => requestAnimationFrame(cb));
  const now = clock.now || (() => performance.now());

  let until = 0;
  let running = false;
  let tint = 0;

  function frame() {
    tint = 1 - tint;
    overlay.style.backgroundColor = TINTS[tint];

    if (now() < until) {
      requestFrame(frame);
    } else {
      running = false;
    }
  }

  return function repaintFully() {
    until = now() + REPAINT_BURST_MS;

    if (!running) {
      running = true;
      requestFrame(frame);
    }
  };
}
