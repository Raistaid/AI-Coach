import test from 'node:test';
import assert from 'node:assert/strict';
import { rhythmStats, rhythmBuckets, rhythmText, MIN_EVENTS } from './rhythm.js';

test('an even rhythm scores high, an uneven one lower', () => {
  const even = rhythmStats([0, 1000, 2000, 3000, 4000, 5000]);
  assert.equal(even.evenness, 100);
  assert.equal(even.meanMs, 1000);
  const uneven = rhythmStats([0, 600, 2000, 2500, 4200, 4500]);
  assert.ok(uneven.evenness < 60, `uneven ${uneven.evenness}`);
  assert.ok(uneven.evenness >= 0);
});

test('fewer than three counted events give no verdict instead of a made-up score', () => {
  assert.deepEqual(rhythmStats([]), { count: 0, breaks: 0, meanMs: null, evenness: null });
  assert.equal(rhythmStats([0, 1000]).evenness, null);
  assert.equal(rhythmStats(null).count, 0);
  assert.match(rhythmText(rhythmStats([0, 900])), new RegExp(`хотя бы ${MIN_EVENTS}`));
});

test('a pause or a dropped ball is a break, not a broken rhythm', () => {
  const withPause = rhythmStats([0, 1000, 2000, 3000, 12000, 13000, 14000]);
  assert.equal(withPause.breaks, 1);
  assert.equal(withPause.evenness, 100);
  assert.equal(withPause.meanMs, 1000);
});

test('unsorted and invalid timestamps are tolerated', () => {
  assert.equal(rhythmStats([2000, NaN, 0, 1000, 'x', 3000]).evenness, 100);
});

test('buckets hold every event exactly once', () => {
  const times = [0, 500, 999, 5000, 9999, 10000];
  const bars = rhythmBuckets(times, 10000, 10);
  assert.equal(bars.length, 10);
  assert.equal(bars.reduce((a, b) => a + b, 0), times.length);
  assert.equal(bars[0], 3);
  assert.equal(bars[9], 2, 'the last moment lands in the last slot');
  assert.deepEqual(rhythmBuckets(times, 0, 4), [0, 0, 0, 0]);
});

test('the text names the real numbers', () => {
  assert.equal(rhythmText({ count: 5, breaks: 1, meanMs: 1400, evenness: 86 }, 'касаниями'), 'Ровность ритма 86%, в среднем 1,4 с между касаниями, перерывов: 1.');
  assert.equal(rhythmText({ count: 5, breaks: 0, meanMs: 2000, evenness: 90 }, 'повторами'), 'Ровность ритма 90%, в среднем 2,0 с между повторами.');
});
