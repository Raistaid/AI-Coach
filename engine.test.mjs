import test from 'node:test';
import assert from 'node:assert/strict';
import {
  observePose, createPoseState, trackBall, createBallState, createSession, stepSession, skipLesson,
  describeLesson, mainMistake, jointAngle, POSE_CONNECTIONS,
} from './coach-engine.js';
import { SKILL_LIST, PERSONALITIES } from './skills/index.js';
import { COMMON_PHRASES, pickPhrase, fillTemplate } from './skills/common.js';
import { squatPose } from './skills/squats.js';

/* ───────────── fixtures ───────────── */
function pose() {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.4, z: 0, visibility: 0.99, presence: 0.99 }));
  for (const [index, x, y] of [
    [11, .44, .20], [12, .56, .20], [13, .36, .32], [14, .64, .32], [15, .27, .42], [16, .73, .42],
    [23, .46, .46], [24, .54, .46], [25, .46, .66], [26, .54, .66],
    [27, .46, .88], [28, .54, .88], [31, .46, .92], [32, .54, .92],
  ]) Object.assign(p[index], { x, y });
  return p;
}
function lifted(side = 0, amount = .08) {
  const p = pose();
  p[side === 0 ? 27 : 28].y -= amount; p[side === 0 ? 31 : 32].y -= amount;
  p[side === 0 ? 25 : 26].y -= amount * .4;
  return p;
}
function crouched() {
  const p = pose();
  for (const [index, x, y] of [[11, .34, .22], [12, .46, .22], [23, .35, .46], [24, .43, .46], [25, .55, .62], [26, .63, .62], [27, .43, .86], [28, .51, .86]]) Object.assign(p[index], { x, y });
  return p;
}
const ball = (y, x = .54) => [{ x, y, w: .08, h: .08, score: .8 }];

class Sim {
  constructor(skill = 'football', personality = 'calm') {
    this.skill = skill; this.pose = createPoseState(); this.ball = createBallState();
    this.session = createSession(skill, { personality }); this.t = 0; this.log = []; this.events = [];
  }
  frame(points, detections = [], dt = 100) {
    const aspect = this.aspect || 1;
    const observed = observePose(points, this.pose, this.t, aspect, this.skill); this.pose = observed.state;
    if (observed.obs.motion?.event) this.events.push(observed.obs.motion.event);
    this.ball = trackBall(detections, this.ball, this.t, observed.obs, aspect);
    const stepped = stepSession(this.session, observed.obs, this.ball, this.t); this.session = stepped.session;
    if (stepped.feedback) this.log.push(stepped.feedback);
    this.t += dt; this.last = stepped; this.obs = observed.obs;
    return stepped;
  }
  frames(points, n, detections = []) { let r; for (let i = 0; i < n; i++) r = this.frame(points, detections); return r; }
  stance() { return this.frames(pose(), 40); }
  lift(n = 1, amount = .08) { let r; for (let i = 0; i < n; i++) { this.frames(lifted(0, amount), 3); r = this.frames(pose(), 3); } return r; }
  bounce(times = 1, x = .54) { let r; for (let k = 0; k < times; k++) for (const y of [.60, .70, .80, .86, .80, .70, .60, .55]) r = this.frame(pose(), ball(y, x)); return r; }
  tags() { return this.log.map(f => f.tag); }
}

/* ───────────── geometry & vision ───────────── */
test('joint angle measures straight and bent knees; degenerate points rejected', () => {
  assert.equal(jointAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }), 180);
  assert.equal(jointAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), 90);
  assert.equal(jointAngle({ x: 0, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }), null);
  assert.equal(jointAngle(null, {}, {}), null);
  assert.ok(POSE_CONNECTIONS.every(([a, b]) => a >= 0 && b < 33));
});

test('portrait normalization preserves the same physical knee angle', () => {
  const points = [{ x: .3, y: .3 }, { x: .5, y: .5 }, { x: .6, y: .8 }];
  const aspect = 9 / 16;
  const portrait = points.map(p => ({ x: .5 + (p.x - .5) / aspect, y: p.y }));
  assert.ok(Math.abs(jointAngle(...portrait, aspect) - jointAngle(...points)) < 1e-8);
});

test('missing person is never counted; the warning comes only after it lasts', () => {
  const sim = new Sim();
  const r = sim.frame(null);
  assert.equal(r.metrics.visible, false);
  assert.equal(r.metrics.lifts, 0);
  assert.equal(r.feedback.tag, 'lesson-intro', 'the first step is announced right away');
  sim.frames(null, 10);
  assert.ok(!sim.tags().includes('no-person'), 'one second out of view is not worth a remark');
  sim.frames(null, 20);
  assert.ok(sim.tags().includes('no-person'), 'after 1.5 s (and a pause after the intro) the coach says it');
  sim.frames(null, 600);
  assert.ok(sim.tags().filter(t => t === 'no-person').length <= 3, 'then the screen keeps showing it, the voice stops');
});

test('hidden feet are partial visibility with no movement claims', () => {
  const sim = new Sim(); sim.stance();
  const p = pose(); p[27].visibility = .2;
  const r = sim.frame(p);
  assert.equal(sim.obs.quality, 'partial');
  assert.equal(sim.obs.framing, 'show-feet');
  assert.equal(r.metrics.visible, false);
  sim.frames(p, 30);
  assert.ok(sim.tags().includes('show-feet'), 'a lasting problem is said');
  assert.equal(sim.last.metrics.lifts, 0);
});

test('low-confidence shoulder cannot drive posture guidance', () => {
  const p = pose(); p[11].visibility = .1; p[11].x = .95;
  const { obs } = observePose(p, createPoseState(), 0);
  assert.ok(obs.tilt < 5, 'the unreliable point is ignored, the other side anchors the torso');
  const q = pose(); for (const i of [11, 12]) q[i].visibility = .1;
  assert.notEqual(observePose(q, createPoseState(), 0).obs.quality, 'good', 'no shoulders, no torso');
});

test('standing and a held lifted foot cannot inflate lift counts', () => {
  const sim = new Sim(); sim.stance();
  assert.equal(sim.last.metrics.lifts, 0);
  sim.frames(lifted(), 12);
  assert.equal(sim.last.metrics.lifts, 0);
  assert.equal(sim.obs.raised, true);
  sim.frames(pose(), 2);
  assert.equal(sim.last.metrics.lifts, 1);
  sim.frames(pose(), 10);
  assert.equal(sim.last.metrics.lifts, 1);
});

test('single-frame ankle jitter is rejected', () => {
  const sim = new Sim(); sim.stance();
  sim.frame(lifted()); sim.frames(pose(), 2);
  assert.equal(sim.last.metrics.lifts, 0);
});

test('loss of body resets an incomplete lift so re-entry cannot count', () => {
  const sim = new Sim(); sim.stance();
  sim.frames(lifted(), 2);
  assert.equal(sim.obs.raised, true);
  sim.frame(null);
  sim.frames(pose(), 8);
  assert.equal(sim.last.metrics.lifts, 0);
});

test('a foot above the knee is flagged as a high lift', () => {
  const sim = new Sim(); sim.stance();
  sim.frames(lifted(0, .25), 3);
  assert.equal(sim.obs.liftHigh, true);
  sim.frames(lifted(0, .08), 3);
  const low = new Sim(); low.stance(); low.frames(lifted(0, .08), 3);
  assert.equal(low.obs.liftHigh, false);
});

test('observation does not mutate prior state or landmark coordinates', () => {
  const state = createPoseState();
  const p = pose();
  const before = structuredClone(state); const pointsBefore = structuredClone(p);
  observePose(p, state, 1000);
  assert.deepEqual(state, before); assert.deepEqual(p, pointsBefore);
});

test('squat counts stand-lower-stand on the athlete\'s own scale; a shallow dip is an attempt', () => {
  const sim = new Sim('squats'); const aspect = 9 / 16; sim.aspect = aspect;
  sim.frames(squatPose(0, { aspect }), 25);
  assert.ok(describeLesson(sim.session).index >= 1, 'standing still completes the stance and calibrates');
  for (const p of [.3, .7, 1, 1, .7, .3, 0, 0, 0]) sim.frame(squatPose(p, { aspect }));
  assert.equal(sim.last.metrics.reps, 1);
  for (const p of [.3, .55, .55, .3, 0, 0, 0]) sim.frame(squatPose(p, { aspect }));
  assert.equal(sim.last.metrics.reps, 1, 'half a squat is not counted');
  assert.ok(sim.events.some(e => e.type === 'attempt' && e.errors.includes('squat-attempt')));
  sim.frames(squatPose(0, { aspect }), 20);
  assert.equal(sim.last.metrics.reps, 1, 'standing still adds nothing');
});

test('starting crouched then standing is not a repetition', () => {
  const sim = new Sim('squats'); const aspect = 9 / 16; sim.aspect = aspect;
  sim.frames(squatPose(1, { aspect }), 6); sim.frames(squatPose(0, { aspect }), 6);
  assert.equal(sim.last.metrics.reps, 0);
});

test('walking toward the camera is not a squat', () => {
  const sim = new Sim('squats'); const aspect = 9 / 16; sim.aspect = aspect;
  sim.frames(squatPose(0, { aspect }), 25);
  // The whole body grows and moves down the frame, the legs stay straight.
  for (let k = 0; k < 12; k++) sim.frame(squatPose(0, { aspect }).map(p => ({ ...p, y: .5 + (p.y - .5) * (1 + k * .02) + k * .004 })));
  assert.equal(sim.last.metrics.reps, 0);
});

/* ───────────── ball tracking ───────────── */
test('a downward-to-upward reversal next to the foot is a touch; a toss near the hands is not', () => {
  const sim = new Sim(); sim.stance();
  sim.bounce(1);
  assert.equal(sim.ball.touches, 1);
  // Ball reversing high in the frame (hands) must not count.
  const high = new Sim(); high.stance();
  for (const y of [.25, .32, .40, .46, .40, .32, .25]) high.frame(pose(), ball(y));
  assert.equal(high.ball.touches, 0);
});

test('ball resting on the ground after a streak is a drop that resets the streak', () => {
  const sim = new Sim(); sim.stance();
  sim.bounce(3);
  assert.equal(sim.ball.streak, 3);
  for (let i = 0; i < 8; i++) sim.frame(pose(), ball(.90));
  assert.equal(sim.ball.drops, 1);
  assert.equal(sim.ball.streak, 0);
  assert.equal(sim.ball.bestStreak, 3);
  assert.equal(sim.ball.lastStreak, 3);
  assert.ok(sim.tags().includes('ball-drop'));
});

test('ball never seen means no touches are claimed and metrics say so', () => {
  const sim = new Sim(); sim.stance(); sim.lift(3);
  assert.equal(sim.last.metrics.touches, 0);
  assert.equal(sim.last.metrics.ballEverSeen, false);
  assert.equal(sim.last.metrics.lifts, 3);
});

test('detector noise below the score threshold is ignored', () => {
  const sim = new Sim(); sim.stance();
  for (const y of [.60, .70, .80, .86, .80, .70, .60]) sim.frame(pose(), [{ x: .54, y, w: .08, h: .08, score: .1 }]);
  assert.equal(sim.ball.seen, false);
  assert.equal(sim.ball.touches, 0);
});

test('ball tracking is pure', () => {
  const state = createBallState(); const before = structuredClone(state);
  trackBall(ball(.6), state, 100, null, 1);
  assert.deepEqual(state, before);
});

/* ───────────── lessons ───────────── */
test('stance lesson completes only after holding still, then the next lesson is introduced', () => {
  const sim = new Sim();
  sim.frames(pose(), 10);
  assert.equal(describeLesson(sim.session).index, 0);
  sim.frames(pose(), 30);
  assert.equal(describeLesson(sim.session).index, 1);
  assert.deepEqual(sim.session.completedLessons, ['stance']);
  const done = sim.log.find(f => f.tag === 'lesson-complete');
  assert.match(done.text, /Шаг 2/, 'one message closes the step and introduces the next');
  assert.equal(sim.tags().filter(t => t === 'lesson-intro').length, 1, 'no separate intro right after');
});

test('lift lesson needs six low lifts; high lifts do not count towards it', () => {
  const sim = new Sim(); sim.stance();
  sim.lift(3, .25);
  assert.equal(describeLesson(sim.session).progress, 0);
  sim.lift(6, .08);
  assert.equal(describeLesson(sim.session).index, 2);
});

test('series lesson only counts a streak started after the lesson began', () => {
  const sim = new Sim(); sim.stance(); sim.lift(6);
  assert.equal(describeLesson(sim.session).title, 'Одно касание');
  sim.bounce(3);
  const lesson = describeLesson(sim.session);
  assert.equal(lesson.title, 'Серия из 3');
  assert.ok(lesson.progress < 3, 'previous touches must not pre-fill the series');
  sim.bounce(3);
  assert.equal(describeLesson(sim.session).title, 'Серия из 5');
});

test('course completion is announced once and free practice keeps counting', () => {
  const sim = new Sim(); sim.stance(); sim.lift(6); sim.bounce(3); sim.bounce(3); sim.bounce(5); sim.bounce(10);
  assert.equal(sim.session.courseComplete, true);
  assert.equal(sim.tags().filter(t => t === 'course-complete').length, 1);
  const before = sim.ball.touches; sim.bounce(2);
  assert.equal(sim.ball.touches, before + 2);
  assert.equal(describeLesson(sim.session).complete, true);
});

test('skipping a lesson is recorded honestly and not as completed', () => {
  const sim = new Sim(); sim.stance(); sim.lift(6);
  sim.session = skipLesson(sim.session);
  assert.deepEqual(sim.session.skippedLessons, ['touch']);
  assert.deepEqual(sim.session.completedLessons, ['stance', 'lifts']);
  assert.equal(describeLesson(sim.session).title, 'Серия из 3');
});

test('ball-dependent lesson asks for the ball when none is visible', () => {
  const sim = new Sim(); sim.stance(); sim.lift(6);
  sim.t += 5000; sim.frames(pose(), 3);
  assert.ok(sim.tags().includes('ball-missing'));
});

test('balance lesson progresses with held seconds; a lean stops the clock', () => {
  const balance = new Sim('balance');
  balance.frames(pose(), 4);
  const up = pose(); up[28].y = .75; up[32].y = .79;
  for (let i = 0; i < 25; i++) balance.frame(up);
  assert.ok(balance.last.metrics.bestHold >= 1);
  assert.ok(describeLesson(balance.session).index >= 1);
  const leaning = up.map((p, i) => ([11, 12, 13, 14, 15, 16, 0].includes(i) ? { ...p, x: p.x + .12 } : p));
  const before = balance.last.metrics.hold;
  balance.frames(leaning, 12);
  assert.equal(balance.last.metrics.hold, 0, 'a tilted torso pauses the hold');
  assert.ok(before >= 1);
});

/* ───────────── phrases & cooldowns ───────────── */
test('every skill has at least five phrases per tag and personality and templates resolve', () => {
  for (const skill of SKILL_LIST) {
    const tags = new Set([...Object.keys(skill.phrases), ...Object.keys(skill.errors || {})]);
    for (const tag of tags) {
      const bank = skill.phrases[tag];
      assert.ok(bank, `${skill.id} lacks phrases for ${tag}`);
      for (const p of Object.keys(PERSONALITIES)) assert.ok(bank[p]?.length >= 5, `${skill.id}/${tag}/${p}`);
    }
    assert.ok(skill.phrases[`${skill.id}-idle`] || Object.keys(skill.phrases).some(t => t.endsWith('-idle')), `${skill.id} has a nudge`);
    for (const lesson of skill.lessons) for (const p of Object.keys(PERSONALITIES)) assert.ok(lesson.intro[p], `${skill.id}/${lesson.id}/${p}`);
  }
  for (const tag of Object.keys(COMMON_PHRASES)) for (const p of Object.keys(PERSONALITIES)) assert.ok(COMMON_PHRASES[tag][p].length >= 5);
  assert.equal(fillTemplate('Серия {streak}, касаний {touches}', { streak: 3, touches: 7 }), 'Серия 3, касаний 7');
});

test('phrase picker avoids repeating the previous phrase', () => {
  const bank = { calm: ['a', 'b', 'c'] };
  const first = pickPhrase(bank, 'calm', -1, 0);
  const second = pickPhrase(bank, 'calm', first.index, 0);
  assert.notEqual(first.index, second.index);
});

test('personality changes the words but never the observation', () => {
  const strict = new Sim('football', 'strict'); strict.stance(); strict.bounce(3);
  const fun = new Sim('football', 'fun'); fun.stance(); fun.bounce(3);
  assert.deepEqual(strict.tags(), fun.tags());
  assert.equal(strict.ball.touches, fun.ball.touches);
  assert.notDeepEqual(strict.log.map(f => f.text), fun.log.map(f => f.text));
});

test('a standing athlete gets one nudge after a long pause, not a stream of tips', () => {
  const sim = new Sim('squats'); const aspect = 9 / 16; sim.aspect = aspect;
  sim.frames(squatPose(0, { aspect }), 30);
  const start = sim.log.length;
  sim.frames(squatPose(0, { aspect }), 120); // 12 s of standing still
  assert.equal(sim.log.length - start, 0, 'no remarks while the athlete gets ready');
  sim.frames(squatPose(0, { aspect }), 200); // 20 s more
  assert.equal(sim.log.length - start, 1, 'one nudge');
  assert.equal(sim.log.at(-1).tag, 'squats-idle');
});

test('one high lift is not a remark; two of three are', () => {
  const sim = new Sim(); sim.stance(); sim.lift(6);
  sim.t += 9000; sim.lift(1, .25); sim.lift(1, .08);
  assert.ok(!sim.tags().includes('lift-high'));
  sim.lift(1, .25); sim.frames(pose(), 50);
  assert.ok(sim.tags().includes('lift-high'), 'said once the previous remark has had its pause');
});

test('main mistake counts observed errors, not remarks', () => {
  const session = createSession();
  session.tagCounts = { 'lift-high': 1, torso: 9 };
  session.errorCounts = { 'lift-high': 4, torso: 2 };
  assert.deepEqual(mainMistake(session), { tag: 'lift-high', count: 4 });
  assert.equal(mainMistake(createSession()), null);
  const sim = new Sim(); sim.stance(); sim.lift(6); sim.t += 9000;
  sim.lift(3, .25);
  assert.ok(sim.session.errorCounts['lift-high'] >= 3, 'every high lift is counted even if the coach spoke once');
  assert.ok((sim.session.tagCounts['lift-high'] || 0) <= 1);
});

test('session stepping is pure', () => {
  const session = createSession(); const before = structuredClone(session);
  const { obs } = observePose(pose(), createPoseState(), 0);
  stepSession(session, obs, createBallState(), 0);
  assert.deepEqual(session, before);
});

import { farModeDecision } from './coach-engine.js';

test('far mode switches only after a sustained distance change, with hysteresis', () => {
  let d = farModeDecision(null, 0.4);
  assert.equal(d.far, false);
  for (let i = 0; i < 7; i++) d = farModeDecision(d, 0.2);
  assert.equal(d.far, false, 'seven far frames are not enough');
  d = farModeDecision(d, 0.2);
  assert.equal(d.far, true, 'eighth far frame switches');
  for (let i = 0; i < 20; i++) d = farModeDecision(d, 0.3);
  assert.equal(d.far, true, 'inside the hysteresis band nothing changes');
  for (let i = 0; i < 8; i++) d = farModeDecision(d, 0.4);
  assert.equal(d.far, false, 'close again after eight near frames');
  const kept = farModeDecision({ far: true, frames: 5 }, 0.4, 'missing');
  assert.deepEqual(kept, { far: true, frames: 0 }, 'losing the person keeps the mode and resets the count');
  assert.deepEqual(farModeDecision({ far: false, frames: 3 }, NaN), { far: false, frames: 0 });
});

test('distance mode does not switch on during a deep squat', () => {
  const aspect = 9 / 16;
  let pose = createPoseState(); let far = { far: false, frames: 0 };
  for (let k = 0; k < 6; k++) {
    for (const p of [0, 0, .5, .9, 1, 1, 1, 1, 1, 1, 1, 1, .9, .5, 0, 0]) {
      const o = observePose(squatPose(p, { aspect }), pose, k * 2000 + p, aspect, 'squats'); pose = o.state;
      far = farModeDecision(far, o.obs.scale, o.obs.quality);
    }
  }
  assert.equal(far.far, false, 'the hips going down are not the athlete walking away');
});

test('a skipped step is not reported as finished; the summary knows the current step (F01)', () => {
  const sim = new Sim(); sim.stance(); sim.lift(6);
  sim.session = skipLesson(sim.session);
  const r = sim.frame(pose());
  assert.deepEqual(r.metrics.completed, ['stance', 'lifts']);
  assert.deepEqual(r.metrics.skipped, ['touch']);
  assert.equal(r.metrics.lessonIndex, 3, 'the next step is «Серия из 3», not «Одно касание»');
  assert.equal(r.metrics.lessonsDone, 2);
});
