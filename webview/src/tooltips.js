/*
 * Tooltips are drawn by this page, not by the browser.
 *
 * The view runs inside JCEF, where a native `title` tooltip never appears: CEF hands the tooltip to
 * the client through CefDisplayHandler#onTooltip, and JBCefClient only forwards that to display
 * handlers the plugin registers - nothing draws it. So every `title` in the top bar and on the
 * change badges was invisible. Elements carry `data-tip` instead and this shows it.
 *
 * `aria-disabled` rather than `disabled` for the same family of reasons: a disabled button receives
 * no pointer events at all, so it could not be hovered to explain why it does nothing.
 */

const TIP_DELAY_MS = 400;
const TIP_MARGIN = 6;

let tipTimer = null;

function tipElement() {
  return document.getElementById('tip');
}

function showTip(target) {
  const text = target.getAttribute('data-tip');

  if (!text) {
    return;
  }

  const tip = tipElement();

  tip.textContent = text;
  tip.hidden = false;

  // measure only after the text is in, then keep the tip inside the window
  const anchor = target.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const left = Math.max(TIP_MARGIN,
    Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - TIP_MARGIN));
  const below = anchor.bottom + TIP_MARGIN;
  const top = below + box.height > window.innerHeight - TIP_MARGIN ? anchor.top - box.height - TIP_MARGIN : below;

  tip.style.left = left + 'px';
  tip.style.top = Math.max(TIP_MARGIN, top) + 'px';
}

export function hideTip() {
  clearTimeout(tipTimer);
  tipElement().hidden = true;
}

/**
 * Shows the `data-tip` of whatever the pointer rests on.
 *
 * @param {() => void} onShown called after a tip appeared
 */
export function installTooltips(onShown) {

  // delegated, so badges and change list rows created later are covered too
  document.addEventListener('mouseover', (event) => {
    const target = event.target.closest && event.target.closest('[data-tip]');

    if (!target) {
      return;
    }

    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      showTip(target);
      onShown();
    }, TIP_DELAY_MS);
  });

  document.addEventListener('mouseout', (event) => {
    if (event.target.closest && event.target.closest('[data-tip]')) {
      hideTip();
    }
  });

  document.addEventListener('mousedown', hideTip);
  window.addEventListener('blur', hideTip);
}

/** Sets an element's tooltip; an empty text removes it. */
export function setTip(element, text) {
  if (text) {
    element.setAttribute('data-tip', text);
  } else {
    element.removeAttribute('data-tip');
  }
}

/** Greys a top-bar button out and gives it a tooltip saying why, without the `disabled` attribute. */
export function setBarButtonState(id, inactive, activeTitle, inactiveTitle) {
  const button = document.getElementById(id);

  button.setAttribute('aria-disabled', String(inactive));
  setTip(button, inactive ? inactiveTitle : activeTitle);
}
