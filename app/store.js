// Local data layer: profile, preferences, chats and training history.
// Everything stays on the device. The functions below the storage helpers are
// pure (no DOM, no globals) and unit-tested in store.test.mjs.
import { SKILL_LIST } from '../skills/index.js';
import { personalityId } from '../skills/common.js';
import { LLM_MODELS } from '../coach-llm.js';

export const KEYS = { profile: 'aimo:profile', prefs: 'aimo:preferences', sessions: 'aimo:sessions', chats: 'aimo:chats' };
export const AVATAR_HUES = [340, 24, 48, 160, 205, 265];
export const MAX_THREADS = 40;
export const MAX_MESSAGES = 200;

const hasStorage = () => typeof localStorage !== 'undefined';
export const storage = {
  read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode can refuse writes */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

/** One-time move of data saved under the project's old name. */
export function migrateLegacyKeys() {
  if (!hasStorage()) return;
  for (const name of ['preferences', 'sessions', 'sidebar-collapsed']) {
    try {
      const old = localStorage.getItem(`ai-coach:${name}`);
      if (old !== null) { if (localStorage.getItem(`aimo:${name}`) === null) localStorage.setItem(`aimo:${name}`, old); localStorage.removeItem(`ai-coach:${name}`); }
    } catch { /* ignore */ }
  }
}

/* ───────────── Profile ───────────── */

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 24);
  if (!name) return null;
  const hue = AVATAR_HUES.includes(raw.hue) ? raw.hue : AVATAR_HUES[0];
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
  return { name, hue, createdAt };
}

export const loadProfile = () => sanitizeProfile(storage.read(KEYS.profile, null));
export const saveProfile = (profile) => storage.write(KEYS.profile, sanitizeProfile(profile));
export const clearProfile = () => storage.remove(KEYS.profile);

/** Time-of-day greeting, pure for tests. */
export function greeting(name, hour = new Date().getHours()) {
  const part = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  return `${part}, ${name}!`;
}

/* ───────────── Preferences ───────────── */

// Front camera by default, the whole frame on screen; retain local voice/object settings.
const DEFAULT_PREFS = { voice: true, voiceId: 'piper:ru_RU-dmitri-medium', voiceRate: 0.7, skeleton: true, mirror: true, objects: true, sound: true, autoFar: true, liveCoach: false, llmModel: 'default', skill: 'football', personality: 'calm', plan: [], planGoal: '', theme: 'system', facing: 'user', fit: 'contain', wide: true };

export function sanitizePrefs(raw) {
  const prefs = { ...DEFAULT_PREFS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!SKILL_LIST.some(s => s.id === prefs.skill)) prefs.skill = 'football';
  prefs.personality = personalityId(prefs.personality);
  if (!LLM_MODELS[prefs.llmModel]) prefs.llmModel = 'default';
  prefs.plan = Array.isArray(prefs.plan) ? prefs.plan.filter(id => SKILL_LIST.some(s => s.id === id)).slice(0, 3) : [];
  prefs.planGoal = typeof prefs.planGoal === 'string' ? prefs.planGoal.slice(0, 200) : '';
  if (!['system', 'light', 'dark'].includes(prefs.theme)) prefs.theme = 'system';
  if (!['user', 'environment'].includes(prefs.facing)) prefs.facing = 'user';
  if (!['contain', 'cover'].includes(prefs.fit)) prefs.fit = 'contain'; // the whole frame: what the coach analyses
  prefs.wide = prefs.wide !== false;
  prefs.voiceId = typeof prefs.voiceId === 'string' ? prefs.voiceId.slice(0, 300) : '';
  prefs.voiceVolume = Number.isFinite(prefs.voiceVolume) ? Math.max(0, Math.min(1, prefs.voiceVolume)) : 1;
  prefs.voiceRate = Number.isFinite(prefs.voiceRate) ? Math.max(0.5, Math.min(1.5, prefs.voiceRate)) : DEFAULT_PREFS.voiceRate;
  if (typeof raw?.objects !== 'boolean' && typeof raw?.ball === 'boolean') prefs.objects = raw.ball;
  delete prefs.ball;
  for (const key of ['voice', 'skeleton', 'mirror', 'objects', 'sound', 'autoFar', 'liveCoach']) prefs[key] = Boolean(prefs[key]);
  return prefs;
}
export function loadPrefs() {
  const prefs = sanitizePrefs(storage.read(KEYS.prefs, {}));
  // Apply the new voice default once to existing installations, then retain edits.
  if (prefs.voiceDefaultsVersion !== 2) {
    prefs.voiceId = DEFAULT_PREFS.voiceId; prefs.voiceRate = DEFAULT_PREFS.voiceRate;
    prefs.voiceDefaultsVersion = 2; storage.write(KEYS.prefs, prefs);
  }
  return prefs;
}
export const savePrefs = (prefs) => storage.write(KEYS.prefs, prefs);

/* ───────────── Training history ───────────── */

export function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(s => s && typeof s.seconds === 'number' && typeof s.date === 'string' && SKILL_LIST.some(k => k.id === s.skill)).slice(0, 50);
}
export const loadHistory = () => sanitizeHistory(storage.read(KEYS.sessions, []));
export const saveHistory = (list) => storage.write(KEYS.sessions, sanitizeHistory(list));

const dayKey = (date) => { const d = new Date(date); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** Consecutive days with at least one training, counting back from today (or yesterday). */
export function streakDays(history, today = new Date()) {
  const days = new Set(history.map(s => dayKey(s.date)));
  if (!days.size) return 0;
  const cursor = new Date(today);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(dayKey(cursor))) { count += 1; cursor.setDate(cursor.getDate() - 1); }
  return count;
}

export function historyStats(history) {
  return {
    trainings: history.length,
    minutes: Math.round(history.reduce((sum, s) => sum + s.seconds, 0) / 60),
    bestStreak: history.reduce((best, s) => Math.max(best, s.bestStreak || 0), 0),
    days: streakDays(history),
  };
}

/* ───────────── Chats ───────────── */

const makeId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

export function createThread(greetingText, { now = new Date().toISOString(), skill = null } = {}) {
  const thread = { id: makeId(), createdAt: now, updatedAt: now, title: '', skill, messages: [] };
  if (greetingText) thread.messages.push({ id: makeId(), role: 'coach', type: 'text', text: greetingText, at: now });
  return thread;
}

/** A thread is "fresh" while the person has not written anything and no training was logged in it. */
export function isFresh(thread) {
  return Boolean(thread) && !thread.messages.some(m => m.role === 'user' || m.type === 'summary');
}

/** On app open: reuse an untouched latest thread instead of piling up empty chats. Pure. */
export function freshThread(chats, greetingText, options = {}) {
  const list = Array.isArray(chats) ? chats : [];
  if (list[0] && isFresh(list[0])) {
    // Same untouched chat, but it greets as of now: no stale «вчера» above a new greeting.
    const now = options.now || new Date().toISOString();
    const reused = { ...list[0], createdAt: now, updatedAt: now, messages: list[0].messages.map(m => ({ ...m })) };
    const greet = reused.messages.find(m => m.role === 'coach' && m.type === 'text');
    if (greet && greetingText) { greet.text = greetingText; greet.at = now; }
    return { chats: [reused, ...list.slice(1)], thread: reused };
  }
  const thread = createThread(greetingText, options);
  return { chats: [thread, ...list].slice(0, MAX_THREADS), thread };
}

export function appendMessage(thread, message) {
  const at = message.at || new Date().toISOString();
  const msg = { id: makeId(), type: 'text', ...message, at };
  const messages = [...thread.messages, msg].slice(-MAX_MESSAGES);
  const title = thread.title || (msg.role === 'user' && msg.type === 'text' ? msg.text.slice(0, 48) : '');
  return { thread: { ...thread, messages, title, updatedAt: at, skill: message.skill || thread.skill }, message: msg };
}

export function threadTitle(thread) {
  if (thread.title) return thread.title;
  const summary = thread.messages.find(m => m.type === 'summary');
  if (summary?.data?.skillName) return `Эфир · ${summary.data.skillName}`;
  return 'Новый чат';
}

export function replaceThread(chats, thread) {
  const rest = chats.filter(t => t.id !== thread.id);
  return [thread, ...rest].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0)).slice(0, MAX_THREADS);
}

export function sanitizeChats(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(t => t && typeof t.id === 'string' && Array.isArray(t.messages)).map(t => ({
    id: t.id, createdAt: String(t.createdAt || ''), updatedAt: String(t.updatedAt || t.createdAt || ''), title: String(t.title || '').slice(0, 48),
    skill: SKILL_LIST.some(s => s.id === t.skill) ? t.skill : null,
    messages: t.messages.filter(m => m && typeof m.text === 'string' || (m && m.type && m.type !== 'text')).slice(-MAX_MESSAGES),
  })).slice(0, MAX_THREADS);
}
export const loadChats = () => sanitizeChats(storage.read(KEYS.chats, []));
export const saveChats = (chats) => storage.write(KEYS.chats, sanitizeChats(chats));
