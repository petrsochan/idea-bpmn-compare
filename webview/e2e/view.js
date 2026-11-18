import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect } from '@playwright/test';

/*
 * Drives the built page the way the IDE does: through window.bpmnCompare, with the messages the page
 * sends to the IDE collected instead of handled.
 *
 * Fixtures: current.bpmn (left, working copy) against revision.bpmn (right). Against the revision the
 * working copy
 *   - renames Task_Check ("Check stock" -> "Verify availability"),
 *   - replaces Task_Review and its flows by Task_Supplier and its flows,
 *   - moves End_Hold by 40 px and Task_Receive by 2 px (within the tolerance, so not a change),
 *   - inside the collapsed subprocess Sub_Payment adds Task_Receipt and Pay_F3, re-targets Pay_F2
 *     and moves Pay_End.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(path.resolve(here, '..', '..', 'build', 'generated', 'webview', 'bpmn-compare', 'index.html')).href;

export const CURRENT = readFileSync(path.join(here, 'fixtures', 'current.bpmn'), 'utf8');
export const REVISION = readFileSync(path.join(here, 'fixtures', 'revision.bpmn'), 'utf8');

/*
 * Merge fixtures: base = REVISION, ours = CURRENT, theirs = MERGE_THEIRS. Against the base theirs
 *   - renames Task_Check to "Check warehouse stock" (ours renamed it to "Verify availability": conflict),
 *   - renames Task_Review to "Manual check" (ours removed it: conflict),
 *   - renames End_Hold to "Held" (ours moved it: both changed, no conflict),
 *   - renames Task_Ship to "Ship parcel" and adds Task_Gift (theirs only).
 */
export const MERGE_THEIRS = readFileSync(path.join(here, 'fixtures', 'merge-theirs.bpmn'), 'utf8');

/** The change list of the fixtures, in its order: added, removed, changed, moved. */
export const ALL_CHANGES = [
  'F_Supplier', 'F_No2', 'Task_Supplier', 'Pay_F3', 'Task_Receipt',
  'F_Review', 'Task_Review', 'F_No',
  'Pay_F2', 'Task_Check',
  'End_Hold', 'Pay_End'
];

/** Opens the page with the host bridge replaced by a recorder. */
export async function openView(page) {
  await page.goto(pageUrl);
  await page.evaluate(() => {
    window.sentToHost = [];
    window.bpmnCompareHost = (message) => window.sentToHost.push(message);
  });
}

/** Shows the fixtures (or the given sides) and waits until the change list is rendered. */
export async function showDiagrams(page, payload = {}) {
  const full = {
    left: { xml: CURRENT, label: 'working copy' },
    right: { xml: REVISION, label: 'HEAD' },
    ...payload
  };

  await page.evaluate((p) => {
    document.getElementById('change-list').textContent = '';
    window.bpmnCompare.setDiagrams(p);
  }, full);
  await page.waitForFunction(() => document.querySelectorAll('#change-list li').length > 0);
}

/** Runs a host call that renders and waits until the page has finished that render. */
export async function rendered(page, call) {
  const before = await page.evaluate(() => Number(document.body.dataset.renders || 0));

  await call();
  await page.waitForFunction((b) => Number(document.body.dataset.renders || 0) > b, before);
}

/** Shows a merge: the merge fixtures, with the base as the result unless `sides` says otherwise. */
export async function showMerge(page, sides = {}) {
  const full = {
    ours: { xml: CURRENT, label: 'Changes from main' },
    base: { xml: REVISION, label: 'Base' },
    theirs: { xml: MERGE_THEIRS, label: 'Changes from theirs' },
    result: { xml: REVISION, label: 'Result' },
    ...sides
  };

  await rendered(page, () => page.evaluate((p) => window.bpmnCompare.setMerge(p), full));
}

/** Opens the page and shows the merge fixtures. */
export async function openMerge(page, sides = {}) {
  await openView(page);
  await showMerge(page, sides);
}

/** Replaces the result of the merge shown and waits until it is rendered. */
export function setResult(page, xml) {
  return rendered(page, () => page.evaluate((x) => window.bpmnCompare.setMergeResult({ xml: x, label: 'Result' }), xml));
}

/** Opens the page and shows the fixtures. */
export async function openFixtures(page) {
  await openView(page);
  await showDiagrams(page);
}

/** Calls a function of the host API. */
export function callHost(page, name, ...args) {
  return page.evaluate(([ n, a ]) => window.bpmnCompare[n](...a), [ name, args ]);
}

/** Messages the page sent to the host, optionally only those of one command. */
export function sentToHost(page, command) {
  return page.evaluate((c) => window.sentToHost.filter((m) => !c || m.command === c), command);
}

/** The drawing of an element in a pane; the same id may be drawn on both. */
export function element(page, side, id) {
  return page.locator('#pane-' + side + ' .djs-element[data-element-id="' + id + '"]');
}

/** The diff badges on an element: its own, and on a collapsed subprocess the count of changes inside. */
export function badge(page, side, id) {
  return page.locator('#pane-' + side + ' .djs-overlays[data-container-id="' + id + '"] .diff-badge');
}

/** The visible region of a pane in diagram coordinates, read from the viewport transform. */
export function viewbox(page, side) {
  return page.evaluate((s) => {
    const viewport = document.querySelector('#pane-' + s + ' svg g.viewport');
    const matrix = viewport.transform.baseVal.consolidate().matrix;

    return { x: -matrix.e / matrix.a, y: -matrix.f / matrix.a, scale: matrix.a };
  }, side);
}

/**
 * The panes show the same region. The left pane may be a pixel wider, so the scale may differ a little
 * and the origin is compared with a tolerance.
 */
export async function expectSameRegion(page) {
  await expect.poll(async () => {
    const [ left, right ] = [ await viewbox(page, 'left'), await viewbox(page, 'right') ];

    return Math.abs(left.x - right.x) < 1 && Math.abs(left.y - right.y) < 1 && Math.abs(left.scale / right.scale - 1) < 0.01;
  }).toBe(true);
}

/** The breadcrumbs of a pane: the plane it shows and those above it. */
export function breadcrumbs(page, side) {
  return page.locator('#pane-' + side + ' .bjs-breadcrumbs li');
}

/** Ids of the change list rows, in order. */
export function changeListIds(page) {
  return page.locator('#change-list li[data-change-id]').evaluateAll((rows) => rows.map((row) => row.dataset.changeId));
}

export function selectedChange(page) {
  return page.locator('#change-list li.selected').evaluateAll((rows) => rows.map((row) => row.dataset.changeId));
}
