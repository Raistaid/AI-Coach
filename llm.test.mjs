import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, allowedNumbers, buildMessages, validateReply, LIVE_MAX_CHARS } from './coach-llm.js';

const snapshot = {
  skillId: 'football', personality: 'fun',
  lesson: { title: 'Серия из 3', index: 3, total: 6, progress: 2, target: 3 },
  lessonsDone: 3, seconds: 95, touches: 12, streak: 2, bestStreak: 4, drops: 3, lifts: 7,
  ballSeen: true, visiblePercent: 88, mainMistake: { tag: 'lift-high', count: 4 }, cues: 14,
};

test('summary contains only numbers and labels, never frames or free text', () => {
  const summary = buildSummary(snapshot);
  for (const value of Object.values(summary)) assert.ok(['number', 'string', 'boolean'].includes(typeof value));
  assert.equal(summary.lessonIndex, 4);
  assert.equal(summary.mainMistake, 'стопа поднимается слишком высоко');
  assert.equal(buildSummary({}).skill, 'Чеканка мяча');
});

test('messages describe the summary in Russian and forbid invented numbers', () => {
  const [system, user] = buildMessages(buildSummary(snapshot), 'live');
  assert.equal(system.role, 'system');
  assert.match(system.content, /только числа из сводки/);
  assert.match(user.content, /Касаний: 12/);
  assert.match(buildMessages(buildSummary(snapshot), 'final')[0].content, /итог тренировки/);
});

test('valid short Russian reply with summary numbers passes', () => {
  const summary = buildSummary(snapshot);
  const r = validateReply('«Уже 12 касаний, лучшая серия 4. Стопу чуть ниже!»', summary);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Уже 12 касаний, лучшая серия 4. Стопу чуть ниже!');
});

test('invented numbers, percentages, English, emoji and long replies are rejected', () => {
  const summary = buildSummary(snapshot);
  assert.equal(validateReply('Ты сделал 25 касаний!', summary).reason, 'invented-number');
  assert.equal(validateReply('Точность 90%!', summary).reason, 'invented-number');
  assert.equal(validateReply('Great job, keep going!', summary).reason, 'not-russian');
  assert.equal(validateReply('Молодец 🔥', summary).reason, 'emoji');
  assert.equal(validateReply('а'.repeat(LIVE_MAX_CHARS + 1), summary).reason, 'too-long');
  assert.equal(validateReply('', summary).reason, 'empty');
  assert.equal(validateReply('Ты был виден 88% времени.', summary).ok, true);
});

test('allowed numbers include minutes and seconds of the duration', () => {
  const allowed = allowedNumbers(buildSummary(snapshot));
  assert.ok(allowed.has(95) && allowed.has(1) && allowed.has(35));
  assert.ok(!allowed.has(14), 'cue count is not something the coach should quote');
});
