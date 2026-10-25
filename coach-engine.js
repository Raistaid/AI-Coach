// Vision + coaching engine. MediaPipe inference runs on this device; no video
// frames leave the browser. Everything below `createCoachEngine` is pure and
// unit-tested: pose observations, ball tracking, lesson progression, phrases.
import { getSkill, personalityId } from './skills/index.js';
import { COMMON_PHRASES, pickPhrase, fillTemplate } from './skills/common.js';
import { normalizeObjects, ballDetections } from './coach-objects.js';

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

const CONFIDENCE = 0.55;
const COOLDOWN = { tip: 4000, success: 1500, warning: 2000, lesson: 0 };
const SAME_TAG_COOLDOWN = 12000;
const BALL_LOST_MS = 1500;
const BALL_SPEED = 0.18; // normalized image units per second
const distance = (a, b, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

export function jointAngle(a, b, c, aspectRatio = 1) {
  if (![a, b, c].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const ab = { x: (a.x - b.x) * aspect, y: a.y - b.y };
  const cb = { x: (c.x - b.x) * aspect, y: c.y - b.y };
  const denominator = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (denominator < 1e-8) return null;
  return Math.acos(Math.max(-1, Math.min(1, (ab.x * cb.x + ab.y * cb.y) / denominator))) * 180 / Math.PI;
}

function visible(p) {
  return Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && (p.visibility ?? 1) >= CONFIDENCE && (p.presence ?? 1) >= CONFIDENCE
    && p.x > 0.015 && p.x < 0.985 && p.y > 0.015 && p.y < 0.985);
}

/* ───────────────────────── Pose observations ───────────────────────── */

export function createPoseState() {
  return {
    samples: 0, lifts: 0, reps: 0,
    ground: [null, null],
    feet: [{ phase: 'down', frames: 0 }, { phase: 'down', frames: 0 }],
    lastLiftAt: -Infinity, lastRepAt: -Infinity,
    squatPhase: 'unready', squatFrames: 0,
    balanceSince: null, balanceSeconds: 0,
    hipTrail: [], quality: 'missing',
  };
}

function emptyObservation(quality, points, state) {
  return {
    quality, points, visible: false,
    kneeAngle: { left: null, right: null, mean: null }, softKnee: false, supportKnee: null,
    torsoTilt: 0, shoulderSlope: 0, torsoLean: false, armsSpread: true,
    lift: [0, 0], raised: false, raisedSide: -1, liftCompleted: false, liftHigh: false,
    standingStill: false, squat: { phase: state.squatPhase, repCompleted: false },
    balanceSeconds: state.balanceSeconds, lifts: state.lifts, reps: state.reps,
    hips: null, kneeY: null, feet: [], legScale: 0.2,
  };
}

function resetMotion(state) {
  state.samples = 0;
  state.ground = [null, null];
  state.feet = state.feet.map(() => ({ phase: 'down', frames: 0 }));
  state.squatPhase = 'unready';
  state.squatFrames = 0;
  state.balanceSince = null;
  state.hipTrail = [];
}

/** Pure, deterministic analysis of one landmark frame. Returns { state, obs }. */
export function observePose(landmarks, previous, timestamp = 0, aspectRatio = 1, skillId = 'football') {
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const old = previous || createPoseState();
  const state = { ...old, ground: [...old.ground], feet: old.feet.map(f => ({ ...f })), hipTrail: [...old.hipTrail] };
  const now = Number.isFinite(timestamp) ? timestamp : 0;
  const points = Array.isArray(landmarks) && landmarks.length >= 33 ? landmarks : null;
  const torso = points && [11, 12, 23, 24].filter(i => visible(points[i])).length === 4;
  if (!torso) {
    resetMotion(state); state.quality = 'missing';
    return { state, obs: emptyObservation('missing', points, state) };
  }
  const legs = [[23, 25, 27], [24, 26, 28]].map(indices => indices.every(i => visible(points[i])));
  const enoughLegs = skillId === 'squats' ? legs.some(Boolean) : legs.every(Boolean);
  if (!enoughLegs) {
    resetMotion(state); state.quality = 'partial';
    return { state, obs: emptyObservation('partial', points, state) };
  }

  state.samples += 1;
  state.quality = 'good';
  const leftAngle = legs[0] ? jointAngle(points[23], points[25], points[27], aspect) : null;
  const rightAngle = legs[1] ? jointAngle(points[24], points[26], points[28], aspect) : null;
  const angles = [leftAngle, rightAngle].filter(v => Number.isFinite(v));
  const kneeMean = angles.reduce((sum, v) => sum + v, 0) / angles.length;
  const shoulders = { x: (points[11].x + points[12].x) / 2, y: (points[11].y + points[12].y) / 2 };
  const hips = { x: (points[23].x + points[24].x) / 2, y: (points[23].y + points[24].y) / 2 };
  const ankles = [points[27], points[28]];
  const legScale = Math.max(0.16, Math.max(...ankles.filter(visible).map(p => p.y)) - hips.y);
  const kneeY = [points[25], points[26]].filter(visible).reduce((sum, p, _, arr) => sum + p.y / arr.length, 0) || null;

  // Stillness: hips barely move over the last ~600 ms.
  state.hipTrail.push({ t: now, x: hips.x, y: hips.y });
  state.hipTrail = state.hipTrail.filter(h => now - h.t <= 600);
  const drift = Math.max(...state.hipTrail.map(h => distance(h, hips, aspect)));
  const standingStill = state.hipTrail.length >= 3 && drift < legScale * 0.08;

  // Squat cycle: stand -> bent -> stand with two-frame hysteresis.
  const squat = { phase: state.squatPhase, repCompleted: false };
  if (skillId === 'squats') {
    const standing = kneeMean > 160;
    const lowered = kneeMean < 110;
    if (state.squatPhase === 'unready') {
      state.squatFrames = standing ? state.squatFrames + 1 : 0;
      if (state.squatFrames >= 2) { state.squatPhase = 'standing'; state.squatFrames = 0; }
    } else if (state.squatPhase === 'standing') {
      state.squatFrames = lowered ? state.squatFrames + 1 : 0;
      if (state.squatFrames >= 2) { state.squatPhase = 'lowered'; state.squatFrames = 0; }
    } else {
      state.squatFrames = standing ? state.squatFrames + 1 : 0;
      if (state.squatFrames >= 2) {
        if (now - state.lastRepAt >= 1000) { state.reps += 1; state.lastRepAt = now; squat.repCompleted = true; }
        state.squatPhase = 'standing'; state.squatFrames = 0;
      }
    }
    squat.phase = state.squatPhase;
  }

  // Ankle calibration per side: a foot already held up when entering the frame
  // must not count as a completed lift.
  ankles.forEach((ankle, side) => {
    if (state.ground[side] === null) state.ground[side] = ankle.y;
    if (state.feet[side].phase === 'down') state.ground[side] = Math.max(state.ground[side], ankle.y);
  });
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
  const raisedSide = state.feet.findIndex(f => f.phase === 'up');
  const raised = raisedSide !== -1;
  // Height is judged at the peak of the movement, so a completed lift carries its own verdict.
  const highThreshold = legScale * 0.5;
  const liftHigh = raised ? lift[raisedSide] > highThreshold : liftCompleted && completedPeak > highThreshold;
  const supportKnee = raised ? (raisedSide === 0 ? rightAngle : leftAngle) : null;

  const torsoTilt = Math.abs(shoulders.x - hips.x) * aspect / Math.max(0.12, distance(shoulders, hips, aspect));
  const shoulderSlope = Math.abs(points[11].y - points[12].y);
  const torsoLean = Math.abs(shoulders.x - hips.x) * aspect > legScale * 0.5;
  const wrists = [[15, 11], [16, 12]].filter(([w]) => visible(points[w]));
  const armsSpread = wrists.length === 0 || wrists.some(([w, s]) => Math.abs(points[w].x - points[s].x) * aspect > legScale * 0.35);

  if (skillId === 'balance') {
    if (raised && torsoTilt < 0.4 && shoulderSlope < 0.08) {
      if (state.balanceSince === null) state.balanceSince = now;
      state.balanceSeconds = Math.max(state.balanceSeconds, Math.floor((now - state.balanceSince) / 1000));
    } else state.balanceSince = null;
  }

  const obs = {
    quality: 'good', points, visible: true,
    kneeAngle: { left: leftAngle, right: rightAngle, mean: kneeMean },
    softKnee: kneeMean < 178, supportKnee,
    torsoTilt, shoulderSlope, torsoLean, armsSpread,
    lift, raised, raisedSide, liftCompleted, liftHigh,
    standingStill: standingStill && !raised, squat,
    balanceSeconds: state.balanceSeconds, lifts: state.lifts, reps: state.reps,
    hips, kneeY, legScale,
    feet: [27, 28, 31, 32].map(i => points[i]).filter(visible).map(p => ({ x: p.x, y: p.y })),
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
    lastCueAt: -Infinity, lastCueTag: '', lastCueKind: '', phraseIndex: {}, cueCount: 0, tagCounts: {},
    lastQuality: 'missing',
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
    target: lesson?.target || 0, unit: lesson?.unit || '', needsBall: Boolean(lesson?.needsBall),
    complete: session.courseComplete,
  };
}

function emit(session, now, tag, kind, bank, vars, { urgent = false, source = 'rule' } = {}) {
  const elapsed = now - session.lastCueAt;
  if (!urgent && elapsed < (COOLDOWN[kind] ?? COOLDOWN.tip)) return null;
  if (tag === session.lastCueTag && elapsed < SAME_TAG_COOLDOWN && !urgent) return null;
  const picked = pickPhrase(bank, session.personality, session.phraseIndex[tag] ?? -1, session.cueCount * 7 + session.lessonIndex * 3);
  if (!picked.text) return null;
  session.phraseIndex = { ...session.phraseIndex, [tag]: picked.index };
  session.lastCueAt = now; session.lastCueTag = tag; session.lastCueKind = kind;
  session.cueCount += 1;
  session.tagCounts = { ...session.tagCounts, [tag]: (session.tagCounts[tag] || 0) + 1 };
  return { text: fillTemplate(picked.text, vars), kind, tag, source };
}

/** Advances lessons and selects one coaching phrase. Pure: returns a new session. */
export function stepSession(previous, obs, ball, timestamp = 0) {
  const session = { ...previous, completedLessons: [...previous.completedLessons], skippedLessons: [...previous.skippedLessons] };
  const skill = getSkill(session.skillId);
  const now = Number.isFinite(timestamp) ? timestamp : 0;
  const safeBall = ball || createBallState();
  const lesson = skill.lessons[session.lessonIndex] || null;
  const vars = {
    touches: safeBall.touches, streak: safeBall.event === 'drop' ? safeBall.lastStreak : safeBall.streak,
    lifts: obs.lifts, reps: obs.reps, balanceSeconds: obs.balanceSeconds,
    lesson: lesson?.title || '', next: skill.lessons[session.lessonIndex + 1]?.title || '',
  };
  let feedback = null;
  const ctx = { obs, ball: safeBall, now, session, lesson };

  if (session.pendingIntro && lesson) {
    session.pendingIntro = false;
    feedback = emit(session, now, 'lesson-intro', 'lesson', { [session.personality]: [lesson.intro[session.personality] || lesson.intro.calm] }, vars, { urgent: true, source: 'lesson' });
  }

  if (obs.quality !== 'good') {
    const tag = obs.quality === 'missing' ? 'no-person' : 'show-feet';
    const urgent = session.lastQuality === 'good' || (tag === 'no-person' && session.lastQuality === 'partial');
    session.lastQuality = obs.quality;
    if (!feedback) feedback = emit(session, now, tag, 'warning', COMMON_PHRASES[tag], vars, { urgent });
    return finish(skill, session, feedback, obs, safeBall);
  }
  session.lastQuality = 'good';

  if (lesson && !session.courseComplete && !session.pendingIntro) {
    const { progress, memo } = lesson.update(ctx, session.lessonMemo ?? undefined);
    session.lessonProgress = progress; session.lessonMemo = memo;
    if (progress >= lesson.target) {
      session.completedLessons.push(lesson.id);
      session.lessonIndex += 1; session.lessonProgress = 0; session.lessonMemo = null;
      const done = session.lessonIndex >= skill.lessons.length;
      if (done) session.courseComplete = true; else session.pendingIntro = true;
      feedback = emit(session, now, done ? 'course-complete' : 'lesson-complete', 'success', COMMON_PHRASES[done ? 'course-complete' : 'lesson-complete'], vars, { urgent: true, source: 'lesson' });
      return finish(skill, session, feedback, obs, safeBall);
    }
  }

  if (!feedback) {
    const rule = skill.rules.find(r => r.when(ctx));
    if (rule) feedback = emit(session, now, rule.tag, rule.kind, skill.phrases[rule.tag], vars, { urgent: Boolean(rule.urgent) });
  }
  return finish(skill, session, feedback, obs, safeBall);
}

function finish(skill, session, feedback, obs, ball) {
  return {
    session, feedback, lesson: lessonView(skill, session),
    metrics: {
      touches: ball.touches, streak: ball.streak, bestStreak: ball.bestStreak, drops: ball.drops,
      ballSeen: ball.seen, ballEverSeen: ball.everSeen,
      lifts: obs.lifts, reps: obs.reps, balanceSeconds: obs.balanceSeconds,
      visible: obs.quality === 'good', lessonsDone: session.completedLessons.length, cues: session.cueCount,
    },
  };
}

/** Manual skip (for example, no ball available). Recorded honestly. */
export function skipLesson(previous) {
  const skill = getSkill(previous.skillId);
  const lesson = skill.lessons[previous.lessonIndex];
  if (!lesson || previous.courseComplete) return previous;
  const session = { ...previous, skippedLessons: [...previous.skippedLessons, lesson.id], lessonIndex: previous.lessonIndex + 1, lessonProgress: 0, lessonMemo: null };
  if (session.lessonIndex >= skill.lessons.length) session.courseComplete = true; else session.pendingIntro = true;
  return session;
}

/** Most frequent corrective tag: the "main mistake" for the summary. */
export function mainMistake(session) {
  const corrective = Object.entries(session.tagCounts || {}).filter(([tag]) => !['start', 'lesson-intro', 'lesson-complete', 'course-complete', 'no-person', 'show-feet', 'ball-touch', 'ball-streak', 'lift-done', 'squat-complete', 'balance-hold', 'squat-camera', 'balance-start'].includes(tag));
  corrective.sort((a, b) => b[1] - a[1]);
  return corrective[0] ? { tag: corrective[0][0], count: corrective[0][1] } : null;
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
      } else if (!detector || !skillNeedsBall) {
        ballState = { ...ballState, event: null };
      } else {
        ballState = { ...ballState, event: null };
      }
      const stepped = stepSession(session, observed.obs, ballState, frameTimestamp);
      session = stepped.session;
      return {
        landmarks: observed.obs.points, ball: ballState.seen ? { x: ballState.x, y: ballState.y, r: ballState.r } : null,
        quality: observed.obs.quality, feedback: stepped.feedback, lesson: stepped.lesson, metrics: stepped.metrics,
        objects: frameTimestamp - lastBallAt <= 700 ? lastObjects : [],
        timing: { poseMs }, ballDetector: Boolean(detector), objectDetector: Boolean(detector),
        scale: observed.obs.quality === 'good' ? observed.obs.legScale : null,
      };
    },
    close() { if (!closed) { closed = true; landmarker.close(); detector?.close(); } },
  };
}
