import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProgress } from './coach-progress.js';

const record = (overrides = {}) => ({
  schemaVersion: 2, source: 'camera', skill: 'football', metricKey: 'touches',
  date: '2026-10-25T12:00:00.000Z', seconds: 60, metricValue: 12, bestStreak: 5,
  ...overrides,
});
const earlier = (overrides = {}) => record({ date: '2026-10-24T12:00:00.000Z', bestStreak: 3, ...overrides });

test('first measured result has no invented comparison or new-record claim', () => {
  const result = compareProgress(record(), []);
  assert.deepEqual({ ...result, text: undefined }, {
    metricLabel: 'Лучшая серия', value: 5, previousValue: null, delta: null,
    bestValue: 5, isNewBest: false, sampleCount: 1, text: undefined,
  });
  assert.match(result.text, /Первый результат среди сохранённых тренировок/);
});

test('football compares the best series rather than total touches', () => {
  const result = compareProgress(record(), [earlier({ metricValue: 100, bestStreak: 3 })]);
  assert.equal(result.value, 5);
  assert.equal(result.previousValue, 3);
  assert.equal(result.delta, 2);
  assert.equal(result.bestValue, 5);
  assert.equal(result.isNewBest, true);
  assert.equal(result.sampleCount, 2);
  assert.match(result.text, /изменение: \+2/);
  assert.match(result.text, /среди сохранённых тренировок/);
});

test('newer result is compared to the latest earlier date, independent of input order', () => {
  const history = [
    earlier({ date: '2026-10-23T12:00:00.000Z', bestStreak: 9 }),
    earlier({ bestStreak: 4 }),
    earlier({ date: '2026-10-22T12:00:00.000Z', bestStreak: 2 }),
    record({ date: '2026-10-26T12:00:00.000Z', bestStreak: 11 }),
    record({ bestStreak: 10 }),
  ];
  const result = compareProgress(record(), history);
  assert.equal(result.previousValue, 4);
  assert.equal(result.delta, 1);
  assert.equal(result.bestValue, 9);
  assert.equal(result.isNewBest, false);
  assert.equal(result.sampleCount, 4, 'future and equal-time records are not previous sessions');
});

test('ties and lower results never announce a new best', () => {
  const tie = compareProgress(record(), [earlier({ bestStreak: 5 })]);
  assert.equal(tie.delta, 0);
  assert.equal(tie.isNewBest, false);
  assert.match(tie.text, /без изменения/);
  const lower = compareProgress(record(), [earlier({ bestStreak: 8 })]);
  assert.equal(lower.delta, -3);
  assert.equal(lower.bestValue, 8);
  assert.equal(lower.isNewBest, false);
});

test('metrics, skills and input media are never mixed', () => {
  const history = [
    earlier({ metricKey: 'lifts', metricValue: 100 }),
    earlier({ source: 'file', bestStreak: 10 }),
    earlier({ source: 'demo', bestStreak: 11 }),
    earlier({ skill: 'squats', metricKey: 'reps', metricValue: 50 }),
    earlier({ skill: 'balance', metricKey: 'balanceSeconds', metricValue: 30 }),
    earlier({ schemaVersion: 1, bestStreak: 8 }),
    { skill: 'football', seconds: 60, movements: 999, metricLabel: 'касаний' },
    earlier(),
  ];
  const result = compareProgress(record(), history);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.previousValue, 3);
});

test('video results stay separate and explicitly describe video in the reply', () => {
  const result = compareProgress(record({ source: 'file' }), [earlier(), earlier({ source: 'file' })]);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.isNewBest, true);
  assert.match(result.text, /^Видео\./);
  assert.match(result.text, /среди сохранённых тренировок по видео/);
  assert.doesNotMatch(result.text, /личн|вс[её] время|качество|техник/i);
});

test('fallback lifts, repetitions and best balance use their own measured values', () => {
  for (const [skill, metricKey, label] of [
    ['football', 'lifts', 'Подъёмы стопы'],
    ['squats', 'reps', 'Повторы'],
    ['balance', 'balanceSeconds', 'Лучшее удержание, с'],
  ]) {
    const result = compareProgress(record({ skill, metricKey, metricValue: 8 }), [earlier({ skill, metricKey, metricValue: 6 })]);
    assert.equal(result.metricLabel, label);
    assert.equal(result.value, 8);
    assert.equal(result.previousValue, 6);
    assert.equal(result.delta, 2);
  }
});

test('no person/no counted movement produces an honest zero without a new best', () => {
  const result = compareProgress(record({ metricValue: 0, bestStreak: 0 }), [earlier({ metricValue: 0, bestStreak: 0 })]);
  assert.equal(result.value, 0);
  assert.equal(result.bestValue, 0);
  assert.equal(result.isNewBest, false);
  assert.match(result.text, /В этой тренировке положительный результат не зафиксирован/);
  const afterPositive = compareProgress(record({ metricValue: 0, bestStreak: 0 }), [earlier()]);
  assert.equal(afterPositive.previousValue, 3);
  assert.equal(afterPositive.bestValue, 3);
  assert.equal(afterPositive.delta, -3);
  assert.equal(afterPositive.isNewBest, false);
  assert.match(afterPositive.text, /В этой тренировке положительный результат не зафиксирован/);
  assert.equal(compareProgress({}), null);
});

test('unsupported, legacy, demo and malformed current records are unavailable', () => {
  for (const value of [null, undefined, [], {},
    record({ schemaVersion: undefined }), record({ schemaVersion: '2' }),
    record({ source: 'demo' }), record({ source: undefined }), record({ source: 'unknown' }),
    record({ skill: 'unknown' }), record({ skill: '__proto__' }), record({ skill: 'squats', metricKey: 'touches' }),
    record({ metricKey: 'unknown' }), record({ metricKey: 'toString' }),
    record({ seconds: 0 }), record({ seconds: -1 }), record({ seconds: NaN }), record({ seconds: Infinity }), record({ seconds: 1.5 }),
    record({ metricValue: NaN }), record({ metricValue: Infinity }), record({ metricValue: -1 }), record({ metricValue: 1.5 }), record({ metricValue: '12' }),
    record({ bestStreak: NaN }), record({ bestStreak: undefined }), record({ bestStreak: -1 }), record({ bestStreak: 1.5 }), record({ bestStreak: 13 }),
    record({ date: undefined }), record({ date: 'yesterday' }), record({ date: '2026-10-25' }),
    record({ date: '2026-02-30T12:00:00.000Z' }), record({ date: '2026-10-25T24:00:00.000Z' }),
  ]) assert.equal(compareProgress(value), null, JSON.stringify(value));
});

test('malformed previous records are ignored rather than replacing missing data with zero', () => {
  const result = compareProgress(record(), [null, undefined, [], {}, earlier({ metricValue: NaN }), earlier({ seconds: 0 })]);
  assert.equal(result.previousValue, null);
  assert.equal(result.delta, null);
  assert.equal(result.sampleCount, 1);
  assert.equal(compareProgress(record(), null).sampleCount, 1);
});

test('ISO dates with explicit offsets compare by actual instant and respect leap years', () => {
  const result = compareProgress(record(), [
    earlier({ date: '2026-10-25T14:00:00+03:00', bestStreak: 4 }),
    earlier({ date: '2026-10-25T12:30:00Z', bestStreak: 10 }),
  ]);
  assert.equal(result.previousValue, 4);
  assert.equal(result.sampleCount, 2);
  assert.equal(compareProgress(record({ date: '2024-02-29T12:00:00Z' })).value, 5);
  assert.equal(compareProgress(record({ date: '2025-02-29T12:00:00Z' })), null);
});

test('comparison neither mutates nor retains the input records', () => {
  const current = Object.freeze(record());
  const history = Object.freeze([Object.freeze(earlier()), Object.freeze(earlier({ date: '2026-10-23T12:00:00Z' }))]);
  const before = JSON.stringify({ current, history });
  const result = compareProgress(current, history);
  result.value = 999;
  assert.equal(JSON.stringify({ current, history }), before);
  assert.equal(compareProgress(current, history).value, 5);
});
