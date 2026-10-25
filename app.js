import { createCoachEngine, observePose, trackBall, createSession, stepSession, describeLesson, createPoseState, createBallState, mainMistake, farModeDecision, POSE_CONNECTIONS } from './coach-engine.js';
import { SKILL_LIST, getSkill, PERSONALITIES, personalityId } from './skills/index.js';
import { createLocalCoach, buildSummary, supportsWebGPU, LLM_MODELS } from './coach-llm.js';
import { keywordPlan, buildPlannerMessages, parsePlan, planReplyText, nextInPlan, pluralize } from './coach-planner.js';

const $ = id => document.getElementById(id);
const app = $('app');
const video = $('cameraVideo');
const overlay = $('poseCanvas');
const demoCanvas = $('demoCanvas');
const stage = document.querySelector('.video-stage');
const storage = {
  read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can restrict storage. */ } },
};

/* ───────────── Sidebar (unchanged behaviour) ───────────── */
const sidebarQuery = matchMedia('(max-width: 900px)');
let sidebarOpen = false;
function setSidebar(open, { persist = true, focus = true } = {}) {
  sidebarOpen = open;
  const sidebar = $('sidebar');
  sidebar.hidden = !open;
  sidebar.inert = !open;
  app.dataset.sidebar = open ? 'open' : 'closed';
  $('openSidebar').hidden = open && !sidebarQuery.matches;
  $('openSidebar').setAttribute('aria-expanded', String(open));
  $('sidebarBackdrop').hidden = !open || !sidebarQuery.matches;
  $('training').inert = open && sidebarQuery.matches;
  document.body.classList.toggle('menu-open', open && sidebarQuery.matches);
  if (open && sidebarQuery.matches) { sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true'); }
  else { sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal'); }
  if (persist && !sidebarQuery.matches) storage.write('ai-coach:sidebar-collapsed', !open);
  if (focus) (open ? $('closeSidebar') : $('openSidebar')).focus();
}
$('openSidebar').addEventListener('click', () => setSidebar(true));
$('closeSidebar').addEventListener('click', () => setSidebar(false));
$('sidebarBackdrop').addEventListener('click', () => setSidebar(false));
$('sidebar').querySelectorAll('a').forEach(link => link.addEventListener('click', () => { if (sidebarQuery.matches) setSidebar(false); }));
document.addEventListener('keydown', event => {
  if (!sidebarOpen) return;
  if (event.key === 'Escape') { event.preventDefault(); setSidebar(false); }
  if (event.key === 'Tab' && sidebarQuery.matches) {
    const controls = [...$('sidebar').querySelectorAll('a[href],button:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
sidebarQuery.addEventListener('change', () => setSidebar(!sidebarQuery.matches && !storage.read('ai-coach:sidebar-collapsed', false), { persist: false, focus: false }));
setSidebar(!sidebarQuery.matches && !storage.read('ai-coach:sidebar-collapsed', false), { persist: false, focus: false });

/* ───────────── State ───────────── */
const cueLabels = {
  'no-person': 'Камера', 'show-feet': 'Положение в кадре', 'lesson-intro': 'Шаг урока', 'lesson-complete': 'Шаг выполнен', 'course-complete': 'Урок пройден',
  'ball-drop': 'Мяч упал', 'ball-streak': 'Серия', 'ball-touch': 'Касание', 'lift-high': 'Высота стопы', 'support-knee': 'Опорная нога', torso: 'Положение корпуса',
  'arms-closed': 'Руки', 'ball-side': 'Направление удара', 'ball-missing': 'Мяч', 'lift-done': 'Подъём стопы', start: 'Начало',
  'squat-complete': 'Повтор', 'squat-torso': 'Положение корпуса', 'squat-rise': 'Движение', 'squat-camera': 'Ракурс',
  'balance-align': 'Равновесие', 'balance-hold': 'Баланс', 'balance-start': 'Начало', live: 'Живой тренер',
};
const mistakeAdvice = {
  'lift-high': ['Стопа поднималась выше колена', 'Делай удар короче: мяч до пояса, стопа не выше колена.'],
  'support-knee': ['Опорная нога была прямой', 'Чуть сгибай опорное колено, оно гасит качание.'],
  torso: ['Корпус заваливался', 'Держи плечи над тазом и смотри на мяч.'],
  'arms-closed': ['Руки прижаты к телу', 'Разводи руки в стороны, это балансир.'],
  'ball-side': ['Мяч уходил в сторону', 'Бей серединой подъёма, носок на себя.'],
  'ball-drop': ['Частые потери мяча', 'Начинай с одного касания и ловли, потом серии.'],
  'ball-missing': ['Мяч часто не был виден', 'Больше света и мяч перед собой, ближе к центру кадра.'],
  'squat-torso': ['Наклон корпуса в приседе', 'Меньше глубина, грудь вперёд, пятки на полу.'],
  'squat-rise': ['Задержка в нижней точке', 'Поднимайся плавно сразу после сгибания.'],
  'balance-align': ['Наклон корпуса при балансе', 'Найди точку перед собой, плечи ровно.'],
};
const saved = storage.read('ai-coach:preferences', {});
const prefs = { voice: true, skeleton: true, mirror: false, ball: true, sound: true, autoFar: true, liveCoach: false, llmModel: 'default', skill: 'football', personality: 'calm', ...saved };
if (!getSkill(prefs.skill) || getSkill(prefs.skill).id !== prefs.skill) prefs.skill = 'football';
prefs.personality = personalityId(prefs.personality);
if (!LLM_MODELS[prefs.llmModel]) prefs.llmModel = 'default';
prefs.plan = Array.isArray(prefs.plan) ? prefs.plan.filter(id => SKILL_LIST.some(k => k.id === id)).slice(0, 3) : [];
prefs.planGoal = typeof prefs.planGoal === 'string' ? prefs.planGoal.slice(0, 200) : '';
const plannerHistory = [];
let history = storage.read('ai-coach:sessions', []);
if (!Array.isArray(history)) history = [];
history = history.filter(s => s && typeof s.seconds === 'number' && SKILL_LIST.some(k => k.id === s.skill)).slice(0, 8);

let state = 'ready';
let mode = 'camera';
let source = 'camera';
let facingMode = 'environment';
let stream = null;
let engine = null;
let enginePromise = null;
let generation = 0;
let raf = 0;
let elapsedMs = 0;
let lastTick = 0;
let lastAnalysis = 0;
let lastVideoTime = -1;
let cues = [];
let toastTimer;
let objectUrl;
let wakeLock;
let sessionSkill = prefs.skill;
let sessionGoal = getSkill(sessionSkill).goal;
let lastResult = null;
let frames = { good: 0, total: 0 };
let lastSpoken = 0;
// Demo simulation state (explicitly labelled as such in the UI)
let demo = null;
// Local LLM
let liveCoach = null;
let liveCoachPromise = null;
let lastLiveAt = 0;
let liveTimer = 0;
let pendingFinal = null;
// Distance mode: automatic by the athlete's size in the frame, or forced by the button
let farState = { far: false, frames: 0 };
let farManual = null;
let audioCtx = null;

const formatTime = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const text = (id, value) => { if ($(id)) $(id).textContent = value; };
function toast(message) {
  text('toast', message); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

/* ───────────── Catalog & personality ───────────── */
function renderCatalog() {
  const list = $('catalogList'); list.replaceChildren();
  for (const skill of SKILL_LIST) {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'skill-card'; card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(skill.id === prefs.skill)); card.dataset.skill = skill.id;
    card.disabled = ['live', 'paused', 'loading'].includes(state);
    const top = document.createElement('div'); top.className = 'skill-top';
    const emoji = document.createElement('span'); emoji.className = 'skill-emoji'; emoji.textContent = skill.emoji;
    const level = document.createElement('span'); level.className = 'skill-level'; level.textContent = skill.level;
    top.append(emoji, level);
    const planIndex = prefs.plan.indexOf(skill.id);
    if (planIndex !== -1) { const badge = document.createElement('span'); badge.className = 'skill-plan'; badge.textContent = `Маршрут · ${planIndex + 1}`; top.append(badge); }
    const body = document.createElement('div'); body.className = 'skill-body';
    const h = document.createElement('h3'); h.textContent = skill.name;
    const tagline = document.createElement('p'); tagline.className = 'skill-tagline'; tagline.textContent = skill.tagline;
    const meta = document.createElement('div'); meta.className = 'skill-meta';
    for (const item of [pluralize(skill.lessons.length, ['шаг', 'шага', 'шагов']), `${skill.minutes} мин`, skill.needsBall ? 'нужен мяч' : 'без инвентаря']) { const s = document.createElement('span'); s.textContent = item; meta.append(s); }
    body.append(h, tagline, meta);
    const check = document.createElement('span'); check.className = 'skill-check'; check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
    card.append(top, body, check);
    card.addEventListener('click', () => { if (card.disabled) return; prefs.skill = skill.id; applyPreferences(); renderCatalog(); updateSkill(); $('training').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    list.append(card);
  }
}
function renderPersonalities() {
  const row = $('personalityRow'); row.replaceChildren();
  for (const p of Object.values(PERSONALITIES)) {
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'personality-chip';
    chip.setAttribute('role', 'radio'); chip.setAttribute('aria-checked', String(p.id === prefs.personality)); chip.disabled = ['live', 'paused', 'loading'].includes(state);
    const name = document.createElement('span'); name.textContent = p.name;
    const small = document.createElement('small'); small.textContent = p.description;
    chip.append(name, small);
    chip.addEventListener('click', () => { prefs.personality = p.id; applyPreferences(); renderPersonalities(); text('coachPill', `${p.name} тренер`); });
    row.append(chip);
  }
}
function updateSkill() {
  const skill = getSkill(prefs.skill);
  $('goalInput').value = skill.goal;
  text('sessionGoal', skill.goal);
  text('chosenEmoji', skill.emoji); text('chosenName', skill.name);
  text('chosenMeta', `${skill.level} · ${pluralize(skill.lessons.length, ['шаг', 'шага', 'шагов'])} · ${skill.minutes} мин`);
  text('skillDescription', skill.description); text('cameraHint', skill.camera);
  text('movementLabel', skill.metric.label); text('secondLabel', skill.id === 'football' ? 'Лучшая серия' : 'Подсказки тренера');
  text('metricNote', skill.needsBall ? 'Касания считаются только когда камера видит мяч.' : 'Счёт по позе, распознанной на устройстве.');
  text('coachPill', `${PERSONALITIES[prefs.personality].name} тренер`);
}

/* ───────────── UI state ───────────── */
function setState(next) {
  state = next;
  app.dataset.state = next;
  const active = ['live', 'paused', 'loading'].includes(next);
  $('goalInput').disabled = active;
  document.querySelectorAll('.skill-card, .personality-chip').forEach(el => { el.disabled = active; });
  text('statusText', { ready: 'Готов к эфиру', loading: 'Подключаем тренера', live: mode === 'demo' ? 'Демонстрация · симуляция' : 'Тренер в эфире', paused: 'Эфир на паузе', finished: 'Эфир завершён', error: 'Давай попробуем ещё раз' }[next]);
  $('cameraPlaceholder').hidden = !['ready', 'error', 'finished'].includes(next);
  video.setAttribute('aria-hidden', String(!active || mode === 'demo'));
  $('pauseSession').setAttribute('aria-label', next === 'paused' ? 'Продолжить эфир' : 'Приостановить эфир');
  $('pauseSession').querySelector('span').textContent = next === 'paused' ? 'Продолжить' : 'Пауза';
  $('switchCamera').disabled = mode === 'demo' || source === 'file' || next === 'loading';
  renderFar();
}
function applyPreferences() {
  for (const key of ['voice', 'skeleton', 'mirror', 'ball', 'sound', 'autoFar', 'liveCoach']) if ($(key + 'Input')) $(key + 'Input').checked = !!prefs[key];
  document.querySelectorAll('input[name=llmModel]').forEach(r => { r.checked = r.value === prefs.llmModel; });
  $('liveCoachBox').hidden = !prefs.liveCoach;
  $('toggleVoice').setAttribute('aria-pressed', String(!!prefs.voice));
  $('toggleSkeleton').setAttribute('aria-pressed', String(!!prefs.skeleton));
  overlay.style.opacity = prefs.skeleton ? '1' : '0';
  video.style.transform = prefs.mirror && source !== 'file' ? 'scaleX(-1)' : '';
  overlay.style.transform = prefs.mirror && source !== 'file' ? 'scaleX(-1)' : '';
  storage.write('ai-coach:preferences', prefs);
}
function speak(message, kind = 'tip') {
  if (!prefs.voice || !('speechSynthesis' in window) || state !== 'live') return;
  // Successes, warnings and lesson changes interrupt; plain tips wait their turn.
  const urgent = kind !== 'tip';
  const now = performance.now();
  if (!urgent && (now - lastSpoken < 5000 || speechSynthesis.speaking)) return;
  if (urgent && now - lastSpoken < 1200) return;
  lastSpoken = now;
  if (urgent) speechSynthesis.cancel();
  const p = PERSONALITIES[prefs.personality];
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'ru-RU'; utterance.rate = p.voiceRate; utterance.pitch = p.voicePitch;
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('ru'));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}
// iOS Safari only speaks if the first utterance starts inside a user gesture.
function unlockSpeech() {
  if (!('speechSynthesis' in window)) return;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'ru-RU'; speechSynthesis.speak(u); speechSynthesis.getVoices(); } catch { /* voice is optional */ }
}
function ensureAudio() {
  if (!prefs.sound) return;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  } catch { audioCtx = null; }
}
// Short earcons synthesised on the fly: no files, recognisable from across the room.
const EARCONS = { success: [[660, 0, .08], [880, .09, .14]], lesson: [[523, 0, .1], [659, .11, .1], [784, .22, .2]], warning: [[220, 0, .16], [196, .2, .24]] };
function playCue(kind) {
  const notes = EARCONS[kind];
  if (!notes || !prefs.sound || !audioCtx || audioCtx.state !== 'running' || state !== 'live') return;
  const t0 = audioCtx.currentTime;
  for (const [freq, at, dur] of notes) {
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.type = kind === 'warning' ? 'triangle' : 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(gain).connect(audioCtx.destination); osc.start(t0 + at); osc.stop(t0 + at + dur + 0.02);
  }
}
function flash(kind) {
  const el = $('stageFlash'); el.removeAttribute('data-kind'); void el.offsetWidth; el.dataset.kind = kind;
}
const farActive = () => farManual ?? (prefs.autoFar && farState.far);
function renderFar() {
  const on = Boolean(farActive()) && ['live', 'paused'].includes(state);
  stage.dataset.far = String(on);
  $('toggleFar').setAttribute('aria-pressed', String(on));
  if (!on) return;
  const last = cues.at(-1);
  $('farText').textContent = last?.text || ''; $('farText').className = `far-text ${last?.kind || 'tip'}`;
}
function updateFarStep(lesson) {
  text('farStep', lesson.complete ? 'Урок пройден' : `Шаг ${lesson.index + 1}/${lesson.total} · ${lesson.unit === 'с' ? Math.floor(lesson.progress) : lesson.progress}/${lesson.target}`);
}
function addFeedback(feedback) {
  if (!feedback?.text) return;
  if (cues.at(-1)?.text === feedback.text && elapsedMs - cues.at(-1).at < 12000) return;
  const source = feedback.source || 'rule';
  cues.push({ text: feedback.text, kind: feedback.kind || 'tip', tag: cueLabels[feedback.tag] || feedback.tag || 'Техника', rawTag: feedback.tag, source, at: elapsedMs });
  cues = cues.slice(-120);
  const item = document.createElement('div'); item.className = `feedback-item ${feedback.kind || 'tip'}${source === 'llm' ? ' from-llm' : ''}`;
  const avatar = document.createElement('span'); avatar.className = 'feedback-avatar'; avatar.textContent = '✦';
  const bubble = document.createElement('div'); bubble.className = 'feedback-bubble';
  const author = document.createElement('strong'); author.textContent = mode === 'demo' ? 'AI-тренер · демо' : `${PERSONALITIES[prefs.personality].name} тренер`;
  const p = document.createElement('p'); p.textContent = feedback.text;
  bubble.append(author, p); item.append(avatar, bubble); $('feedbackList').append(item);
  while ($('feedbackList').children.length > 3) $('feedbackList').firstElementChild.remove();
  renderInsights(); if (getSkill(sessionSkill).id !== 'football') text('secondValue', cues.length);
  const kind = feedback.kind || 'tip';
  speak(feedback.text, kind); flash(kind); playCue(kind); renderFar();
}
function renderInsights() {
  $('insightList').replaceChildren();
  for (const cue of cues.slice(-4).reverse()) {
    const item = document.createElement('div'); item.className = 'insight-item';
    const label = document.createElement('small'); label.textContent = `${formatTime(Math.floor(cue.at / 1000))} · ${cue.source === 'llm' ? 'Живой тренер' : cue.tag}`;
    const p = document.createElement('p'); p.textContent = cue.text;
    item.append(label, p); $('insightList').append(item);
  }
}
function renderLesson(lesson) {
  if (!lesson) return;
  const hud = $('lessonHud'); hud.dataset.complete = String(lesson.complete);
  text('lessonStep', lesson.complete ? 'Урок пройден' : `Шаг ${lesson.index + 1}/${lesson.total}`);
  text('lessonTitle', lesson.title);
  text('lessonCount', lesson.complete ? '✓' : `${lesson.unit === 'с' ? Math.floor(lesson.progress) : lesson.progress}/${lesson.target}${lesson.unit ? ' ' + lesson.unit : ''}`);
  $('lessonBar').style.width = lesson.complete ? '100%' : `${Math.min(100, lesson.target ? lesson.progress / lesson.target * 100 : 0)}%`;
  text('lessonGoal', lesson.goal);
  updateFarStep(lesson);
}
function renderMetrics(metrics) {
  const skill = getSkill(sessionSkill);
  if (skill.id === 'football') {
    const useTouches = metrics.ballEverSeen;
    text('movementValue', useTouches ? metrics.touches : metrics.lifts);
    text('movementLabel', useTouches ? skill.metric.label : skill.metric.fallbackLabel);
    text('metricNote', useTouches ? (metrics.ballSeen ? 'Мяч виден: считаем касания по его траектории.' : 'Мяч потерян из виду. Касания считаются, когда он в кадре.') : skill.metric.fallbackNote);
    text('secondValue', metrics.bestStreak);
  } else {
    text('movementValue', skill.id === 'squats' ? metrics.reps : metrics.balanceSeconds);
    text('secondValue', cues.length);
  }
}
function renderHistory() {
  $('historyList').replaceChildren();
  $('clearHistory').disabled = history.length === 0;
  if (!history.length) {
    const empty = document.createElement('div'); empty.className = 'history-empty';
    const copy = document.createElement('div');
    const h = document.createElement('h3'); h.textContent = 'Первая тренировка — начало истории';
    const p = document.createElement('p'); p.textContent = 'Здесь появятся итоги твоих тренировок. Демо в историю не записывается.';
    copy.append(h, p); empty.append(copy); $('historyList').append(empty); return;
  }
  for (const session of history) {
    const row = document.createElement('article'); row.className = 'history-session';
    const skill = getSkill(session.skill);
    const title = document.createElement('strong'); title.textContent = `${skill.emoji} ${session.goal}`;
    const details = document.createElement('span');
    const parts = [new Date(session.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }), formatTime(session.seconds), `${session.metricValue ?? session.movements ?? 0} ${session.metricLabel || 'движений'}`];
    if (session.lessonsTotal) parts.push(`шагов ${session.lessonsDone}/${session.lessonsTotal}`);
    if (session.bestStreak) parts.push(`серия ${session.bestStreak}`);
    details.textContent = parts.join(' · ');
    row.append(title, details); $('historyList').append(row);
  }
}

/* ───────────── Media & engine lifecycle ───────────── */
function releaseMedia() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; video.pause(); video.srcObject = null;
  video.removeAttribute('src'); video.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
function cancelRun() {
  generation++; cancelAnimationFrame(raf); raf = 0; releaseMedia();
  clearTimeout(liveTimer); liveTimer = 0;
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  audioCtx?.suspend().catch(() => {});
  $('stageFlash').removeAttribute('data-kind');
}
async function ensureEngine(run) {
  if (!enginePromise) {
    const pending = createCoachEngine({ ball: prefs.ball, onStatus(message) { if (generation === run) { text('modelStatus', message); text('loadingText', message); } } })
      .then(value => {
        if (enginePromise !== pending) { value.close(); throw new DOMException('Session cancelled', 'AbortError'); }
        engine = value; return value;
      }).catch(error => { if (enginePromise === pending) enginePromise = null; throw error; });
    enginePromise = pending;
  }
  return enginePromise;
}
function resetSession(newMode, newSource) {
  cancelRun();
  mode = newMode; source = newSource; app.dataset.mode = mode;
  elapsedMs = 0; cues = []; lastAnalysis = 0; lastVideoTime = -1; lastSpoken = -10000; lastResult = null; frames = { good: 0, total: 0 }; lastLiveAt = 0; pendingFinal = null;
  farState = { far: false, frames: 0 }; farManual = null; text('farText', ''); text('farStep', '');
  sessionSkill = prefs.skill;
  sessionGoal = $('goalInput').value.trim() || getSkill(sessionSkill).goal;
  text('sessionGoal', sessionGoal); updateSkill();
  text('timerValue', '00:00'); text('movementValue', '0'); text('secondValue', '0');
  $('sessionProgress').style.width = '0%'; $('feedbackList').replaceChildren(); $('insightList').replaceChildren();
  $('cameraError').hidden = true;
  $('summaryDialog').close();
  text('sessionLabel', mode === 'demo' ? 'РЕЖИМ ЗНАКОМСТВА' : 'ПРИВАТНЫЙ ЭФИР');
  text('modeBadge', mode === 'demo' ? 'ДЕМО' : source === 'file' ? 'ВИДЕО' : 'LIVE');
  applyPreferences();
  return generation;
}
async function startCamera() {
  const run = resetSession('camera', 'camera'); setState('loading');
  text('modelStatus', 'Подключаем камеру…');
  try {
    if (!window.isSecureContext) throw new Error('Для камеры нужна HTTPS-ссылка или localhost. Открой опубликованную версию.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Этот браузер не поддерживает камеру. Открой сайт в Safari или Chrome.');
    const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facingMode }, width: { ideal: 720 }, height: { ideal: 1280 } } });
    if (generation !== run) { media.getTracks().forEach(t => t.stop()); return; }
    stream = media; video.srcObject = media; await video.play();
    await ensureEngine(run); if (generation !== run) return;
    engine.start(sessionSkill, prefs.personality); beginLive(run);
  } catch (error) { if (generation === run) showError(error); }
}
async function startFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) { toast('Выбери видеофайл.'); return; }
  const run = resetSession('camera', 'file'); setState('loading'); text('modelStatus', 'Подготавливаем видео…');
  try {
    objectUrl = URL.createObjectURL(file); video.src = objectUrl; video.loop = false;
    await video.play(); await ensureEngine(run); if (generation !== run) return;
    video.currentTime = 0;
    await video.play(); if (generation !== run) return;
    engine.start(sessionSkill, prefs.personality); beginLive(run);
  } catch (error) { if (generation === run) showError(error); }
}
function startDemo() {
  const run = resetSession('demo', 'demo');
  demo = { pose: createPoseState(), ball: createBallState(), session: createSession(sessionSkill, { personality: prefs.personality }), lesson: null };
  text('modelStatus', 'Демо · симуляция движений, не анализ камеры'); beginLive(run);
  addFeedback({ text: 'Это демонстрация интерфейса на нарисованном спортсмене. В эфире подсказки зависят от твоих реальных движений.', tag: 'Знакомство', kind: 'tip' });
}
function beginLive(run) {
  setState('live');
  if (matchMedia('(max-width: 720px)').matches) video.closest('.video-column').scrollIntoView({ behavior: 'smooth', block: 'start' });
  lastTick = performance.now(); text('stageHint', mode === 'demo' ? 'Симуляция · не анализ камеры' : 'Встань так, чтобы были видны обе стопы и плечи');
  if (mode !== 'demo') {
    text('modelStatus', engine?.hasBallDetector ? 'Тренер в эфире · поза и мяч на устройстве' : 'Тренер в эфире · поза на устройстве, мяч не отслеживается');
    if (prefs.liveCoach) ensureLiveCoach().catch(() => {});
  }
  if (navigator.wakeLock && mode !== 'demo') navigator.wakeLock.request('screen').then(lock => { if (generation === run) wakeLock = lock; else lock.release(); }).catch(() => {});
  renderLesson(mode === 'demo' ? describeLesson(demo.session) : engine ? describeLesson(engine.session) : null);
  raf = requestAnimationFrame(t => tick(t, run));
}
function showError(error) {
  cancelRun(); setState('error'); text('modelStatus', 'Тренер пока не подключён');
  const messages = { NotAllowedError: 'Доступ к камере не разрешён. Разреши камеру в настройках сайта или попробуй демо.', NotFoundError: 'Камера не найдена. Подключи камеру или открой видеофайл.', NotReadableError: 'Камера занята другим приложением. Закрой его и попробуй снова.' };
  const message = messages[error.name] || (error.message?.includes('HTTPS') ? error.message : 'Не удалось подготовить тренировку. Проверь интернет и доступ к камере. Можно открыть демо.');
  text('cameraError', message); $('cameraError').hidden = false; text('stageHint', 'Демо доступно без камеры');
  console.warn('AI-Coach session:', error.name, error.message);
}
function snapshot() {
  const session = mode === 'demo' ? demo?.session : engine?.session;
  const metrics = lastResult?.metrics || {};
  return {
    skillId: sessionSkill, personality: prefs.personality, lesson: lastResult?.lesson || null,
    lessonsDone: metrics.lessonsDone || 0, seconds: Math.floor(elapsedMs / 1000),
    touches: metrics.touches || 0, streak: metrics.streak || 0, bestStreak: metrics.bestStreak || 0, drops: metrics.drops || 0,
    lifts: metrics.lifts || 0, reps: metrics.reps || 0, balanceSeconds: metrics.balanceSeconds || 0,
    ballSeen: Boolean(metrics.ballSeen), visiblePercent: frames.total ? Math.round(frames.good / frames.total * 100) : 0,
    mainMistake: session ? mainMistake(session) : null, cues: cues.length,
  };
}
function stopSession(showSummary = true) {
  const wasActive = ['live', 'paused'].includes(state);
  const wasDemo = mode === 'demo';
  const skill = getSkill(sessionSkill);
  const metrics = lastResult?.metrics || {};
  const summary = snapshot();
  const useTouches = skill.id === 'football' && metrics.ballEverSeen;
  const metricValue = skill.id === 'football' ? (useTouches ? metrics.touches : metrics.lifts) : skill.id === 'squats' ? metrics.reps : metrics.balanceSeconds;
  const metricLabel = skill.id === 'football' ? (useTouches ? 'касаний' : 'подъёмов стопы') : skill.id === 'squats' ? 'повторов' : 'с баланса';
  const record = { date: new Date().toISOString(), goal: sessionGoal, skill: sessionSkill, seconds: Math.floor(elapsedMs / 1000), metricValue: metricValue || 0, metricLabel, lessonsDone: metrics.lessonsDone || 0, lessonsTotal: skill.lessons.length, bestStreak: metrics.bestStreak || 0, cues: cues.length };
  cancelRun(); setState('finished');
  text('stageHint', 'Готов к следующему эфиру?');
  if (!wasActive || !showSummary) return;
  if (!wasDemo && record.seconds > 0) { history.unshift(record); history = history.slice(0, 8); storage.write('ai-coach:sessions', history); renderHistory(); }
  text('summaryTitle', metrics.lessonsDone >= skill.lessons.length ? 'Урок пройден целиком.' : metrics.lessonsDone > 0 ? 'Хорошая работа.' : 'Начало положено.');
  text('summaryTime', formatTime(record.seconds)); text('summaryMovements', record.metricValue); text('summaryMovementsLabel', metricLabel);
  text('summaryLessons', `${record.lessonsDone}/${record.lessonsTotal}`);
  $('summaryNotes').replaceChildren();
  const row = (label, value) => { const div = document.createElement('div'); div.className = 'summary-row'; const b = document.createElement('b'); b.textContent = label; const span = document.createElement('span'); span.textContent = value; div.append(b, span); $('summaryNotes').append(div); };
  const done = metrics.lessonsDone || 0;
  const lastLesson = skill.lessons[Math.min(done, skill.lessons.length) - 1];
  row('Получилось', done ? `Выполнено шагов: ${done} из ${skill.lessons.length}${lastLesson ? `, последний — «${lastLesson.title}»` : ''}.${record.bestStreak ? ` Лучшая серия: ${record.bestStreak}.` : ''}` : 'Шаги урока пока не засчитаны. Это нормально для первого раза.');
  const mistake = summary.mainMistake;
  row('Главная ошибка', mistake && mistakeAdvice[mistake.tag] ? `${mistakeAdvice[mistake.tag][0]} (замечено ${mistake.count} раз).` : mistake ? `${cueLabels[mistake.tag] || mistake.tag} (замечено ${mistake.count} раз).` : 'Явных ошибок тренер не заметил.');
  const nextLesson = skill.lessons[done];
  const planNext = !wasDemo && done >= skill.lessons.length ? nextInPlan(prefs.plan, sessionSkill) : null;
  row('Следующий шаг', planNext ? `Следующий навык по маршруту: «${getSkill(planNext).name}».` : nextLesson ? `${nextLesson.title}: ${nextLesson.goal.toLowerCase()}.` : mistake && mistakeAdvice[mistake.tag] ? mistakeAdvice[mistake.tag][1] : 'Повтори урок и попробуй увеличить серию.');
  const note = document.createElement('p'); note.textContent = wasDemo ? 'Это была демонстрация на нарисованном спортсмене. Её показатели условные и не сохранены.' : skill.needsBall && !metrics.ballEverSeen ? 'Мяч не был виден камере, поэтому касания не считались: только подъёмы стопы по позе.' : 'Сохранён итог без видео. Все наблюдения сделаны моделями на твоём устройстве.';
  $('summaryNotes').append(note);
  $('summaryLive').hidden = true; text('summaryLiveText', '');
  $('summaryDialog').querySelector('.summary-private').textContent = wasDemo ? 'Демо не сохраняется в историю.' : 'Сохранён только итог. Видео не записывалось.';
  $('summaryDialog').showModal();
  if (planNext) { prefs.skill = planNext; applyPreferences(); updateSkill(); renderPlan(); toast(`Шаг маршрута пройден. Следующий навык: ${getSkill(planNext).name}`); }
  if (!wasDemo && liveCoach && record.seconds > 20) {
    const run = generation;
    pendingFinal = liveCoach.generate(buildSummary(summary), 'final').then(textValue => { if (textValue && run === generation) { text('summaryLiveText', textValue); $('summaryLive').hidden = false; } });
  }
}
async function togglePause() {
  if (state === 'live') {
    setState('paused'); cancelAnimationFrame(raf); video.pause();
    stream?.getVideoTracks().forEach(t => { t.enabled = false; });
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    text('stageHint', 'Пауза · продолжи, когда будешь готов');
  } else if (state === 'paused') {
    stream?.getVideoTracks().forEach(t => { t.enabled = true; });
    if (mode !== 'demo') { try { await video.play(); } catch (error) { showError(error); return; } }
    if (state !== 'paused') return;
    setState('live'); lastTick = performance.now(); raf = requestAnimationFrame(t => tick(t, generation));
    text('stageHint', mode === 'demo' ? 'Симуляция · не анализ камеры' : 'Продолжаем · двигайся в своём темпе');
  }
}
function handleResult(result) {
  lastResult = result;
  frames.total += 1; if (result.quality === 'good') frames.good += 1;
  renderMetrics(result.metrics); renderLesson(result.lesson);
  if (mode !== 'demo') {
    drawPose(result.landmarks, result.ball);
    text('stageHint', result.quality === 'missing' ? 'Не вижу всё тело · отойди от камеры и добавь света' : result.quality === 'partial' ? 'Проверь, что плечи, колени и стопы в кадре' : result.lesson?.needsBall && !result.metrics.ballSeen ? 'Покажи мяч камере · касания считаются по нему' : 'Движения видны · продолжай в своём темпе');
  }
  if (result.feedback) addFeedback(result.feedback);
  if (result.scale !== undefined) {
    const next = farModeDecision(farState, result.scale ?? NaN, result.quality);
    const switched = next.far !== farState.far;
    farState = next;
    if (switched && farManual === null && prefs.autoFar) { renderFar(); toast(next.far ? 'Ты далеко от камеры: включаю крупный режим' : 'Ты ближе к камере: обычная лента'); }
  }
  maybeAskLiveCoach();
}
function tick(now, run) {
  if (run !== generation || state !== 'live') return;
  elapsedMs += Math.min(now - lastTick, 1000); lastTick = now;
  text('timerValue', formatTime(Math.floor(elapsedMs / 1000)));
  $('sessionProgress').style.width = `${Math.min(elapsedMs / 180000 * 100, 100)}%`;
  if (mode === 'demo') renderDemo(now);
  else if (now - lastAnalysis >= 110 && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastAnalysis = now; lastVideoTime = video.currentTime;
    try {
      const result = engine.analyze(video, now);
      if (result) handleResult(result);
    } catch (error) { showError(error); return; }
  }
  raf = requestAnimationFrame(t => tick(t, run));
}

/* ───────────── Drawing ───────────── */
function canvasContext(canvas) {
  const { width, height } = canvas.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); return { ctx, width, height };
}
function drawPose(landmarks, ball) {
  const { ctx, width, height } = canvasContext(overlay); ctx.clearRect(0, 0, width, height);
  if (!video.videoWidth) return;
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const ox = (width - video.videoWidth * scale) / 2, oy = (height - video.videoHeight * scale) / 2;
  const point = p => ({ x: p.x * video.videoWidth * scale + ox, y: p.y * video.videoHeight * scale + oy });
  if (landmarks?.length && prefs.skeleton) {
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(168,203,177,.85)'; ctx.fillStyle = '#c9dfce';
    for (const [a, b] of POSE_CONNECTIONS) { const p = landmarks[a], q = landmarks[b]; if (!p || !q || (p.visibility ?? 1) < .5 || (q.visibility ?? 1) < .5) continue; const u = point(p), v = point(q); ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(v.x, v.y); ctx.stroke(); }
    for (const p of landmarks) { if ((p.visibility ?? 1) < .5) continue; const v = point(p); ctx.beginPath(); ctx.arc(v.x, v.y, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  if (ball) {
    const c = point(ball); const r = Math.max(10, ball.r * video.videoWidth * scale);
    ctx.lineWidth = 2; ctx.strokeStyle = '#e7d98a'; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e7d98a'; ctx.font = '600 10px sans-serif'; ctx.fillText('мяч', c.x + r + 4, c.y + 3);
  }
}

/* ───────────── Demo simulation (explicitly not camera analysis) ───────────── */
function demoPose(seconds) {
  const p = Array.from({ length: 33 }, () => ({ x: .5, y: .25, z: 0, visibility: 1 }));
  const set = (i, x, y) => { p[i] = { x, y, z: 0, visibility: 1 }; };
  set(0, .5, .19); set(11, .42, .31); set(12, .58, .31); set(13, .36, .43); set(14, .65, .42); set(15, .31, .52); set(16, .69, .49); set(23, .45, .53); set(24, .55, .53); set(25, .43, .7); set(26, .58, .7); set(27, .41, .88); set(28, .61, .88); set(29, .40, .89); set(30, .62, .89); set(31, .37, .9); set(32, .66, .9);
  const phase = Math.floor(seconds / 9) % 3; // 0: stance, 1: lifts, 2: ball
  const lift = phase === 0 ? 0 : Math.pow(Math.max(0, Math.sin(seconds * 1.55)), 2) * .16;
  if (sessionSkill === 'squats') {
    const d = seconds < 4 ? 0 : (Math.sin(seconds * 1.25) + 1) / 2;
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24]) p[i].y += d * .15;
    p[25].x = .43 - d * .15; p[26].x = .58 + d * .15;
  } else {
    for (const i of [28, 30, 32]) p[i].y -= sessionSkill === 'balance' ? (seconds < 3 ? 0 : .13) : lift;
    p[26].y -= lift * .45; p[26].x += lift * .2;
  }
  return { points: p, phase, lift };
}
function demoBall(seconds, phase, foot) {
  if (sessionSkill !== 'football' || phase !== 2) return [];
  const bounce = Math.abs(Math.sin(seconds * 1.55));
  return [{ x: foot.x + .03, y: foot.y - .05 - bounce * .22, w: .07, h: .07, score: .9 }];
}
function renderDemo(now) {
  const { ctx, width: w, height: h } = canvasContext(demoCanvas); ctx.clearRect(0, 0, w, h);
  const gradient = ctx.createLinearGradient(0, 0, w, h); gradient.addColorStop(0, '#25312c'); gradient.addColorStop(1, '#0e1713'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(168,203,177,.06)'; ctx.lineWidth = 1;
  for (let n = 0; n < 9; n++) { ctx.beginPath(); ctx.moveTo(w / 2, h * .38); ctx.lineTo(w * (n / 8), h); ctx.stroke(); }
  for (let n = 0; n < 7; n++) { const y = h * (.47 + n * .085); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const seconds = elapsedMs / 1000;
  const { points, phase } = demoPose(seconds);
  const map = p => ({ x: p.x * w, y: p.y * h * .82 + h * .05 });
  const parts = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w * .026; ctx.strokeStyle = '#92b795';
  for (const [a, b] of parts) { const u = map(points[a]), v = map(points[b]); ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(v.x, v.y); ctx.stroke(); }
  const head = map(points[0]); ctx.fillStyle = '#b1c8ab'; ctx.beginPath(); ctx.arc(head.x, head.y, w * .049, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#a8cbb1'; ctx.fillStyle = '#a8cbb1';
  for (const i of [11, 12, 13, 14, 23, 24, 25, 26, 27, 28]) { const v = map(points[i]); ctx.beginPath(); ctx.arc(v.x, v.y, 4, 0, Math.PI * 2); ctx.fill(); }
  const detections = demoBall(seconds, phase, points[32]);
  if (detections[0]) {
    const b = map(detections[0]); ctx.fillStyle = '#c3dac8'; ctx.beginPath(); ctx.arc(b.x, b.y, w * .042, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#1a2616'; ctx.font = `${w * .035}px sans-serif`; ctx.fillText('⬡', b.x - 8, b.y + 5);
  }
  if (now - lastAnalysis > 110) {
    lastAnalysis = now;
    const observed = observePose(points, demo.pose, now, w / h, sessionSkill); demo.pose = observed.state;
    demo.ball = trackBall(detections, demo.ball, now, observed.obs, w / h);
    const stepped = stepSession(demo.session, observed.obs, demo.ball, now); demo.session = stepped.session;
    handleResult({ landmarks: null, ball: null, quality: observed.obs.quality, feedback: stepped.feedback, lesson: stepped.lesson, metrics: stepped.metrics, scale: observed.obs.quality === 'good' ? observed.obs.legScale : null });
  }
}

/* ───────────── Local live coach (WebLLM) ───────────── */
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
      .catch(error => { liveCoachPromise = null; setLiveCoachStatus(error.message || 'Не удалось запустить модель.', 0); prefs.liveCoach = false; applyPreferences(); throw error; });
  }
  return liveCoachPromise;
}
async function unloadLiveCoach() {
  const coach = liveCoach; liveCoach = null; liveCoachPromise = null;
  if (coach) await coach.unload();
  setLiveCoachStatus('Модель выгружена. Включи, чтобы загрузить снова.', 0);
}
function maybeAskLiveCoach() {
  if (mode === 'demo' || !liveCoach || liveCoach.busy || state !== 'live') return;
  if (elapsedMs - lastLiveAt < 12000 || elapsedMs < 8000) return;
  if (lastResult?.quality !== 'good') return;
  if ((lastResult?.timing?.poseMs || 0) > 110) return; // pose keeps priority
  lastLiveAt = elapsedMs;
  const run = generation;
  liveCoach.generate(buildSummary(snapshot()), 'live').then(textValue => {
    if (textValue && run === generation && state === 'live') addFeedback({ text: textValue, kind: 'tip', tag: 'live', source: 'llm' });
  });
}

/* ───────────── Skill planner chat ───────────── */
function addChat(role, message, meta = '') {
  const item = document.createElement('div'); item.className = `chat-item ${role}`;
  const p = document.createElement('p'); p.textContent = message; item.append(p);
  if (meta) { const small = document.createElement('small'); small.textContent = meta; item.append(small); }
  $('plannerLog').append(item); $('plannerLog').hidden = false;
  while ($('plannerLog').children.length > 12) $('plannerLog').firstElementChild.remove();
  item.scrollIntoView({ block: 'nearest' });
}
function renderPlan() {
  const picked = prefs.plan.map(id => SKILL_LIST.find(k => k.id === id)).filter(Boolean);
  $('planCard').hidden = picked.length === 0;
  if (picked.length) {
    text('planGoal', prefs.planGoal ? `Цель: ${prefs.planGoal}` : 'Твой маршрут');
    const list = $('planSteps'); list.replaceChildren();
    picked.forEach(skill => {
      const li = document.createElement('li'); li.textContent = `${skill.emoji} ${skill.name} · ${pluralize(skill.lessons.length, ['шаг', 'шага', 'шагов'])} · ${skill.minutes} мин`;
      if (skill.id === prefs.skill) li.className = 'is-current';
      list.append(li);
    });
  }
  renderCatalog();
}
async function askPlanner(message) {
  const query = String(message || '').trim();
  if (!query || $('plannerSend').disabled) return;
  addChat('user', query);
  $('plannerInput').value = ''; $('plannerSend').disabled = true;
  let result = null;
  if (prefs.liveCoach) {
    text('plannerStatus', liveCoach ? 'Живой тренер думает…' : 'Загружаем живого тренера, прогресс виден в настройках…');
    try {
      const coach = await ensureLiveCoach();
      const raw = await coach.chat(buildPlannerMessages(query, SKILL_LIST, plannerHistory), { maxTokens: 220 });
      const parsed = parsePlan(raw, SKILL_LIST);
      if (parsed.ok) result = parsed; else console.warn('AI-Coach planner: LLM reply rejected,', parsed.reason);
    } catch (error) { console.warn('AI-Coach planner: LLM unavailable', error?.message); }
  }
  const viaLlm = Boolean(result);
  if (!result) result = keywordPlan(query, SKILL_LIST);
  const reply = result.reply || planReplyText(result.plan, SKILL_LIST);
  plannerHistory.push({ role: 'user', content: query }, { role: 'assistant', content: reply });
  addChat('coach', reply, viaLlm ? 'живой тренер · маршрут проверен по каталогу' : 'подбор по ключевым словам');
  if (result.plan.length) { prefs.plan = result.plan; prefs.planGoal = query; prefs.skill = result.plan[0]; applyPreferences(); updateSkill(); }
  renderPlan();
  text('plannerStatus', viaLlm ? 'Ответ живого тренера проверен кодом: только навыки из каталога, без выдуманных чисел.' : prefs.liveCoach ? 'Живой тренер не дал проверяемый ответ, маршрут собран по ключевым словам.' : 'Подбор по ключевым словам. Включи «Живой тренер» в настройках, чтобы отвечала локальная модель.');
  $('plannerSend').disabled = false;
}

/* ───────────── Events ───────────── */
$('plannerForm').addEventListener('submit', event => { event.preventDefault(); askPlanner($('plannerInput').value); });
document.querySelectorAll('.planner-chip').forEach(chip => chip.addEventListener('click', () => askPlanner(chip.textContent)));
$('planStart').addEventListener('click', () => {
  if (!prefs.plan.length) return;
  prefs.skill = prefs.plan[0]; applyPreferences(); updateSkill(); renderPlan();
  $('training').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('planClear').addEventListener('click', () => { prefs.plan = []; prefs.planGoal = ''; applyPreferences(); renderPlan(); toast('Маршрут сброшен'); });
$('startCamera').addEventListener('click', () => { unlockSpeech(); ensureAudio(); startCamera(); });
$('startDemo').addEventListener('click', () => { unlockSpeech(); ensureAudio(); startDemo(); });
$('stopSession').addEventListener('click', () => stopSession());
$('pauseSession').addEventListener('click', togglePause);
$('skipLesson').addEventListener('click', () => {
  if (mode === 'demo' || !engine || state !== 'live') return;
  engine.skip(); toast('Шаг пропущен. Он отмечен как невыполненный.');
});
$('switchCamera').addEventListener('click', async () => {
  if (!['live', 'paused'].includes(state) || source !== 'camera') return;
  const previousFacing = facingMode;
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  const run = generation + 1; cancelRun(); setState('loading');
  text('modelStatus', 'Переключаем камеру…');
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facingMode }, width: { ideal: 720 }, height: { ideal: 1280 } } });
    if (run !== generation) { media.getTracks().forEach(t => t.stop()); return; }
    stream = media; video.srcObject = media; await video.play(); if (run !== generation) return;
    lastVideoTime = -1; applyPreferences(); beginLive(run); toast('Камера переключена. Эфир продолжается.');
  } catch (error) { facingMode = previousFacing; if (run === generation) showError(error); }
});
$('toggleVoice').addEventListener('click', () => { prefs.voice = !prefs.voice; applyPreferences(); if (!prefs.voice && 'speechSynthesis' in window) speechSynthesis.cancel(); toast(prefs.voice ? 'Голосовые подсказки включены' : 'Голосовые подсказки выключены'); });
$('toggleSkeleton').addEventListener('click', () => { prefs.skeleton = !prefs.skeleton; applyPreferences(); });
$('toggleFar').addEventListener('click', () => {
  farManual = !farActive(); renderFar();
  toast(farManual ? 'Крупный режим: последняя фраза во весь экран' : 'Обычная лента комментариев');
});
$('openSettings').addEventListener('click', () => $('settingsDialog').showModal());
$('closeSettings').addEventListener('click', () => $('settingsDialog').close());
$('closeSummary').addEventListener('click', () => $('summaryDialog').close());
$('restartSession').addEventListener('click', () => { $('summaryDialog').close(); setState('ready'); unlockSpeech(); ensureAudio(); startCamera(); });
for (const key of ['voice', 'skeleton', 'mirror', 'ball', 'sound', 'autoFar']) $(key + 'Input').addEventListener('change', () => {
  prefs[key] = $(key + 'Input').checked; applyPreferences();
  if (key === 'sound' && prefs.sound) ensureAudio();
  if (key === 'autoFar') renderFar();
  if (key === 'voice' && !prefs.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
  if (key === 'ball') {
    if (['live', 'paused', 'loading'].includes(state)) toast('Настройка мяча применится при следующем эфире');
    else if (engine || enginePromise) { const pending = enginePromise; engine = null; enginePromise = null; pending?.then(v => v.close()).catch(() => {}); toast(prefs.ball ? 'Детектор мяча включится при следующем эфире' : 'Детектор мяча выключен'); }
  }
});
$('liveCoachInput').addEventListener('change', () => {
  prefs.liveCoach = $('liveCoachInput').checked; applyPreferences();
  if (prefs.liveCoach) ensureLiveCoach().catch(() => {}); else unloadLiveCoach();
});
document.querySelectorAll('input[name=llmModel]').forEach(radio => radio.addEventListener('change', async () => {
  prefs.llmModel = radio.value; applyPreferences();
  if (liveCoach || liveCoachPromise) { await unloadLiveCoach(); if (prefs.liveCoach) ensureLiveCoach().catch(() => {}); }
}));
for (const dialog of [$('settingsDialog'), $('summaryDialog')]) dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
$('goalInput').addEventListener('input', () => text('sessionGoal', $('goalInput').value.trim() || getSkill(prefs.skill).goal));
$('clearHistory').addEventListener('click', () => { history = []; storage.write('ai-coach:sessions', history); renderHistory(); toast('История тренировок очищена'); });
$('uploadVideo').addEventListener('click', () => { unlockSpeech(); ensureAudio(); $('videoFile').click(); });
$('videoFile').addEventListener('change', e => { startFile(e.target.files[0]); e.target.value = ''; });
video.addEventListener('ended', () => { if (source === 'file' && state === 'live') stopSession(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'live') { togglePause(); toast('Эфир на паузе, пока вкладка скрыта'); } });
window.addEventListener('pagehide', () => {
  const pending = enginePromise; cancelRun(); engine = null; enginePromise = null;
  pending?.then(value => { value.close(); if (engine === value) engine = null; }).catch(() => {});
  if (liveCoach) { const coach = liveCoach; liveCoach = null; liveCoachPromise = null; coach.unload(); }
  setState('ready');
});
window.addEventListener('pageshow', event => { if (event.persisted) { setState('ready'); text('modelStatus', 'AI подключится при старте'); } });
if (!supportsWebGPU()) { $('liveCoachInput').disabled = true; text('liveCoachHint', 'Нужен WebGPU. В этом браузере его нет: подсказки по правилам работают, живой тренер недоступен.'); prefs.liveCoach = false; }
applyPreferences(); renderPlan(); renderPersonalities(); updateSkill(); renderHistory(); setState('ready');
