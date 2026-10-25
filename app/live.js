// Live screen: camera (or a video file, or the labelled demo), the vision
// engine loop, the comment feed, distance mode, sounds and the summary sheet.
// No frame ever leaves the device; the LLM only receives numbers.
import { createCoachEngine, observePose, trackBall, createSession, stepSession, describeLesson, createPoseState, createBallState, mainMistake, farModeDecision, POSE_CONNECTIONS } from '../coach-engine.js';
import { getSkill, PERSONALITIES } from '../skills/index.js';
import { buildSummary } from '../coach-llm.js';
import { nextInPlan } from '../coach-planner.js';
import { $, text, el, toast, haptic, bus, formatTime, openSheet, closeSheet, paintAvatar } from './ui.js';
import * as store from './store.js';

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
const REACTIONS = { 'ball-touch': '⚽', 'ball-streak': '🔥', 'lesson-complete': '✅', 'course-complete': '🏆', 'lift-done': '👟', 'squat-complete': '💪', 'balance-hold': '🧘' };
const EARCONS = { success: [[660, 0, .08], [880, .09, .14]], lesson: [[523, 0, .1], [659, .11, .1], [784, .22, .2]], warning: [[220, 0, .16], [196, .2, .24]] };

const ctx = { prefs: null, profile: null, ensureLiveCoach: null, getLiveCoach: null, onHistory: null };
let video, overlay, demoCanvas, stage;
let state = 'idle'; let mode = 'camera'; let source = 'camera'; let facingMode = 'user';
let stream = null; let engine = null; let enginePromise = null; let generation = 0; let raf = 0;
let elapsedMs = 0; let lastTick = 0; let lastAnalysis = 0; let lastVideoTime = -1; let cues = [];
let objectUrl = null; let wakeLock = null; let sessionSkill = 'football'; let lastResult = null;
let frames = { good: 0, total: 0 }; let lastSpoken = 0; let demo = null; let lastLiveAt = 0;
let farState = { far: false, frames: 0 }; let farManual = null; let audioCtx = null; let pendingFile = null;
let lastSummaryText = '';

export function initLive({ prefs, profile, ensureLiveCoach, getLiveCoach, onHistory }) {
  Object.assign(ctx, { prefs, profile, ensureLiveCoach, getLiveCoach, onHistory });
  facingMode = prefs.facing;
  video = $('cameraVideo'); overlay = $('poseCanvas'); demoCanvas = $('demoCanvas'); stage = $('stage');
  $('liveClose').addEventListener('click', () => stopSession());
  $('livePause').addEventListener('click', togglePause);
  $('liveSkip').addEventListener('click', () => { if (mode === 'demo' || !engine || state !== 'live') return; engine.skip(); toast('Шаг пропущен. Он отмечен как невыполненный.'); });
  $('liveFlip').addEventListener('click', flipCamera);
  $('liveVoice').addEventListener('click', () => { ctx.prefs.voice = !ctx.prefs.voice; store.savePrefs(ctx.prefs); applyPrefs(); if (!ctx.prefs.voice && 'speechSynthesis' in window) speechSynthesis.cancel(); bus.emit('prefs-changed'); });
  $('liveSkeleton').addEventListener('click', () => { ctx.prefs.skeleton = !ctx.prefs.skeleton; store.savePrefs(ctx.prefs); applyPrefs(); bus.emit('prefs-changed'); });
  $('liveFar').addEventListener('click', () => { farManual = !farActive(); renderFar(); toast(farManual ? 'Крупный режим: последняя фраза во весь кадр' : 'Обычная лента комментариев'); });
  $('liveRetry').addEventListener('click', () => startLive({ skillId: sessionSkill, mode: source === 'file' && pendingFile ? 'file' : 'camera', file: pendingFile }));
  $('liveErrorDemo').addEventListener('click', () => startLive({ skillId: sessionSkill, mode: 'demo' }));
  $('liveErrorBack').addEventListener('click', () => hideLive());
  $('summaryAgain').addEventListener('click', () => { closeSheet(); startLive({ skillId: ctx.prefs.skill, mode: 'camera' }); });
  $('summaryClose').addEventListener('click', () => closeSheet());
  $('summaryShare').addEventListener('click', shareSummary);
  video.addEventListener('ended', () => { if (source === 'file' && state === 'live') stopSession(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'live') { togglePause(); toast('Эфир на паузе, пока вкладка скрыта'); } });
  window.addEventListener('pagehide', () => {
    const pending = enginePromise; cancelRun(); engine = null; enginePromise = null;
    pending?.then(value => { value.close(); if (engine === value) engine = null; }).catch(() => {});
  });
  // Back from the browser cache: the camera and models were released on pagehide.
  window.addEventListener('pageshow', (event) => { if (event.persisted && state !== 'idle') { hideLive(); toast('Эфир остановлен, пока страница была скрыта'); } });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state === 'live' && !event.defaultPrevented) stopSession(); });
}

export const isActive = () => ['live', 'paused', 'loading'].includes(state);
export function setProfile(profile) { ctx.profile = profile; }
/** Called when the ball-detector preference changes: the engine must be rebuilt. */
export function resetEngine() {
  if (isActive()) { toast('Настройка мяча применится при следующем эфире'); return; }
  const pending = enginePromise; engine = null; enginePromise = null; pending?.then(v => v.close()).catch(() => {});
}
export function applyPrefs() {
  $('liveVoice').setAttribute('aria-pressed', String(ctx.prefs.voice));
  $('liveSkeleton').setAttribute('aria-pressed', String(ctx.prefs.skeleton));
  if (overlay) overlay.style.opacity = ctx.prefs.skeleton ? '1' : '0';
  // A mirror view only makes sense for the selfie camera, never for the rear one.
  const mirror = ctx.prefs.mirror && source === 'camera' && mode !== 'demo' && facingMode === 'user';
  if (video) video.style.transform = mirror ? 'scaleX(-1)' : '';
  if (overlay) overlay.style.transform = mirror ? 'scaleX(-1)' : '';
  renderFar();
}

/* ───────────── Start / stop ───────────── */

function showLive() { $('liveScreen').hidden = false; $('app').dataset.live = 'on'; closeSheet(); }
function hideLive() { cancelRun(); state = 'idle'; $('liveScreen').hidden = true; $('app').dataset.live = 'off'; $('liveError').hidden = true; $('loadingCover').hidden = true; }

export async function startLive({ skillId, mode: newMode = 'camera', file = null } = {}) {
  unlockSpeech(); ensureAudio();
  sessionSkill = getSkill(skillId || ctx.prefs.skill).id; ctx.prefs.skill = sessionSkill; store.savePrefs(ctx.prefs);
  pendingFile = newMode === 'file' ? file : null;
  if (newMode === 'file' && !file) { toast('Выбери видеофайл.'); return; }
  if (newMode === 'file' && !file.type.startsWith('video/')) { toast('Это не видеофайл.'); return; }
  const run = resetSession(newMode === 'demo' ? 'demo' : 'camera', newMode);
  showLive(); bus.emit('live-started', { skillId: sessionSkill, mode: newMode });
  if (newMode === 'demo') { startDemo(run); return; }
  setState('loading');
  try {
    if (newMode === 'file') {
      text('loadingText', 'Подготавливаем видео…');
      objectUrl = URL.createObjectURL(file); video.src = objectUrl; video.loop = false;
      await video.play(); await ensureEngine(run); if (generation !== run) return;
      video.currentTime = 0; await video.play(); if (generation !== run) return;
    } else {
      text('loadingText', 'Подключаем камеру…');
      if (!window.isSecureContext) throw new Error('Для камеры нужна HTTPS-ссылка или localhost. Открой опубликованную версию.');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Этот браузер не поддерживает камеру. Открой сайт в Safari или Chrome.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facingMode }, width: { ideal: 720 }, height: { ideal: 1280 } } });
      if (generation !== run) { media.getTracks().forEach(t => t.stop()); return; }
      stream = media; video.srcObject = media; await video.play();
      await ensureEngine(run); if (generation !== run) return;
    }
    engine.start(sessionSkill, ctx.prefs.personality); beginLive(run);
  } catch (error) { if (generation === run) showError(error); }
}

function resetSession(newMode, newSource) {
  cancelRun();
  mode = newMode; source = newSource; $('app').dataset.mode = mode;
  elapsedMs = 0; cues = []; lastAnalysis = 0; lastVideoTime = -1; lastSpoken = -10000; lastResult = null; frames = { good: 0, total: 0 }; lastLiveAt = 0;
  farState = { far: false, frames: 0 }; farManual = null; text('farText', ''); text('farStep', '');
  $('feedbackList').replaceChildren(); $('liveReactions').replaceChildren(); $('liveError').hidden = true;
  text('liveTimer', '00:00'); text('liveMetricValue', '0'); text('liveSecondValue', '0');
  const skill = getSkill(sessionSkill);
  text('liveMetricLabel', skill.id === 'football' ? skill.metric.fallbackLabel.toLowerCase() : skill.metric.label.toLowerCase()); text('liveSecondLabel', skill.id === 'football' ? 'серия' : 'подсказок');
  text('liveBadge', mode === 'demo' ? 'ДЕМО' : source === 'file' ? 'ВИДЕО' : 'LIVE'); $('liveBadge').dataset.kind = mode === 'demo' ? 'demo' : source;
  text('liveName', ctx.profile?.name || ''); paintAvatar($('liveAvatar'), ctx.profile);
  text('liveCoachName', `${PERSONALITIES[ctx.prefs.personality].name} тренер`);
  $('liveFlip').disabled = mode === 'demo' || source === 'file';
  $('liveSkip').disabled = mode === 'demo';
  applyPrefs();
  return generation;
}
function setState(next) {
  state = next; $('liveScreen').dataset.state = next;
  $('loadingCover').hidden = next !== 'loading';
  $('livePause').querySelector('span').textContent = next === 'paused' ? 'Дальше' : 'Пауза';
  $('livePause').querySelector('use').setAttribute('href', next === 'paused' ? '#i-play' : '#i-pause');
  renderFar();
}
function startDemo(run) {
  demo = { pose: createPoseState(), ball: createBallState(), session: createSession(sessionSkill, { personality: ctx.prefs.personality }) };
  beginLive(run);
  addFeedback({ text: 'Это демонстрация интерфейса на нарисованном спортсмене. В эфире подсказки зависят от твоих реальных движений.', tag: 'Знакомство', kind: 'tip' });
}
function beginLive(run) {
  setState('live'); lastTick = performance.now();
  text('stageHint', mode === 'demo' ? 'Симуляция · не анализ камеры' : 'Встань так, чтобы были видны обе стопы и плечи');
  if (mode !== 'demo' && ctx.prefs.liveCoach) ctx.ensureLiveCoach().catch(() => {});
  keepAwake(run);
  renderLesson(mode === 'demo' ? describeLesson(demo.session) : engine ? describeLesson(engine.session) : null);
  raf = requestAnimationFrame(t => tick(t, run));
}
function showError(error) {
  cancelRun(); setState('error');
  const messages = { NotAllowedError: 'Доступ к камере не разрешён. Разреши камеру в настройках сайта или попробуй демо.', NotFoundError: 'Камера не найдена. Подключи камеру или открой видеофайл.', NotReadableError: 'Камера занята другим приложением. Закрой его и попробуй снова.' };
  const message = messages[error.name] || (error.message?.includes('HTTPS') ? error.message : 'Не удалось подготовить эфир. Проверь интернет и доступ к камере. Можно открыть демо.');
  text('liveErrorText', message); $('liveError').hidden = false;
  bus.emit('live-failed', message);
  console.warn('Aimo session:', error.name, error.message);
}
function releaseMedia() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
function cancelRun() {
  generation++; cancelAnimationFrame(raf); raf = 0; releaseMedia();
  overlay?.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  audioCtx?.suspend().catch(() => {});
  $('stageFlash').removeAttribute('data-kind');
}
async function ensureEngine(run) {
  if (!enginePromise) {
    const pending = createCoachEngine({ ball: ctx.prefs.ball, onStatus(message) { if (generation === run) text('loadingText', message); } })
      .then(value => { if (enginePromise !== pending) { value.close(); throw new DOMException('Session cancelled', 'AbortError'); } engine = value; return value; })
      .catch(error => { if (enginePromise === pending) enginePromise = null; throw error; });
    enginePromise = pending;
  }
  return enginePromise;
}
async function flipCamera() {
  if (!['live', 'paused'].includes(state) || source !== 'camera') return;
  const previous = facingMode; facingMode = facingMode === 'user' ? 'environment' : 'user';
  const run = generation + 1; cancelRun(); setState('loading'); text('loadingText', 'Переключаем камеру…');
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facingMode }, width: { ideal: 720 }, height: { ideal: 1280 } } });
    if (run !== generation) { media.getTracks().forEach(t => t.stop()); return; }
    stream = media; video.srcObject = media; await video.play(); if (run !== generation) return;
    ctx.prefs.facing = facingMode; store.savePrefs(ctx.prefs);
    lastVideoTime = -1; applyPrefs(); beginLive(run); toast(facingMode === 'user' ? 'Фронтальная камера' : 'Задняя камера');
  } catch (error) { facingMode = previous; if (run === generation) showError(error); }
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
    keepAwake(generation); // the system drops the wake lock while the page is hidden
    text('stageHint', mode === 'demo' ? 'Симуляция · не анализ камеры' : 'Продолжаем · двигайся в своём темпе');
  }
}

/* ───────────── Loop ───────────── */

function tick(now, run) {
  if (run !== generation || state !== 'live') return;
  elapsedMs += Math.min(now - lastTick, 1000); lastTick = now;
  text('liveTimer', formatTime(Math.floor(elapsedMs / 1000)));
  if (mode === 'demo') renderDemo(now);
  else if (now - lastAnalysis >= 110 && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastAnalysis = now; lastVideoTime = video.currentTime;
    try { const result = engine.analyze(video, now); if (result) handleResult(result); }
    catch (error) { showError(error); return; }
  }
  raf = requestAnimationFrame(t => tick(t, run));
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
    const switched = next.far !== farState.far; farState = next;
    if (switched && farManual === null && ctx.prefs.autoFar) { renderFar(); toast(next.far ? 'Ты далеко от камеры: включаю крупный режим' : 'Ты ближе к камере: обычная лента'); }
  }
  maybeAskLiveCoach();
}
function renderMetrics(metrics) {
  const skill = getSkill(sessionSkill);
  if (skill.id === 'football') {
    const useTouches = metrics.ballEverSeen;
    text('liveMetricValue', useTouches ? metrics.touches : metrics.lifts);
    text('liveMetricLabel', useTouches ? 'касаний' : 'подъёмов');
    text('liveSecondValue', metrics.bestStreak);
  } else { text('liveMetricValue', skill.id === 'squats' ? metrics.reps : metrics.balanceSeconds); text('liveSecondValue', cues.length); }
}
function renderLesson(lesson) {
  if (!lesson) return;
  $('lessonHud').dataset.complete = String(lesson.complete);
  text('lessonStep', lesson.complete ? 'Урок пройден' : `Шаг ${lesson.index + 1}/${lesson.total}`);
  text('lessonTitle', lesson.title);
  const progress = lesson.unit === 'с' ? Math.floor(lesson.progress) : lesson.progress;
  text('lessonCount', lesson.complete ? '✓' : `${progress}/${lesson.target}${lesson.unit ? ' ' + lesson.unit : ''}`);
  $('lessonBar').style.width = lesson.complete ? '100%' : `${Math.min(100, lesson.target ? lesson.progress / lesson.target * 100 : 0)}%`;
  text('lessonGoal', lesson.goal);
  text('farStep', lesson.complete ? 'Урок пройден' : `Шаг ${lesson.index + 1}/${lesson.total} · ${progress}/${lesson.target}`);
}

/* ───────────── Feed, voice, sounds ───────────── */

function addFeedback(feedback) {
  if (!feedback?.text) return;
  if (cues.at(-1)?.text === feedback.text && elapsedMs - cues.at(-1).at < 12000) return;
  const kind = feedback.kind || 'tip'; const from = feedback.source || 'rule';
  cues.push({ text: feedback.text, kind, tag: cueLabels[feedback.tag] || feedback.tag || 'Техника', rawTag: feedback.tag, source: from, at: elapsedMs });
  cues = cues.slice(-120);
  const item = el('div', `lc ${kind}${from === 'llm' ? ' from-llm' : ''}`);
  const avatar = el('span', 'avatar tiny coach', '✦');
  const body = el('div', 'lc-body');
  body.append(el('b', null, mode === 'demo' ? 'Тренер · демо' : `${PERSONALITIES[ctx.prefs.personality].name} тренер${from === 'llm' ? ' · живой' : ''}`), el('span', null, feedback.text));
  item.append(avatar, body); $('feedbackList').append(item);
  while ($('feedbackList').children.length > 4) $('feedbackList').firstElementChild.remove();
  if (getSkill(sessionSkill).id !== 'football') text('liveSecondValue', cues.length);
  speak(feedback.text, kind); flash(kind); playCue(kind); renderFar();
  const emoji = REACTIONS[feedback.tag]; if (emoji) { react(emoji); haptic(kind === 'warning' ? [30, 40, 30] : 10); }
  else if (kind === 'warning') haptic([30, 40, 30]);
}
function react(emoji) {
  const node = el('span', 'reaction', emoji); node.style.setProperty('--dx', `${Math.round(Math.random() * 40 - 20)}px`);
  $('liveReactions').append(node); node.addEventListener('animationend', () => node.remove());
}
function speak(message, kind = 'tip') {
  if (!ctx.prefs.voice || !('speechSynthesis' in window) || state !== 'live') return;
  const urgent = kind !== 'tip'; const now = performance.now();
  if (!urgent && (now - lastSpoken < 5000 || speechSynthesis.speaking)) return;
  if (urgent && now - lastSpoken < 1200) return;
  lastSpoken = now; if (urgent) speechSynthesis.cancel();
  const p = PERSONALITIES[ctx.prefs.personality];
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'ru-RU'; utterance.rate = p.voiceRate; utterance.pitch = p.voicePitch;
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('ru')); if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}
function keepAwake(run) {
  if (!navigator.wakeLock || mode === 'demo' || (wakeLock && !wakeLock.released)) return;
  navigator.wakeLock.request('screen').then(lock => { if (generation === run) wakeLock = lock; else lock.release(); }).catch(() => {});
}
let speechUnlocked = false;
export function unlockSpeech() {
  if (!('speechSynthesis' in window) || speechUnlocked) return;
  speechUnlocked = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'ru-RU'; speechSynthesis.speak(u); speechSynthesis.getVoices(); } catch { /* optional */ }
}
export function ensureAudio() {
  if (!ctx.prefs.sound) return;
  try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {}); } catch { audioCtx = null; }
}
function playCue(kind) {
  const notes = EARCONS[kind];
  if (!notes || !ctx.prefs.sound || !audioCtx || audioCtx.state !== 'running' || state !== 'live') return;
  const t0 = audioCtx.currentTime;
  for (const [freq, at, dur] of notes) {
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.type = kind === 'warning' ? 'triangle' : 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at); gain.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(gain).connect(audioCtx.destination); osc.start(t0 + at); osc.stop(t0 + at + dur + 0.02);
  }
}
function flash(kind) { const node = $('stageFlash'); node.removeAttribute('data-kind'); void node.offsetWidth; node.dataset.kind = kind; }
const farActive = () => farManual ?? (ctx.prefs.autoFar && farState.far);
function renderFar() {
  if (!stage) return;
  const on = Boolean(farActive()) && ['live', 'paused'].includes(state);
  stage.dataset.far = String(on); $('liveFar').setAttribute('aria-pressed', String(on));
  if (!on) return;
  const last = cues.at(-1);
  $('farText').textContent = last?.text || ''; $('farText').className = `far-text ${last?.kind || 'tip'}`;
}

/* ───────────── Drawing ───────────── */

function canvasContext(canvas) {
  const { width, height } = canvas.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); return { ctx: context, width, height };
}
function drawPose(landmarks, ball) {
  const { ctx: c, width, height } = canvasContext(overlay); c.clearRect(0, 0, width, height);
  if (!video.videoWidth) return;
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const ox = (width - video.videoWidth * scale) / 2, oy = (height - video.videoHeight * scale) / 2;
  const point = p => ({ x: p.x * video.videoWidth * scale + ox, y: p.y * video.videoHeight * scale + oy });
  if (landmarks?.length && ctx.prefs.skeleton) {
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(255,255,255,.85)'; c.fillStyle = '#ffffff';
    for (const [a, b] of POSE_CONNECTIONS) { const p = landmarks[a], q = landmarks[b]; if (!p || !q || (p.visibility ?? 1) < .5 || (q.visibility ?? 1) < .5) continue; const u = point(p), v = point(q); c.beginPath(); c.moveTo(u.x, u.y); c.lineTo(v.x, v.y); c.stroke(); }
    for (const p of landmarks) { if ((p.visibility ?? 1) < .5) continue; const v = point(p); c.beginPath(); c.arc(v.x, v.y, 3.5, 0, Math.PI * 2); c.fill(); }
  }
  if (ball) {
    const centre = point(ball); const r = Math.max(10, ball.r * video.videoWidth * scale);
    c.lineWidth = 2.5; c.strokeStyle = '#ffd166'; c.beginPath(); c.arc(centre.x, centre.y, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#ffd166'; c.font = '600 11px sans-serif'; c.fillText('мяч', centre.x + r + 4, centre.y + 4);
  }
}

/* ───────────── Demo (labelled simulation) ───────────── */

function demoPose(seconds) {
  const p = Array.from({ length: 33 }, () => ({ x: .5, y: .25, z: 0, visibility: 1 }));
  const set = (i, x, y) => { p[i] = { x, y, z: 0, visibility: 1 }; };
  set(0, .5, .19); set(11, .42, .31); set(12, .58, .31); set(13, .36, .43); set(14, .65, .42); set(15, .31, .52); set(16, .69, .49); set(23, .45, .53); set(24, .55, .53); set(25, .43, .7); set(26, .58, .7); set(27, .41, .88); set(28, .61, .88); set(29, .40, .89); set(30, .62, .89); set(31, .37, .9); set(32, .66, .9);
  const phase = Math.floor(seconds / 9) % 3;
  const lift = phase === 0 ? 0 : Math.pow(Math.max(0, Math.sin(seconds * 1.55)), 2) * .16;
  if (sessionSkill === 'squats') {
    const d = seconds < 4 ? 0 : (Math.sin(seconds * 1.25) + 1) / 2;
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24]) p[i].y += d * .15;
    p[25].x = .43 - d * .15; p[26].x = .58 + d * .15;
  } else {
    for (const i of [28, 30, 32]) p[i].y -= sessionSkill === 'balance' ? (seconds < 3 ? 0 : .13) : lift;
    p[26].y -= lift * .45; p[26].x += lift * .2;
  }
  return { points: p, phase };
}
function demoBall(seconds, phase, foot) {
  if (sessionSkill !== 'football' || phase !== 2) return [];
  const bounce = Math.abs(Math.sin(seconds * 1.55));
  return [{ x: foot.x + .03, y: foot.y - .05 - bounce * .22, w: .07, h: .07, score: .9 }];
}
function renderDemo(now) {
  const { ctx: c, width: w, height: h } = canvasContext(demoCanvas); c.clearRect(0, 0, w, h);
  const gradient = c.createLinearGradient(0, 0, w, h); gradient.addColorStop(0, '#1c1c24'); gradient.addColorStop(1, '#0a0a0f'); c.fillStyle = gradient; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1;
  for (let n = 0; n < 9; n++) { c.beginPath(); c.moveTo(w / 2, h * .38); c.lineTo(w * (n / 8), h); c.stroke(); }
  for (let n = 0; n < 7; n++) { const y = h * (.47 + n * .085); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  const seconds = elapsedMs / 1000;
  const { points, phase } = demoPose(seconds);
  const map = p => ({ x: p.x * w, y: p.y * h * .82 + h * .05 });
  const parts = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
  c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = w * .026; c.strokeStyle = '#e8e8ee';
  for (const [a, b] of parts) { const u = map(points[a]), v = map(points[b]); c.beginPath(); c.moveTo(u.x, u.y); c.lineTo(v.x, v.y); c.stroke(); }
  const head = map(points[0]); c.fillStyle = '#f4f4f8'; c.beginPath(); c.arc(head.x, head.y, w * .049, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ee2a7b';
  for (const i of [11, 12, 13, 14, 23, 24, 25, 26, 27, 28]) { const v = map(points[i]); c.beginPath(); c.arc(v.x, v.y, 4, 0, Math.PI * 2); c.fill(); }
  const detections = demoBall(seconds, phase, points[32]);
  if (detections[0]) { const b = map(detections[0]); c.fillStyle = '#ffd166'; c.beginPath(); c.arc(b.x, b.y, w * .042, 0, Math.PI * 2); c.fill(); }
  if (now - lastAnalysis > 110) {
    lastAnalysis = now;
    const observed = observePose(points, demo.pose, now, w / h, sessionSkill); demo.pose = observed.state;
    demo.ball = trackBall(detections, demo.ball, now, observed.obs, w / h);
    const stepped = stepSession(demo.session, observed.obs, demo.ball, now); demo.session = stepped.session;
    handleResult({ landmarks: null, ball: null, quality: observed.obs.quality, feedback: stepped.feedback, lesson: stepped.lesson, metrics: stepped.metrics, scale: observed.obs.quality === 'good' ? observed.obs.legScale : null });
  }
}

/* ───────────── Live LLM phrases ───────────── */

function snapshot() {
  const session = mode === 'demo' ? demo?.session : engine?.session;
  const metrics = lastResult?.metrics || {};
  return {
    skillId: sessionSkill, personality: ctx.prefs.personality, lesson: lastResult?.lesson || null,
    lessonsDone: metrics.lessonsDone || 0, seconds: Math.floor(elapsedMs / 1000),
    touches: metrics.touches || 0, streak: metrics.streak || 0, bestStreak: metrics.bestStreak || 0, drops: metrics.drops || 0,
    lifts: metrics.lifts || 0, reps: metrics.reps || 0, balanceSeconds: metrics.balanceSeconds || 0,
    ballSeen: Boolean(metrics.ballSeen), visiblePercent: frames.total ? Math.round(frames.good / frames.total * 100) : 0,
    mainMistake: session ? mainMistake(session) : null, cues: cues.length,
  };
}
function maybeAskLiveCoach() {
  const coach = ctx.getLiveCoach();
  if (mode === 'demo' || !coach || coach.busy || state !== 'live') return;
  if (elapsedMs - lastLiveAt < 12000 || elapsedMs < 8000) return;
  if (lastResult?.quality !== 'good') return;
  if ((lastResult?.timing?.poseMs || 0) > 110) return;
  lastLiveAt = elapsedMs; const run = generation;
  coach.generate(buildSummary(snapshot()), 'live').then(value => { if (value && run === generation && state === 'live') addFeedback({ text: value, kind: 'tip', tag: 'live', source: 'llm' }); });
}

/* ───────────── Summary ───────────── */

function stopSession() {
  const wasActive = ['live', 'paused'].includes(state);
  const wasLoading = state === 'loading';
  const wasDemo = mode === 'demo';
  const skill = getSkill(sessionSkill);
  const metrics = lastResult?.metrics || {};
  const summary = snapshot();
  const useTouches = skill.id === 'football' && metrics.ballEverSeen;
  const metricValue = skill.id === 'football' ? (useTouches ? metrics.touches : metrics.lifts) : skill.id === 'squats' ? metrics.reps : metrics.balanceSeconds;
  const metricLabel = skill.id === 'football' ? (useTouches ? 'касаний' : 'подъёмов стопы') : skill.id === 'squats' ? 'повторов' : 'с баланса';
  const record = { date: new Date().toISOString(), goal: skill.goal, skill: sessionSkill, seconds: Math.floor(elapsedMs / 1000), metricValue: metricValue || 0, metricLabel, lessonsDone: metrics.lessonsDone || 0, lessonsTotal: skill.lessons.length, bestStreak: metrics.bestStreak || 0, cues: cues.length };
  hideLive();
  if (!wasActive) { if (wasLoading) bus.emit('live-cancelled'); return; }
  if (!wasDemo && record.seconds > 0) ctx.onHistory(record);
  const done = record.lessonsDone;
  const lastLesson = skill.lessons[Math.min(done, skill.lessons.length) - 1];
  const mistake = summary.mainMistake;
  const nextLesson = skill.lessons[done];
  const planNext = !wasDemo && done >= skill.lessons.length ? nextInPlan(ctx.prefs.plan, sessionSkill) : null;
  const data = {
    skillId: sessionSkill, skillName: skill.name, demo: wasDemo, seconds: record.seconds, metricValue: record.metricValue, metricLabel, lessonsDone: done, lessonsTotal: skill.lessons.length, bestStreak: record.bestStreak,
    done: done ? `выполнено ${done} из ${skill.lessons.length}${lastLesson ? `, последний «${lastLesson.title}»` : ''}${record.bestStreak ? `, лучшая серия ${record.bestStreak}` : ''}.` : 'шаги урока пока не засчитаны, это нормально для первого раза.',
    mistake: mistake && mistakeAdvice[mistake.tag] ? `${mistakeAdvice[mistake.tag][0].toLowerCase()} (${mistake.count} раз).` : mistake ? `${(cueLabels[mistake.tag] || mistake.tag).toLowerCase()} (${mistake.count} раз).` : 'явных ошибок тренер не заметил.',
    next: planNext ? `следующий навык по маршруту «${getSkill(planNext).name}».` : nextLesson ? `«${nextLesson.title}», ${nextLesson.goal.toLowerCase()}.` : mistake && mistakeAdvice[mistake.tag] ? mistakeAdvice[mistake.tag][1] : 'повтори урок и попробуй увеличить серию.',
    live: '',
  };
  text('summaryTitle', wasDemo ? 'Демо завершено' : done >= skill.lessons.length ? 'Урок пройден целиком' : done > 0 ? 'Хорошая работа' : 'Начало положено');
  text('summarySub', `${skill.emoji} ${skill.name} · ${PERSONALITIES[ctx.prefs.personality].name} тренер`);
  text('summaryTime', formatTime(record.seconds)); text('summaryMetric', record.metricValue); text('summaryMetricLabel', metricLabel); text('summaryLessons', `${done}/${skill.lessons.length}`);
  const notes = $('summaryNotes'); notes.replaceChildren();
  for (const [label, value] of [['Получилось', data.done], ['Главная ошибка', data.mistake], ['Следующий шаг', data.next]]) { const row = el('div', 'summary-row'); row.append(el('b', null, label), el('span', null, value)); notes.append(row); }
  notes.append(el('p', 'muted-note', wasDemo ? 'Это была демонстрация на нарисованном спортсмене. Показатели условные и не сохранены.' : skill.needsBall && !metrics.ballEverSeen ? 'Мяч не был виден камере, поэтому касания не считались: только подъёмы стопы по позе.' : 'Все наблюдения сделаны моделями на твоём устройстве.'));
  text('summaryPrivate', wasDemo ? 'Демо не сохраняется в историю.' : 'Сохранён только итог. Видео не записывалось.');
  $('summaryLive').hidden = true; text('summaryLiveText', '');
  lastSummaryText = `Aimo · ${skill.name}: ${formatTime(record.seconds)} в движении, ${record.metricValue} ${metricLabel}, шагов ${done}/${skill.lessons.length}. Получилось: ${data.done} Главная ошибка: ${data.mistake} Следующий шаг: ${data.next}`;
  openSheet('sheetSummary');
  if (planNext) { ctx.prefs.skill = planNext; store.savePrefs(ctx.prefs); toast(`Шаг маршрута пройден. Следующий навык: ${getSkill(planNext).name}`); }
  bus.emit('live-finished', data);
  const coach = ctx.getLiveCoach();
  if (!wasDemo && coach && record.seconds > 20) {
    coach.generate(buildSummary(summary), 'final').then(value => { if (value) { text('summaryLiveText', value); $('summaryLive').hidden = false; bus.emit('live-final-text', { ...data, live: value }); } });
  }
}
async function shareSummary() {
  if (!lastSummaryText) return;
  try {
    if (navigator.share) { await navigator.share({ text: lastSummaryText }); return; }
    await navigator.clipboard.writeText(lastSummaryText); toast('Итог скопирован');
  } catch { /* user cancelled */ }
}
