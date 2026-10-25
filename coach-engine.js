// Vision + coaching engine. MediaPipe inference runs on this device; no video
// frames leave the browser. Everything below `createCoachEngine` is pure and
// unit-tested: body features and the skill's own movement checks
// (coach-motion.js and skills/*), ball tracking, lesson progression and the
// message budget (coach-policy.js) that decides what the coach says and when.
import { getSkill, personalityId } from './skills/index.js';
import { COMMON_PHRASES, pickPhrase, fillTemplate, pauseMemo } from './skills/common.js';
import { normalizeObjects, ballDetections } from './coach-objects.js';
import { jointAngle, bodyFeatures, calibrate, createCalibration, confirmByReps, stepLiveErrors, VIS } from './coach-motion.js';
import { createPolicy, noteView, noteActivity, choose } from './coach-policy.js';

export { jointAngle };
export const MODEL_VERSION = '0.10.21';
export const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
export const OBJECT_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
export const BALL_MODEL_URL = OBJECT_MODEL_URL;
const CDN_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MODEL_VERSION}`;

export const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 29], [29, 31], [27, 31],
  [28, 30], [30, 32], [28, 32],
];

const BALL_LOST_MS = 1500;
const BALL_SPEED = 0.18; // normalized image units per second
const distance = (a, b, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
const visibleRaw = (p) => Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && (p.visibility ?? 1) >= VIS && (p.presence ?? 1) >= VIS && p.x > 0.015 && p.x < 0.985 && p.y > 0.015 && p.y < 0.985);

/* ───────────────────────── Pose observations ───────────────────────── */

export function createPoseState() {
  return {
    samples: 0, quality: 'missing', framing: 'no-person', lifts: 0,
    ground: [null, null], feet: [{ phase: 'down', frames: 0 }, { phase: 'down', frames: 0 }], lastLiftAt: -Infinity,
    hipTrail: [], calib: createCalibration(), motion: undefined, repHistory: [], liveErrors: {},
  };
}

const NO_FEET = { lift: [0, 0], raised: false, raisedSide: -1, liftCompleted: false, liftHigh: false, completedPeak: 0, supportKnee: null, armsSpread: true };

function resetMotion(state) {
  state.samples = 0;
  state.ground = [null, null];
  state.feet = state.feet.map(() => ({ phase: 'down', frames: 0 }));
  state.hipTrail = [];
  state.liveErrors = {};
  state.motion = pauseMemo(state.motion); // totals stay, a movement in progress is dropped
}

function emptyObservation(quality, framing, points, state, f) {
  return {
    quality, framing, points, visible: false, still: false, standingStill: false,
    ...NO_FEET, lifts: state.lifts, tilt: f?.tilt ?? 0, motion: null,
    hips: null, kneeY: null, legScale: f?.legScale ?? 0.2, feet: [],
  };
}

/**
 * Foot lifts from ankle heights, calibrated per side: a foot already held up
 * when entering the frame does not count, a single jittery frame does not count.
 * Used by keepie-uppie (lifts) and balance (a raised foot).
 */
function stepFeet(state, points, f, now, aspect) {
  if (!f.legVisible[0] || !f.legVisible[1]) {
    state.ground = [null, null]; state.feet = state.feet.map(() => ({ phase: 'down', frames: 0 }));
    return { ...NO_FEET };
  }
  const ankles = [points[27], points[28]];
  ankles.forEach((ankle, side) => {
    if (state.ground[side] === null) state.ground[side] = ankle.y;
    if (state.feet[side].phase === 'down') state.ground[side] = Math.max(state.ground[side], ankle.y);
  });
  const legScale = f.legScale;
  const raiseThreshold = Math.max(0.035, legScale * 0.14);
  const lowerThreshold = Math.max(0.018, legScale * 0.06);
  const lift = ankles.map((ankle, side) => state.ground[side] - ankle.y);
  let liftCompleted = false;
  let completedPeak = 0;
  if (state.samples > 5) {
    lift.forEach((value, side) => {
      const foot = state.feet[side];
      if (foot.phase === 'down') {
        foot.frames = value > raiseThreshold ? foot.frames + 1 : 0;
        if (foot.frames >= 2) { foot.phase = 'up'; foot.frames = 0; foot.peak = value; }
      } else {
        foot.peak = Math.max(foot.peak || 0, value);
        foot.frames = value < lowerThreshold ? foot.frames + 1 : 0;
        if (foot.frames >= 2) {
          if (now - state.lastLiftAt >= 400) { state.lifts += 1; state.lastLiftAt = now; liftCompleted = true; completedPeak = foot.peak || 0; }
          foot.phase = 'down'; foot.frames = 0;
        }
      }
    });
  }
  const raisedSide = state.feet.findIndex(foot => foot.phase === 'up');
  const raised = raisedSide !== -1;
  // Height is judged at the peak of the movement, so a completed lift carries its own verdict.
  const highThreshold = legScale * 0.5;
  const liftHigh = raised ? lift[raisedSide] > highThreshold : liftCompleted && completedPeak > highThreshold;
  const supportKnee = raised ? f.knee[1 - raisedSide] : null;
  const wrists = [[15, 11], [16, 12]].filter(([w]) => visibleRaw(points[w]));
  const armsSpread = wrists.length === 0 || wrists.some(([w, s]) => Math.abs(points[w].x - points[s].x) * aspect > legScale * 0.35);
  return { lift, raised, raisedSide, liftCompleted, liftHigh, completedPeak, supportKnee, armsSpread };
}

/**
 * Pure analysis of one landmark frame for a skill. Returns { state, obs }.
 * `obs.motion` carries the skill's verdict: a counted repetition or an attempt
 * (with its errors), a hold, milestones, and errors confirmed over several
 * repetitions or a sustained moment.
 */
export function observePose(landmarks, previous, timestamp = 0, aspectRatio = 1, skillId = 'football') {
  const skill = getSkill(skillId);
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const old = previous || createPoseState();
  const state = { ...old, ground: [...old.ground], feet: old.feet.map(foot => ({ ...foot })), hipTrail: [...old.hipTrail] };
  const now = Number.isFinite(timestamp) ? timestamp : 0;
  const points = Array.isArray(landmarks) && landmarks.length >= 33 ? landmarks : null;
  const f = points ? bodyFeatures(points, aspect) : null;
  const framing = f ? skill.view(f) : 'no-person';
  if (framing) {
    const quality = f ? 'partial' : 'missing';
    resetMotion(state); state.quality = quality; state.framing = framing;
    return { state, obs: emptyObservation(quality, framing, points, state, f) };
  }
  state.samples += 1; state.quality = 'good'; state.framing = null;

  // Stillness: the hips barely move over the last ~600 ms.
  state.hipTrail.push({ t: now, x: f.hipMid.x, y: f.hipMid.y });
  state.hipTrail = state.hipTrail.filter(h => now - h.t <= 600);
  const drift = Math.max(...state.hipTrail.map(h => Math.hypot(h.x - f.hipMid.x, h.y - f.hipMid.y)));
  const still = state.hipTrail.length >= 3 && drift < f.legScale * 0.08;
  state.calib = calibrate(state.calib, f, still);
  const feet = stepFeet(state, points, f, now, aspect);

  const m = skill.measure({ f, calib: state.calib, still, feet, now }, state.motion);
  state.motion = m.memo;
  let confirmed = []; let observed = [];
  if (m.event?.type === 'rep') {
    const check = confirmByReps(state.repHistory, m.event.errors);
    state.repHistory = check.history;
    confirmed = check.confirmed.filter(tag => m.event.errors.includes(tag));
    observed = [...m.event.errors];
  } else if (m.event?.type === 'attempt') {
    confirmed = [...m.event.errors]; observed = [...m.event.errors];
  }
  const live = stepLiveErrors(state.liveErrors, m.live || [], now);
  state.liveErrors = live.state;
  const motion = {
    event: m.event || null, milestone: m.milestone || null, hold: m.hold || null, counts: m.counts || {},
    ready: Boolean(m.ready), activity: Boolean(m.activity), idle: m.idle || null, phase: m.phase || '',
    confirmed: [...new Set([...confirmed, ...live.confirmed])], observed: [...observed, ...live.started],
  };
  const obs = {
    quality: 'good', framing: null, points, visible: true, still, standingStill: still && !feet.raised,
    ...feet, lifts: state.lifts, tilt: f.tilt, motion,
    hips: { x: f.hipMid.x / aspect, y: f.hipMid.y },
    kneeY: [f.kneeY[0], f.kneeY[1]].filter(Number.isFinite).reduce((sum, y, _, list) => sum + y / list.length, 0) || null,
    legScale: f.legScale,
    // Distance to the phone: legs shrink in a squat, the torso in a bend; the larger reading is the honest one.
    scale: Math.max(f.legScale, f.torsoLen * 1.7),
    feet: [27, 28, 31, 32].map(i => points[i]).filter(visibleRaw).map(p => ({ x: p.x, y: p.y })),
  };
  return { state, obs };
}

/* ───────────────────────── Ball tracking ───────────────────────── */

export function createBallState() {
  return {
    seen: false, x: null, y: null, r: 0, vy: 0, vx: 0,
    lastSeenAt: -Infinity, lastSampleAt: -Infinity, phase: null, phaseFrames: 0,
    touches: 0, streak: 0, bestStreak: 0, lastStreak: 0, drops: 0,
    lastTouchAt: -Infinity, groundFrames: 0, event: null, awayFromBody: false, everSeen: false,
  };
}

/**
 * Pure ball tracker. `detections` are normalized boxes {x, y, w, h, score}
 * (centre coordinates). A touch is a downward-to-upward reversal next to a
 * foot; a drop is the ball resting at ground level after a flight, or lost
 * low in the frame.
 */
export function trackBall(detections, previous, timestamp = 0, obs = null, aspectRatio = 1) {
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const old = previous || createBallState();
  const state = { ...old, event: null };
  const now = Number.isFinite(timestamp) ? timestamp : 0;
  const candidates = Array.isArray(detections) ? detections.filter(d => d && Number.isFinite(d.x) && Number.isFinite(d.y) && (d.score ?? 1) >= 0.3) : [];
  let best = null;
  for (const d of candidates) {
    const near = state.seen ? -distance(d, state, aspect) : 0;
    const scoreValue = (d.score ?? 1) + near;
    if (!best || scoreValue > best.scoreValue) best = { ...d, scoreValue };
  }
  const inFlight = now - state.lastTouchAt < 2500;
  const groundY = obs?.feet?.length ? Math.max(...obs.feet.map(p => p.y)) : null;

  if (!best) {
    if (state.seen && now - state.lastSeenAt > BALL_LOST_MS) {
      state.seen = false; state.phase = null; state.phaseFrames = 0; state.vy = 0;
      if (inFlight && state.streak > 0 && obs?.kneeY !== null && state.y !== null && state.y > obs.kneeY) {
        state.event = 'drop'; state.drops += 1; state.lastStreak = state.streak; state.streak = 0;
      }
    }
    state.awayFromBody = false;
    return state;
  }

  const r = Math.max(best.w || 0, best.h || 0) / 2;
  const dt = state.seen && Number.isFinite(state.lastSampleAt) ? (now - state.lastSampleAt) / 1000 : 0;
  if (dt > 0 && dt < 1) {
    const vy = (best.y - state.y) / dt;
    const vx = (best.x - state.x) / dt;
    state.vy = state.vy * 0.3 + vy * 0.7;
    state.vx = state.vx * 0.3 + vx * 0.7;
  } else { state.vy = 0; state.vx = 0; }
  state.x = best.x; state.y = best.y; state.r = r;
  state.seen = true; state.everSeen = true; state.lastSeenAt = now; state.lastSampleAt = now;

  const feet = obs?.feet || [];
  const nearFoot = feet.some(f => distance(f, best, aspect) < r + Math.max(0.06, (obs?.legScale || 0.2) * 0.3));
  const lowZone = obs?.kneeY === null || obs?.kneeY === undefined ? true : best.y > obs.kneeY - 0.08;

  const previousPhase = state.phase;
  if (state.vy > BALL_SPEED) { state.phase = 'down'; state.phaseFrames = previousPhase === 'down' ? state.phaseFrames + 1 : 1; }
  else if (state.vy < -BALL_SPEED) { state.phase = 'up'; state.phaseFrames = previousPhase === 'up' ? state.phaseFrames + 1 : 1; }
  else { state.phaseFrames = 0; }

  if (previousPhase === 'down' && state.phase === 'up' && nearFoot && lowZone && now - state.lastTouchAt > 250) {
    state.touches += 1; state.streak += 1; state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.lastTouchAt = now; state.event = 'touch'; state.groundFrames = 0;
  }

  const onGround = groundY !== null && best.y + r >= groundY - 0.02 && Math.abs(state.vy) < BALL_SPEED;
  state.groundFrames = onGround ? state.groundFrames + 1 : 0;
  if (state.groundFrames >= 2 && state.streak > 0 && now - state.lastTouchAt > 400) {
    state.event = 'drop'; state.drops += 1; state.lastStreak = state.streak; state.streak = 0; state.groundFrames = 0;
  }
  state.awayFromBody = Boolean(obs?.hips) && Math.abs(best.x - obs.hips.x) * aspect > (obs.legScale || 0.2) * 0.7 && lowZone;
  return state;
}

/* ───────────────────────── Coaching session ───────────────────────── */

export function createSession(skillId = 'football', { personality = 'calm' } = {}) {
  const skill = getSkill(skillId);
  return {
    skillId: skill.id, personality: personalityId(personality),
    lessonIndex: 0, lessonProgress: 0, lessonMemo: null, completedLessons: [], skippedLessons: [],
    courseComplete: false, pendingIntro: true,
    phraseIndex: {}, cueCount: 0, tagCounts: {}, errorCounts: {},
    policy: createPolicy(), cueMemo: null, lastCounts: {},
  };
}

/** Lesson HUD data for a session. */
export function describeLesson(session) { return lessonView(getSkill(session.skillId), session); }

function lessonView(skill, session) {
  const lesson = skill.lessons[session.lessonIndex] || null;
  return {
    index: session.lessonIndex, total: skill.lessons.length,
    title: lesson?.title || 'Свободная практика', short: lesson?.short || 'Практика',
    goal: lesson?.goal || 'Все шаги выполнены. Продолжай в своём темпе.',
    progress: lesson ? Math.min(lesson.target, Math.floor(session.lessonProgress * 10) / 10) : 0,
    target: lesson?.target || 0, unit: lesson?.unit || '', needsBall: Boolean(lesson?.needsBall), clean: Boolean(lesson?.clean),
    complete: session.courseComplete,
  };
}

const UI_KIND = { lesson: 'lesson', safety: 'warning', framing: 'warning', attempt: 'tip', error: 'tip', praise: 'success', idle: 'tip' };
const introText = (lesson, personality) => lesson.intro[personality] || lesson.intro.calm;

function phrase(session, bank, tag) {
  const picked = pickPhrase(bank, session.personality, session.phraseIndex[tag] ?? -1, session.cueCount * 7 + session.lessonIndex * 3);
  if (picked.text) session.phraseIndex = { ...session.phraseIndex, [tag]: picked.index };
  return picked.text;
}

/**
 * Advances lessons and picks at most one remark for this frame. Pure: returns
 * a new session. Lesson events always pass; everything else goes through the
 * message budget, so the feed stays calm and the voice is never cut off.
 */
export function stepSession(previous, obs, ball, timestamp = 0) {
  const session = { ...previous, completedLessons: [...previous.completedLessons], skippedLessons: [...previous.skippedLessons], errorCounts: { ...previous.errorCounts } };
  const skill = getSkill(session.skillId);
  const now = Number.isFinite(timestamp) ? timestamp : 0;
  const safeBall = ball || createBallState();
  const motion = obs.motion || null;
  let policy = previous.policy || createPolicy();
  if (policy.activityAt === null) policy = noteActivity(policy, now);
  const lesson = skill.lessons[session.lessonIndex] || null;
  const counts = motion?.counts || session.lastCounts || {};
  const vars = {
    touches: safeBall.touches, streak: safeBall.event === 'drop' ? safeBall.lastStreak : safeBall.streak,
    lifts: obs.lifts ?? 0, reps: counts.reps ?? 0, clean: counts.clean ?? 0, seconds: Math.floor(counts.hold ?? 0), best: Math.floor(counts.best ?? 0),
    lesson: lesson?.title || '', next: skill.lessons[session.lessonIndex + 1]?.title || '',
  };
  const cues = [];
  if (session.pendingIntro && lesson) {
    session.pendingIntro = false;
    cues.push({ kind: 'lesson', tag: 'lesson-intro', text: introText(lesson, session.personality) });
  }

  policy = noteView(policy, obs.quality === 'good' ? null : obs.framing || 'no-person', now);
  if (obs.quality !== 'good') {
    const tag = obs.framing || 'no-person';
    cues.push({ kind: 'framing', tag, bank: COMMON_PHRASES[tag] || COMMON_PHRASES['no-person'] });
    return decide(skill, session, policy, cues, vars, obs, safeBall, now);
  }
  if (motion?.activity || motion?.event || safeBall.event) policy = noteActivity(policy, now);
  // Mistakes are counted when they are observed, not when the coach mentions them.
  for (const tag of motion?.observed || []) session.errorCounts[tag] = (session.errorCounts[tag] || 0) + 1;

  if (lesson && !session.courseComplete && !session.pendingIntro) {
    const { progress, memo } = lesson.update({ obs, motion, ball: safeBall, now, session }, session.lessonMemo ?? undefined);
    session.lessonProgress = progress; session.lessonMemo = memo;
    if (progress >= lesson.target) {
      policy = noteActivity(policy, now); // finishing a step is activity too: no nudge right after it
      session.completedLessons.push(lesson.id);
      session.lessonIndex += 1; session.lessonProgress = 0; session.lessonMemo = null;
      const next = skill.lessons[session.lessonIndex];
      if (!next) {
        session.courseComplete = true;
        cues.push({ kind: 'lesson', tag: 'course-complete', bank: COMMON_PHRASES['course-complete'] });
      } else {
        // One message for the finished step and the next one: «Готово. Шаг 2: …».
        const praise = phrase(session, COMMON_PHRASES['lesson-done'], 'lesson-done');
        cues.push({ kind: 'lesson', tag: 'lesson-complete', text: `${praise} ${introText(next, session.personality)}` });
      }
    }
  }

  // A not-counted attempt is explained right away; a technique error once it repeats.
  const attempted = motion?.event?.type === 'attempt' ? motion.event.errors : [];
  const fromEvent = motion?.event ? motion.event.errors || [] : [];
  for (const tag of motion?.confirmed || []) {
    if (skill.phrases[tag]) cues.push({ kind: attempted.includes(tag) ? 'attempt' : 'error', tag, once: fromEvent.includes(tag), priority: skill.errors?.[tag]?.priority || 1, bank: skill.phrases[tag] });
  }
  if (motion?.milestone && skill.phrases[motion.milestone.tag]) cues.push({ kind: 'praise', tag: motion.milestone.tag, bank: skill.phrases[motion.milestone.tag], vars: motion.milestone.vars });
  const idleTag = motion?.idle || `${skill.id}-idle`;
  if (skill.phrases[idleTag]) cues.push({ kind: 'idle', tag: idleTag, bank: skill.phrases[idleTag] });
  let list = cues;
  if (skill.cues) {
    const extra = skill.cues({ obs, motion, ball: safeBall, lesson: skill.lessons[session.lessonIndex] || null, now, session }, list, session.cueMemo);
    list = extra.cues; session.cueMemo = extra.memo;
    for (const tag of extra.observed || []) session.errorCounts[tag] = (session.errorCounts[tag] || 0) + 1;
  }
  // Every cue needs words: its own bank, the skill's bank for its tag, or the shared one.
  list = list.map(cue => (cue.text || cue.bank ? cue : { ...cue, bank: skill.phrases[cue.tag] || COMMON_PHRASES[cue.tag] })).filter(cue => cue.text || cue.bank);
  return decide(skill, session, policy, list, vars, obs, safeBall, now);
}

function decide(skill, session, policy, cues, vars, obs, ball, now) {
  const { policy: next, pick } = choose(policy, cues, now);
  session.policy = next;
  let feedback = null;
  if (pick) {
    const text = pick.text ?? phrase(session, pick.bank, pick.tag);
    if (text) {
      feedback = { text: fillTemplate(text, { ...vars, ...(pick.vars || {}) }), kind: UI_KIND[pick.kind] || 'tip', tag: pick.tag, source: pick.kind === 'lesson' ? 'lesson' : 'rule' };
      session.cueCount += 1;
      session.tagCounts = { ...session.tagCounts, [pick.tag]: (session.tagCounts[pick.tag] || 0) + 1 };
    }
  }
  return finish(skill, session, feedback, obs, ball);
}

function finish(skill, session, feedback, obs, ball) {
  if (obs.motion?.counts) session.lastCounts = obs.motion.counts; // totals stay visible while out of view
  const counts = session.lastCounts || {};
  const metrics = {
    touches: ball.touches, streak: ball.streak, bestStreak: ball.bestStreak, drops: ball.drops,
    ballSeen: ball.seen, ballEverSeen: ball.everSeen,
    lifts: obs.lifts ?? 0, reps: counts.reps || 0, clean: counts.clean || 0, left: counts.left || 0, right: counts.right || 0,
    hold: Math.floor(counts.hold || 0), bestHold: Math.floor(counts.best || 0),
    visible: obs.quality === 'good', lessonsDone: session.completedLessons.length, lessonIndex: session.lessonIndex,
    completed: [...session.completedLessons], skipped: [...session.skippedLessons], cues: session.cueCount,
  };
  return { session, feedback, lesson: lessonView(skill, session), metrics, result: skill.result(metrics) };
}

/** Manual skip (for example, no ball available). Recorded honestly, never as completed. */
export function skipLesson(previous) {
  const skill = getSkill(previous.skillId);
  const lesson = skill.lessons[previous.lessonIndex];
  if (!lesson || previous.courseComplete) return previous;
  const session = { ...previous, skippedLessons: [...previous.skippedLessons, lesson.id], lessonIndex: previous.lessonIndex + 1, lessonProgress: 0, lessonMemo: null };
  if (session.lessonIndex >= skill.lessons.length) session.courseComplete = true; else session.pendingIntro = true;
  return session;
}

/** The most frequent observed mistake (not the most frequent remark): the summary's "main mistake". */
export function mainMistake(session) {
  const entries = Object.entries(session.errorCounts || {}).filter(([, count]) => count > 0);
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0] ? { tag: entries[0][0], count: entries[0][1] } : null;
}

/**
 * Distance ("far") display mode with hysteresis. `legScale` is the hip-to-ankle
 * height in normalized frame units: under 0.26 the athlete is far from the
 * phone, over 0.33 close again. A switch needs 8 consecutive good frames so a
 * step or a jitter never flips the screen. Pure.
 */
export function farModeDecision(previous, legScale, quality = 'good') {
  const state = previous || { far: false, frames: 0 };
  if (quality !== 'good' || !Number.isFinite(legScale)) return { far: state.far, frames: 0 };
  const wants = state.far ? legScale < 0.33 : legScale < 0.26;
  if (wants === state.far) return { far: state.far, frames: 0 };
  const frames = (state.frames || 0) + 1;
  return frames >= 8 ? { far: wants, frames: 0 } : { far: state.far, frames };
}

/* ───────────────────────── Browser wiring ───────────────────────── */

export async function createCoachEngine({ onStatus = () => {}, ball = true, objects = ball } = {}) {
  let landmarker; let detector = null;
  try {
    onStatus('Загружаем AI-модель позы…');
    const { FilesetResolver, PoseLandmarker, ObjectDetector } = await import(`${CDN_ROOT}/vision_bundle.mjs`);
    const vision = await FilesetResolver.forVisionTasks(`${CDN_ROOT}/wasm`);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.55, minPosePresenceConfidence: 0.55, minTrackingConfidence: 0.55,
      outputSegmentationMasks: false,
    };
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, options);
    } catch {
      onStatus('Подключаем совместимый режим AI…');
      landmarker = await PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
    }
    if (objects) {
      onStatus('Загружаем детектор предметов…');
      const objectOptions = { baseOptions: { modelAssetPath: OBJECT_MODEL_URL, delegate: 'GPU' }, runningMode: 'VIDEO', scoreThreshold: 0.3, maxResults: 15 };
      try { detector = await ObjectDetector.createFromOptions(vision, objectOptions); }
      catch {
        try { detector = await ObjectDetector.createFromOptions(vision, { ...objectOptions, baseOptions: { ...objectOptions.baseOptions, delegate: 'CPU' } }); }
        catch (cause) { console.warn('Aimo: object detector unavailable', cause); detector = null; }
      }
    }
    onStatus(detector ? 'AI-модели готовы · поза и предметы на устройстве' : 'AI-модель позы готова · детектор предметов выключен или недоступен');
  } catch (cause) {
    landmarker?.close();
    const error = new Error('Не удалось загрузить AI-модель. Проверь интернет и попробуй ещё раз. Можно открыть демо без камеры.');
    error.cause = cause;
    throw error;
  }

  let pose = createPoseState();
  let ballState = createBallState();
  let session = createSession();
  let closed = false;
  let lastTimestamp = -1;
  let lastBallAt = -Infinity;
  let ballInterval = 160;
  let lastObjects = [];

  return {
    hasBallDetector: Boolean(detector),
    hasObjectDetector: Boolean(detector),
    start(skillId = 'football', personality = 'calm') {
      pose = createPoseState(); ballState = createBallState(); session = createSession(skillId, { personality });
      lastTimestamp = -1; lastBallAt = -Infinity; lastObjects = [];
    },
    skip() { session = skipLesson(session); },
    /** After a camera switch the old frame geometry is meaningless; the lesson and totals stay. */
    resetTracking() {
      pose = { ...createPoseState(), lifts: pose.lifts, motion: pauseMemo(pose.motion) };
      ballState = { ...ballState, seen: false, phase: null, event: null }; lastTimestamp = -1;
    },
    get session() { return session; },
    analyze(video, timestamp) {
      if (closed) throw new Error('AI-сессия уже завершена. Начни новую тренировку.');
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      const frameTimestamp = Math.max(lastTimestamp + 1, Number.isFinite(timestamp) ? timestamp : performance.now());
      lastTimestamp = frameTimestamp;
      const aspect = video.videoWidth / video.videoHeight;
      const started = performance.now();
      const result = landmarker.detectForVideo(video, frameTimestamp);
      const observed = observePose(result.landmarks?.[0] ?? null, pose, frameTimestamp, aspect, session.skillId);
      pose = observed.state;
      const poseMs = performance.now() - started;
      const skillNeedsBall = getSkill(session.skillId).needsBall;
      if (detector && frameTimestamp - lastBallAt >= ballInterval) {
        lastBallAt = frameTimestamp;
        try {
          const detected = detector.detectForVideo(video, frameTimestamp);
          lastObjects = normalizeObjects(detected.detections, video.videoWidth, video.videoHeight);
        } catch (cause) {
          detector.close(); detector = null; lastObjects = [];
          onStatus('Детектор предметов недоступен. Анализ позы продолжает работать.');
          console.warn('Aimo object detection:', cause);
        }
        if (skillNeedsBall) ballState = trackBall(ballDetections(lastObjects), ballState, frameTimestamp, observed.obs, aspect);
        // Pose keeps priority: slow frames push the ball detector to a lower rate.
        const total = performance.now() - started;
        ballInterval = total > 110 ? Math.min(400, ballInterval + 40) : Math.max(120, ballInterval - 10);
      } else {
        ballState = { ...ballState, event: null };
      }
      const stepped = stepSession(session, observed.obs, ballState, frameTimestamp);
      session = stepped.session;
      return {
        landmarks: observed.obs.points, ball: ballState.seen ? { x: ballState.x, y: ballState.y, r: ballState.r } : null,
        quality: observed.obs.quality, framing: observed.obs.framing, feedback: stepped.feedback, lesson: stepped.lesson, metrics: stepped.metrics,
        result: stepped.result, motion: observed.obs.motion,
        objects: frameTimestamp - lastBallAt <= 700 ? lastObjects : [],
        timing: { poseMs }, ballDetector: Boolean(detector), objectDetector: Boolean(detector),
        scale: observed.obs.quality === 'good' ? observed.obs.scale : null,
      };
    },
    close() { if (!closed) { closed = true; landmarker.close(); detector?.close(); } },
  };
}
