// Bootstrap: local profile gate, screens and tabs, chat drawer with swipe,
// skill sheet, progress and profile screens. Wires chat.js and live.js together.
import { SKILL_LIST, getSkill, PERSONALITIES } from '../skills/index.js';
import { createLocalCoach, supportsWebGPU, LLM_MODELS } from '../coach-llm.js';
import { pluralize } from '../coach-planner.js';
import { $, text, el, icon, toast, haptic, bus, formatTime, relativeDate, openSheet, closeSheet, currentSheet, paintAvatar } from './ui.js';
import * as store from './store.js';
import * as chat from './chat.js';
import * as live from './live.js';

store.migrateLegacyKeys();
const app = $('app');
const prefs = store.loadPrefs();
let profile = store.loadProfile();
let history = store.loadHistory();
let liveCoach = null; let liveCoachPromise = null;
let sheetSkillId = null;
const steps = (n) => pluralize(n, ['шаг', 'шага', 'шагов']);

/* ───────────── Theme ───────────── */
function applyTheme() { document.documentElement.dataset.theme = prefs.theme; $('themeSelect').value = prefs.theme; }

/* ───────────── Screens & tabs ───────────── */
function showScreen(name) {
  app.dataset.screen = name;
  document.querySelectorAll('.tab[data-tab]').forEach(tab => { if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); });
  if (name === 'progress') renderProgress();
  if (name === 'profile') renderProfile();
  if (name === 'catalog') renderCatalog();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tab[data-tab]').forEach(tab => tab.addEventListener('click', () => {
  haptic(6);
  if (tab.dataset.tab === 'live') { openSkillSheet(prefs.skill); return; }
  showScreen(tab.dataset.tab);
}));

/* ───────────── Login ───────────── */
function renderAvatarPicker(container, selectedHue, onPick) {
  container.replaceChildren();
  for (const hue of store.AVATAR_HUES) {
    const swatch = el('button', 'swatch'); swatch.type = 'button'; swatch.style.setProperty('--hue', hue);
    swatch.setAttribute('role', 'radio'); swatch.setAttribute('aria-checked', String(hue === selectedHue)); swatch.setAttribute('aria-label', `Оттенок ${hue}`);
    swatch.addEventListener('click', () => { onPick(hue); renderAvatarPicker(container, hue, onPick); });
    container.append(swatch);
  }
}
let loginHue = store.AVATAR_HUES[0];
renderAvatarPicker($('loginAvatars'), loginHue, hue => { loginHue = hue; });
$('loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('loginName').value.trim(); if (!name) return;
  profile = store.sanitizeProfile({ name, hue: loginHue, createdAt: new Date().toISOString() });
  store.saveProfile(profile); enterApp(); toast(`Добро пожаловать, ${profile.name}!`);
});
$('logoutBtn').addEventListener('click', () => {
  store.clearProfile(); profile = null; app.dataset.screen = 'login'; $('loginName').value = '';
  toast('Ты вышел. Чаты и история остались на этом устройстве.');
});

/* ───────────── Drawer (chat history, swipe from the left edge) ───────────── */
let drawerOpen = false;
function setDrawer(open) {
  drawerOpen = open; app.dataset.drawer = open ? 'open' : 'closed';
  $('drawer').hidden = !open; $('drawerBackdrop').hidden = !open; $('openDrawer').setAttribute('aria-expanded', String(open));
  if (open) { chat.renderDrawer(); $('closeDrawer').focus({ preventScroll: true }); } else $('openDrawer').focus({ preventScroll: true });
}
bus.on('drawer', setDrawer);
$('openDrawer').addEventListener('click', () => setDrawer(true));
$('closeDrawer').addEventListener('click', () => setDrawer(false));
$('drawerBackdrop').addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (currentSheet()) { closeSheet(); event.preventDefault(); return; }
  if (drawerOpen) { setDrawer(false); event.preventDefault(); }
});
let swipe = null;
document.addEventListener('touchstart', (event) => {
  if (!profile || live.isActive() || currentSheet()) return;
  const touch = event.touches[0];
  if ((!drawerOpen && touch.clientX <= 28 && app.dataset.screen === 'chat') || drawerOpen) swipe = { x: touch.clientX, y: touch.clientY, t: performance.now() };
}, { passive: true });
document.addEventListener('touchend', (event) => {
  if (!swipe) return;
  const touch = event.changedTouches[0]; const dx = touch.clientX - swipe.x; const dy = Math.abs(touch.clientY - swipe.y);
  const quick = performance.now() - swipe.t < 700; swipe = null;
  if (dy > 80 || !quick) return;
  if (!drawerOpen && dx > 60) { setDrawer(true); haptic(8); }
  else if (drawerOpen && dx < -60) { setDrawer(false); haptic(8); }
}, { passive: true });
document.addEventListener('keydown', (event) => { if (event.key === '[' && profile && !live.isActive() && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setDrawer(!drawerOpen); } });

/* ───────────── Catalog & skill sheet ───────────── */
function renderCatalog() {
  const grid = $('catalogGrid'); grid.replaceChildren();
  const done = new Set(history.map(s => s.skill));
  for (const skill of SKILL_LIST) {
    const card = el('button', 'skill-tile'); card.type = 'button';
    const top = el('div', 'tile-top'); top.append(el('span', 'skill-emoji', skill.emoji));
    const planIndex = prefs.plan.indexOf(skill.id);
    if (planIndex !== -1) top.append(el('span', 'tile-badge', `маршрут ${planIndex + 1}`));
    else if (done.has(skill.id)) { const badge = el('span', 'tile-badge seen'); badge.append(icon('i-check'), document.createTextNode(' было')); top.append(badge); }
    card.append(top, el('b', null, skill.name), el('small', null, `${skill.level} · ${steps(skill.lessons.length)} · ${skill.minutes} мин`), el('p', null, skill.tagline));
    card.addEventListener('click', () => openSkillSheet(skill.id));
    grid.append(card);
  }
}
function openSkillSheet(skillId) {
  const skill = getSkill(skillId); sheetSkillId = skill.id;
  text('skillSheetEmoji', skill.emoji); text('skillSheetName', skill.name);
  text('skillSheetMeta', `${skill.level} · ${steps(skill.lessons.length)} · ${skill.minutes} мин${skill.needsBall ? ' · нужен мяч' : ' · без инвентаря'}`);
  text('skillSheetDesc', skill.description); text('skillSheetCamera', skill.camera);
  const list = $('skillSheetSteps'); list.replaceChildren();
  skill.lessons.forEach(lesson => { const item = el('li'); item.append(el('b', null, lesson.title), el('span', null, lesson.goal)); list.append(item); });
  openSheet('sheetSkill');
}
bus.on('open-skill', openSkillSheet);
$('skillStart').addEventListener('click', () => { closeSheet(); chat.introduceSkill(sheetSkillId); live.startLive({ skillId: sheetSkillId, mode: 'camera' }); });
$('skillDemo').addEventListener('click', () => { closeSheet(); chat.introduceSkill(sheetSkillId); live.startLive({ skillId: sheetSkillId, mode: 'demo' }); });
$('skillFile').addEventListener('click', () => { live.unlockSpeech(); live.ensureAudio(); $('videoFile').click(); });
$('videoFile').addEventListener('change', (event) => { const file = event.target.files[0]; event.target.value = ''; if (!file) return; closeSheet(); chat.introduceSkill(sheetSkillId); live.startLive({ skillId: sheetSkillId, mode: 'file', file }); });
document.querySelector('[data-sheet-backdrop]').addEventListener('click', closeSheet);

/* ───────────── Progress ───────────── */
function renderProgress() {
  const stats = store.historyStats(history);
  text('statTrainings', stats.trainings); text('statMinutes', stats.minutes); text('statStreak', stats.bestStreak); text('statDays', stats.days);
  const list = $('historyList'); list.replaceChildren(); $('clearHistory').disabled = history.length === 0;
  if (!history.length) { list.append(el('p', 'empty', 'Здесь появятся итоги эфиров. Демо в историю не записывается, видео не хранится.')); return; }
  for (const session of history) {
    const skill = getSkill(session.skill);
    const row = el('div', 'history-row');
    row.append(el('span', 'skill-emoji', skill.emoji));
    const copy = el('div');
    copy.append(el('b', null, skill.name), el('small', null, [relativeDate(session.date), formatTime(session.seconds), `${session.metricValue ?? 0} ${session.metricLabel || ''}`, `шагов ${session.lessonsDone}/${session.lessonsTotal}`, session.bestStreak ? `серия ${session.bestStreak}` : ''].filter(Boolean).join(' · ')));
    row.append(copy); list.append(row);
  }
}
$('clearHistory').addEventListener('click', () => { history = []; store.saveHistory(history); renderProgress(); chat.setHistory(history); toast('История очищена'); });

/* ───────────── Profile & settings ───────────── */
function renderProfile() {
  paintAvatar($('profileAvatar'), profile); $('profileNameInput').value = profile.name;
  text('profileSince', `В Aimo с ${new Date(profile.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`);
  renderAvatarPicker($('profileAvatars'), profile.hue, hue => { profile = { ...profile, hue }; store.saveProfile(profile); syncProfile(); });
  renderPersonalities(); applyPreferences();
}
function syncProfile() { paintAvatar($('tabAvatar'), profile); paintAvatar($('profileAvatar'), profile); chat.setProfile(profile); live.setProfile(profile); }
$('profileNameInput').addEventListener('change', () => {
  const name = $('profileNameInput').value.trim(); if (!name) { $('profileNameInput').value = profile.name; return; }
  profile = { ...profile, name }; store.saveProfile(profile); syncProfile(); toast('Имя обновлено');
});
function renderPersonalities() {
  const row = $('personalityRow'); row.replaceChildren();
  for (const p of Object.values(PERSONALITIES)) {
    const chip = el('button', 'persona'); chip.type = 'button'; chip.setAttribute('role', 'radio'); chip.setAttribute('aria-checked', String(p.id === prefs.personality));
    chip.append(el('b', null, p.name), el('small', null, p.description));
    chip.addEventListener('click', () => { prefs.personality = p.id; store.savePrefs(prefs); renderPersonalities(); bus.emit('prefs-changed'); toast(`${p.name} тренер`); });
    row.append(chip);
  }
}
function applyPreferences() {
  for (const key of ['voice', 'skeleton', 'mirror', 'ball', 'sound', 'autoFar', 'liveCoach']) if ($(key + 'Input')) $(key + 'Input').checked = prefs[key];
  document.querySelectorAll('input[name=llmModel]').forEach(radio => { radio.checked = radio.value === prefs.llmModel; });
  $('liveCoachBox').hidden = !prefs.liveCoach;
  live.applyPrefs(); applyTheme();
}
for (const key of ['voice', 'skeleton', 'mirror', 'ball', 'sound', 'autoFar']) $(key + 'Input').addEventListener('change', () => {
  prefs[key] = $(key + 'Input').checked; store.savePrefs(prefs); applyPreferences();
  if (key === 'sound' && prefs.sound) live.ensureAudio();
  if (key === 'voice' && !prefs.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
  if (key === 'ball') live.resetEngine();
});
$('themeSelect').addEventListener('change', () => { prefs.theme = $('themeSelect').value; store.savePrefs(prefs); applyTheme(); });
$('liveCoachInput').addEventListener('change', () => {
  prefs.liveCoach = $('liveCoachInput').checked; store.savePrefs(prefs); applyPreferences();
  if (prefs.liveCoach) ensureLiveCoach().catch(() => {}); else unloadLiveCoach();
});
document.querySelectorAll('input[name=llmModel]').forEach(radio => radio.addEventListener('change', async () => {
  prefs.llmModel = radio.value; store.savePrefs(prefs);
  if (liveCoach || liveCoachPromise) { await unloadLiveCoach(); if (prefs.liveCoach) ensureLiveCoach().catch(() => {}); }
}));
bus.on('prefs-changed', () => { applyPreferences(); if (app.dataset.screen === 'profile') renderPersonalities(); chat.renderStories(); });

/* ───────────── Local LLM ───────────── */
function setLiveCoachStatus(message, progress = null) {
  text('liveCoachStatus', message);
  if (progress !== null) $('liveCoachProgress').style.width = `${Math.round(progress * 100)}%`;
}
async function ensureLiveCoach() {
  if (liveCoach) return liveCoach;
  if (!liveCoachPromise) {
    if (!supportsWebGPU()) { setLiveCoachStatus('В этом браузере нет WebGPU. Живой тренер недоступен, подсказки по правилам работают.'); throw new Error('no-webgpu'); }
    const modelId = LLM_MODELS[prefs.llmModel].id;
    liveCoachPromise = createLocalCoach({ modelId, onStatus: m => setLiveCoachStatus(m), onProgress: ({ progress, text: t }) => setLiveCoachStatus(t || 'Загрузка модели…', progress) })
      .then(coach => { liveCoach = coach; setLiveCoachStatus(`Живой тренер готов · ${LLM_MODELS[prefs.llmModel].label}`, 1); toast('Живой тренер подключён'); return coach; })
      .catch(error => { liveCoachPromise = null; setLiveCoachStatus(error.message || 'Не удалось запустить модель.', 0); prefs.liveCoach = false; store.savePrefs(prefs); applyPreferences(); throw error; });
  }
  return liveCoachPromise;
}
async function unloadLiveCoach() {
  const coach = liveCoach; liveCoach = null; liveCoachPromise = null;
  if (coach) await coach.unload();
  setLiveCoachStatus('Модель выгружена. Включи, чтобы загрузить снова.', 0);
}
window.addEventListener('pagehide', () => { if (liveCoach) { const coach = liveCoach; liveCoach = null; liveCoachPromise = null; coach.unload(); } });
if (!supportsWebGPU()) { $('liveCoachInput').disabled = true; text('liveCoachHint', 'Нужен WebGPU. В этом браузере его нет: подсказки по правилам работают, живой тренер недоступен.'); prefs.liveCoach = false; }

/* ───────────── Live wiring ───────────── */
bus.on('start-live', ({ skillId, mode }) => { closeSheet(); setDrawer(false); live.startLive({ skillId, mode }); });
bus.on('live-started', ({ skillId, mode }) => chat.postSystem(`${mode === 'demo' ? 'Демо' : 'Эфир'} начат · ${getSkill(skillId).name}`));
bus.on('live-finished', (data) => { chat.postSummary(data); if (app.dataset.screen === 'progress') renderProgress(); chat.setHistory(history); });
live.initLive({
  prefs, profile, ensureLiveCoach, getLiveCoach: () => liveCoach,
  onHistory(record) { history = [record, ...history].slice(0, 50); store.saveHistory(history); chat.setHistory(history); },
});
chat.initChat({ prefs, profile, history, ensureLiveCoach, getLiveCoach: () => liveCoach });

/* ───────────── Enter ───────────── */
function enterApp() {
  syncProfile(); applyPreferences(); renderCatalog();
  chat.setHistory(history); chat.openFresh();
  showScreen('chat');
}
applyTheme();
if (profile) enterApp(); else { app.dataset.screen = 'login'; setTimeout(() => $('loginName').focus(), 100); }
