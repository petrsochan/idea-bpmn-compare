import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REPAINT_BURST_MS, createFullRepaint } from '../src/repaint.js';

function fakeClock() {
  const clock = {
    time: 0,
    queue: [],
    requestFrame: (cb) => clock.queue.push(cb),
    now: () => clock.time,
    /** runs one animation frame, 16 ms after the previous one */
    tick() {
      clock.time += 16;
      const due = clock.queue.splice(0);
      due.forEach((cb) => cb());
      return due.length;
    }
  };
  return clock;
}

test('every frame of a burst paints the overlay differently from the frame before', () => {
  const clock = fakeClock();
  const overlay = { style: {} };
  const repaintFully = createFullRepaint(overlay, clock);

  repaintFully();

  let previous = overlay.style.backgroundColor;
  for (let i = 0; i < 5; i++) {
    assert.equal(clock.tick(), 1);
    assert.notEqual(overlay.style.backgroundColor, previous);
    previous = overlay.style.backgroundColor;
  }
});

test('the burst stops after the last trigger and a new trigger starts it again', () => {
  const clock = fakeClock();
  const overlay = { style: {} };
  const repaintFully = createFullRepaint(overlay, clock);

  repaintFully();
  while (clock.tick() > 0) { /* run the burst out */ }

  assert.ok(clock.time >= REPAINT_BURST_MS);
  assert.ok(clock.time < REPAINT_BURST_MS + 50);
  assert.equal(clock.queue.length, 0);

  repaintFully();
  assert.equal(clock.queue.length, 1);
});

test('triggers during a burst extend it without starting a second frame loop', () => {
  const clock = fakeClock();
  const overlay = { style: {} };
  const repaintFully = createFullRepaint(overlay, clock);

  repaintFully();
  clock.tick();
  clock.time = 400;
  repaintFully();
  repaintFully();

  assert.equal(clock.queue.length, 1);

  while (clock.tick() > 0) { /* run the burst out */ }
  assert.ok(clock.time >= 400 + REPAINT_BURST_MS);
});
