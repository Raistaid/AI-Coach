// Small DOM helpers shared by the screens. No app state lives here.
import { rhythmBuckets, rhythmText } from '../rhythm.js';
export const $ = (id) => document.getElementById(id);
export const text = (id, value) => { const node = $(id); if (node) node.textContent = value; };
export function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined && content !== null) node.textContent = content;
  return node;
}
export function icon(name, className = 'ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`); svg.append(use);
  return svg;
}

export const formatTime = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export const timeLabel = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export function relativeDate(iso) {
  const date = new Date(iso); const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, now)) return 'Сегодня';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

let toastTimer;
export function toast(message) {
  text('toast', message); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3800);
}
export function haptic(pattern = 12) { try { navigator.vibrate?.(pattern); } catch { /* optional */ } }

/** Tiny event bus so screens can talk without importing each other. */
const listeners = new Map();
export const bus = {
  on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
  emit(name, payload) { for (const fn of listeners.get(name) || []) fn(payload); },
};

/* Bottom sheets: one open at a time, backdrop and Escape close them. */
let openSheetId = null;
export function openSheet(id) {
  closeSheet();
  const sheet = $(id); if (!sheet) return;
  openSheetId = id; sheet.hidden = false; document.querySelector('[data-sheet-backdrop]').hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  sheet.querySelector('button, input, [tabindex]')?.focus({ preventScroll: true });
}
export function closeSheet() {
  if (!openSheetId) return;
  const sheet = $(openSheetId); openSheetId = null;
  sheet.classList.remove('is-open'); sheet.hidden = true;
  document.querySelector('[data-sheet-backdrop]').hidden = true;
}
export const currentSheet = () => openSheetId;

export function avatarNode(profile, className = 'avatar') {
  const node = el('span', className, profile ? initialsOf(profile.name) : '?');
  if (profile) node.style.setProperty('--hue', profile.hue);
  return node;
}
export function paintAvatar(node, profile) {
  if (!node) return;
  node.textContent = profile ? initialsOf(profile.name) : '?';
  node.style.setProperty('--hue', profile ? profile.hue : 200);
}
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map(p => p[0].toUpperCase()).join('') : '?';
}

/** Bar strip of counted movements over the session, with the rhythm verdict under it. */
export function rhythmNode(rhythm) {
  const wrap = el('div', 'rhythm');
  wrap.append(el('b', 'rhythm-title', `Ритм: ${rhythm.label}`));
  const bars = rhythmBuckets(rhythm.times, rhythm.durationMs, 24);
  const max = Math.max(1, ...bars);
  const strip = el('div', 'rhythm-bars');
  strip.setAttribute('role', 'img');
  strip.setAttribute('aria-label', `Засчитано движений по ходу эфира: ${rhythm.times.length}`);
  for (const value of bars) {
    const bar = el('span', value ? '' : 'empty');
    bar.style.height = `${value ? Math.round(24 + (76 * value) / max) : 8}%`;
    strip.append(bar);
  }
  wrap.append(strip, el('small', 'rhythm-text', rhythmText(rhythm.stats, rhythm.between)));
  return wrap;
}
