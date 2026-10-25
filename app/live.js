// Live screen: camera (or a video file, or the labelled demo), the vision
// engine loop and a calm screen: one lesson card, one counter, one coach line,
// three controls and a menu for everything else. The coach speaks through a
// queue that never cuts a phrase off. No frame ever leaves the device; the LLM
// only receives numbers.
import { createCoachEngine, observePose, trackBall, createSession, stepSession, describeLesson, createPoseState, createBallState, mainMistake, farModeDecision, POSE_CONNECTIONS } from '../coach-engine.js';
import { getSkill, PERSONALITIES, SKILL_LIST } from '../skills/index.js';
import { buildSummary } from '../coach-llm.js';
import { nextInPlan, pluralize } from '../coach-planner.js';
import { $, text, el, toast, haptic, bus, formatTime, openSheet, closeSheet, rhythmNode } from './ui.js';
import { rhythmStats, rhythmText } from '../rhythm.js';
import * as store from './store.js';
import { openCameraStream } from './camera.js';
import { createVoiceQuestion } from './speech.js';
import { trainerAudio } from './trainer-audio.js';
import { createVoiceQueue, VOICE_PRIORITY } from './voice-queue.js';
import { cleanQuestion, answerTrainingQuestion, buildQuestionMessages, validateQuestionReply } from '../coach-questions.js';

// What the frame guide says while the athlete is not fully in view (shown at once, spoken rarely).
const FRAMING_TEXT = {
  'no-person': 'Встань в кадр целиком',
  'show-feet': 'Нужны колени и стопы в кадре',
  'show-body': 'Нужно всё тело: от головы до стоп',
  'turn-side': 'Повернись боком к камере',
  'turn-front': 'Повернись лицом к камере',
  muted: 'Камеру приостановила система',
};
const EARCONS = { lesson: [[523, 0, .1], [659, .11, .1], [784, .22, .2]], count: [[880, 0, .045]] };
const word = (n, forms) => pluralize(n, forms).split(' ').slice(1).join(' ');

const ctx = { prefs: null, profile: null, ensureLiveCoach: null, getLiveCoach: null, onHistory: null, releaseCoach: null };
let video, overlay, demoCanvas, stage;
let state = 'idle'; let mode = 'camera'; let source = 'camera'; let facingMode = 'user';
let stream = null; let engine = null; let enginePromise = null; let generation = 0; let raf = 0;
let elapsedMs = 0; let lastTick = 0; let lastAnalysis = 0; let lastVideoTime = -1; let cues = [];
let objectUrl = null; let wakeLock = null; let sessionSkill = 'football'; let lastResult = null;
let frames = { good: 0, total: 0 }; let demo = null; let lastLiveAt = 0; let lastCount = 0;
let farState = { far: false, frames: 0 }; let farManual = null; let audioCtx = null; let pendingFile = null;
let lastSummaryText = ''; let fadeTimer = 0; let guideSince = null; let muted = false; let switching = false;
// Camera view: the whole frame by default, the widest lens the phone offers.
let lens = { ultraId: null, active: false };
// Rhythm: the moments the engine counted repetitions, touches or lifts.
let tally = { key: null, count: 0, times: [], words: null };
// Technical line for phone tests: tap the timer or open the page with ?debug.
let debugOn = /[?&]debug\b/.test(location.search);
let rate = { n: 0, since: 0, fps: 0, poseMs: 0 };
let voiceQuestion = null; let questionBusy = false; let questionSerial = 0;
const voice = createVoiceQueue({
  start: (message, item, done) => trainerAudio.speak(message, ctx.prefs, PERSONALITIES[ctx.prefs.personality], { timeoutMs: 6000, onEnd: done }),
  stop: () => trainerAudio.cancel({ fade: true }),
  now: () => performance.now(),
});

export function initLive({ prefs, profile, ensureLiveCoach, getLiveCoach, onHistory, releaseCoach }) {
  Object.assign(ctx, { prefs, profile, ensureLiveCoach, getLiveCoach, onHistory, releaseCoach });
  facingMode = prefs.facing;
  video = $('cameraVideo'); overlay = $('poseCanvas'); demoCanvas = $('demoCanvas'); stage = $('stage');
  $('liveClose').addEventListener('click', () => stopSession());
  $('livePause').addEventListener('click', togglePause);
  $('liveMore').addEventListener('click', (event) => { event.stopPropagation(); setMenu($('liveMenu').hidden); });
  stage.addEventListener('click', (event) => { if (!$('liveMenu').hidden && !event.target.closest('#liveMenu, #liveMore')) setMenu(false); });
  $('liveSkip').addEventListener('click', () => {
    setMenu(false);
    if (mode === 'demo' || !engine || state !== 'live') return;
    engine.skip(); toast('Шаг пропущен. Он отмечен как невыполненный.');
  });
  // Camera and scale are explicit choices, not toggles: the menu shows what is really active.
  $('camUser').addEventListener('click', () => chooseCamera('user', false));
  $('camRear').addEventListener('click', () => chooseCamera('environment', false));
  $('camWide').addEventListener('click', () => chooseCamera('environment', true));
  $('fitContain').addEventListener('click', () => chooseFit('contain'));
  $('fitCover').addEventListener('click', () => chooseFit('cover'));
  $('liveTimer').addEventListener('click', () => { debugOn = !debugOn; renderDebug(); });
  $('liveVoice').addEventListener('click', () => { ctx.prefs.voice = !ctx.prefs.voice; store.savePrefs(ctx.prefs); applyPrefs(); if (!ctx.prefs.voice) voice.stop(); bus.emit('prefs-changed'); });
  $('liveSkeleton').addEventListener('click', () => { ctx.prefs.skeleton = !ctx.prefs.skeleton; store.savePrefs(ctx.prefs); applyPrefs(); bus.emit('prefs-changed'); });
  $('liveFar').addEventListener('click', () => { farManual = !farActive(); renderFar(); });
  $('liveRetry').addEventListener('click', () => startLive({ skillId: sessionSkill, mode: source === 'file' && pendingFile ? 'file' : 'camera', file: pendingFile }));
  $('liveErrorDemo').addEventListener('click', () => startLive({ skillId: sessionSkill, mode: 'demo' }));
  $('liveErrorBack').addEventListener('click', () => hideLive());
  $('summaryAgain').addEventListener('click', () => { closeSheet(); startLive({ skillId: ctx.prefs.skill, mode: 'camera' }); });
  $('summaryClose').addEventListener('click', () => closeSheet());
  $('summaryShare').addEventListener('click', shareSummary);
  voiceQuestion = createVoiceQuestion({
    onText(question) { $('liveQuestionInput').value = question; askQuestion(question); },
    onState(status, message) {
      const listening = ['starting', 'listening'].includes(status);
      $('liveQuestionMic').setAttribute('aria-pressed', String(listening));
      $('liveQuestionMic').querySelector('span').textContent = listening ? 'Выключить микрофон' : 'Сказать вопрос';
      if (message) text('liveQuestionStatus', message);
    },
  });
  $('liveAsk').addEventListener('click', () => {
    if (state !== 'live') return;
    if (!$('liveQuestionPanel').hidden) { closeQuestion(); return; }
    setMenu(false);
    $('liveQuestionPanel').hidden = false; stage.dataset.question = 'open'; $('liveAsk').setAttribute('aria-expanded', 'true');
    if (!voiceQuestion.supported) text('liveQuestionStatus', 'В этом браузере голосовой ввод недоступен. Напиши вопрос.');
    $('liveQuestionMic').disabled = !voiceQuestion.supported || questionBusy;
    $('liveQuestionInput').focus({ preventScroll: true });
  });
  $('closeLiveQuestion').addEventListener('click', closeQuestion);
  $('liveQuestionMic').addEventListener('click', () => {
    if (state !== 'live' || questionBusy) return;
    if (voiceQuestion.listening) { voiceQuestion.abort(); text('liveQuestionStatus', 'Микрофон выключен.'); return; }
    voice.stop(); // the microphone must not hear the coach
    voiceQuestion.start();
  });
  $('liveQuestionForm').addEventListener('submit', event => { event.preventDefault(); askQuestion($('liveQuestionInput').value); });
  video.addEventListener('ended', () => { if (source === 'file' && state === 'live') stopSession(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'live') { togglePause(); toast('Эфир на паузе, пока приложение свёрнуто'); } });
  window.addEventListener('pagehide', () => {
    const pending = enginePromise; cancelRun(); engine = null; enginePromise = null;
    pending?.then(value => { value.close(); if (engine === value) engine = null; }).catch(() => {});
  });
  // Back from the browser cache: the camera and models were released on pagehide.
  window.addEventListener('pageshow', (event) => { if (event.persisted && state !== 'idle') { hideLive(); toast('Эфир остановлен, пока страница была скрыта'); } });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || state === 'idle') return;
    if (!$('liveMenu').hidden) { setMenu(false); event.preventDefault(); return; }
    if (!$('liveQuestionPanel').hidden) { closeQuestion(); event.preventDefault(); return; }
    if (state === 'live') stopSession();
  });
}

export const isActive = () => ['live', 'paused', 'loading'].includes(state);
export function setProfile(profile) { ctx.profile = profile; }
/** Detector preference applies to the next session. */
export function resetEngine() {
  if (isActive()) { toast('Настройка детектора предметов применится при следующем эфире'); return; }
  dropEngine();
}
function dropEngine() {
  const pending = enginePromise; engine = null; enginePromise = null;
  pending?.then(v => v.close()).catch(() => {});
}
export function applyPrefs() {
  if (!$('liveVoice')) return;
  $('liveVoice').setAttribute('aria-checked', String(ctx.prefs.voice));
  $('liveSkeleton').setAttribute('aria-checked', String(ctx.prefs.skeleton));
  const mirror = ctx.prefs.mirror && source === 'camera' && mode !== 'demo' && facingMode === 'user';
  if (video) video.style.transform = mirror ? 'scaleX(-1)' : '';
  if (overlay) overlay.style.transform = mirror ? 'scaleX(-1)' : '';
  const whole = ctx.prefs.fit !== 'cover';
  if (video) video.style.objectFit = whole ? 'contain' : 'cover';
  $('fitContain').setAttribute('aria-checked', String(whole));
  $('fitCover').setAttribute('aria-checked', String(!whole));
  renderCamera(); renderFar();
}
function chooseFit(fit) {
  if (ctx.prefs.fit === fit) return;
  ctx.prefs.fit = fit; store.savePrefs(ctx.prefs); applyPrefs(); haptic(6);
}
/** Which camera is really on: from the track's own settings, not from what was asked for. */
function activeCamera() {
  const settings = stream?.getVideoTracks()[0]?.getSettings?.() || {};
  const facing = settings.facingMode === 'user' || settings.facingMode === 'environment' ? settings.facingMode : facingMode;
  const wide = facing === 'environment' && Boolean(lens.ultraId) && settings.deviceId === lens.ultraId;
  return { facing, wide };
}
function renderCamera() {
  if (!$('camUser')) return;
  const { facing, wide } = activeCamera();
  const locked = source !== 'camera' || mode === 'demo';
  $('camUser').setAttribute('aria-checked', String(facing === 'user'));
  $('camRear').setAttribute('aria-checked', String(facing === 'environment' && !wide));
  $('camWide').setAttribute('aria-checked', String(facing === 'environment' && wide));
  $('camWide').hidden = !lens.ultraId;
  for (const id of ['camUser', 'camRear', 'camWide']) $(id).disabled = locked || switching;
}
async function chooseCamera(facing, wide) {
  const current = activeCamera();
  if (current.facing === facing && current.wide === wide) { setMenu(false); return; }
  setMenu(false);
  const previous = { facingMode, wide: ctx.prefs.wide };
  facingMode = facing; ctx.prefs.wide = wide;
  await restartCamera(() => {
    const actual = activeCamera();
    ctx.prefs.facing = actual.facing; store.savePrefs(ctx.prefs);
    if (wide && !actual.wide) return 'Широкий угол недоступен: обычная задняя камера';
    return actual.facing === 'user' ? 'Фронтальная камера' : actual.wide ? 'Задняя камера · широкий угол 0.5×' : 'Задняя камера';
  }, () => { facingMode = previous.facingMode; ctx.prefs.wide = previous.wide; });
}
function setMenu(open) {
  $('liveMenu').hidden = !open;
  $('liveMore').setAttribute('aria-expanded', String(open));
  if (open) $('liveMenu').querySelector('[aria-checked="true"]:not(:disabled), .menu-item:not([hidden]):not(:disabled)')?.focus({ preventScroll: true });
}

/* ───────────── Start / stop ───────────── */

function showLive() { $('liveScreen').hidden = false; $('app').dataset.live = 'on'; closeSheet(); }
function hideLive() {
  cancelRun(); state = 'idle'; $('skillPlate').hidden = true; $('liveScreen').hidden = true; $('app').dataset.live = 'off'; $('liveError').hidden = true; $('loadingCover').hidden = true;
  const pending = enginePromise; engine = null; enginePromise = null; pending?.then(value => value.close()).catch(() => {});
}

/* The «Эфир» tab: the camera is on and a plate at the top offers the catalog. The button hides the
   plate, the app opens a new chat for this session, and the live restarts with the chosen skill. */
let plateSkill = null;
function renderPlate(open) {
  const plate = $('skillPlate'); plate.hidden = !open;
  if (!open) return;
  plateSkill = sessionSkill;
  const list = $('skillPlateList'); list.replaceChildren();
  for (const skill of SKILL_LIST) {
    const chip = el('button', 'chip', `${skill.emoji} ${skill.short || skill.name}`); chip.type = 'button';
    chip.setAttribute('role', 'radio'); chip.setAttribute('aria-checked', String(skill.id === plateSkill));
    chip.addEventListener('click', () => { plateSkill = skill.id; haptic(6); list.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-checked', String(c === chip))); text('skillPlateLabel', `Начать эфир: ${skill.short || skill.name}`); });
    list.append(chip);
  }
  text('skillPlateLabel', `Начать эфир: ${getSkill(plateSkill).short || getSkill(plateSkill).name}`);
}
export function initPlate() {
  $('skillPlateGo').addEventListener('click', () => {
    const skillId = plateSkill || sessionSkill; $('skillPlate').hidden = true; haptic(8);
    bus.emit('live-pick', { skillId });
    if (skillId !== sessionSkill || state === 'error') startLive({ skillId, mode: 'camera' });
  });
}

export async function startLive({ skillId, mode: newMode = 'camera', file = null, pick = false } = {}) {
  unlockSpeech(); ensureAudio();
  sessionSkill = getSkill(skillId || ctx.prefs.skill).id; ctx.prefs.skill = sessionSkill; store.savePrefs(ctx.prefs);
  renderPlate(pick && newMode === 'camera');
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
      const media = await openCamera();
      if (generation !== run) { media.getTracks().forEach(t => t.stop()); return; }
      attachStream(media); await video.play(); renderCamera();
      await ensureEngine(run); if (generation !== run) return;
    }
    engine.start(sessionSkill, ctx.prefs.personality); beginLive(run);
  } catch (error) { if (generation === run) showError(error); }
}

function resetSession(newMode, newSource) {
  cancelRun();
  mode = newMode; source = newSource; $('app').dataset.mode = mode;
  elapsedMs = 0; cues = []; lastAnalysis = 0; lastVideoTime = -1; lastResult = null; frames = { good: 0, total: 0 }; lastLiveAt = 0; lastCount = 0;
  farState = { far: false, frames: 0 }; farManual = null; text('farText', ''); text('farStep', ''); guideSince = null; muted = false;
  tally = { key: null, count: 0, times: [], words: null }; rate = { n: 0, since: 0, fps: 0, poseMs: 0 };
  lens = { ultraId: null, active: false }; renderDebug(); setMenu(false); renderGuide(null);
  $('feedbackList').replaceChildren(); $('liveError').hidden = true;
  text('liveTimer', '00:00'); text('liveMetricValue', '0');
  $('liveQuestionInput').value = ''; text('liveQuestionReply', ''); $('liveQuestionReply').hidden = true;
  const skill = getSkill(sessionSkill);
  text('liveMetricLabel', skill.metric.unit === 'с' ? 'секунд' : (skill.metric.fallbackLabel || skill.metric.label));
  text('liveBadge', mode === 'demo' ? 'ДЕМО' : source === 'file' ? 'ВИДЕО' : 'LIVE'); $('liveBadge').dataset.kind = mode === 'demo' ? 'demo' : source;
  for (const id of ['fitContain', 'fitCover']) $(id).disabled = mode === 'demo';
  $('liveSkip').disabled = mode === 'demo';
  applyPrefs();
  return generation;
}
function setState(next) {
  state = next; $('liveScreen').dataset.state = next;
  $('loadingCover').hidden = next !== 'loading';
  $('livePause').querySelector('span').textContent = next === 'paused' ? 'Дальше' : 'Пауза';
  $('livePause').setAttribute('aria-label', next === 'paused' ? 'Продолжить' : 'Пауза');
  $('livePause').querySelector('use').setAttribute('href', next === 'paused' ? '#i-play' : '#i-pause');
  renderFar();
  $('liveAsk').disabled = next !== 'live';
  $('liveQuestionSend').disabled = next !== 'live' || questionBusy;
}
function startDemo(run) {
  demo = { pose: createPoseState(), ball: createBallState(), session: createSession(sessionSkill, { personality: ctx.prefs.personality }) };
  beginLive(run);
}
function beginLive(run) {
  setState('live'); lastTick = performance.now();
  if (mode !== 'demo' && ctx.prefs.liveCoach) ctx.ensureLiveCoach().catch(() => {});
  keepAwake(run);
  renderLesson(mode === 'demo' ? describeLesson(demo.session) : engine ? describeLesson(engine.session) : null);
  raf = requestAnimationFrame(t => tick(t, run));
}
function showError(error) {
  cancelRun(); setState('error');
  const messages = {
    NotAllowedError: 'Доступ к камере не разрешён. Разреши камеру в настройках сайта или попробуй демо.',
    NotFoundError: 'Камера не найдена. Подключи камеру или открой видеофайл.',
    NotReadableError: 'Камера занята другим приложением. Закрой его и попробуй снова.',
    OverconstrainedError: 'Камера не поддерживает нужный режим. Попробуй другую камеру.',
  };
  const message = messages[error.name] || (error.message?.includes('HTTPS') || error.message?.includes('браузер') ? error.message : 'Не удалось подготовить эфир. Проверь интернет и доступ к камере. Можно открыть демо.');
  text('liveErrorText', message); $('liveError').hidden = false;
  bus.emit('live-failed', message);
  console.warn('Aimo session:', error.name, error.message);
}
function releaseMedia() {
  if (stream) stream.getTracks().forEach(track => { track.onended = null; track.onmute = null; track.onunmute = null; track.stop(); });
  stream = null; video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
function cancelRun() {
  closeQuestion();
  generation++; cancelAnimationFrame(raf); raf = 0; releaseMedia();
  overlay?.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  voice.stop(); trainerAudio.release();
  audioCtx?.suspend().catch(() => {});
  clearTimeout(fadeTimer);
  $('stageFlash').removeAttribute('data-kind');
}
async function ensureEngine(run) {
  if (!enginePromise) {
    const pending = createCoachEngine({ objects: ctx.prefs.objects, onStatus(message) { if (generation === run) text('loadingText', message); } })
      .then(value => { if (enginePromise !== pending) { value.close(); throw new DOMException('Session cancelled', 'AbortError'); } engine = value; return value; })
      .catch(error => { if (enginePromise === pending) enginePromise = null; throw error; });
    enginePromise = pending;
  }
  return enginePromise;
}

/* ───────────── Camera ───────────── */

async function openCamera() {
  const opened = await openCameraStream(navigator.mediaDevices, { facing: facingMode, wide: ctx.prefs.wide });
  lens = opened.lens;
  // Cameras with optical or digital zoom start at their widest setting.
  const track = opened.media.getVideoTracks()[0];
  try {
    const caps = track?.getCapabilities?.();
    if (caps?.zoom && Number.isFinite(caps.zoom.min) && (track.getSettings().zoom ?? caps.zoom.min) > caps.zoom.min) await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
  } catch { /* zoom is not supported */ }
  return opened.media;
}
/** Watches the camera: the system may pause it (a call, the lock screen) or take it away. */
function attachStream(media) {
  stream = media; video.srcObject = media; muted = false;
  const track = media.getVideoTracks()[0];
  if (!track) return;
  track.onmute = () => { muted = true; renderGuide('muted'); };
  track.onunmute = () => { muted = false; renderGuide(null); };
  track.onended = () => {
    if (stream !== media || !['live', 'paused'].includes(state)) return;
    restartCamera(() => 'Камера снова работает', () => showError(new DOMException('Камера отключилась', 'NotReadableError')));
  };
}
const trackAlive = () => stream?.getVideoTracks().some(t => t.readyState === 'live');
async function restartCamera(message, onFail) {
  if (!['live', 'paused'].includes(state) || source !== 'camera' || switching) return;
  switching = true;
  const run = generation + 1; cancelRun(); setState('loading'); text('loadingText', 'Переключаем камеру…');
  try {
    const media = await openCamera();
    if (run !== generation) { media.getTracks().forEach(t => t.stop()); return; }
    attachStream(media); await video.play(); if (run !== generation) return;
    engine?.resetTracking?.(); // the old frame geometry means nothing for the new camera
    lastVideoTime = -1; applyPrefs(); beginLive(run); toast(message());
  } catch (error) { onFail?.(); if (run === generation) showError(error); }
  finally { switching = false; renderCamera(); }
}
function renderDebug() {
  const line = $('liveDebug'); line.hidden = !debugOn || mode === 'demo';
  if (line.hidden) return;
  const size = video?.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '—';
  const labels = [...new Set((lastResult?.objects || []).map(o => o.label))].slice(0, 5).join(', ').toLowerCase();
  line.textContent = `Анализ ${rate.fps.toFixed(1)} к/с · поза ${Math.round(rate.poseMs)} мс · видео ${size}${lens.active ? ' · 0.5×' : ''}${labels ? ` · в кадре: ${labels}` : ''}`;
}
async function togglePause() {
  if (state === 'live') {
    closeQuestion(); setMenu(false);
    setState('paused'); cancelAnimationFrame(raf); video.pause();
    stream?.getVideoTracks().forEach(t => { t.enabled = false; });
    voice.stop(); trainerAudio.release();
  } else if (state === 'paused') {
    // Back from the background the camera may be gone: open it again instead of showing a frozen frame.
    if (source === 'camera' && mode !== 'demo' && !trackAlive()) { await restartCamera(() => 'Камера снова работает'); return; }
    stream?.getVideoTracks().forEach(t => { t.enabled = true; });
    if (mode !== 'demo') { try { await video.play(); } catch (error) { showError(error); return; } }
    if (state !== 'paused') return;
    setState('live'); lastTick = performance.now(); raf = requestAnimationFrame(t => tick(t, generation));
    keepAwake(generation); // the system drops the wake lock while the page is hidden
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
  renderMetrics(result.metrics); renderLesson(result.lesson); trackRhythm(result.metrics);
  if (mode !== 'demo') {
    const now = performance.now(); rate.n += 1; rate.poseMs = result.timing?.poseMs ?? rate.poseMs;
    if (!rate.since) rate.since = now;
    if (now - rate.since >= 1000) { rate.fps = (rate.n * 1000) / (now - rate.since); rate.n = 0; rate.since = now; renderDebug(); }
    drawPose(result.landmarks, result.ball, result.objects);
  }
  // The frame guide shows a view problem at once (after a short moment, so a blink does not flicker it).
  if (muted) renderGuide('muted'); // a camera paused by the system explains itself first
  else if (result.quality !== 'good') { guideSince ??= performance.now(); if (performance.now() - guideSince > 700) renderGuide(result.framing || 'no-person'); }
  else { guideSince = null; renderGuide(null); }
  if (result.feedback) addFeedback(result.feedback);
  if (result.scale !== undefined) {
    const next = farModeDecision(farState, result.scale ?? NaN, result.quality);
    const switched = next.far !== farState.far; farState = next;
    if (switched && farManual === null && ctx.prefs.autoFar) renderFar();
  }
  maybeAskLiveCoach();
}
function renderGuide(problem) {
  const guide = $('frameGuide');
  guide.hidden = !problem; stage.dataset.guide = problem ? 'on' : 'off';
  if (problem) text('frameGuideText', FRAMING_TEXT[problem] || FRAMING_TEXT['no-person']);
}
function currentResult(metrics) { return getSkill(sessionSkill).result(metrics || {}); }
function trackRhythm(metrics) {
  const skill = getSkill(sessionSkill);
  if (!skill.rhythm) return; // holds are not a rhythm
  const result = currentResult(metrics);
  const fallback = skill.metric.fallbackKey && result.key === skill.metric.fallbackKey;
  if (result.key !== tally.key) tally = { key: result.key, count: result.value || 0, times: [], words: fallback ? skill.metric.fallbackRhythmWords : skill.metric.rhythmWords };
  while (tally.count < (result.value || 0)) { tally.count += 1; if (tally.times.length < 300) tally.times.push(Math.round(elapsedMs)); }
}
function rhythmSummary() {
  if (!tally.key || !tally.times.length || !tally.words) return null;
  const [label, between] = tally.words;
  return { key: tally.key, label, between, times: tally.times, durationMs: Math.max(1, Math.round(elapsedMs)), stats: rhythmStats(tally.times) };
}
function renderMetrics(metrics) {
  const skill = getSkill(sessionSkill);
  if (skill.metric.unit === 'с') {
    text('liveMetricValue', metrics.hold || 0);
    text('liveMetricLabel', metrics.bestHold ? `${word(metrics.hold || 0, ['секунда', 'секунды', 'секунд'])} · лучшее ${metrics.bestHold}` : word(metrics.hold || 0, ['секунда', 'секунды', 'секунд']));
    return;
  }
  const result = currentResult(metrics);
  const forms = result.key === skill.metric.fallbackKey ? skill.metric.fallbackForms : skill.metric.forms;
  text('liveMetricValue', result.value);
  text('liveMetricLabel', word(result.value, forms || ['раз', 'раза', 'раз']));
  if (result.value > lastCount) {
    const counter = $('liveCounter'); counter.classList.remove('bump'); void counter.offsetWidth; counter.classList.add('bump');
    playCue('count');
  }
  lastCount = result.value;
}
function renderLesson(lesson) {
  if (!lesson) return;
  $('lessonHud').dataset.complete = String(lesson.complete);
  text('lessonStep', lesson.complete ? 'Урок пройден' : `Шаг ${lesson.index + 1} из ${lesson.total}`);
  text('lessonTitle', lesson.title);
  const progress = lesson.unit === 'с' ? Math.floor(lesson.progress) : lesson.progress;
  text('lessonCount', lesson.complete ? '✓' : `${progress}/${lesson.target}${lesson.unit ? ' ' + lesson.unit : ''}`);
  $('lessonBar').style.width = lesson.complete ? '100%' : `${Math.min(100, lesson.target ? lesson.progress / lesson.target * 100 : 0)}%`;
  text('lessonGoal', lesson.goal);
  text('farStep', lesson.complete ? 'Урок пройден' : `Шаг ${lesson.index + 1}/${lesson.total} · ${progress}/${lesson.target}`);
}

/* ───────────── Coach line, voice, sounds ───────────── */

function addFeedback(feedback) {
  if (!feedback?.text) return;
  const kind = feedback.kind || 'tip'; const from = feedback.source || 'rule';
  cues.push({ text: feedback.text, kind, tag: feedback.tag, source: from, at: elapsedMs });
  cues = cues.slice(-120);
  // One line: the newest remark replaces the previous one, then quietly fades.
  const node = el('p', `coach-msg ${kind}`);
  const label = from === 'llm' ? 'Живой тренер' : feedback.tag === 'question' ? 'Ответ' : '';
  if (label) node.append(el('small', null, label));
  node.append(document.createTextNode(feedback.text));
  $('feedbackList').replaceChildren(node);
  clearTimeout(fadeTimer); fadeTimer = setTimeout(() => node.classList.add('faded'), 7000);
  speak(feedback.text, kind, feedback.tag === 'question');
  if (kind === 'lesson') { flash('lesson'); playCue('lesson'); haptic(12); }
  renderFar();
}
function speak(message, kind = 'tip', force = false) {
  if (!ctx.prefs.voice || state !== 'live' || voiceQuestion?.listening) return;
  if (questionBusy && !force) return;
  voice.say(message, { priority: force ? VOICE_PRIORITY.question : VOICE_PRIORITY[kind] || 2 });
}
function keepAwake(run) {
  if (!navigator.wakeLock || mode === 'demo' || (wakeLock && !wakeLock.released)) return;
  navigator.wakeLock.request('screen').then(lock => { if (generation === run) wakeLock = lock; else lock.release(); }).catch(() => {});
}
let speechUnlocked = false;
export function unlockSpeech() {
  trainerAudio.unlock();
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
  const t0 = audioCtx.currentTime; const peak = kind === 'count' ? 0.08 : 0.2;
  for (const [freq, at, dur] of notes) {
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at); gain.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(gain).connect(audioCtx.destination); osc.start(t0 + at); osc.stop(t0 + at + dur + 0.02);
  }
}
function flash(kind) { const node = $('stageFlash'); node.removeAttribute('data-kind'); void node.offsetWidth; node.dataset.kind = kind; }
// Large text from a distance: automatic with the camera, never in the demo (the phone is in hand).
const farActive = () => farManual ?? (mode !== 'demo' && ctx.prefs.autoFar && farState.far);
function renderFar() {
  if (!stage) return;
  const on = Boolean(farActive()) && ['live', 'paused'].includes(state);
  stage.dataset.far = String(on); $('liveFar').setAttribute('aria-checked', String(on));
  if (!on) return;
  // From three metres a long step introduction is unreadable: show the step's short goal instead.
  const last = cues.at(-1);
  const goal = last?.kind === 'lesson' ? lastResult?.lesson?.goal : '';
  $('farText').textContent = goal || last?.text || ''; $('farText').className = `far-text ${last?.kind || 'tip'}`;
}

/* ───────────── Drawing ───────────── */

function canvasContext(canvas) {
  const { width, height } = canvas.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); return { ctx: context, width, height };
}
/** The overlay is mirrored with the selfie view; text drawn on it is flipped back so it stays readable. */
function readable(c, centreX, draw) {
  if (overlay.style.transform !== 'scaleX(-1)') { draw(); return; }
  c.save(); c.translate(centreX, 0); c.scale(-1, 1); c.translate(-centreX, 0); draw(); c.restore();
}
function drawPose(landmarks, ball, objects = []) {
  const { ctx: c, width, height } = canvasContext(overlay); c.clearRect(0, 0, width, height);
  if (!video.videoWidth) return;
  const fill = ctx.prefs.fit === 'cover';
  const scale = (fill ? Math.max : Math.min)(width / video.videoWidth, height / video.videoHeight);
  const ox = (width - video.videoWidth * scale) / 2, oy = (height - video.videoHeight * scale) / 2;
  const point = p => ({ x: p.x * video.videoWidth * scale + ox, y: p.y * video.videoHeight * scale + oy });
  if (ctx.prefs.objects) {
    for (const object of objects) {
      if (object.category === 'sports ball' && ball) continue; // the tracker draws the active ball separately
      if (object.category === 'person') continue; // the skeleton already shows the athlete
      const corner = point({ x: object.x - object.w / 2, y: object.y - object.h / 2 });
      const w = object.w * video.videoWidth * scale, h = object.h * video.videoHeight * scale;
      c.strokeStyle = 'rgba(140, 219, 255, .7)'; c.lineWidth = 1.5; c.strokeRect(corner.x, corner.y, w, h);
      c.font = '600 12px sans-serif'; const labelWidth = c.measureText(object.label).width + 10;
      const x = Math.max(0, Math.min(width - labelWidth, corner.x)); const y = Math.max(18, Math.min(height - 2, corner.y));
      readable(c, x + labelWidth / 2, () => { c.fillStyle = '#001b2dd9'; c.fillRect(x, y - 18, labelWidth, 18); c.fillStyle = '#fff'; c.fillText(object.label, x + 5, y - 5); });
    }
  }
  if (landmarks?.length && ctx.prefs.skeleton) {
    c.lineWidth = 3; c.lineCap = 'round'; c.strokeStyle = 'rgba(255,255,255,.85)'; c.fillStyle = '#4c9bff';
    for (const [a, b] of POSE_CONNECTIONS) { const p = landmarks[a], q = landmarks[b]; if (!p || !q || (p.visibility ?? 1) < .5 || (q.visibility ?? 1) < .5) continue; const u = point(p), v = point(q); c.beginPath(); c.moveTo(u.x, u.y); c.lineTo(v.x, v.y); c.stroke(); }
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { const p = landmarks[i]; if (!p || (p.visibility ?? 1) < .5) continue; const v = point(p); c.beginPath(); c.arc(v.x, v.y, 4, 0, Math.PI * 2); c.fill(); }
  }
  if (ball) {
    const centre = point(ball); const r = Math.max(10, ball.r * video.videoWidth * scale);
    c.lineWidth = 2.5; c.strokeStyle = '#ffd166'; c.beginPath(); c.arc(centre.x, centre.y, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#ffd166'; c.font = '600 11px sans-serif';
    readable(c, centre.x + r + 14, () => c.fillText('мяч', centre.x + r + 4, centre.y + 4));
  }
}

/* ───────────── Demo (labelled simulation, same engine as the camera) ───────────── */

const DEMO_BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30]];
function renderDemo(now) {
  const { ctx: c, width: w, height: h } = canvasContext(demoCanvas); c.clearRect(0, 0, w, h);
  const gradient = c.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, '#202227'); gradient.addColorStop(1, '#0c0d10'); c.fillStyle = gradient; c.fillRect(0, 0, w, h);
  const skill = getSkill(sessionSkill);
  const frame = skill.demo(elapsedMs / 1000, w / h);
  const map = p => ({ x: p.x * w, y: p.y * h });
  const points = frame.points;
  const floorY = Math.max(...[29, 30, 31, 32].map(i => points[i].y)) * h + 4;
  c.strokeStyle = 'rgba(255,255,255,.1)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, floorY); c.lineTo(w, floorY); c.stroke();
  c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#e8e9ee'; c.lineWidth = Math.max(5, w * 0.022);
  for (const [a, b] of DEMO_BONES) { const u = map(points[a]), v = map(points[b]); c.beginPath(); c.moveTo(u.x, u.y); c.lineTo(v.x, v.y); c.stroke(); }
  const head = map(points[0]); const shoulders = map({ x: (points[11].x + points[12].x) / 2, y: (points[11].y + points[12].y) / 2 });
  const neck = Math.hypot(head.x - shoulders.x, head.y - shoulders.y);
  c.beginPath(); c.moveTo(shoulders.x, shoulders.y); c.lineTo(head.x, head.y); c.stroke();
  c.fillStyle = '#f4f4f8'; c.beginPath(); c.arc(head.x, head.y, Math.max(8, neck * 0.42), 0, Math.PI * 2); c.fill();
  c.fillStyle = '#4c9bff';
  for (const i of [11, 12, 13, 14, 23, 24, 25, 26, 27, 28]) { const v = map(points[i]); c.beginPath(); c.arc(v.x, v.y, 4, 0, Math.PI * 2); c.fill(); }
  const detections = frame.ball || [];
  if (detections[0]) { const b = map(detections[0]); c.fillStyle = '#ffd166'; c.beginPath(); c.arc(b.x, b.y, w * 0.035, 0, Math.PI * 2); c.fill(); }
  if (now - lastAnalysis > 110) {
    lastAnalysis = now;
    const observed = observePose(points, demo.pose, now, w / h, sessionSkill); demo.pose = observed.state;
    demo.ball = trackBall(detections, demo.ball, now, observed.obs, w / h);
    const stepped = stepSession(demo.session, observed.obs, demo.ball, now); demo.session = stepped.session;
    handleResult({ landmarks: null, ball: null, quality: observed.obs.quality, framing: observed.obs.framing, feedback: stepped.feedback, lesson: stepped.lesson, metrics: stepped.metrics, scale: observed.obs.quality === 'good' ? observed.obs.scale : null });
  }
}

/* ───────────── Live LLM phrases ───────────── */

function snapshot() {
  const session = mode === 'demo' ? demo?.session : engine?.session;
  const m = lastResult?.metrics || {};
  return {
    skillId: sessionSkill, personality: ctx.prefs.personality, lesson: lastResult?.lesson || null,
    lessonsDone: m.lessonsDone || 0, seconds: Math.floor(elapsedMs / 1000),
    touches: m.touches || 0, streak: m.streak || 0, bestStreak: m.bestStreak || 0, drops: m.drops || 0,
    lifts: m.lifts || 0, reps: m.reps || 0, clean: m.clean || 0, left: m.left || 0, right: m.right || 0, hold: m.hold || 0, bestHold: m.bestHold || 0,
    ballSeen: Boolean(m.ballSeen), ballEverSeen: Boolean(m.ballEverSeen), quality: lastResult?.quality || 'missing', objects: lastResult?.objects || [], visiblePercent: frames.total ? Math.round(frames.good / frames.total * 100) : 0,
    mainMistake: session ? mainMistake(session) : null, cues: cues.length,
  };
}
function maybeAskLiveCoach() {
  const coach = ctx.getLiveCoach();
  if (mode === 'demo' || !coach || coach.busy || state !== 'live' || questionBusy || voiceQuestion?.listening) return;
  // The live model joins the same calm budget: rarely, and never right after another remark.
  if (elapsedMs - lastLiveAt < 20000 || elapsedMs < 10000 || (cues.length && elapsedMs - cues.at(-1).at < 8000)) return;
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
  const result = skill.result(metrics);
  const usesFallback = result.key === skill.metric.fallbackKey;
  const forms = usesFallback ? skill.metric.fallbackForms : skill.metric.forms;
  const record = {
    schemaVersion: 2, source: wasDemo ? 'demo' : source, metricKey: result.key, date: new Date().toISOString(), goal: skill.goal, skill: sessionSkill,
    seconds: Math.floor(elapsedMs / 1000), metricValue: result.value || 0, metricLabel: result.label,
    lessonsDone: metrics.lessonsDone || 0, lessonsTotal: skill.lessons.length, bestStreak: metrics.bestStreak || 0, clean: metrics.clean || 0,
    personality: ctx.prefs.personality,
  };
  hideLive();
  if (!wasActive) { if (wasLoading) bus.emit('live-cancelled'); return; }
  const progress = !wasDemo && record.seconds > 0 ? ctx.onHistory(record) : null;
  // Steps by what happened, not by their count: a skipped step is not a finished one.
  const completed = (metrics.completed || []).map(id => skill.lessons.find(l => l.id === id)).filter(Boolean);
  const lastLesson = completed.at(-1);
  const index = Number.isFinite(metrics.lessonIndex) ? metrics.lessonIndex : completed.length;
  const nextLesson = skill.lessons[index] || null;
  const done = completed.length;
  const metricWord = forms ? word(record.metricValue, forms) : record.metricLabel; // «2 выпада», «13 секунд планки»
  const mistake = summary.mainMistake;
  const info = mistake ? skill.errors?.[mistake.tag] : null;
  const skipped = (metrics.skipped || []).length;
  // A route moves on only when every step was really done, not skipped.
  const planNext = !wasDemo && index >= skill.lessons.length && !skipped ? nextInPlan(ctx.prefs.plan, sessionSkill) : null;
  const data = {
    skillId: sessionSkill, skillName: skill.name, demo: wasDemo, source: record.source, progress: progress?.text || '', seconds: record.seconds,
    metricValue: record.metricValue, metricLabel: record.metricLabel, metricWord, lessonsDone: done, lessonsTotal: skill.lessons.length, bestStreak: record.bestStreak,
    done: done ? `выполнено ${done} из ${skill.lessons.length}${lastLesson ? `, последний «${lastLesson.title}»` : ''}${skipped ? `, пропущено ${skipped}` : ''}${record.bestStreak ? `, лучшая серия ${record.bestStreak}` : ''}.` : 'шаги урока пока не засчитаны, это нормально для первого раза.',
    mistake: info ? `${info.label.toLowerCase()} (${mistake.count} раз).` : mistake ? `${mistake.tag} (${mistake.count} раз).` : 'явных ошибок тренер не заметил.',
    next: planNext ? `следующий навык по маршруту «${getSkill(planNext).name}».` : nextLesson ? `«${nextLesson.title}»: ${nextLesson.goal.charAt(0).toLowerCase()}${nextLesson.goal.slice(1)}.` : info ? info.advice : 'повтори урок и попробуй улучшить результат.',
    live: '', rhythm: rhythmSummary(),
  };
  text('summaryTitle', wasDemo ? 'Демо завершено' : index >= skill.lessons.length && !skipped ? 'Урок пройден целиком' : done > 0 ? 'Хорошая работа' : 'Начало положено');
  text('summarySub', `${skill.emoji} ${skill.name} · ${PERSONALITIES[ctx.prefs.personality].name} тренер`);
  text('summaryTime', formatTime(record.seconds)); text('summaryMetric', record.metricValue); text('summaryMetricLabel', metricWord); text('summaryLessons', `${done}/${skill.lessons.length}`);
  const notes = $('summaryNotes'); notes.replaceChildren();
  for (const [label, value] of [['Получилось', data.done], ['Главная ошибка', data.mistake], ['Следующий шаг', data.next], ['Твой прогресс', data.progress]]) { if (!value) continue; const row = el('div', 'summary-row'); row.append(el('b', null, label), el('span', null, value)); notes.append(row); }
  const note = wasDemo ? 'Это была демонстрация на нарисованном спортсмене. Показатели условные и не сохранены.'
    : skill.needsBall && usesFallback ? skill.metric.fallbackNote
    : 'Все наблюдения сделаны моделями на устройстве. Число движений не оценивает технику целиком.';
  notes.append(el('p', 'muted-note', note));
  text('summaryPrivate', wasDemo ? 'Демо не сохраняется в историю.' : 'Сохранён только итог. Видео не записывалось.');
  $('summaryLive').hidden = true; text('summaryLiveText', '');
  $('summaryRhythm').replaceChildren(); $('summaryRhythm').hidden = !data.rhythm;
  if (data.rhythm) $('summaryRhythm').append(rhythmNode(data.rhythm));
  lastSummaryText = `Aimo · ${skill.name}: ${formatTime(record.seconds)} в движении, ${record.metricValue} ${metricWord}, шагов ${done}/${skill.lessons.length}. Получилось: ${data.done} Главная ошибка: ${data.mistake} Следующий шаг: ${data.next}${data.rhythm ? ` ${rhythmText(data.rhythm.stats, data.rhythm.between)}` : ''}`;
  openSheet('sheetSummary');
  if (planNext) { ctx.prefs.skill = planNext; store.savePrefs(ctx.prefs); toast(`Шаг маршрута пройден. Следующий навык: ${getSkill(planNext).name}`); }
  bus.emit('live-finished', data);
  const coach = ctx.getLiveCoach();
  if (!wasDemo && coach && record.seconds > 20) {
    const run = generation;
    coach.generate(buildSummary(summary), 'final').then(value => { if (value && run === generation && !isActive()) { text('summaryLiveText', value); $('summaryLive').hidden = false; bus.emit('live-final-text', { ...data, live: value }); } }).finally(() => ctx.releaseCoach?.(coach));
  } else ctx.releaseCoach?.(coach);
}

function closeQuestion() {
  questionSerial++; questionBusy = false; voiceQuestion?.abort();
  if ($('liveQuestionPanel')) $('liveQuestionPanel').hidden = true;
  if (stage) delete stage.dataset.question;
  $('liveAsk')?.setAttribute('aria-expanded', 'false');
  if ($('liveQuestionSend')) $('liveQuestionSend').disabled = false;
}

async function askQuestion(raw) {
  const question = cleanQuestion(raw);
  if (!question || questionBusy || state !== 'live') return;
  voiceQuestion?.abort();
  const request = ++questionSerial, run = generation;
  questionBusy = true; $('liveQuestionSend').disabled = true; $('liveQuestionMic').disabled = true;
  text('liveQuestionStatus', `Вопрос: ${question}`);
  const facts = snapshot(); const fallback = answerTrainingQuestion(question, facts);
  let answer = fallback.text, viaModel = false;
  const coach = ctx.getLiveCoach();
  try {
    if (fallback.rewrite && coach && !coach.busy && mode !== 'demo' && (lastResult?.timing?.poseMs || 0) <= 110) {
      const summary = buildSummary(facts);
      const candidate = await coach.chat(buildQuestionMessages(question, summary), { maxTokens: 120, temperature: .3 });
      const checked = validateQuestionReply(candidate, summary);
      if (checked.ok) { answer = checked.text; viaModel = true; }
    }
    if (run !== generation || request !== questionSerial || state !== 'live') return;
    questionBusy = false;
    text('liveQuestionReply', answer); $('liveQuestionReply').hidden = false;
    text('liveQuestionStatus', `Вопрос: ${question} · ${mode === 'demo' ? 'ответ по симуляции' : viaModel ? 'живой тренер' : 'ответ по правилам'}`);
    addFeedback({ text: answer, tag: 'question', kind: 'tip', source: viaModel ? 'llm' : 'rule' });
  } catch {
    if (run === generation && request === questionSerial && state === 'live') {
      questionBusy = false; text('liveQuestionReply', fallback.text); $('liveQuestionReply').hidden = false;
      speak(fallback.text, 'tip', true);
    }
  } finally {
    if (request === questionSerial) { questionBusy = false; $('liveQuestionSend').disabled = false; $('liveQuestionMic').disabled = !voiceQuestion?.supported; }
  }
}
async function shareSummary() {
  if (!lastSummaryText) return;
  try {
    if (navigator.share) { await navigator.share({ text: lastSummaryText }); return; }
    await navigator.clipboard.writeText(lastSummaryText); toast('Итог скопирован');
  } catch { /* user cancelled */ }
}
