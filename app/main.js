// Bootstrap: local profile gate, screens and tabs, chat drawer with swipe,
// skill sheet, progress and profile screens. Wires chat.js and live.js together.
import { SKILL_LIST, getSkill, PERSONALITIES, CATEGORIES } from '../skills/index.js';
import { createLocalCoach, hasCachedModel, supportsWebGPU, LLM_MODELS } from '../coach-llm.js';
import { pluralize } from '../coach-planner.js';
import { compareProgress } from '../coach-progress.js';
import { $, text, el, icon, toast, haptic, bus, formatTime, relativeDate, openSheet, closeSheet, currentSheet, paintAvatar } from './ui.js';
import * as store from './store.js';
import * as chat from './chat.js';
import * as live from './live.js';
import { createModelManager } from './model-manager.js';
import { russianVoices, voiceKey } from './speech.js';
import { LOCAL_VOICES, localVoice } from './voice-models.js';
import { trainerAudio } from './trainer-audio.js';
import { initViewport } from './viewport.js';
import { metricPhrase } from '../coach-talk.js';

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

/* ───────────── Viewport & keyboard ───────────── */
initViewport({
  onChange({ keyboard }) {
    const value = keyboard ? 'open' : 'closed';
    if (app.dataset.keyboard !== value) { app.dataset.keyboard = value; bus.emit('keyboard', keyboard); }
  },
});

/* ───────────── Theme ───────────── */
const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')];
function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme; $('themeSelect').value = prefs.theme;
  // The browser bar follows the chosen theme, not only the system one.
  for (const meta of themeMetas) {
    const systemDark = (meta.getAttribute('media') || '').includes('dark');
    const dark = prefs.theme === 'system' ? systemDark : prefs.theme === 'dark';
    meta.setAttribute('content', dark ? '#242526' : '#ffffff');
  }
}

/* ───────────── Screens & tabs ───────────── */
function showScreen(name) {
  app.dataset.screen = name;
  document.querySelectorAll('.tab[data-tab]').forEach(tab => { if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); });
  if (name === 'progress') renderProgress();
  if (name === 'profile') { renderProfile(); modelManager.refresh(); trainerAudio.refresh(); }
  if (name === 'catalog') renderCatalog();
  if (name !== 'chat') document.querySelector(`.screen-${name}`)?.scrollTo({ top: 0 });
  if (drawerOpen) setDrawer(false, { focus: false });
}
document.querySelectorAll('.tab[data-tab]').forEach(tab => tab.addEventListener('click', () => {
  haptic(6);
  if (tab.dataset.tab === 'live') { openSkillSheet(prefs.skill); return; }
  if (tab.dataset.tab === app.dataset.screen) { document.querySelector(`.screen-${app.dataset.screen === 'chat' ? 'chat .chat-list' : app.dataset.screen}`)?.scrollTo({ top: app.dataset.screen === 'chat' ? 1e9 : 0, behavior: 'smooth' }); return; }
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
function submitLogin(event) {
  event?.preventDefault();
  const name = $('loginName').value.trim();
  if (!name) { $('loginName').focus(); return; }
  profile = store.sanitizeProfile({ name, hue: loginHue, createdAt: new Date().toISOString() });
  store.saveProfile(profile); enterApp(); toast(`Добро пожаловать, ${profile.name}!`);
}
$('loginForm').addEventListener('submit', submitLogin);
$('loginSubmit').addEventListener('click', submitLogin);
$('logoutBtn').addEventListener('click', () => {
  store.clearProfile(); profile = null; app.dataset.screen = 'login'; $('loginName').value = '';
  toast('Ты вышел. Чаты и история остались на этом устройстве.');
});

/* ───────────── Drawer: chat history, swipe right anywhere on the chat ───────────── */
const drawerEl = $('drawer');
const backdropEl = $('drawerBackdrop');
let drawerOpen = false;
function setDrawer(open, { focus = true } = {}) {
  const changed = open !== drawerOpen;
  drawerOpen = open; app.dataset.drawer = open ? 'open' : 'closed';
  drawerEl.inert = !open; $('openDrawer').setAttribute('aria-expanded', String(open));
  if (open) chat.renderDrawer();
  if (changed && focus) (open ? $('closeDrawer') : $('openDrawer')).focus({ preventScroll: true });
}
setDrawer(false, { focus: false });
bus.on('drawer', (open) => setDrawer(open));
$('openDrawer').addEventListener('click', () => setDrawer(true));
$('closeDrawer').addEventListener('click', () => setDrawer(false));
backdropEl.addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (currentSheet()) { closeSheet(); event.preventDefault(); return; }
  if (drawerOpen) { setDrawer(false); event.preventDefault(); }
});

// The panel follows the finger. Opening starts anywhere on the chat except rows that
// scroll sideways (stories, chips) and the composer, which also keeps clear of the
// iOS back gesture at the very edge of the screen.
const NO_SWIPE = '.stories, .chips, .composer, input, select, textarea';
let drag = null;
document.addEventListener('touchstart', (event) => {
  if (!profile || live.isActive() || currentSheet() || event.touches.length !== 1) { drag = null; return; }
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const fromChat = !drawerOpen && app.dataset.screen === 'chat' && target.closest('.screen-chat') && !target.closest(NO_SWIPE);
  const fromDrawer = drawerOpen && (target.closest('#drawer') || target === backdropEl);
  if (!fromChat && !fromDrawer) { drag = null; return; }
  const touch = event.touches[0]; const now = performance.now();
  drag = { x: touch.clientX, y: touch.clientY, open: drawerOpen, axis: null, progress: drawerOpen ? 1 : 0, lastX: touch.clientX, lastT: now, velocity: 0 };
}, { passive: true });
document.addEventListener('touchmove', (event) => {
  if (!drag) return;
  const touch = event.touches[0]; const dx = touch.clientX - drag.x; const dy = touch.clientY - drag.y;
  if (!drag.axis) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    const sideways = Math.abs(dx) > Math.abs(dy) * 1.3 && (drag.open ? dx < 0 : dx > 0);
    if (!sideways) { drag = null; return; }
    drag.axis = 'x'; app.classList.add('drawer-dragging'); if (!drag.open) chat.renderDrawer();
  }
  const now = performance.now();
  drag.velocity = (touch.clientX - drag.lastX) / Math.max(1, now - drag.lastT); drag.lastX = touch.clientX; drag.lastT = now;
  const width = drawerEl.offsetWidth || 300;
  drag.progress = Math.min(1, Math.max(0, (drag.open ? 1 : 0) + dx / width));
  drawerEl.style.transform = `translateX(${((drag.progress - 1) * 100).toFixed(2)}%)`;
  backdropEl.style.opacity = drag.progress.toFixed(3);
}, { passive: true });
function endDrag() {
  const finished = drag; drag = null;
  if (!finished || finished.axis !== 'x') return;
  const open = finished.velocity > 0.45 ? true : finished.velocity < -0.45 ? false : finished.progress > 0.4;
  app.classList.remove('drawer-dragging'); drawerEl.style.transform = ''; backdropEl.style.opacity = '';
  if (open !== drawerOpen) haptic(8);
  setDrawer(open, { focus: false });
}
document.addEventListener('touchend', endDrag, { passive: true });
document.addEventListener('touchcancel', endDrag, { passive: true });
document.addEventListener('keydown', (event) => { if (event.key === '[' && profile && !live.isActive() && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setDrawer(!drawerOpen); } });

/* ───────────── Catalog & skill sheet ───────────── */
// Catalog: one section per category, a plain tile per skill (emoji, name, length).
function renderCatalog() {
  const root = $('catalogGrid'); root.replaceChildren();
  const done = new Set(history.map(s => s.skill));
  for (const category of CATEGORIES) {
    const skills = SKILL_LIST.filter(skill => skill.category === category.id);
    if (!skills.length) continue;
    const section = el('section', 'catalog-section');
    const head = el('div', 'catalog-head'); head.append(el('h3', null, category.name), el('small', null, category.note));
    const grid = el('div', 'catalog-grid');
    for (const skill of skills) {
      const card = el('button', 'skill-tile'); card.type = 'button';
      const top = el('div', 'tile-top'); top.append(el('span', 'skill-emoji', skill.emoji));
      const planIndex = prefs.plan.indexOf(skill.id);
      if (planIndex !== -1) top.append(el('span', 'tile-badge', `маршрут ${planIndex + 1}`));
      else if (done.has(skill.id)) { const badge = el('span', 'tile-badge seen'); badge.setAttribute('aria-label', 'уже тренировался'); badge.append(icon('i-check')); top.append(badge); }
      card.append(top, el('b', null, skill.name), el('small', null, `${steps(skill.lessons.length)} · ${skill.minutes} мин${skill.needsBall ? ' · мяч' : ''}`));
      card.addEventListener('click', () => openSkillSheet(skill.id));
      grid.append(card);
    }
    section.append(head, grid); root.append(section);
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
  const tail = (n, forms) => pluralize(n, forms).split(' ').slice(1).join(' ');
  text('statTrainings', stats.trainings); text('statTrainingsLabel', tail(stats.trainings, ['тренировка', 'тренировки', 'тренировок']));
  text('statMinutes', stats.minutes); text('statMinutesLabel', tail(stats.minutes, ['минута', 'минуты', 'минут']));
  text('statDays', stats.days); text('statDaysLabel', `${tail(stats.days, ['день', 'дня', 'дней'])} подряд`);
  const list = $('historyList'); list.replaceChildren(); $('clearHistory').disabled = history.length === 0;
  if (!history.length) { list.append(el('p', 'empty', 'Здесь появятся итоги эфиров. Демо в историю не записывается, видео не хранится.')); return; }
  for (const [index, session] of history.entries()) {
    const skill = getSkill(session.skill);
    const row = el('div', 'history-row');
    row.append(el('span', 'skill-emoji', skill.emoji));
    const copy = el('div');
    copy.append(el('b', null, skill.name), el('small', null, [relativeDate(session.date), formatTime(session.seconds), metricPhrase(session.metricValue ?? session.movements ?? 0, session.metricLabel || ''), session.source === 'camera' ? 'Камера' : session.source === 'file' ? 'Видео' : 'Источник не указан', `шагов ${session.lessonsDone}/${session.lessonsTotal}`, session.bestStreak ? `серия ${session.bestStreak}` : ''].filter(Boolean).join(' · ')));
    const progress = compareProgress(session, history.filter((_, otherIndex) => otherIndex !== index));
    copy.append(el('p', `history-progress${progress?.isNewBest ? ' is-best' : ''}`, progress ? progress.text : 'Для этой записи сравнение недоступно.'));
    row.append(copy); list.append(row);
  }
  list.append(el('p', 'history-note', 'Сравниваются тренировки одного навыка и источника, до 50 последних.'));
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
    const chip = el('button', 'segment', p.name); chip.type = 'button'; chip.setAttribute('role', 'radio'); chip.setAttribute('aria-checked', String(p.id === prefs.personality));
    chip.addEventListener('click', () => { prefs.personality = p.id; store.savePrefs(prefs); renderPersonalities(); bus.emit('prefs-changed'); });
    row.append(chip);
  }
  text('personalityNote', PERSONALITIES[prefs.personality].description);
}
function applyPreferences() {
  for (const key of ['voice', 'skeleton', 'mirror', 'objects', 'sound', 'autoFar']) if ($(key + 'Input')) $(key + 'Input').checked = prefs[key];
  document.querySelectorAll('input[name=llmModel]').forEach(radio => { radio.checked = radio.value === prefs.llmModel; });
  live.applyPrefs(); applyTheme();
}
for (const key of ['voice', 'skeleton', 'mirror', 'objects', 'sound', 'autoFar']) $(key + 'Input').addEventListener('change', () => {
  prefs[key] = $(key + 'Input').checked; store.savePrefs(prefs); applyPreferences();
  if (key === 'sound' && prefs.sound) live.ensureAudio();
  if (key === 'voice' && !prefs.voice) trainerAudio.cancel();
  if (key === 'objects') live.resetEngine();
});
$('themeSelect').addEventListener('change', () => { prefs.theme = $('themeSelect').value; store.savePrefs(prefs); applyTheme(); });
document.querySelectorAll('input[name=llmModel]').forEach(radio => radio.addEventListener('change', async () => {
  prefs.llmModel = radio.value; store.savePrefs(prefs);
  await unloadLiveCoach(); if (prefs.liveCoach) ensureLiveCoach().catch(() => {});
}));
bus.on('prefs-changed', () => { applyPreferences(); if (app.dataset.screen === 'profile') renderPersonalities(); chat.renderHeader(); });

/* ───────────── Local LLM ───────────── */
function renderModels() {
  for (const [key, info] of Object.entries(modelManager.states)) {
    const button = document.querySelector(`[data-download-model="${key}"]`);
    const ready = info.status === 'cached';
    if (ready && !prefs.liveCoach) { prefs.liveCoach = true; store.savePrefs(prefs); }
    button.textContent = ready ? 'Скачана' : info.status === 'loading' ? 'Загружается…' : 'Скачать';
    button.dataset.ready = String(ready);
    button.disabled = ready || modelManager.busy || trainerAudio.downloading || info.status === 'checking' || !supportsWebGPU() || live.isActive();
    button.setAttribute('aria-label', `${ready ? 'Скачана' : 'Скачать'} ${LLM_MODELS[key].label}`);
    text(`modelStatus-${key}`, !supportsWebGPU() ? 'Для скачивания и запуска нужен WebGPU' : info.message);
    const bar = $(`modelProgress-${key}`); bar.hidden = info.status !== 'loading'; bar.value = info.progress;
  }
  $('cancelModelDownload').hidden = !modelManager.downloading;
  renderLocalVoiceControls();
}
document.querySelectorAll('[data-download-model]').forEach(button => button.addEventListener('click', async () => {
  const key = button.dataset.downloadModel;
  text('liveCoachStatus', `Скачиваем ${LLM_MODELS[key].label}. Можно отменить загрузку.`);
  try { await modelManager.download(key); text('liveCoachStatus', `${LLM_MODELS[key].label} скачана. Она будет использоваться в эфире и чате.`); }
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
window.addEventListener('pagehide', () => { liveStartRequest++; modelManager.dispose(); trainerAudio.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) { modelManager = makeModelManager(); renderModels(); } });
if (!supportsWebGPU()) text('liveCoachStatus', 'Для локальной модели нужен WebGPU. Подсказки по правилам работают без неё.');

/* ───────────── Trainer voice ───────────── */
function renderVoiceOptions() {
  const select = $('coachVoiceSelect'); select.replaceChildren(el('option', null, 'Автоматически · русский'));
  select.options[0].value = '';
  const local = el('optgroup'); local.label = 'Скачиваемые голоса · на устройстве';
  for (const voice of LOCAL_VOICES) { const option = el('option', null, `${voice.name} · ${voice.description}`); option.value = voice.id; local.append(option); }
  select.append(local);
  const system = el('optgroup'); system.label = 'Голоса браузера и системы';
  const voices = russianVoices(window.speechSynthesis?.getVoices() || []);
  for (const voice of voices) { const option = el('option', null, `${voice.name}${voice.localService ? '' : ' · онлайн'}`); option.value = voiceKey(voice); system.append(option); }
  if (voices.length) select.append(system);
  select.value = localVoice(prefs.voiceId) || voices.some(v => voiceKey(v) === prefs.voiceId) ? prefs.voiceId : '';
  text('voiceHint', 'Денис и Дмитрий звучат на устройстве после скачивания');
  renderLocalVoiceControls();
}
function renderLocalVoiceControls() {
  const voice = localVoice(prefs.voiceId), state = voice && trainerAudio.states[voice.id];
  $('coachVoiceSelect').disabled = trainerAudio.downloading;
  const button = $('downloadCoachVoice'), ready = state?.status === 'cached';
  button.hidden = !voice;
  button.textContent = ready ? 'Голос скачан' : state?.status === 'downloading' ? 'Скачивается…' : 'Скачать голос · 63 МБ';
  button.dataset.ready = String(ready);
  button.disabled = ready || trainerAudio.downloading || modelManager.busy || live.isActive() || !trainerAudio.supported || state?.status === 'unknown';
  $('previewCoachVoice').disabled = voice ? !ready || trainerAudio.downloading : !window.speechSynthesis;
  $('cancelVoiceDownload').hidden = !trainerAudio.downloading;
  const bar = $('voiceDownloadProgress'); bar.hidden = !trainerAudio.downloading; bar.value = state?.progress || 0;
  const message = trainerAudio.statusVoiceId === prefs.voiceId ? trainerAudio.status : '';
  text('voiceDownloadStatus', voice && !trainerAudio.supported ? 'Для скачиваемых голосов нужен браузер с локальным хранилищем и Web Audio. Выбери системный голос.' : message || (ready ? 'Голос скачан. Нажми «Прослушать голос», чтобы выбрать звучание.' : voice ? 'Один раз скачай голос. При первом запуске также загрузится модуль озвучивания.' : 'Выбранный голос озвучивает подсказки и ответы в эфире.'));
}
trainerAudio.onChange(() => { renderLocalVoiceControls(); renderModels(); });
$('coachVoiceSelect').addEventListener('change', () => { trainerAudio.release(); prefs.voiceId = $('coachVoiceSelect').value; store.savePrefs(prefs); renderLocalVoiceControls(); trainerAudio.refresh(); });
$('downloadCoachVoice').addEventListener('click', async () => {
  if (modelManager.busy || live.isActive()) return;
  try { await trainerAudio.downloadVoice(prefs.voiceId); } catch (error) { if (error.name !== 'AbortError') toast(error.message); }
});
$('cancelVoiceDownload').addEventListener('click', () => trainerAudio.cancelDownload());
$('previewCoachVoice').addEventListener('click', () => {
  trainerAudio.unlock();
  trainerAudio.speak('Привет! Давай потренируемся вместе. Не спеши, держи равновесие. У тебя всё получится.', prefs, PERSONALITIES[prefs.personality]);
});
window.speechSynthesis?.addEventListener('voiceschanged', renderVoiceOptions);
renderVoiceOptions(); renderModels(); trainerAudio.refresh();

/* ───────────── Live wiring ───────────── */
async function startSession(options) {
  live.unlockSpeech(); live.ensureAudio();
  const request = ++liveStartRequest; closeSheet(); setDrawer(false);
  await trainerAudio.cancelDownload(); if (request !== liveStartRequest) return;
  if (modelManager.downloading) { await modelManager.cancelDownload(); toast('Скачивание остановлено: анализ движений важнее.'); }
  await modelManager.release(); if (request !== liveStartRequest) return;
  live.startLive(options);
}
bus.on('start-live', startSession);
bus.on('gesture', () => { live.unlockSpeech(); live.ensureAudio(); });
bus.on('live-final-text', data => chat.attachLiveText(data.live));
bus.on('live-failed', () => chat.postSystem('Эфир не запустился'));
bus.on('live-cancelled', () => chat.postSystem('Эфир отменён'));
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

/* ───────────── Coming back after a break opens a new chat ───────────── */
const NEW_CHAT_AFTER_MS = 30 * 60 * 1000;
let hiddenAt = 0;
function comeBack() {
  const away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0;
  if (!profile || live.isActive() || away < NEW_CHAT_AFTER_MS) return;
  closeSheet(); setDrawer(false, { focus: false }); chat.openFresh(); showScreen('chat');
}
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else comeBack(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) comeBack(); });

/* ───────────── Enter ───────────── */
function enterApp() {
  syncProfile(); applyPreferences(); renderCatalog();
  chat.setHistory(history); chat.openFresh();
  showScreen('chat');
}
/* ───────────── Offline ───────────── */
// After the first visit the app and the vision models work without a network (sw.js).
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.addEventListener('offline', () => toast('Нет сети: тренер продолжает работать на устройстве'));
window.addEventListener('online', () => toast('Сеть снова есть'));

applyTheme();
if (profile) enterApp(); else { app.dataset.screen = 'login'; setTimeout(() => $('loginName').focus(), 100); }
