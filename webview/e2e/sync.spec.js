import { expect, test } from '@playwright/test';

import { breadcrumbs, callHost, element, expectSameRegion, openFixtures, viewbox } from './view.js';

test.describe('synchronization of the panes', () => {

  test('both panes start from the same region', async ({ page }) => {
    await openFixtures(page);

    await expectSameRegion(page);
  });

  test('scrolling one pane scrolls the other', async ({ page }) => {
    await openFixtures(page);

    const before = await viewbox(page, 'right');

    await page.locator('#pane-left .canvas').hover();
    await page.mouse.wheel(0, 300);

    await expect.poll(async () => (await viewbox(page, 'right')).y).not.toBeCloseTo(before.y, 0);
    await expectSameRegion(page);
  });

  test('with sync off, the panes move on their own', async ({ page }) => {
    await openFixtures(page);
    await callHost(page, 'setSync', false);

    const before = await viewbox(page, 'right');

    await page.locator('#pane-left .canvas').hover();
    await page.mouse.wheel(0, 300);

    await expect.poll(async () => (await viewbox(page, 'left')).y).not.toBeCloseTo(before.y, 0);
    expect((await viewbox(page, 'right')).y).toBeCloseTo(before.y, 3);
  });

  test('turning sync back on aligns the right pane with the left one', async ({ page }) => {
    await openFixtures(page);
    await callHost(page, 'setSync', false);
    await page.locator('#pane-left .canvas').hover();
    await page.mouse.wheel(0, 300);

    await callHost(page, 'setSync', true);

    await expectSameRegion(page);
  });

  test('hovering an element highlights it on the other side', async ({ page }) => {
    await openFixtures(page);

    await element(page, 'left', 'Task_Ship').hover();
    await expect(element(page, 'right', 'Task_Ship')).toHaveClass(/sync-hover/);

    await page.locator('#summary').hover();
    await expect(element(page, 'right', 'Task_Ship')).not.toHaveClass(/sync-hover/);
  });

  test('with sync off, hovering highlights nothing on the other side', async ({ page }) => {
    await openFixtures(page);
    await callHost(page, 'setSync', false);

    await element(page, 'left', 'Task_Ship').hover();

    await expect(element(page, 'right', 'Task_Ship')).not.toHaveClass(/sync-hover/);
  });

  test('the mouse cursor is mirrored onto the other pane', async ({ page }) => {
    await openFixtures(page);

    const ghost = page.locator('#pane-right .ghost-cursor');

    await page.locator('#pane-left .canvas').hover();
    await expect(ghost).toHaveClass(/visible/);

    await page.locator('#summary').hover();
    await expect(ghost).not.toHaveClass(/visible/);
  });

  test('drilling into a subprocess on one side opens it on the other', async ({ page }) => {
    await openFixtures(page);

    await page.locator('#pane-left .djs-overlays[data-container-id="Sub_Payment"] .bjs-drilldown').click();

    await expect(breadcrumbs(page, 'left').last()).toHaveText('Process payment');
    await expect(breadcrumbs(page, 'right').last()).toHaveText('Process payment');
    await expectSameRegion(page);

    // and back out through the breadcrumbs
    await breadcrumbs(page, 'right').first().click();

    await expect(breadcrumbs(page, 'left').last()).toHaveText('Order fulfilment');
  });

  test('with sync off, drilling in stays on its side', async ({ page }) => {
    await openFixtures(page);
    await callHost(page, 'setSync', false);

    await page.locator('#pane-left .djs-overlays[data-container-id="Sub_Payment"] .bjs-drilldown').click();

    await expect(breadcrumbs(page, 'left').last()).toHaveText('Process payment');
    await expect(breadcrumbs(page, 'right').last()).toHaveText('Order fulfilment');
  });

  test('turning sync back on takes the other side into the same subprocess', async ({ page }) => {
    await openFixtures(page);
    await callHost(page, 'setSync', false);
    await page.locator('#pane-left .djs-overlays[data-container-id="Sub_Payment"] .bjs-drilldown').click();

    await callHost(page, 'setSync', true);

    await expect(breadcrumbs(page, 'right').last()).toHaveText('Process payment');
    await expectSameRegion(page);
  });
});
