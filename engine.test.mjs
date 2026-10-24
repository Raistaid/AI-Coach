import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePose, createAnalysisState, jointAngle, POSE_CONNECTIONS } from './coach-engine.js';

function pose() {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.4, z: 0, visibility: 0.99, presence: 0.99 }));
  for (const [index, x, y] of [
    [11, .44, .20], [12, .56, .20],
    [23, .46, .46], [24, .54, .46],
    [25, .46, .66], [26, .54, .66],
    [27, .46, .88], [28, .54, .88],
  ]) Object.assign(p[index], { x, y });
  return p;
}

function crouched() {
  const p = pose();
  for (const [index, x, y] of [
    [11, .34, .22], [12, .46, .22],
    [23, .35, .46], [24, .43, .46],
    [25, .55, .62], [26, .63, .62],
    [27, .43, .86], [28, .51, .86],
  ]) Object.assign(p[index], { x, y });
  return p;
}

function frame(p, state, time = 0, skill = state.skill) {
  return analyzePose(p, skill, state, time);
}

function calibrate(skill = 'football') {
  let state = createAnalysisState(skill);
  for (let i = 0; i < 6; i++) state = frame(pose(), state, i * 100).state;
  return state;
}

test('joint angle measures straight and bent knees; degenerate points rejected', () => {
  assert.equal(jointAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }), 180);
  assert.equal(jointAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), 90);
  assert.equal(jointAngle({ x: 0, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }), null);
  assert.equal(jointAngle(null, {}, {}), null);
  assert.ok(POSE_CONNECTIONS.every(([a, b]) => a >= 0 && b < 33));
});

test('missing person emits a useful warning and never counts', () => {
  const r = frame(null, createAnalysisState(), 0);
  assert.equal(r.quality, 'missing');
  assert.equal(r.metrics.visible, false);
  assert.equal(r.metrics.movements, 0);
  assert.equal(r.feedback.kind, 'warning');
  assert.equal(r.feedback.tag, 'no-person');
});

test('hidden feet are partial visibility, with no claims about movement', () => {
  const p = pose(); p[27].visibility = .2;
  const r = frame(p, calibrate(), 1000);
  assert.equal(r.quality, 'partial');
  assert.equal(r.feedback.tag, 'show-feet');
  assert.equal(r.metrics.movements, 0);
  assert.equal(r.metrics.visible, false);
});

test('standing and a held lifted foot cannot inflate movement counts', () => {
  let state = calibrate();
  for (let i = 0; i < 10; i++) state = frame(pose(), state, 600 + i * 100).state;
  assert.equal(state.movements, 0);
  const lifted = pose(); lifted[27].y = .73;
  for (let i = 0; i < 12; i++) state = frame(lifted, state, 2000 + i * 100).state;
  assert.equal(state.movements, 0);
  assert.equal(state.feet[0].phase, 'up');
  state = frame(pose(), state, 4000).state;
  state = frame(pose(), state, 4100).state;
  assert.equal(state.movements, 1);
  for (let i = 0; i < 10; i++) state = frame(pose(), state, 4200 + i * 100).state;
  assert.equal(state.movements, 1);
});

test('single-frame ankle jitter is rejected', () => {
  let state = calibrate();
  const lifted = pose(); lifted[27].y = .73;
  state = frame(lifted, state, 700).state;
  state = frame(pose(), state, 800).state;
  state = frame(pose(), state, 900).state;
  assert.equal(state.movements, 0);
  assert.equal(state.feet[0].phase, 'down');
});

test('loss of body resets incomplete movement so re-entry cannot count', () => {
  let state = calibrate();
  const lifted = pose(); lifted[27].y = .73;
  state = frame(lifted, state, 700).state;
  state = frame(lifted, state, 800).state;
  assert.equal(state.feet[0].phase, 'up');
  state = frame(null, state, 900).state;
  for (let i = 0; i < 8; i++) state = frame(pose(), state, 1000 + i * 100).state;
  assert.equal(state.movements, 0);
});

test('squat requires full stand-lower-stand with two-frame hysteresis', () => {
  let state = createAnalysisState('squats');
  for (const [p, time] of [[pose(), 0], [pose(), 200], [crouched(), 1000], [crouched(), 1200]]) {
    state = frame(p, state, time).state;
  }
  assert.equal(state.squatPhase, 'lowered');
  assert.equal(state.reps, 0);
  state = frame(pose(), state, 2000).state;
  assert.equal(state.reps, 0);
  state = frame(pose(), state, 2200).state;
  assert.equal(state.reps, 1);
  for (let i = 0; i < 10; i++) state = frame(pose(), state, 2300 + i * 100).state;
  assert.equal(state.reps, 1);
});

test('starting crouched then standing is not a full repetition', () => {
  let state = createAnalysisState('squats');
  for (const [p, time] of [[crouched(), 0], [crouched(), 200], [pose(), 1000], [pose(), 1200]]) {
    state = frame(p, state, time).state;
  }
  assert.equal(state.reps, 0);
  assert.equal(state.squatPhase, 'standing');
});

test('analysis does not mutate prior state or landmark coordinates', () => {
  const state = calibrate();
  const p = pose();
  const before = structuredClone(state);
  const pointsBefore = structuredClone(p);
  frame(p, state, 1000);
  assert.deepEqual(state, before);
  assert.deepEqual(p, pointsBefore);
});

test('new coaching cues respect cooldown but loss of view interrupts immediately', () => {
  let r = frame(pose(), createAnalysisState(), 0);
  assert.ok(r.feedback);
  const tilted = pose(); tilted[11].x = .8; tilted[12].x = .92;
  r = frame(tilted, r.state, 1000);
  assert.equal(r.feedback, null);
  r = frame(tilted, r.state, 4100);
  assert.equal(r.feedback.tag, 'football-torso');
  r = frame(null, r.state, 4200);
  assert.equal(r.feedback.tag, 'no-person');
});

test('changing exercise resets counts and phases', () => {
  const state = createAnalysisState(); state.movements = 12;
  const r = analyzePose(pose(), 'squats', state, 1000);
  assert.equal(r.state.skill, 'squats');
  assert.equal(r.metrics.movements, 0);
  assert.equal(r.metrics.reps, 0);
});


test('portrait normalization preserves the same physical knee angle', () => {
  const points = [{ x: .3, y: .3 }, { x: .5, y: .5 }, { x: .6, y: .8 }];
  const aspect = 9 / 16;
  const portrait = points.map(p => ({ x: .5 + (p.x - .5) / aspect, y: p.y }));
  const expected = jointAngle(...points);
  assert.ok(Math.abs(jointAngle(...portrait, aspect) - expected) < 1e-8);
  assert.ok(Math.abs(jointAngle(...portrait) - expected) > 1);
});

test('low-confidence shoulder cannot drive posture guidance', () => {
  const p = pose(); p[11].visibility = .1; p[11].x = .95;
  const result = analyzePose(p, 'football', createAnalysisState(), 0);
  assert.notEqual(result.quality, 'good');
  assert.equal(result.metrics.visible, false);
  assert.equal(result.feedback.kind, 'warning');
});
