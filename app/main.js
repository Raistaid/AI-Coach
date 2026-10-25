// Bootstrap: local profile gate, screens and tabs, chat drawer with swipe,
// skill sheet, progress and profile screens. Wires chat.js and live.js together.
import { SKILL_LIST, getSkill, PERSONALITIES } from '../skills/index.js';
import { createLocalCoach, hasCachedModel, supportsWebGPU, LLM_MODELS } from '../coach-llm.js';
import { pluralize } from '../coach-planner.js';
import { compareProgress } from '../coach-progress.js';
import { $, text, el, icon, toast, haptic, bus, formatTime, relativeDate, openSheet, closeSheet, currentSheet, paintAvatar } from './ui.js';
import * as store from './store.js';
import * as chat from './chat.js';
import * as live from './live.js';
import { createModelManager } from './model-manager.js';
import { russianVoices, voiceKey, configureUtterance } from './speech.js';

store.migrateLegacyKeys();
const app = $('app');
const prefs = store.loadPrefs();
let profile = store.loadProfile();
let history = store.loadHistory();
const makeModelManager = () => createModelManager({ models: LLM_MODELS, load: createLocalCoach, hasCached: hasCachedModel, canLoad: supportsWebGPU, isLive: live.isActive, onChange: renderModels });
let modelManager = makeModelManager();
let liveStartRequest = 0;
let sheetSkillId = null;
const steps = (n) => pluralize(n, ['шаг', 'шага', 'шагов']);

/* ───────────── Theme ───────────── */
function applyTheme() { document.documentElement.dataset.theme = prefs.theme; $('themeSelect').value = prefs.theme; }

/* ───────────── Screens & tabs ───────────── */
function showScreen(name) {
  app.dataset.screen = name;
  document.querySelectorAll('.tab[data-tab]').forEach(tab => { if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); });
  if (name === 'progress') renderProgress();
  if (name === 'profile') { renderProfile(); modelManager.refresh(); }
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
$('skillStart').addEventListener('click', () => { closeSheet(); chat.introduceSkill(sheetSkillId); startSession({ skillId: sheetSkillId, mode: 'camera' }); });
$('skillDemo').addEventListener('click', () => { closeSheet(); chat.introduceSkill(sheetSkillId); startSession({ skillId: sheetSkillId, mode: 'demo' }); });
$('skillFile').addEventListener('click', () => { live.unlockSpeech(); live.ensureAudio(); $('videoFile').click(); });
$('videoFile').addEventListener('change', (event) => { const file = event.target.files[0]; event.target.value = ''; if (!file) return; closeSheet(); chat.introduceSkill(sheetSkillId); startSession({ skillId: sheetSkillId, mode: 'file', file }); });
document.querySelector('[data-sheet-backdrop]').addEventListener('click', closeSheet);

/* ───────────── Progress ───────────── */
function renderProgress() {
  const stats = store.historyStats(history);
  text('statTrainings', stats.trainings); text('statMinutes', stats.minutes); text('statStreak', stats.bestStreak); text('statDays', stats.days);
  const list = $('historyList'); list.replaceChildren(); $('clearHistory').disabled = history.length === 0;
  if (!history.length) { list.append(el('p', 'empty', 'Здесь появятся итоги эфиров. Демо в историю не записывается, видео не хранится.')); return; }
  for (const [index, session] of history.entries()) {
    const skill = getSkill(session.skill);
    const row = el('div', 'history-row');
    row.append(el('span', 'skill-emoji', skill.emoji));
    const copy = el('div');
    copy.append(el('b', null, skill.name), el('small', null, [relativeDate(session.date), formatTime(session.seconds), `${session.metricValue ?? session.movements ?? 0} ${session.metricLabel || ''}`, session.source === 'camera' ? 'Камера' : session.source === 'file' ? 'Видео' : 'Источник не указан', `шагов ${session.lessonsDone}/${session.lessonsTotal}`, session.bestStreak ? `серия ${session.bestStreak}` : ''].filter(Boolean).join(' · ')));
    const progress = compareProgress(session, history.filter((_, otherIndex) => otherIndex !== index));
    copy.append(el('p', `history-progress${progress?.isNewBest ? ' is-best' : ''}`, progress ? progress.text : 'Для этой записи сравнение недоступно.'));
    row.append(copy); list.append(row);
  }
  list.append(el('p', 'history-note', 'Сравнение по последним 50 сохранённым тренировкам: отдельно для каждого навыка, показателя и источника. Количество движений не оценивает качество техники.'));
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
  for (const key of ['voice', 'skeleton', 'mirror', 'objects', 'sound', 'autoFar', 'liveCoach']) if ($(key + 'Input')) $(key + 'Input').checked = prefs[key];
  document.querySelectorAll('input[name=llmModel]').forEach(radio => { radio.checked = radio.value === prefs.llmModel; });
  live.applyPrefs(); applyTheme();
}
for (const key of ['voice', 'skeleton', 'mirror', 'objects', 'sound', 'autoFar']) $(key + 'Input').addEventListener('change', () => {
  prefs[key] = $(key + 'Input').checked; store.savePrefs(prefs); applyPreferences();
  if (key === 'sound' && prefs.sound) live.ensureAudio();
  if (key === 'voice' && !prefs.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
  if (key === 'objects') live.resetEngine();
});
$('themeSelect').addEventListener('change', () => { prefs.theme = $('themeSelect').value; store.savePrefs(prefs); applyTheme(); });
$('liveCoachInput').addEventListener('change', () => {
  prefs.liveCoach = $('liveCoachInput').checked; store.savePrefs(prefs); applyPreferences();
  if (prefs.liveCoach) ensureLiveCoach().catch(() => {}); else unloadLiveCoach();
});
document.querySelectorAll('input[name=llmModel]').forEach(radio => radio.addEventListener('change', async () => {
  prefs.llmModel = radio.value; store.savePrefs(prefs);
  await unloadLiveCoach(); if (prefs.liveCoach) ensureLiveCoach().catch(() => {});
}));
bus.on('prefs-changed', () => { applyPreferences(); if (app.dataset.screen === 'profile') renderPersonalities(); chat.renderStories(); });

/* ───────────── Local LLM ───────────── */
function renderModels() {
  for (const [key, info] of Object.entries(modelManager.states)) {
    const button = document.querySelector(`[data-download-model="${key}"]`);
    const ready = info.status === 'cached';
    button.textContent = ready ? 'Скачана' : info.status === 'loading' ? 'Загружается…' : 'Скачать';
    button.dataset.ready = String(ready);
    button.disabled = ready || modelManager.busy || info.status === 'checking' || !supportsWebGPU() || live.isActive();
    button.setAttribute('aria-label', `${ready ? 'Скачана' : 'Скачать'} ${LLM_MODELS[key].label}`);
    text(`modelStatus-${key}`, !supportsWebGPU() ? 'Для скачивания и запуска нужен WebGPU' : info.message);
    const bar = $(`modelProgress-${key}`); bar.hidden = info.status !== 'loading'; bar.value = info.progress;
  }
  $('cancelModelDownload').hidden = !modelManager.downloading;
}
document.querySelectorAll('[data-download-model]').forEach(button => button.addEventListener('click', async () => {
  const key = button.dataset.downloadModel;
  text('liveCoachStatus', `Скачиваем ${LLM_MODELS[key].label}. Можно отменить загрузку.`);
  try { await modelManager.download(key); text('liveCoachStatus', `${LLM_MODELS[key].label} скачана. Её можно выбрать и включить живого тренера.`); }
  catch (error) { if (error.name !== 'AbortError') { text('liveCoachStatus', error.message); toast(error.message); } }
}));
$('cancelModelDownload').addEventListener('click', async () => { await modelManager.cancelDownload(); text('liveCoachStatus', 'Скачивание отменено.'); modelManager.refresh(); });
async function ensureLiveCoach() {
  try {
    const coach = await modelManager.activate(prefs.llmModel);
    text('liveCoachStatus', `Живой тренер готов · ${LLM_MODELS[prefs.llmModel].label}`);
    return coach;
  } catch (error) {
    if (error.name !== 'AbortError') {
      text('liveCoachStatus', error.message || 'Не удалось запустить модель.');
      if (!modelManager.downloading) { prefs.liveCoach = false; store.savePrefs(prefs); applyPreferences(); }
    }
    throw error;
  }
}
async function unloadLiveCoach() {
  await modelManager.release();
  text('liveCoachStatus', 'Модель выгружена из памяти. Скачанные файлы остаются в кеше.');
}
window.addEventListener('pagehide', () => { liveStartRequest++; modelManager.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) { modelManager = makeModelManager(); renderModels(); } });
if (!supportsWebGPU()) { $('liveCoachInput').disabled = true; text('liveCoachHint', 'Нужен WebGPU. В этом браузере его нет: подсказки по правилам работают, живой тренер недоступен.'); prefs.liveCoach = false; }

/* ───────────── Trainer voice ───────────── */
function renderVoiceOptions() {
  const select = $('coachVoiceSelect'); select.replaceChildren(el('option', null, 'Автоматически · русский'));
  select.options[0].value = '';
  const supported = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  const voices = russianVoices(window.speechSynthesis?.getVoices() || []);
  for (const voice of voices) { const option = el('option', null, `${voice.name}${voice.localService ? '' : ' · онлайн'}`); option.value = voiceKey(voice); select.append(option); }
  select.value = voices.some(v => voiceKey(v) === prefs.voiceId) ? prefs.voiceId : '';
  select.disabled = !supported; $('previewCoachVoice').disabled = !supported;
  text('voiceHint', !supported ? 'Озвучивание недоступно в этом браузере' : voices.length ? 'Русские голоса браузера и системы; выбранный голос сохраняется на устройстве' : 'Русские голоса пока не найдены. Используется голос системы; можно установить русский голос в настройках устройства.');
}
$('coachVoiceSelect').addEventListener('change', () => { prefs.voiceId = $('coachVoiceSelect').value; store.savePrefs(prefs); });
$('previewCoachVoice').addEventListener('click', () => {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  speechSynthesis.cancel();
  const utterance = configureUtterance(new SpeechSynthesisUtterance('Готов к тренировке. Я буду подсказывать по ходу эфира.'), prefs, PERSONALITIES[prefs.personality], speechSynthesis.getVoices());
  speechSynthesis.speak(utterance);
});
window.speechSynthesis?.addEventListener('voiceschanged', renderVoiceOptions);
renderVoiceOptions(); renderModels();

/* ───────────── Live wiring ───────────── */
async function startSession(options) {
  live.unlockSpeech(); live.ensureAudio();
  const request = ++liveStartRequest; closeSheet(); setDrawer(false);
  if (modelManager.downloading) { await modelManager.cancelDownload(); toast('Скачивание остановлено: анализ движений важнее.'); }
  await modelManager.release(); if (request !== liveStartRequest) return;
  live.startLive(options);
}
bus.on('start-live', startSession);
bus.on('live-started', ({ skillId, mode }) => chat.postSystem(`${mode === 'demo' ? 'Демо' : 'Эфир'} начат · ${getSkill(skillId).name}`));
bus.on('live-finished', (data) => { chat.postSummary(data); if (app.dataset.screen === 'progress') renderProgress(); chat.setHistory(history); renderModels(); });
live.initLive({
  prefs, profile, ensureLiveCoach, getLiveCoach: () => modelManager.loaded,
  async releaseCoach(coach) { if (!live.isActive() && (!coach || modelManager.loaded === coach)) await unloadLiveCoach(); },
  onHistory(record) {
    const progress = compareProgress(record, history.slice(0, 49));
    history = [record, ...history].slice(0, 50); store.saveHistory(history); chat.setHistory(history);
    return progress;
  },
});
chat.initChat({ prefs, profile, history, ensureLiveCoach, getLiveCoach: () => modelManager.loaded });

/* ───────────── Enter ───────────── */
function enterApp() {
  syncProfile(); applyPreferences(); renderCatalog();
  chat.setHistory(history); chat.openFresh();
  showScreen('chat');
}
applyTheme();
if (profile) enterApp(); else { app.dataset.screen = 'login'; setTimeout(() => $('loginName').focus(), 100); }
