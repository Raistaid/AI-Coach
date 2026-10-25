import test from 'node:test';
import assert from 'node:assert/strict';
import { initials, sanitizeProfile, greeting, sanitizePrefs, streakDays, historyStats, createThread, freshThread, appendMessage, threadTitle, isFresh, replaceThread, sanitizeChats, AVATAR_HUES } from './app/store.js';

test('object-detector preference migrates the old ball switch and saved voice is sanitized', () => {
  assert.equal(sanitizePrefs({ ball: false }).objects, false);
  assert.equal(sanitizePrefs({ ball: false, objects: true }).objects, true);
  assert.equal(sanitizePrefs({ voiceId: 'voice-uri' }).voiceId, 'voice-uri');
  assert.equal(sanitizePrefs({ voiceId: {} }).voiceId, '');
  assert.equal('ball' in sanitizePrefs({ ball: true }), false);
});

test('profile is sanitized: trimmed name, known hue, no empty names', () => {
  assert.equal(sanitizeProfile({ name: '  Максим  ', hue: 999 }).name, 'Максим');
  assert.equal(sanitizeProfile({ name: 'Максим', hue: 999 }).hue, AVATAR_HUES[0]);
  assert.equal(sanitizeProfile({ name: '   ' }), null);
  assert.equal(sanitizeProfile(null), null);
  assert.equal(initials('Максим Манзиков'), 'ММ');
  assert.equal(initials(''), '?');
});

test('greeting follows the hour', () => {
  assert.equal(greeting('Максим', 8), 'Доброе утро, Максим!');
  assert.equal(greeting('Максим', 15), 'Добрый день, Максим!');
  assert.equal(greeting('Максим', 22), 'Добрый вечер, Максим!');
  assert.equal(greeting('Максим', 2), 'Доброй ночи, Максим!');
});

test('preferences fall back to safe defaults', () => {
  const p = sanitizePrefs({ skill: 'nope', personality: 'angry', llmModel: 'giant', plan: ['football', 'x', 'balance', 'squats', 'football'], theme: 'neon', voice: 'yes' });
  assert.equal(p.skill, 'football'); assert.equal(p.personality, 'calm'); assert.equal(p.llmModel, 'default');
  assert.deepEqual(p.plan, ['football', 'balance', 'squats']); assert.equal(p.theme, 'system'); assert.equal(p.voice, true);
  assert.equal(p.facing, 'user', 'front camera by default: the athlete must see the screen');
  assert.equal(sanitizePrefs({ facing: 'environment' }).facing, 'environment');
  assert.equal(sanitizePrefs({ facing: 'sideways' }).facing, 'user');
  assert.equal(p.fit, 'contain', 'the whole camera frame by default, nothing cropped');
  assert.equal(sanitizePrefs({ fit: 'zoom' }).fit, 'contain');
  assert.equal(sanitizePrefs({}).wide, true, 'widest lens by default');
  assert.equal(sanitizePrefs({ wide: false }).wide, false);
});

test('day streak counts consecutive training days back from today or yesterday', () => {
  const day = (offset) => { const d = new Date(2026, 9, 25, 12); d.setDate(d.getDate() - offset); return d.toISOString(); };
  const today = new Date(2026, 9, 25, 20);
  assert.equal(streakDays([], today), 0);
  assert.equal(streakDays([{ date: day(0) }], today), 1);
  assert.equal(streakDays([{ date: day(1) }, { date: day(2) }], today), 2, 'yesterday counts when today has no training yet');
  assert.equal(streakDays([{ date: day(0) }, { date: day(1) }, { date: day(3) }], today), 2, 'a gap breaks the streak');
  const stats = historyStats([{ date: day(0), seconds: 90, bestStreak: 4, skill: 'football' }, { date: day(1), seconds: 30, bestStreak: 7, skill: 'squats' }]);
  assert.equal(stats.trainings, 2); assert.equal(stats.minutes, 2); assert.equal(stats.bestStreak, 7);
});

test('opening the app reuses an untouched chat instead of creating a new one', () => {
  const first = freshThread([], 'Привет!', { now: '2026-10-25T10:00:00Z' });
  assert.equal(first.chats.length, 1);
  assert.equal(first.thread.messages[0].text, 'Привет!');
  assert.equal(isFresh(first.thread), true);
  const second = freshThread(first.chats, 'Добрый день!');
  assert.equal(second.chats.length, 1, 'no second empty chat');
  assert.equal(second.thread.id, first.thread.id);
  assert.equal(second.thread.messages[0].text, 'Добрый день!', 'greeting refreshed');
  const later = freshThread(second.chats, 'Доброе утро!', { now: '2026-10-26T08:00:00Z' });
  assert.equal(later.thread.messages[0].at, '2026-10-26T08:00:00Z', 'greeting time refreshed, no stale day separator');
  assert.equal(later.thread.updatedAt, '2026-10-26T08:00:00Z');
  const { thread: used } = appendMessage(second.thread, { role: 'user', text: 'хочу чеканить' });
  const third = freshThread(replaceThread(second.chats, used), 'Привет!');
  assert.equal(third.chats.length, 2, 'a used chat stays and a new one is opened');
  assert.notEqual(third.thread.id, used.id);
});

test('messages set the chat title and summaries name the thread', () => {
  const t = createThread('Привет', { now: '2026-10-25T10:00:00Z' });
  assert.equal(threadTitle(t), 'Новый чат');
  const { thread: a } = appendMessage(t, { role: 'user', text: 'Хочу научиться чеканить мяч, но он всё время падает и улетает' });
  assert.equal(a.title.length, 48);
  const { thread: b } = appendMessage(createThread('Привет'), { role: 'coach', type: 'summary', text: 'итог', data: { skillName: 'Чеканка мяча' } });
  assert.equal(threadTitle(b), 'Эфир · Чеканка мяча');
  assert.equal(isFresh(b), false);
});

test('stored chats are validated and ordered by last activity', () => {
  const chats = sanitizeChats([{ id: 'a', createdAt: '1', messages: [{ role: 'user', text: 'x' }] }, { id: 'b' }, 'junk']);
  assert.equal(chats.length, 1);
  const older = { id: 'o', createdAt: '2026-01-01', updatedAt: '2026-01-01', title: '', skill: null, messages: [] };
  const newer = { id: 'n', createdAt: '2026-02-01', updatedAt: '2026-02-01', title: '', skill: null, messages: [] };
  assert.deepEqual(replaceThread([newer, older], { ...older, updatedAt: '2026-03-01' }).map(t => t.id), ['o', 'n']);
});
