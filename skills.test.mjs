import test from 'node:test';
import assert from 'node:assert/strict';
import { observePose, createPoseState, createSession, stepSession, trackBall, createBallState, describeLesson, mainMistake } from './coach-engine.js';
import { SKILL_LIST, CATEGORIES, PERSONALITIES } from './skills/index.js';
import { jitter, puppet, lying } from './skills/puppet.js';

const aspect = 9 / 16;
function play(skill, seconds, frameAt = (t) => skill.demo(t, aspect)) {
  let pose = createPoseState(); let ball = createBallState(); let session = createSession(skill.id, { personality: 'calm' });
  const said = []; const events = []; let last;
  for (let ms = 0; ms <= seconds * 1000; ms += 110) {
    const frame = frameAt(ms / 1000);
    const o = observePose(frame?.points ?? frame, pose, ms, aspect, skill.id); pose = o.state;
    if (o.obs.motion?.event) events.push(o.obs.motion.event);
    ball = trackBall(frame?.ball || [], ball, ms, o.obs, aspect);
    last = stepSession(session, o.obs, ball, ms); session = last.session;
    if (last.feedback) said.push({ ...last.feedback, at: ms });
  }
  return { said, events, last, session };
}

test('catalog: eight skills in three categories, each fully described', () => {
  assert.equal(SKILL_LIST.length, 8);
  assert.equal(new Set(SKILL_LIST.map(s => s.id)).size, 8);
  const categories = new Set(CATEGORIES.map(c => c.id));
  for (const skill of SKILL_LIST) {
    assert.ok(categories.has(skill.category), skill.id);
    for (const key of ['name', 'short', 'emoji', 'level', 'goal', 'tagline', 'camera', 'description']) assert.ok(skill[key], `${skill.id}.${key}`);
    assert.ok(skill.lessons.length >= 3, `${skill.id} has at least three steps`);
    assert.equal(skill.metric.forms.length, 3);
    for (const fn of ['view', 'measure', 'result', 'summaryLine', 'answer', 'demo']) assert.equal(typeof skill[fn], 'function', `${skill.id}.${fn}`);
    for (const [tag, info] of Object.entries(skill.errors)) {
      assert.ok(info.label && info.advice, `${skill.id}/${tag}`);
      for (const p of Object.keys(PERSONALITIES)) assert.ok(skill.phrases[tag][p].length >= 5, `${skill.id}/${tag}/${p}`);
    }
  }
});

for (const skill of SKILL_LIST) {
  test(`${skill.name}: the demo is analysed by the same engine, with steps, a remark and a calm feed`, () => {
    const { said, events, last, session } = play(skill, 60);
    const value = skill.result(last.metrics).value;
    assert.ok(value > 0, `${skill.id} measured ${value}`);
    assert.ok(describeLesson(session).index >= 2 || session.courseComplete, `${skill.id} advanced through steps by observation`);
    const remarks = said.filter(f => f.source !== 'lesson');
    assert.ok(remarks.some(f => f.kind === 'tip'), `${skill.id} explained at least one mistake`);
    assert.ok(remarks.length <= 9, `${skill.id}: ${remarks.length} remarks a minute`);
    for (const f of said) assert.doesNotMatch(f.text, /\{\w+\}/, 'every template is filled');
    if (events.some(e => e.errors?.length)) assert.ok(mainMistake(session), 'the summary has a main mistake');
  });

  test(`${skill.name}: landmark jitter while standing still counts nothing`, () => {
    const still = skill.demo(0, aspect).points;
    const { last, events } = play(skill, 30, (t) => jitter(still, 0.004, Math.round(t * 100) + 1));
    assert.equal(events.filter(e => e.type === 'rep').length, 0, `${skill.id} counted noise`);
    assert.ok(last.metrics.bestHold <= 30);
  });

  test(`${skill.name}: nobody in the frame gives at most three warnings a minute and no counts`, () => {
    const { said, last } = play(skill, 60, () => null);
    assert.ok(said.filter(f => f.tag === 'no-person').length <= 3);
    assert.equal(skill.result(last.metrics).value, 0);
  });
}

test('side-on skills ask to turn when the athlete faces the camera', () => {
  const lunges = SKILL_LIST.find(s => s.id === 'lunges');
  const { said } = play(lunges, 8, () => puppet({ aspect }));
  assert.ok(said.some(f => f.tag === 'turn-side'));
});

test('push-ups are counted only in the push-up position, not standing arm bends', () => {
  const pushups = SKILL_LIST.find(s => s.id === 'pushups');
  const bend = (t) => puppet({ aspect, arms: [{ upper: 80, fore: 80 + 70 * Math.abs(Math.sin(t * 2)) }, { upper: 80, fore: 80 + 70 * Math.abs(Math.sin(t * 2)) }] });
  const { last } = play(pushups, 20, bend);
  assert.equal(last.metrics.reps, 0);
});

test('the plank clock stops while the hips sag', () => {
  const plank = SKILL_LIST.find(s => s.id === 'plank');
  const { last } = play(plank, 20, (t) => lying({ aspect, angle: 14, forearms: true, sag: t > 5 ? 0.1 : 0 }));
  assert.ok(last.metrics.bestHold <= 6, `best ${last.metrics.bestHold}`);
  assert.equal(last.metrics.hold, 0);
});
