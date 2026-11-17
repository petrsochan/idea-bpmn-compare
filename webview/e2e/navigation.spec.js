import { expect, test } from '@playwright/test';

import {
  ALL_CHANGES, badge, breadcrumbs, callHost, element, expectSameRegion, openFixtures, openView, selectedChange
} from './view.js';

test.describe('stepping through changes', () => {

  test('F7 steps through the change list in its order', async ({ page }) => {
    await openFixtures(page);

    for (const id of ALL_CHANGES.slice(0, 3)) {
      await page.keyboard.press('F7');
      expect(await selectedChange(page)).toEqual([ id ]);
    }
  });

  test('F7 wraps from the last change to the first', async ({ page }) => {
    await openFixtures(page);
    await callHost(page, 'focusElement', ALL_CHANGES[ALL_CHANGES.length - 1]);

    await page.keyboard.press('F7');

    expect(await selectedChange(page)).toEqual([ ALL_CHANGES[0] ]);
  });

  test('Shift+F7 with nothing selected starts at the last change', async ({ page }) => {
    await openFixtures(page);

    await page.keyboard.press('Shift+F7');

    expect(await selectedChange(page)).toEqual([ ALL_CHANGES[ALL_CHANGES.length - 1] ]);
  });

  test('the arrows in the top bar step like F7', async ({ page }) => {
    await openFixtures(page);

    await page.locator('#change-next').click();
    await page.locator('#change-next').click();
    await page.locator('#change-prev').click();

    expect(await selectedChange(page)).toEqual([ ALL_CHANGES[0] ]);
  });

  test('the element stepped to is flashed and centred on both sides', async ({ page }) => {
    await openFixtures(page);

    await callHost(page, 'focusElement', 'Task_Check');

    await expect(element(page, 'left', 'Task_Check')).toHaveClass(/diff-focus/);
    await expect(element(page, 'right', 'Task_Check')).toHaveClass(/diff-focus/);
    await expectSameRegion(page);

    const box = await element(page, 'left', 'Task_Check').boundingBox();
    const canvas = await page.locator('#pane-left .canvas').boundingBox();

    expect(Math.abs(box.x + box.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(3);

    // the flash goes away by itself
    await expect(element(page, 'left', 'Task_Check')).not.toHaveClass(/diff-focus/, { timeout: 4000 });
  });

  test('a change inside a collapsed subprocess opens the subprocess on both sides', async ({ page }) => {
    await openFixtures(page);

    // Pay_F3 exists on the left only; the right side follows into the same subprocess
    await callHost(page, 'focusElement', 'Pay_F3');

    await expect(breadcrumbs(page, 'left').last()).toHaveText('Process payment');
    await expect(breadcrumbs(page, 'right').last()).toHaveText('Process payment');

    // and the next top-level change brings both back out
    await callHost(page, 'focusElement', 'F_Review');

    await expect(breadcrumbs(page, 'left').last()).toHaveText('Order fulfilment');
    await expect(breadcrumbs(page, 'right').last()).toHaveText('Order fulfilment');
  });

  test('a click on a change list row centres that element', async ({ page }) => {
    await openFixtures(page);
    await page.locator('#toggle-changes').click();

    await page.locator('#change-list li[data-change-id="Task_Review"]').click();

    expect(await selectedChange(page)).toEqual([ 'Task_Review' ]);
    await expect(element(page, 'right', 'Task_Review')).toHaveClass(/diff-focus/);
  });

  test('selectElement from the XML editor centres the element', async ({ page }) => {
    await openFixtures(page);

    await callHost(page, 'selectElement', 'Task_Ship');

    await expect(element(page, 'left', 'Task_Ship')).toHaveClass(/diff-focus/);
  });

  test('the arrows are inactive while there is nothing to step to', async ({ page }) => {
    await openView(page);

    await expect(page.locator('#change-next')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#change-next')).toHaveAttribute('data-tip', 'No change to step to');

    await openFixtures(page);

    await expect(page.locator('#change-next')).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('#change-next')).toHaveAttribute('data-tip', 'Next change (F7)');
  });
});

test.describe('changes inside collapsed subprocesses', () => {

  test('the subprocess shows how many changes it hides, in the colour of the leading kind', async ({ page }) => {
    await openFixtures(page);

    // left: Pay_F3 and Task_Receipt added, Pay_F2 changed, Pay_End moved
    const left = badge(page, 'left', 'Sub_Payment').and(page.locator('.nested'));

    await expect(left).toHaveText('4');
    await expect(left).toHaveClass(/added/);
    await expect(left).toHaveAttribute('data-tip', /2 added, 1 changed, 1 moved/);
    await expect(element(page, 'left', 'Sub_Payment')).toHaveClass(/diff-nested-added/);

    // right: the added ones do not exist there
    const right = badge(page, 'right', 'Sub_Payment').and(page.locator('.nested'));

    await expect(right).toHaveText('2');
    await expect(right).toHaveClass(/changed/);
  });

  test('the count follows the filter', async ({ page }) => {
    await openFixtures(page);

    await page.locator('.chip.added').click();

    const left = badge(page, 'left', 'Sub_Payment').and(page.locator('.nested'));

    await expect(left).toHaveText('2');
    await expect(left).toHaveClass(/changed/);
    await expect(element(page, 'left', 'Sub_Payment')).not.toHaveClass(/diff-nested-added/);
  });
});
