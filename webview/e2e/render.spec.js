import { expect, test } from '@playwright/test';

import {
  ALL_CHANGES, CURRENT, badge, callHost, changeListIds, element, openFixtures, openView, sentToHost, showDiagrams, viewbox
} from './view.js';

test.describe('rendering the diff', () => {

  test('counts each kind in the top bar and lists every change', async ({ page }) => {
    await openFixtures(page);

    await expect(page.locator('.chip.added b')).toHaveText('5');
    await expect(page.locator('.chip.removed b')).toHaveText('3');
    await expect(page.locator('.chip.changed b')).toHaveText('2');
    await expect(page.locator('.chip.layout b')).toHaveText('2');
    expect(await changeListIds(page)).toEqual(ALL_CHANGES);
    await expect(page.locator('#pane-left .label')).toHaveText('working copy');
    await expect(page.locator('#pane-right .label')).toHaveText('HEAD');
  });

  test('ignores a shift within the layout tolerance', async ({ page }) => {
    await openFixtures(page);

    expect(await changeListIds(page)).not.toContain('Task_Receive');
    await expect(element(page, 'left', 'Task_Receive')).not.toHaveClass(/diff-layout/);
  });

  test('draws added elements on the left, removed on the right, the rest on both', async ({ page }) => {
    await openFixtures(page);

    await expect(element(page, 'left', 'Task_Supplier')).toHaveClass(/diff-added/);
    await expect(element(page, 'right', 'Task_Supplier')).toHaveCount(0);
    await expect(element(page, 'right', 'Task_Review')).toHaveClass(/diff-removed/);
    await expect(element(page, 'left', 'Task_Review')).toHaveCount(0);

    for (const side of [ 'left', 'right' ]) {
      await expect(element(page, side, 'Task_Check')).toHaveClass(/diff-changed/);
      await expect(element(page, side, 'End_Hold')).toHaveClass(/diff-layout/);
    }
  });

  test('puts a badge on each changed element with what changed in its tooltip', async ({ page }) => {
    await openFixtures(page);

    const renamed = badge(page, 'left', 'Task_Check');

    await expect(renamed).toHaveText('✎');
    await expect(renamed).toHaveAttribute('data-tip', /Verify availability/);
    await expect(renamed).toHaveAttribute('data-tip', /Check stock/);
  });

  test('shows the tooltip of a badge on hover', async ({ page }) => {
    await openFixtures(page);

    await badge(page, 'left', 'Task_Check').hover();

    await expect(page.locator('#tip')).toBeVisible();
    await expect(page.locator('#tip')).toContainText('Verify availability');
  });

  test('says there are no differences when both sides are the same', async ({ page }) => {
    await openView(page);
    await showDiagrams(page, { right: { xml: CURRENT, label: 'HEAD' } });

    await expect(page.locator('#summary-note')).toHaveText('No differences');
    await expect(page.locator('#change-list li')).toHaveText('No changes.');
  });

  test('marks everything as added when the file does not exist in the revision', async ({ page }) => {
    await openView(page);
    await showDiagrams(page, { right: { missing: true, message: 'File does not exist in HEAD', label: 'HEAD' } });

    await expect(page.locator('#pane-right .message')).toHaveText('File does not exist in HEAD');
    await expect(page.locator('.chip.removed b')).toHaveText('0');
    await expect(page.locator('.chip.added b')).not.toHaveText('0');
    await expect(element(page, 'left', 'Task_Check')).toHaveClass(/diff-added/);
  });

  test('shows why a side cannot be rendered', async ({ page }) => {
    await openView(page);
    await showDiagrams(page, { right: { xml: '<not-bpmn/>', label: 'HEAD' } });

    await expect(page.locator('#pane-right .message')).toContainText('Cannot render diagram');
    await expect(page.locator('#pane-right .message')).toHaveClass(/error/);
    await expect(page.locator('#summary-note')).toHaveText('Comparison not available');
  });

  test('keeps the view when the host re-renders with preserveView', async ({ page }) => {
    await openFixtures(page);
    await page.locator('#zoom-in').click();
    await page.locator('#zoom-in').click();

    const before = await viewbox(page, 'left');

    await showDiagrams(page, { preserveView: true });

    const after = await viewbox(page, 'left');

    expect(after.scale).toBeCloseTo(before.scale, 3);
    // the overlay of the re-rendered diagram may shift the origin by a fraction of a unit
    expect(after.x).toBeCloseTo(before.x, 0);
  });

  test('centres the element a diff window was opened for', async ({ page }) => {
    await openView(page);
    await showDiagrams(page, { focus: 'Task_Receipt' });

    await expect(page.locator('#pane-left .bjs-breadcrumbs li').last()).toHaveText('Process payment');
    expect(await sentToHost(page, 'exportFailed')).toEqual([]);
  });

  test('a later payload wins over one still rendering', async ({ page }) => {
    await openView(page);
    await page.evaluate(([ cur ]) => {
      window.bpmnCompare.setDiagrams({ left: { xml: cur, label: 'first' }, right: { xml: cur, label: 'first' } });
      window.bpmnCompare.setDiagrams({ left: { xml: cur, label: 'second' }, right: { xml: cur, label: 'second' } });
    }, [ CURRENT ]);

    await expect(page.locator('#pane-left .label')).toHaveText('second');
    await expect(page.locator('#summary-note')).toHaveText('No differences');
  });

  test('setStatus shows a message on a pane that has no diagram yet', async ({ page }) => {
    await openView(page);
    await callHost(page, 'setStatus', 'right', 'Loading HEAD…', false);

    await expect(page.locator('#pane-right .message')).toHaveText('Loading HEAD…');
  });
});
