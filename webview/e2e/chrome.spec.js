import { expect, test } from '@playwright/test';

import { CURRENT, REVISION, callHost, element, expectSameRegion, openFixtures, openView, sentToHost, viewbox } from './view.js';

test.describe('zoom', () => {

  test('the buttons are inactive without a diagram', async ({ page }) => {
    await openView(page);

    await expect(page.locator('#zoom-reset')).toHaveText('—');
    await expect(page.locator('#zoom-in')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#zoom-in')).toHaveAttribute('data-tip', 'No diagram loaded');
  });

  test('zooming keeps both panes on the same region', async ({ page }) => {
    await openFixtures(page);
    const before = (await viewbox(page, 'left')).scale;

    await page.locator('#zoom-in').click();

    expect((await viewbox(page, 'left')).scale).toBeCloseTo(before * 1.2, 2);
    await expectSameRegion(page);

    await page.locator('#zoom-reset').click();

    await expect(page.locator('#zoom-reset')).toHaveText('100%');
    expect((await viewbox(page, 'right')).scale).toBeCloseTo(1, 2);
  });

  test('with sync off, each pane zooms on its own', async ({ page }) => {
    await openFixtures(page);
    await callHost(page, 'setSync', false);
    await page.locator('#pane-left .canvas').hover();
    await page.mouse.wheel(0, 300);

    const right = (await viewbox(page, 'right')).y;

    await page.locator('#zoom-out').click();

    // the right pane zoomed around its own centre, not to the left pane's region
    expect((await viewbox(page, 'right')).y).not.toBeCloseTo(right, 0);
    expect(Math.abs((await viewbox(page, 'left')).y - (await viewbox(page, 'right')).y)).toBeGreaterThan(1);
  });
});

test.describe('element menu and history', () => {

  test.beforeEach(async ({ page }) => {
    await openFixtures(page);
    await callHost(page, 'setHistoryAvailable', {
      left: { available: true, reason: '' },
      right: { available: false, reason: 'The file is not under Git version control.' }
    });
  });

  test('right-click offers the history of the element and asks the host for it', async ({ page }) => {
    await element(page, 'left', 'Task_Check').click({ button: 'right' });

    const item = page.locator('#element-history');

    await expect(item).toHaveText('History of "Verify availability"');
    await expect(item).toHaveAttribute('aria-disabled', 'false');

    await item.click();

    await expect(page.locator('#element-menu')).toBeHidden();
    expect(await sentToHost(page, 'elementHistory')).toEqual([
      expect.objectContaining({ id: 'Task_Check', name: 'Verify availability', side: 'left' })
    ]);
  });

  test('where the history cannot be read, the item says why and does nothing', async ({ page }) => {
    await element(page, 'right', 'Task_Check').click({ button: 'right' });

    const item = page.locator('#element-history');

    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAttribute('data-tip', 'The file is not under Git version control.');

    await item.click();

    await expect(page.locator('#element-menu')).toBeVisible();
    expect(await sentToHost(page, 'elementHistory')).toEqual([]);
  });

  test('Escape and a click elsewhere close the menu', async ({ page }) => {
    const menu = page.locator('#element-menu');

    await element(page, 'left', 'Task_Check').click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await element(page, 'left', 'Task_Check').click({ button: 'right' });
    await page.locator('#pane-left header').click();
    await expect(menu).toBeHidden();
  });

  test('without word from the host there is no menu', async ({ page }) => {
    await openFixtures(page);

    await element(page, 'left', 'Task_Check').click({ button: 'right' });

    await expect(page.locator('#element-menu')).toBeHidden();
  });

  test('computeHistory answers with the commits that changed the element', async ({ page }) => {
    await callHost(page, 'computeHistory', {
      token: 't1',
      id: 'Task_Check',
      blobs: { old: REVISION, new: CURRENT },
      commits: [ { hash: 'c2', before: 'new', after: 'new' }, { hash: 'c1', before: 'old', after: 'new' } ]
    });

    const [ answer ] = await sentToHost(page, 'historyChunk');
    const entries = answer.entries.split('\u001e').map((entry) => entry.split('\u001f'));

    expect(answer.token).toBe('t1');
    expect(entries).toEqual([ [ 'c1', 'changed', expect.stringContaining('Verify availability') ] ]);
  });
});

test.describe('host bridge', () => {

  test('a double-click on the working copy opens the element in the XML editor', async ({ page }) => {
    await openFixtures(page);

    await element(page, 'left', 'Task_Ship').dblclick();
    await element(page, 'right', 'Task_Ship').dblclick();

    expect(await sentToHost(page, 'openXml')).toEqual([ { command: 'openXml', id: 'Task_Ship' } ]);
  });

  test('the change list is exported as Markdown, as filtered', async ({ page }) => {
    await openFixtures(page);
    await page.locator('.chip.added').click();

    await page.locator('#export').click();
    await page.locator('#export-menu li[data-command="copyMarkdown"]').click();

    const [ message ] = await sentToHost(page, 'copyMarkdown');

    expect(message.payload).toContain('`working copy` vs `HEAD`');
    expect(message.payload).toContain('Removed');
    expect(message.payload).not.toContain('Added');
    await expect(page.locator('#export-menu')).toBeHidden();
  });

  test('the left diagram is exported as SVG and PNG', async ({ page }) => {
    await openFixtures(page);

    for (const command of [ 'saveSvg', 'savePng' ]) {
      await page.locator('#export').click();
      await page.locator('#export-menu li[data-command="' + command + '"]').click();
    }

    await expect.poll(async () => (await sentToHost(page)).filter((m) => /save(Svg|Png)/.test(m.command)).length).toBe(2);
    const [ svg ] = await sentToHost(page, 'saveSvg');
    const [ png ] = await sentToHost(page, 'savePng');

    expect(svg.payload).toContain('<svg');
    expect(png.payload.length).toBeGreaterThan(1000);
    expect(await sentToHost(page, 'exportFailed')).toEqual([]);
  });

  test('setTheme switches the colours', async ({ page }) => {
    await openView(page);

    await callHost(page, 'setTheme', { dark: true, bg: '#2b2d30', fg: '#dfe1e5', border: '#393b40' });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--bg'))).toBe('#2b2d30');
  });
});
