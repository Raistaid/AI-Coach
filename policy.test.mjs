import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicy, noteView, noteActivity, choose, BUDGET } from './coach-policy.js';

const cue = (kind, tag, extra = {}) => ({ kind, tag, ...extra });
function run(policy, frames) {
  const said = []; let p = policy;
  for (const [t, cues, view = null] of frames) {
    p = noteView(p, view, t);
    const r = choose(p, cues, t); p = r.policy;
    if (r.pick) said.push([t, r.pick.tag]);
  }
  return { policy: p, said };
}

test('lesson events always pass; other remarks wait for their gap', () => {
  let p = noteActivity(createPolicy(), 0);
  let r = choose(p, [cue('lesson', 'lesson-intro'), cue('error', 'torso')], 0);
  assert.equal(r.pick.tag, 'lesson-intro');
  r = choose(r.policy, [cue('error', 'torso')], 2000);
  assert.equal(r.pick, null, 'too soon after the step message');
  r = choose(r.policy, [cue('error', 'torso')], BUDGET.errorGap + 100);
  assert.equal(r.pick.tag, 'torso');
  r = choose(r.policy, [cue('error', 'torso')], BUDGET.errorGap + 7000);
  assert.equal(r.pick, null, 'the same correction is not repeated soon');
  r = choose(r.policy, [cue('error', 'knees')], BUDGET.errorGap + 7000);
  assert.equal(r.pick.tag, 'knees', 'a different one may follow after the gap');
});

test('view problems: said after they last, a few times, then the voice is quiet', () => {
  const frames = [];
  for (let t = 0; t <= 120000; t += 100) frames.push([t, [cue('framing', 'no-person')], 'no-person']);
  const { said } = run(noteActivity(createPolicy(), 0), frames);
  assert.ok(said[0][0] >= BUDGET.framingDelay);
  assert.equal(said.length, BUDGET.framingMax);
  assert.ok(said[1][0] - said[0][0] >= BUDGET.framingRepeat);
});

test('a short glitch out of view is never said', () => {
  const frames = [];
  for (let t = 0; t <= 10000; t += 100) frames.push([t, t < 1200 ? [cue('framing', 'no-person')] : [], t < 1200 ? 'no-person' : null]);
  assert.equal(run(noteActivity(createPolicy(), 0), frames).said.length, 0);
});

test('praise and corrections share a budget of a few remarks a minute', () => {
  const frames = [];
  for (let t = 0; t < 60000; t += 100) frames.push([t, [cue('praise', `p${t}`), cue('error', `e${t}`)]]);
  const { said } = run(noteActivity(createPolicy(), 0), frames);
  assert.ok(said.length <= BUDGET.perMinute, `${said.length} remarks`);
  for (let i = 1; i < said.length; i++) assert.ok(said[i][0] - said[i - 1][0] >= BUDGET.errorGap - 1);
});

test('a nudge comes only after a long pause in activity', () => {
  let p = noteActivity(createPolicy(), 0);
  assert.equal(choose(p, [cue('idle', 'squats-idle')], 10000).pick, null);
  const r = choose(p, [cue('idle', 'squats-idle')], BUDGET.idle + 1);
  assert.equal(r.pick.tag, 'squats-idle');
  assert.equal(choose(r.policy, [cue('idle', 'squats-idle')], BUDGET.idle + 10000).pick, null);
  p = noteActivity(r.policy, BUDGET.idle + 5000);
  assert.equal(choose(p, [cue('idle', 'squats-idle')], BUDGET.idle + 15000).pick, null, 'activity resets the clock');
});

test('a one-off correction blocked by the gap waits briefly; a lasting one does not', () => {
  let p = noteActivity(createPolicy(), 0);
  p = choose(p, [cue('lesson', 'lesson-complete')], 0).policy;
  p = choose(p, [cue('error', 'pushup-sag', { once: true })], 1000).policy;
  assert.equal(p.pending?.cue.tag, 'pushup-sag');
  const r = choose(p, [], BUDGET.errorGap);
  assert.equal(r.pick?.tag, 'pushup-sag', 'said when its turn comes');
  let q = choose(noteActivity(createPolicy(), 0), [cue('lesson', 'x')], 0).policy;
  q = choose(q, [cue('error', 'plank-sag')], 1000).policy;
  assert.equal(q.pending, null, 'a lasting problem is re-offered while it lasts, not kept');
  let old = choose(noteActivity(createPolicy(), 0), [cue('lesson', 'x')], 0).policy;
  old = choose(old, [cue('error', 'late', { once: true })], 500).policy;
  assert.equal(choose(old, [], 500 + BUDGET.pendingMs + 2000).pick, null, 'a stale remark is dropped');
});

test('an attempt that did not count is explained quickly', () => {
  let p = choose(noteActivity(createPolicy(), 0), [cue('lesson', 'lesson-complete')], 0).policy;
  assert.equal(choose(p, [cue('attempt', 'squat-attempt', { once: true })], BUDGET.attemptGap + 1).pick.tag, 'squat-attempt');
});
