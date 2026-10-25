import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyFeatures, calibrate, createCalibration, calibrated, legCompression, kneeRise, stepReps, createReps, stepHold, createHold, confirmByReps, stepLiveErrors, rhythmSpread } from './coach-motion.js';
import { puppet, lying, jitter } from './skills/puppet.js';
import { squatPose } from './skills/squats.js';

const aspect = 9 / 16;

test('features: facing the camera vs side-on, upright vs along the floor', () => {
  const front = bodyFeatures(puppet({ aspect }), aspect);
  const side = bodyFeatures(puppet({ aspect, view: 'side' }), aspect);
  const floor = bodyFeatures(lying({ aspect, angle: 15 }), aspect);
  assert.ok(front.facing > 0.55, `front ${front.facing}`);
  assert.ok(side.facing < 0.2, `side ${side.facing}`);
  assert.ok(front.tilt < 3 && floor.tilt > 60);
  assert.ok(floor.horizontal < 30 && front.horizontal > 70);
  assert.ok(Math.abs(floor.hipOffset) < 0.05, 'a straight plank has the hips on the line');
  assert.ok(bodyFeatures(lying({ aspect, angle: 15, sag: 0.08 }), aspect).hipOffset > 0.15, 'sagging hips go below the line');
  assert.equal(bodyFeatures(null), null);
  const blind = puppet({ aspect }).map((p, i) => ([11, 12, 23, 24].includes(i) ? { ...p, visibility: 0.1 } : p));
  assert.equal(bodyFeatures(blind, aspect), null, 'no torso, no measurements');
});

test('calibration happens only in a level, still stance', () => {
  let c = createCalibration();
  const stand = bodyFeatures(squatPose(0, { aspect }), aspect);
  for (let i = 0; i < 3; i++) c = calibrate(c, stand, true);
  assert.ok(calibrated(c));
  const moving = calibrate(createCalibration(), stand, false);
  assert.equal(moving.samples, 0, 'a moving athlete is not a reference');
  const knee = bodyFeatures(puppet({ aspect, legs: [{ thigh: 80, shin: 0, plane: 'sagittal' }, {}] }), aspect);
  assert.equal(calibrate(c, knee, true).samples, c.samples, 'a raised knee does not move the reference');
});

test('leg compression measures a squat and ignores walking toward the camera', () => {
  let c = createCalibration();
  const stand = bodyFeatures(squatPose(0, { aspect }), aspect);
  for (let i = 0; i < 4; i++) c = calibrate(c, stand, true);
  assert.ok(Math.abs(legCompression(stand, c)) < 0.02);
  const deep = legCompression(bodyFeatures(squatPose(1, { aspect }), aspect), c);
  assert.ok(deep > 0.4, `deep squat ${deep}`);
  const closer = squatPose(0, { aspect }).map(p => ({ ...p, y: 0.5 + (p.y - 0.5) * 1.2 + 0.03 }));
  assert.ok(legCompression(bodyFeatures(closer, aspect), c) < 0.02, 'a bigger, lower body is not a squat');
});

test('knee rise uses the standing thigh as the unit', () => {
  let c = createCalibration();
  const stand = bodyFeatures(puppet({ aspect }), aspect);
  for (let i = 0; i < 4; i++) c = calibrate(c, stand, true);
  const up = bodyFeatures(puppet({ aspect, legs: [{ thigh: 88, shin: 0, plane: 'sagittal' }, {}] }), aspect);
  assert.ok(kneeRise(up, c, 0) > 0.9);
  assert.ok(Math.abs(kneeRise(up, c, 1)) < 0.05);
  assert.equal(kneeRise(up, createCalibration(), 0), null, 'no reference, no claim');
});

test('repetitions: hysteresis, dwell frames, attempts and the minimum duration', () => {
  const cfg = { down: 0.5, up: 0.1, attempt: 0.25, frames: 2, minMs: 400 };
  let s = createReps(); let t = 0; const events = [];
  const feed = (values) => { for (const v of values) { const r = stepReps(s, v, t, cfg); s = r.state; if (r.rep) events.push('rep'); if (r.attempt) events.push('attempt'); t += 100; } };
  feed([0, 0, 0.3, 0.6, 0.7, 0.6, 0.05, 0.05]);
  assert.deepEqual(events, ['rep']);
  feed([0.6, 0.05, 0.05]);
  assert.deepEqual(events, ['rep'], 'one frame past the threshold is jitter');
  feed([0.3, 0.35, 0.3, 0.05, 0.05]);
  assert.deepEqual(events, ['rep', 'attempt'], 'a dip that never reached the bottom is an attempt');
  feed([0.6, null, 0.6, 0.05, null, 0.05]);
  assert.deepEqual(events, ['rep', 'attempt', 'rep'], 'a lost frame keeps the phase');
  const fast = { ...cfg, minMs: 5000 };
  let f = createReps(); let n = 0;
  for (const v of [0, 0, 0.6, 0.6, 0, 0, 0.6, 0.6, 0, 0]) { const r = stepReps(f, v, n, fast); f = r.state; n += 100; }
  assert.equal(f.count, 1, 'too fast to be a real repetition');
});

test('holds survive a short wobble and break on a long one', () => {
  let h = createHold();
  for (let t = 0; t <= 3000; t += 100) h = stepHold(h, !(t >= 1500 && t < 1800), t, 500);
  assert.ok(h.seconds >= 2.9, 'a 0.3 s wobble does not reset the clock');
  for (let t = 3100; t <= 4000; t += 100) h = stepHold(h, false, t, 500);
  assert.equal(h.seconds, 0);
  assert.ok(h.best >= 2.9);
});

test('error confirmation: two of the last three repetitions, or a lasting moment', () => {
  let history = [];
  let r = confirmByReps(history, ['a']); history = r.history; assert.deepEqual(r.confirmed, []);
  r = confirmByReps(history, []); history = r.history; assert.deepEqual(r.confirmed, []);
  r = confirmByReps(history, ['a']); assert.deepEqual(r.confirmed, ['a']);
  let live = stepLiveErrors({}, ['sag'], 0);
  assert.deepEqual(live.confirmed, []);
  live = stepLiveErrors(live.state, ['sag'], 1300);
  assert.deepEqual(live.confirmed, ['sag']); assert.deepEqual(live.started, ['sag']);
  live = stepLiveErrors(live.state, ['sag'], 1400);
  assert.deepEqual(live.started, [], 'one observation per episode');
  assert.deepEqual(stepLiveErrors(live.state, [], 1500).state, {});
});

test('rhythm spread: zero for a metronome, high for a ragged run, null when too short', () => {
  assert.equal(rhythmSpread([0, 1000, 2000, 3000, 4000]), 0);
  assert.ok(rhythmSpread([0, 400, 1900, 2200, 4200]) > 0.4);
  assert.equal(rhythmSpread([0, 1000]), null);
});

test('landmark jitter alone never makes a repetition', () => {
  let c = createCalibration(); let s = createReps();
  for (let i = 0; i < 120; i++) {
    const f = bodyFeatures(jitter(squatPose(0, { aspect }), 0.006, i + 1), aspect);
    c = calibrate(c, f, true);
    const depth = legCompression(f, c);
    s = stepReps(s, depth, i * 110, { down: 0.25, up: 0.09, attempt: 0.11 }).state;
  }
  assert.equal(s.count, 0);
});
