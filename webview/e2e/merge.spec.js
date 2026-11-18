import { expect, test } from '@playwright/test';

import {
  CURRENT, REVISION, breadcrumbs, element, openMerge, rendered, setResult, showDiagrams, showMerge, viewbox
} from './view.js';

/** Both panes show the same region, as expectSameRegion checks for left/right. */
async function expectSameRegionOf(page, a, b) {
  await expect.poll(async () => {
    const [ one, two ] = [ await viewbox(page, a), await viewbox(page, b) ];

    return Math.abs(one.x - two.x) < 1 && Math.abs(one.y - two.y) < 1 && Math.abs(one.scale / two.scale - 1) < 0.01;
  }).toBe(true);
}

test.describe('merge view: panes', () => {

  test('shows ours, result and theirs with their titles', async ({ page }) => {
    await openMerge(page);

    await expect(page.locator('#pane-ours')).toBeVisible();
    await expect(page.locator('#pane-result')).toBeVisible();
    await expect(page.locator('#pane-theirs')).toBeVisible();
    await expect(page.locator('#pane-base')).toBeHidden();
    await expect(page.locator('#pane-left')).toBeHidden();
    await expect(page.locator('#pane-ours header .label')).toHaveText('Changes from main');
    await expect(page.locator('#pane-theirs header .label')).toHaveText('Changes from theirs');
    await expect(element(page, 'ours', 'Task_Supplier')).toHaveCount(1);
    await expect(element(page, 'theirs', 'Task_Gift')).toHaveCount(1);
  });

  test('setDiagrams returns to two panes', async ({ page }) => {
    await openMerge(page);

    await showDiagrams(page);

    await expect(page.locator('#pane-left')).toBeVisible();
    await expect(page.locator('#pane-right')).toBeVisible();
    await expect(page.locator('#pane-ours')).toBeHidden();
    await expect(page.locator('#pane-result')).toBeHidden();
    await expect(page.locator('#pane-theirs')).toBeHidden();
  });

  test('the middle switch shows the base', async ({ page }) => {
    await openMerge(page, { result: { xml: CURRENT, label: 'Result' } });

    await page.locator('#pane-result [data-middle="base"]').click();

    await expect(page.locator('#pane-base')).toBeVisible();
    await expect(page.locator('#pane-result')).toBeHidden();
    await expect(page.locator('#pane-base header .label')).toHaveText('Base');
    await expect(element(page, 'base', 'Task_Review')).toHaveCount(1);

    await page.locator('#pane-base [data-middle="result"]').click();

    await expect(page.locator('#pane-result')).toBeVisible();
    await expect(page.locator('#pane-base')).toBeHidden();
  });

  test('switching to Base shows it at the same viewport', async ({ page }) => {
    await openMerge(page);

    await page.locator('#pane-ours .canvas').hover();
    await page.mouse.wheel(0, 300);
    await expectSameRegionOf(page, 'ours', 'theirs');

    await page.locator('#pane-result [data-middle="base"]').click();

    await expectSameRegionOf(page, 'ours', 'base');
  });

  test('panning one pane moves the other two', async ({ page }) => {
    await openMerge(page);

    const before = await viewbox(page, 'theirs');

    await page.locator('#pane-ours .canvas').hover();
    await page.mouse.wheel(0, 300);

    await expect.poll(async () => (await viewbox(page, 'theirs')).y).not.toBeCloseTo(before.y, 0);
    await expectSameRegionOf(page, 'ours', 'theirs');
    await expectSameRegionOf(page, 'ours', 'result');
  });

  test('the hidden middle pane does not mirror the cursor', async ({ page }) => {
    await openMerge(page);

    await page.locator('#pane-ours .canvas').hover();

    await expect(page.locator('#pane-theirs .ghost-cursor')).toHaveClass(/visible/);
    await expect(page.locator('#pane-result .ghost-cursor')).toHaveClass(/visible/);
    await expect(page.locator('#pane-base .ghost-cursor')).not.toHaveClass(/visible/);
  });

  test('drilling into a subprocess takes all panes along', async ({ page }) => {
    await openMerge(page);

    await page.locator('#pane-ours .djs-overlays[data-container-id="Sub_Payment"] .bjs-drilldown').click();

    await expect(breadcrumbs(page, 'ours').last()).toHaveText('Process payment');
    await expect(breadcrumbs(page, 'result').last()).toHaveText('Process payment');
    await expect(breadcrumbs(page, 'theirs').last()).toHaveText('Process payment');
  });
});

test.describe('merge view: the result', () => {

  test('setMergeResult updates the result and keeps the view', async ({ page }) => {
    await openMerge(page);
    await page.locator('#pane-result .canvas').hover();
    await page.mouse.wheel(0, 300);

    const before = await viewbox(page, 'result');

    await setResult(page, CURRENT);

    await expect(element(page, 'result', 'Task_Supplier')).toHaveCount(1);
    const after = await viewbox(page, 'result');
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.scale).toBeCloseTo(before.scale, 3);
  });

  test('renders only the last of quick result updates', async ({ page }) => {
    await openMerge(page);

    await rendered(page, () => page.evaluate(([ a, b ]) => {
      window.bpmnCompare.setMergeResult({ xml: a, label: 'Result' });
      window.bpmnCompare.setMergeResult({ xml: b, label: 'Result' });
    }, [ CURRENT, REVISION.replace('name="Ship order"', 'name="Ship it"') ]));
    await page.waitForFunction(() => !window.bpmnCompare.isRendering());

    await expect(element(page, 'result', 'Task_Supplier')).toHaveCount(0);
    await expect(element(page, 'result', 'Task_Ship')).toContainText('Ship it');
  });

  test('keeps the last valid result while the XML is broken', async ({ page }) => {
    await openMerge(page);
    const notice = page.locator('#pane-result .notice');

    await setResult(page, CURRENT);
    await setResult(page, CURRENT.slice(0, CURRENT.length / 2));

    await expect(element(page, 'result', 'Task_Supplier')).toHaveCount(1);
    await expect(notice).toHaveText('The result is not valid BPMN right now – showing the last valid state.');

    await setResult(page, REVISION);

    await expect(element(page, 'result', 'Task_Supplier')).toHaveCount(0);
    await expect(notice).toHaveText('');
  });

  test('an unparsable side leaves the others working', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    await openMerge(page, { ours: { xml: '<broken', label: 'Changes from main' } });

    await expect(page.locator('#pane-ours .message')).toHaveClass(/error/);
    await expect(element(page, 'result', 'Task_Check')).toHaveCount(1);
    await expect(element(page, 'theirs', 'Task_Gift')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('a second merge replaces the first', async ({ page }) => {
    await openMerge(page);

    await showMerge(page, { theirs: { xml: REVISION, label: 'Changes from other' } });

    await expect(page.locator('#pane-theirs header .label')).toHaveText('Changes from other');
    await expect(element(page, 'theirs', 'Task_Gift')).toHaveCount(0);
  });
});
