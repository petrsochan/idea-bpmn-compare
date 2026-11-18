import { expect, test } from '@playwright/test';

import {
  CURRENT, REVISION, badge, breadcrumbs, changeListIds, element, openFixtures, openMerge, rendered, selectedChange,
  sentToHost, setResult, showDiagrams, showMerge, viewbox
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

  test('a result with dangling references is drawn with a notice', async ({ page }) => {
    await openMerge(page);
    const notice = page.locator('#pane-result .notice');

    await setResult(page, REVISION.replace('targetRef="Task_Ship"', 'targetRef="Nowhere"'));

    await expect(element(page, 'result', 'Task_Ship')).toHaveCount(1);
    await expect(notice).toHaveText(/^The result has \d+ problems? – parts of it may not be drawn\.$/);
  });

  test('quick result updates behind a running render are rendered once', async ({ page }) => {
    await openMerge(page);
    const before = await page.evaluate(() => Number(document.body.dataset.renders));

    await page.evaluate(([ a, b, c ]) => {
      window.bpmnCompare.setMergeResult({ xml: a, label: 'Result' });
      window.bpmnCompare.setMergeResult({ xml: b, label: 'Result' });
      window.bpmnCompare.setMergeResult({ xml: c, label: 'Result' });
    }, [ CURRENT, REVISION, CURRENT ]);
    await page.waitForFunction(() => !window.bpmnCompare.isRendering());

    // the first starts at once, the other two wait behind it and collapse into one
    expect(await page.evaluate(() => Number(document.body.dataset.renders))).toBe(before + 2);
    await expect(element(page, 'result', 'Task_Supplier')).toHaveCount(1);
  });

  test('the still-base marker is visible in the dark theme too', async ({ page }) => {
    await openMerge(page, { result: { xml: CURRENT, label: 'Result' } });
    const stroke = () => page.locator('#pane-result .djs-element[data-element-id="Task_Ship"] .djs-visual > :nth-child(1)')
      .evaluate((node) => getComputedStyle(node).stroke);

    const light = await stroke();
    await page.evaluate(() => window.bpmnCompare.setTheme({ dark: true }));

    expect(await stroke()).toBe(light);
    expect(light).toBe('rgb(110, 110, 110)');
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

test.describe('merge view: highlights and the change list', () => {

  test('ours and theirs show their own changes', async ({ page }) => {
    await openMerge(page);

    await expect(badge(page, 'ours', 'Task_Supplier')).toHaveClass(/added/);
    await expect(badge(page, 'theirs', 'Task_Supplier')).toHaveCount(0);
    await expect(badge(page, 'theirs', 'Task_Gift')).toHaveClass(/added/);
    await expect(badge(page, 'ours', 'Task_Gift')).toHaveCount(0);
    await expect(element(page, 'theirs', 'Task_Ship')).toHaveClass(/diff-changed/);
  });

  test('the base shows what either side removed or changed', async ({ page }) => {
    await openMerge(page);
    await page.locator('#pane-result [data-middle="base"]').click();

    await expect(element(page, 'base', 'Task_Review')).toHaveClass(/diff-removed/);
    await expect(element(page, 'base', 'Task_Ship')).toHaveClass(/diff-changed/);
  });

  test('a conflict is marked in every pane that has it', async ({ page }) => {
    await openMerge(page);

    for (const side of [ 'ours', 'result', 'theirs' ]) {
      await expect(element(page, side, 'Task_Check')).toHaveClass(/merge-conflict/);
    }
  });

  test('both changed is quieter than a conflict', async ({ page }) => {
    await openMerge(page);

    await expect(element(page, 'ours', 'End_Hold')).toHaveClass(/merge-both/);
    await expect(element(page, 'ours', 'End_Hold')).not.toHaveClass(/merge-conflict/);
  });

  test('the conflicts chip counts open and total', async ({ page }) => {
    await openMerge(page);
    const chip = page.locator('#summary .chip.conflict');

    await expect(chip).toBeVisible();
    await expect(chip).toHaveText(/Conflicts\s*3 \/ 3 open/);

    await setResult(page, CURRENT);

    await expect(chip).toHaveText(/Conflicts\s*0 \/ 3 open/);
  });

  test('the kind chips count the one-sided changes', async ({ page }) => {
    await openMerge(page);

    // ours adds F_Supplier, F_No2, Task_Supplier, Pay_F3, Task_Receipt; theirs adds Task_Gift
    await expect(page.locator('#summary .chip.added b')).toHaveText('6');
  });

  test('the result shows where each change stands', async ({ page }) => {
    await openMerge(page, { result: { xml: CURRENT, label: 'Result' } });

    await expect(element(page, 'result', 'Task_Check')).toHaveClass(/result-ours/);
    await expect(element(page, 'result', 'Task_Ship')).toHaveClass(/result-base/);
    await expect(element(page, 'result', 'Task_Check')).not.toHaveClass(/merge-conflict/);
  });

  test('the change list starts with open conflicts', async ({ page }) => {
    await openMerge(page);

    expect((await changeListIds(page)).slice(0, 3)).toEqual([ 'Task_Review', 'Task_Check', 'End_Hold' ]);
    await expect(page.locator('#change-list li[data-change-id="Task_Check"] .side')).toHaveText('both');
    await expect(page.locator('#change-list li[data-change-id="Task_Check"] .state')).toHaveText('open');
    await expect(page.locator('#change-list li[data-change-id="Task_Ship"] .side')).toHaveText('theirs');
  });

  test('a resolved conflict says which side the result took', async ({ page }) => {
    await openMerge(page, { result: { xml: CURRENT, label: 'Result' } });

    await expect(page.locator('#change-list li[data-change-id="Task_Check"] .state')).toHaveText('resolved – ours');
  });

  test('F7 walks open conflicts first', async ({ page }) => {
    await openMerge(page);
    await page.locator('#pane-ours header').click();

    await page.keyboard.press('F7');

    expect(await selectedChange(page)).toEqual([ 'Task_Review' ]);
  });

  test('F7 after resolving the selected conflict goes on to the next open one', async ({ page }) => {
    await openMerge(page);
    await page.locator('#pane-ours header').click();
    await page.keyboard.press('F7');
    expect(await selectedChange(page)).toEqual([ 'Task_Review' ]);

    // the user takes theirs for Task_Review in the text merge
    await setResult(page, REVISION.replace('name="Manual review"', 'name="Manual check"'));
    await page.locator('#pane-ours header').click();
    await page.keyboard.press('F7');

    expect(await selectedChange(page)).toEqual([ 'Task_Check' ]);
  });

  test('missing base says the changes cannot be classified', async ({ page }) => {
    await openMerge(page, { base: { xml: '', label: 'Base' } });

    await expect(page.locator('#summary-note')).toHaveText('The base is not available – the changes cannot be classified.');
  });

  test('an unreadable side is named in the summary', async ({ page }) => {
    await openMerge(page, { theirs: { xml: '<broken', label: 'Changes from theirs' } });

    await expect(page.locator('#summary-note')).toHaveText("Changes from theirs cannot be read – only the other side's changes are shown.");
  });

  test('hiding conflicts leaves the one-sided changes', async ({ page }) => {
    await openMerge(page);

    await page.locator('#summary .chip.conflict').click();

    const ids = await changeListIds(page);
    expect(ids).not.toContain('Task_Check');
    expect(ids).toContain('Task_Ship');
    await expect(element(page, 'ours', 'Task_Check')).not.toHaveClass(/merge-conflict/);

    await page.locator('#summary .chip.conflict').click();
  });

  test('a hidden conflicts chip stays hidden on the next merge', async ({ page }) => {
    await openMerge(page);
    await page.locator('#summary .chip.conflict').click();

    await openMerge(page);

    await expect(page.locator('#summary .chip.conflict')).toHaveClass(/off/);
    expect(await changeListIds(page)).not.toContain('Task_Check');
    await page.locator('#summary .chip.conflict').click();
  });

  test('the badge of a conflict lists both sides', async ({ page }) => {
    await openMerge(page);

    await expect(badge(page, 'ours', 'Task_Check')).toHaveAttribute('data-tip',
      /name: "Check stock" → ours "Verify availability", theirs "Check warehouse stock", result "Check stock"/);
  });

  test('diff mode has no conflicts chip', async ({ page }) => {
    await openFixtures(page);

    await expect(page.locator('#summary .chip.conflict')).toBeHidden();

    await showMerge(page);
    await showDiagrams(page);

    await expect(page.locator('#summary .chip.conflict')).toBeHidden();
    await expect(page.locator('#summary .chip.added b')).toHaveText('5');
  });
});

test.describe('merge view: the text merge follows', () => {

  /** The ids the page asked the IDE to show in the result column, in order. */
  async function revealed(page) {
    return (await sentToHost(page, 'revealInResult')).map((message) => message.id);
  }

  test('F7 shows the element in the result column', async ({ page }) => {
    await openMerge(page);
    await page.locator('#pane-ours header').click();

    await page.keyboard.press('F7');

    expect(await revealed(page)).toEqual([ 'Task_Review' ]);
  });

  test('a change list row shows its element in the result column', async ({ page }) => {
    await openMerge(page);
    await page.locator('#toggle-changes').click();

    await page.locator('#change-list li[data-change-id="Task_Ship"]').click();

    expect(await revealed(page)).toEqual([ 'Task_Ship' ]);
  });

  test('a click on an element shows it in the result column', async ({ page }) => {
    await openMerge(page);

    await element(page, 'theirs', 'Task_Gift').click();

    expect(await revealed(page)).toEqual([ 'Task_Gift' ]);
  });

  test('a click on an element label shows its element', async ({ page }) => {
    await openMerge(page);

    await page.locator('#pane-ours .djs-element[data-element-id="F_Yes_label"]').click();

    expect(await revealed(page)).toEqual([ 'F_Yes' ]);
  });

  test('a click on the empty canvas shows nothing', async ({ page }) => {
    await openMerge(page);

    await page.locator('#pane-ours .canvas').click({ position: { x: 5, y: 5 } });

    expect(await revealed(page)).toEqual([]);
  });

  test('the diff view does not ask for the result column', async ({ page }) => {
    await openFixtures(page);
    await page.locator('#pane-left header').click();

    await page.keyboard.press('F7');
    await element(page, 'left', 'Task_Ship').click();

    expect(await revealed(page)).toEqual([]);
  });
});

test.describe('merge view: a conflict without a result (the BPMN Diff tab)', () => {

  test('shows the base in the middle without the switch', async ({ page }) => {
    await openMerge(page, { result: null });

    await expect(page.locator('#pane-base')).toBeVisible();
    await expect(page.locator('#pane-result')).toBeHidden();
    await expect(page.locator('#pane-base .middle-switch')).toBeHidden();
    await expect(page.locator('#summary .chip.conflict')).toHaveText(/Conflicts\s*3 \/ 3 open/);
  });

  test('F7 walks the open conflicts', async ({ page }) => {
    await openMerge(page, { result: null });
    await page.locator('#pane-ours header').click();

    await page.keyboard.press('F7');

    expect(await selectedChange(page)).toEqual([ 'Task_Review' ]);
  });

  test('a merge with a result brings the switch back', async ({ page }) => {
    await openMerge(page, { result: null });

    await showMerge(page);

    await expect(page.locator('#pane-result')).toBeVisible();
    await expect(page.locator('#pane-base')).toBeHidden();
    await expect(page.locator('#pane-result .middle-switch')).toBeVisible();
  });

  test('a double-click on an element opens it in the XML', async ({ page }) => {
    await openMerge(page, { result: null });

    await element(page, 'theirs', 'Task_Gift').dblclick();

    expect((await sentToHost(page, 'openXml')).map((m) => m.id)).toEqual([ 'Task_Gift' ]);
  });
});
