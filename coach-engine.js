// MediaPipe inference runs on this device; no video frames are uploaded.
export const MODEL_VERSION = '0.10.21';
export const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const CDN_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MODEL_VERSION}`;

export const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 29], [29, 31], [27, 31],
  [28, 30], [30, 32], [28, 32],
];

const CONFIDENCE = 0.55;
const COOLDOWN = 4000;
const SKILLS = new Set(['football', 'squats', 'balance']);
const skillName = (skill) => SKILLS.has(skill) ? skill : 'football';
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

export function createAnalysisState(skill = 'football') {
  return {
    skill: skillName(skill), movements: 0, reps: 0, samples: 0,
    ground: [null, null],
    feet: [{ phase: 'down', frames: 0 }, { phase: 'down', frames: 0 }],
    lastMovementAt: -Infinity, lastRepAt: -Infinity,
    squatPhase: 'unready', squatFrames: 0,
    lastCueAt: -Infinity, lastCueTag: '', quality: 'missing',
    balanceSince: null, balanceSeconds: 0,
  };
}

function visible(p) {
  return Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && (p.visibility ?? 1) >= CONFIDENCE && (p.presence ?? 1) >= CONFIDENCE
    && p.x > 0.015 && p.x < 0.985 && p.y > 0.015 && p.y < 0.985);
}

function cue(state, now, text, kind, tag, urgent = false) {
  const elapsed = now - state.lastCueAt;
  if ((!urgent && elapsed < COOLDOWN) || (tag === state.lastCueTag && elapsed < 12000)) return null;
  state.lastCueAt = now;
  state.lastCueTag = tag;
  return { text, kind, tag };
}

function output(state, landmarks, feedback, quality) {
  state.quality = quality;
  return {
    state, landmarks, feedback, quality,
    metrics: {
      movements: state.movements, reps: state.reps,
      visible: quality === 'good', balanceSeconds: state.balanceSeconds,
    },
  };
}

/** Pure, deterministic analysis of one landmark frame. Returns the next state. */
export function analyzePose(landmarks, skill = 'football', previous, timestamp = 0, aspectRatio = 1) {
  const selected = skillName(skill);
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const old = previous?.skill === selected ? previous : createAnalysisState(selected);
  const state = { ...old, ground: [...old.ground], feet: old.feet.map(f => ({ ...f })) };
  const now = Number.isFinite(timestamp) ? timestamp : 0;
  const points = Array.isArray(landmarks) && landmarks.length >= 33 ? landmarks : null;
  const torso = points && [11, 12, 23, 24].filter(i => visible(points[i])).length === 4;
  if (!torso) {
    const feedback = cue(state, now, 'Пока не вижу тебя целиком. Поставь телефон устойчиво и войди в кадр.', 'warning', 'no-person', old.quality !== 'missing');
    state.samples = 0;
    state.ground = [null, null];
    state.feet = state.feet.map(() => ({ phase: 'down', frames: 0 }));
    state.squatPhase = 'unready';
    state.squatFrames = 0;
    state.balanceSince = null;
    return output(state, points, feedback, 'missing');
  }

  const legs = [[23, 25, 27], [24, 26, 28]].map(indices => indices.every(i => visible(points[i])));
  const enoughLegs = selected === 'squats' ? legs.some(Boolean) : legs.every(Boolean);
  if (!enoughLegs) {
    const feedback = cue(state, now, 'В кадре должны быть видны колени и стопы. Отойди от телефона немного дальше.', 'warning', 'show-feet', old.quality === 'good');
    state.samples = 0;
    state.ground = [null, null];
    state.feet = state.feet.map(() => ({ phase: 'down', frames: 0 }));
    state.squatPhase = 'unready';
    state.squatFrames = 0;
    state.balanceSince = null;
    return output(state, points, feedback, 'partial');
  }

  state.samples += 1;
  const leftAngle = legs[0] ? jointAngle(points[23], points[25], points[27], aspect) : null;
  const rightAngle = legs[1] ? jointAngle(points[24], points[26], points[28], aspect) : null;
  const angles = [leftAngle, rightAngle].filter(v => Number.isFinite(v));
  const kneeAngle = angles.reduce((sum, v) => sum + v, 0) / angles.length;
  const shoulders = { x: (points[11].x + points[12].x) / 2, y: (points[11].y + points[12].y) / 2 };
  const hips = { x: (points[23].x + points[24].x) / 2, y: (points[23].y + points[24].y) / 2 };
  const ankles = [points[27], points[28]];
  const legScale = Math.max(0.16, Math.max(...ankles.filter(visible).map(p => p.y)) - hips.y);
  let feedback = null;

  if (selected === 'squats') {
    // A full stand -> bent knees -> stand cycle is required. Two frames at each
    // threshold reject single-frame jitter; thresholds have a large dead band.
    const standing = kneeAngle > 160;
    const lowered = kneeAngle < 110;
    if (state.squatPhase === 'unready') {
      state.squatFrames = standing ? state.squatFrames + 1 : 0;
      if (state.squatFrames >= 2) { state.squatPhase = 'standing'; state.squatFrames = 0; }
    } else if (state.squatPhase === 'standing') {
      state.squatFrames = lowered ? state.squatFrames + 1 : 0;
      if (state.squatFrames >= 2) { state.squatPhase = 'lowered'; state.squatFrames = 0; }
    } else {
      state.squatFrames = standing ? state.squatFrames + 1 : 0;
      if (state.squatFrames >= 2) {
        if (now - state.lastRepAt >= 1000) {
          state.reps += 1;
          state.movements = state.reps;
          state.lastRepAt = now;
          feedback = cue(state, now, `Повтор ${state.reps} завершён. Сохраняй плавное движение.`, 'success', 'squat-complete');
        }
        state.squatPhase = 'standing'; state.squatFrames = 0;
      }
    }
    if (!feedback) {
      if (Math.abs(shoulders.x - hips.x) * aspect > legScale * 0.5) {
        feedback = cue(state, now, 'Корпус заметно наклонён относительно таза. Выпрямись и выбери комфортную глубину.', 'tip', 'squat-torso');
      } else if (state.squatPhase === 'lowered') {
        feedback = cue(state, now, 'Сгибание коленей видно. Теперь плавно вернись в исходное положение.', 'tip', 'squat-rise');
      } else {
        feedback = cue(state, now, 'Встань боком или под небольшим углом к камере. Колени и стопы должны оставаться видимыми.', 'tip', 'squat-camera');
      }
    }
    return output(state, points, feedback, 'good');
  }

  // Calibrate each ankle independently: a foot already held up at the start
  // must not become a completed lift simply by entering the frame.
  ankles.forEach((ankle, side) => {
    if (state.ground[side] === null) state.ground[side] = ankle.y;
    if (state.feet[side].phase === 'down') state.ground[side] = Math.max(state.ground[side], ankle.y);
  });
  const raiseThreshold = Math.max(0.035, legScale * 0.14);
  const lowerThreshold = Math.max(0.018, legScale * 0.06);
  const lifts = ankles.map((ankle, side) => state.ground[side] - ankle.y);
  let completedLift = false;
  if (state.samples > 5) {
    lifts.forEach((lift, side) => {
      const foot = state.feet[side];
      if (foot.phase === 'down') {
        foot.frames = lift > raiseThreshold ? foot.frames + 1 : 0;
        if (foot.frames >= 2) { foot.phase = 'up'; foot.frames = 0; }
      } else {
        foot.frames = lift < lowerThreshold ? foot.frames + 1 : 0;
        if (foot.frames >= 2) {
          if (now - state.lastMovementAt >= 400) {
            state.movements += 1; state.lastMovementAt = now; completedLift = true;
          }
          foot.phase = 'down'; foot.frames = 0;
        }
      }
    });
  }

  const raised = state.feet.some(f => f.phase === 'up');
  const torsoTilt = Math.abs(shoulders.x - hips.x) * aspect / Math.max(0.12, distance(shoulders, hips, aspect));
  const shoulderSlope = Math.abs(points[11].y - points[12].y);
  if (selected === 'balance') {
    if (raised && torsoTilt < 0.4 && shoulderSlope < 0.08) {
      if (state.balanceSince === null) state.balanceSince = now;
      state.balanceSeconds = Math.max(state.balanceSeconds, Math.floor((now - state.balanceSince) / 1000));
    } else state.balanceSince = null;
    if (torsoTilt > 0.4 || shoulderSlope > 0.08) {
      feedback = cue(state, now, 'Вижу наклон корпуса. Попробуй выровнять плечи и держи взгляд перед собой.', 'tip', 'balance-align');
    } else if (raised) {
      feedback = cue(state, now, 'Стопа поднята, корпус остаётся ровным. Удерживай удобное положение без спешки.', 'success', 'balance-hold');
    } else {
      feedback = cue(state, now, 'Для упражнения на баланс слегка подними одну стопу. При необходимости держись за устойчивую опору.', 'tip', 'balance-start');
    }
  } else if (completedLift) {
    feedback = cue(state, now, 'Вижу подъём и возврат стопы. Продолжай невысокие движения, сохраняя равновесие.', 'success', 'foot-lift');
  } else if (torsoTilt > 0.55) {
    feedback = cue(state, now, 'Корпус заметно смещён относительно таза. Попробуй вернуть его ближе к центру опоры.', 'tip', 'football-torso');
  } else if (raised) {
    const supportAngle = state.feet[0].phase === 'up' ? rightAngle : leftAngle;
    if (supportAngle > 175) {
      feedback = cue(state, now, 'Опорная нога почти прямая. Слегка смягчи колено и делай короткие движения стопой.', 'tip', 'support-knee');
    } else {
      feedback = cue(state, now, 'Подъём стопы виден. Для чеканки пробуй короткий импульс и держи мяч невысоко.', 'tip', 'football-lift');
    }
  } else {
    feedback = cue(state, now, 'Ноги видны. Начни с одного невысокого подброса, затем поймай мяч руками и повтори.', 'tip', 'football-start');
  }
  return output(state, points, feedback, 'good');
}

export async function createCoachEngine({ onStatus = () => {} } = {}) {
  let landmarker;
  try {
    onStatus('Загружаем AI-модель позы…');
    const { FilesetResolver, PoseLandmarker } = await import(`${CDN_ROOT}/vision_bundle.mjs`);
    const vision = await FilesetResolver.forVisionTasks(`${CDN_ROOT}/wasm`);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputSegmentationMasks: false,
    };
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, options);
    } catch {
      onStatus('Подключаем совместимый режим AI…');
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' },
      });
    }
    onStatus('AI-модель готова · анализ на устройстве');
  } catch (cause) {
    landmarker?.close();
    const error = new Error('Не удалось загрузить AI-модель. Проверь интернет и попробуй ещё раз. Можно открыть демо без камеры.');
    error.cause = cause;
    throw error;
  }
  let state = createAnalysisState();
  let closed = false;
  let lastTimestamp = -1;
  return {
    analyze(video, timestamp, skill = 'football') {
      if (closed) throw new Error('AI-сессия уже завершена. Начни новую тренировку.');
      if (!video || video.readyState < 2 || !video.videoWidth) {
        return { landmarks: null, feedback: null, metrics: { movements: state.movements, reps: state.reps, visible: false }, quality: 'missing' };
      }
      const frameTimestamp = Math.max(lastTimestamp + 1, Number.isFinite(timestamp) ? timestamp : performance.now());
      lastTimestamp = frameTimestamp;
      const result = landmarker.detectForVideo(video, frameTimestamp);
      const analyzed = analyzePose(result.landmarks?.[0] ?? null, skill, state, frameTimestamp, video.videoWidth / video.videoHeight);
      state = analyzed.state;
      const { state: _state, ...publicResult } = analyzed;
      return publicResult;
    },
    reset(skill = 'football') { state = createAnalysisState(skill); },
    close() { if (!closed) { closed = true; landmarker.close(); } },
  };
}
