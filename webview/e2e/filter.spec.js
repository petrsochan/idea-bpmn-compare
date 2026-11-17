import { expect, test } from '@playwright/test';

import { ALL_CHANGES, callHost, changeListIds, element, openFixtures, selectedChange } from './view.js';

const NOT_ADDED = ALL_CHANGES.slice(5);

test.describe('filter chips', () => {

  test('a chip hides its kind from the diagrams and the change list', async ({ page }) => {
    await openFixtures(page);

    await page.locator('.chip.added').click();

    await expect(page.locator('.chip.added')).toHaveClass(/off/);
    await expect(page.locator('.chip.added')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.chip.added')).toHaveAttribute('data-tip', 'Show added elements');
    await expect(element(page, 'left', 'Task_Supplier')).not.toHaveClass(/diff-added/);
    expect(await changeListIds(page)).toEqual(NOT_ADDED);

    // the count stays: it says what the diff found, not what is shown
    await expect(page.locator('.chip.added b')).toHaveText('5');

    await page.locator('.chip.added').click();

    await expect(element(page, 'left', 'Task_Supplier')).toHaveClass(/diff-added/);
    expect(await changeListIds(page)).toEqual(ALL_CHANGES);
  });

  test('the tooltip of the moved chip names the tolerance', async ({ page }) => {
    await openFixtures(page);

    await expect(page.locator('.chip.layout')).toHaveAttribute('data-tip', /Hide moved elements \(shifts of up to \d+ px are ignored\)/);
  });

  test('stepping skips the hidden kinds', async ({ page }) => {
    await openFixtures(page);
    await page.locator('.chip.added').click();

    await page.keyboard.press('F7');

    expect(await selectedChange(page)).toEqual([ NOT_ADDED[0] ]);
  });

  test('with every kind hidden, there is nothing to step to', async ({ page }) => {
    await openFixtures(page);

    await callHost(page, 'setVisibleKinds', []);

    await expect(page.locator('#change-list li')).toHaveText('All changes are hidden by the filter.');
    await expect(page.locator('#change-next')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#pane-left .diff-badge')).toHaveCount(0);
  });

  test('the host can set the shown kinds, unknown ones are ignored', async ({ page }) => {
    await openFixtures(page);

    await callHost(page, 'setVisibleKinds', [ 'removed', 'nonsense' ]);

    expect(await changeListIds(page)).toEqual([ 'F_Review', 'Task_Review', 'F_No' ]);
    await expect(page.locator('.chip.removed')).not.toHaveClass(/off/);
    await expect(page.locator('.chip.changed')).toHaveClass(/off/);
  });

  test('the choice is remembered when the view is opened again', async ({ page }) => {
    await openFixtures(page);
    await page.locator('.chip.layout').click();

    await openFixtures(page);

    await expect(page.locator('.chip.layout')).toHaveClass(/off/);
    expect(await changeListIds(page)).not.toContain('End_Hold');
  });
});

test.describe('change list', () => {

  test('the button shows and hides the list, Escape hides it', async ({ page }) => {
    await openFixtures(page);
    const list = page.locator('#changes');

    await expect(list).toBeHidden();
    await page.locator('#toggle-changes').click();
    await expect(list).toBeVisible();
    await expect(page.locator('#toggle-changes')).toHaveAttribute('data-tip', /Hide the list of changes/);

    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(page.locator('#toggle-changes')).toHaveAttribute('data-tip', /Show the list of all changes/);
  });

  test('a row says what changed', async ({ page }) => {
    await openFixtures(page);
    await page.locator('#toggle-changes').click();

    const row = page.locator('#change-list li[data-change-id="Task_Check"]');

    await expect(row.locator('.kind')).toHaveText('Changed');
    await expect(row).toContainText('Verify availability');
    await expect(row.locator('.attrs')).toContainText('Check stock');
  });
});
