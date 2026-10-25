import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObjects, ballDetections } from './coach-objects.js';
import { createBallState, trackBall } from './coach-engine.js';
const detection = (categoryName = 'bottle', score = .9, box = {}) => ({ boundingBox: { originX: 10, originY: 20, width: 30, height: 40, ...box }, categories: [{ categoryName, score }] });

test('objects retain category identity and Russian labels with normalized boxes', () => {
  const result = normalizeObjects([detection(), detection('sports ball'), detection('person')], 100, 200);
  assert.equal(result[0].label, 'Бутылка'); assert.equal(result[1].label, 'Мяч');
  assert.equal(result[2].label, 'Человек');
  assert.deepEqual([result[0].x, result[0].y, result[0].w, result[0].h], [.25, .2, .30000000000000004, .19999999999999998]);
});
test('only sports ball may reach the ball tracker, never a bottle or person near a foot', () => {
  const objects = normalizeObjects([detection(), detection('person'), detection('chair')], 100, 200);
  assert.deepEqual(ballDetections(objects), []);
  const state = trackBall(ballDetections(objects), createBallState(), 1000);
  assert.equal(state.everSeen, false); assert.equal(state.touches, 0);
  assert.equal(ballDetections(normalizeObjects([detection('sports ball'), detection()], 100, 200)).length, 1);
});
test('bad dimensions, unknown categories, low confidence and invalid boxes are rejected', () => {
  assert.deepEqual(normalizeObjects(null, 100, 100), []);
  assert.deepEqual(normalizeObjects([detection()], NaN, 100), []);
  assert.deepEqual(normalizeObjects([detection()], 0, 100), []);
  assert.deepEqual(normalizeObjects([null, {}, detection('__proto__'), detection('bottle', NaN), detection('bottle', .2), detection('bottle', 2), detection('bottle', .9, { width: -2 }), detection('bottle', .9, { originX: Infinity })], 100, 100), []);
});
test('partially outside boxes are clipped, fully outside boxes disappear', () => {
  const boxes = normalizeObjects([detection('chair', .8, { originX: -10, originY: -20 }), detection('chair', .8, { originX: 200 })], 100, 100);
  assert.equal(boxes.length, 1); assert.equal(boxes[0].x - boxes[0].w / 2, 0); assert.equal(boxes[0].y - boxes[0].h / 2, 0);
});
test('normalizing detections does not mutate source categories or boxes', () => {
  const input = [detection()]; const before = JSON.stringify(input);
  normalizeObjects(input, 100, 100); assert.equal(JSON.stringify(input), before);
});
