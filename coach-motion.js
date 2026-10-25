// Movement checks shared by every skill. MediaPipe gives 33 body landmarks per
// frame; this module turns them into body features (joint angles, heights,
// spreads, orientation), keeps a per-person calibration taken while standing,
// and provides small state machines: repetitions with hysteresis and dwell
// frames (including attempts that were not deep enough), holds with a grace
// period, and error confirmation so one noisy frame never becomes a remark.
// Pure functions only; unit-tested in motion.test.mjs and engine.test.mjs.

export const VIS = 0.55;      // a landmark this confident may drive a decision
export const VIS_LOW = 0.3;   // the far side of the body in a side view is often half hidden
const EDGE = 0.012;           // points glued to the frame border are guesses

const finite = Number.isFinite;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Angle ABC in degrees; `aspectRatio` scales x so a portrait frame keeps true angles. */
export function jointAngle(a, b, c, aspectRatio = 1) {
  if (![a, b, c].every(p => p && finite(p.x) && finite(p.y))) return null;
  const aspect = finite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const ab = { x: (a.x - b.x) * aspect, y: a.y - b.y };
  const cb = { x: (c.x - b.x) * aspect, y: c.y - b.y };
  const denominator = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (denominator < 1e-8) return null;
  return Math.acos(clamp((ab.x * cb.x + ab.y * cb.y) / denominator, -1, 1)) * 180 / Math.PI;
}
const angle = (a, b, c) => (a && b && c ? jointAngle(a, b, c, 1) : null);

/** Landmark indices: left/right pairs as MediaPipe numbers them (left first). */
export const PAIRS = { shoulder: [11, 12], elbow: [13, 14], wrist: [15, 16], hip: [23, 24], knee: [25, 26], ankle: [27, 28], heel: [29, 30], toe: [31, 32] };

/**
 * Body features of one frame in uniform units: x is multiplied by the frame
 * aspect, so x and y share the same scale (the frame height). Returns null
 * when there is no torso to anchor the measurements.
 */
export function bodyFeatures(points, aspectRatio = 1) {
  if (!Array.isArray(points) || points.length < 33) return null;
  const aspect = finite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const at = (i, min) => {
    const p = points[i];
    if (!p || !finite(p.x) || !finite(p.y)) return null;
    const v = Math.min(p.visibility ?? 1, p.presence ?? 1);
    if (v < min || p.x < EDGE || p.x > 1 - EDGE || p.y < EDGE || p.y > 1 - EDGE) return null;
    return { x: p.x * aspect, y: p.y, v };
  };
  const take = (min) => Object.fromEntries(Object.entries(PAIRS).map(([name, ids]) => [name, ids.map(i => at(i, min))]));
  const strict = take(VIS); const loose = take(VIS_LOW);
  const confidence = (side) => [11, 13, 15, 23, 25, 27].reduce((sum, i) => sum + Math.min(points[i + side]?.visibility ?? 0, points[i + side]?.presence ?? 1), 0);
  const near = confidence(1) > confidence(0) ? 1 : 0;

  // Torso anchor: both sides when seen, otherwise the side facing the camera.
  const torsoBoth = Boolean(strict.shoulder[0] && strict.shoulder[1] && strict.hip[0] && strict.hip[1]);
  const torsoNear = Boolean(strict.shoulder[near] && strict.hip[near]);
  if (!torsoBoth && !torsoNear) return null;
  const shoulderMid = torsoBoth ? mid(strict.shoulder[0], strict.shoulder[1]) : strict.shoulder[near];
  const hipMid = torsoBoth ? mid(strict.hip[0], strict.hip[1]) : strict.hip[near];
  const torsoLen = Math.max(0.02, dist(shoulderMid, hipMid));
  const shoulderWidth = loose.shoulder[0] && loose.shoulder[1] ? dist(loose.shoulder[0], loose.shoulder[1]) : 0;
  const up = { x: shoulderMid.x - hipMid.x, y: shoulderMid.y - hipMid.y };
  const tilt = Math.acos(clamp(-up.y / Math.max(1e-6, Math.hypot(up.x, up.y)), -1, 1)) * 180 / Math.PI;

  const sides = [0, 1];
  const legSeen = sides.map(s => Boolean(loose.hip[s] && loose.knee[s] && loose.ankle[s]));
  const legVisible = sides.map(s => Boolean(strict.hip[s] && strict.knee[s] && strict.ankle[s]));
  const armSeen = sides.map(s => Boolean(loose.shoulder[s] && loose.elbow[s] && loose.wrist[s]));
  const armVisible = sides.map(s => Boolean(strict.shoulder[s] && strict.elbow[s] && strict.wrist[s]));
  const knee = sides.map(s => (legSeen[s] ? angle(loose.hip[s], loose.knee[s], loose.ankle[s]) : null));
  const hipAngle = sides.map(s => angle(loose.shoulder[s], loose.hip[s], loose.knee[s]));
  const elbow = sides.map(s => (armSeen[s] ? angle(loose.shoulder[s], loose.elbow[s], loose.wrist[s]) : null));

  // Side view of a body along the floor: straightness and where the hips sit.
  const nearEnd = loose.ankle[near] || loose.knee[near];
  const nearShoulder = loose.shoulder[near] || shoulderMid;
  const nearHip = loose.hip[near] || hipMid;
  const bodyLine = nearEnd ? angle(nearShoulder, nearHip, nearEnd) : null;
  let hipOffset = null; let horizontal = null;
  if (nearEnd) {
    const dx = nearEnd.x - nearShoulder.x;
    horizontal = Math.atan2(Math.abs(nearEnd.y - nearShoulder.y), Math.abs(dx)) * 180 / Math.PI;
    if (Math.abs(dx) > torsoLen * 0.5) {
      const lineY = nearShoulder.y + (nearHip.x - nearShoulder.x) * (nearEnd.y - nearShoulder.y) / dx;
      hipOffset = (nearHip.y - lineY) / torsoLen; // > 0: the hips sag toward the floor
    }
  }

  const nose = at(0, VIS_LOW);
  const anklesBoth = Boolean(strict.ankle[0] && strict.ankle[1]);
  const kneeY = sides.map(s => loose.knee[s]?.y ?? null);
  const ankleY = sides.map(s => loose.ankle[s]?.y ?? null);
  const seenAnkles = ankleY.filter(finite);
  return {
    aspect, near, strict, loose, nose,
    torsoBoth, torsoNear, shoulderMid, hipMid, torsoLen, shoulderWidth,
    facing: shoulderWidth / torsoLen, // about 0.6–1 facing the camera, under 0.35 side-on
    tilt, leanX: up.x,
    legSeen, legVisible, armSeen, armVisible,
    knee, hipAngle, elbow, bodyLine, hipOffset, horizontal,
    hipY: hipMid.y, kneeY, ankleY,
    floorY: seenAnkles.length ? Math.max(...seenAnkles) : null,
    ankleGap: anklesBoth ? Math.abs(strict.ankle[0].x - strict.ankle[1].x) : null,
    kneeGap: strict.knee[0] && strict.knee[1] ? Math.abs(strict.knee[0].x - strict.knee[1].x) : null,
    wristLift: sides.map(s => (loose.wrist[s] && loose.shoulder[s] ? (loose.shoulder[s].y - loose.wrist[s].y) / torsoLen : null)),
    wristOverHead: sides.map(s => Boolean(loose.wrist[s] && nose && loose.wrist[s].y < nose.y)),
    legScale: Math.max(0.16, seenAnkles.length ? Math.max(...seenAnkles) - hipMid.y : 0),
  };
}

/* ───────────── Calibration: the person's own reference heights ───────────── */

export function createCalibration() {
  return { hipY: null, legLen: null, kneeY: [null, null], thigh: [null, null], shoulderWidth: null, samples: 0 };
}
const ema = (old, value, alpha = 0.25) => (old === null || !finite(old) ? value : old + (value - old) * alpha);

/** Standing tall and still updates the reference: hip height, leg length, knee heights. */
export function calibrate(previous, f, still) {
  const base = previous || createCalibration();
  if (!f || !still || f.tilt > 15) return base;
  const legs = [0, 1].filter(s => f.legSeen[s] && f.knee[s] !== null && f.knee[s] > 160);
  if (!legs.length) return base;
  // Both feet down and knees level: a raised knee or a split stance must not shift the reference.
  const [k0, k1] = f.kneeY; const [a0, a1] = f.ankleY;
  if (finite(k0) && finite(k1) && Math.abs(k0 - k1) > f.torsoLen * 0.12) return base;
  if (finite(a0) && finite(a1) && Math.abs(a0 - a1) > f.torsoLen * 0.12) return base;
  const ankle = mean(legs.map(s => f.ankleY[s]));
  const legLen = ankle - f.hipY;
  if (legLen < 0.08) return base;
  const next = { ...base, kneeY: [...base.kneeY], thigh: [...base.thigh], samples: base.samples + 1 };
  next.hipY = ema(base.hipY, f.hipY); next.legLen = ema(base.legLen, legLen);
  for (const s of legs) {
    const hipY = f.loose.hip[s]?.y ?? f.hipY;
    next.kneeY[s] = ema(base.kneeY[s], f.kneeY[s]);
    next.thigh[s] = ema(base.thigh[s], Math.max(0.03, f.kneeY[s] - hipY));
  }
  if (f.shoulderWidth > 0 && f.facing > 0.45) next.shoulderWidth = ema(base.shoulderWidth, f.shoulderWidth);
  return next;
}
export const calibrated = (c) => Boolean(c && c.samples >= 3 && finite(c.hipY) && finite(c.legLen));

/** How far the hips went down, as a share of the standing leg length (0 standing, ~0.45 at parallel). */
export function hipDrop(f, c) {
  if (!f || !calibrated(c)) return null;
  return (f.hipY - c.hipY) / c.legLen;
}
/**
 * Squat depth that ignores walking toward the camera: how much the hip-to-ankle
 * height shrank compared with standing (0 standing, ~0.45 at parallel). Feet
 * stay planted in a squat or a lunge, so only the hips going down count.
 */
export function legCompression(f, c) {
  if (!f || !calibrated(c)) return null;
  const ankles = f.ankleY.filter(finite);
  if (!ankles.length) return null;
  return 1 - (mean(ankles) - f.hipY) / c.legLen;
}
/** Side-view knee bend mapped onto the same scale as legCompression (146° → 0, 90° → 0.36). */
export const kneeDepth = (degrees) => (finite(degrees) ? clamp((146 - degrees) / 157, 0, 0.6) : null);

/** Knee height on one side: 0 standing, 1 when the thigh is level with the hip. */
export function kneeRise(f, c, side) {
  if (!f || !c || !finite(c.kneeY[side]) || !finite(c.thigh[side]) || !finite(f.kneeY[side])) return null;
  return (c.kneeY[side] - f.kneeY[side]) / c.thigh[side];
}

/* ───────────── Repetitions ───────────── */

export function createReps() {
  return { phase: 'idle', frames: 0, peak: 0, excursion: 0, deepFrames: 0, startAt: 0, count: 0, lastAt: -Infinity };
}

/**
 * One repetition = from the top past `down` and back under `up`, each held
 * for `frames` frames. A dip past `attempt` that never reached `down` is an
 * attempt: not counted, and the coach can say why. `value` grows with depth;
 * null keeps the phase (a lost frame is not a movement).
 */
export function stepReps(previous, value, now, { down, up, attempt = up + (down - up) * 0.4, frames = 2, minMs = 500 }) {
  const s = { ...(previous || createReps()) };
  if (!finite(value)) return { state: s, rep: null, attempt: null }; // a lost frame is no evidence either way
  let rep = null; let tried = null;
  if (s.phase === 'idle') {
    s.frames = value < up ? s.frames + 1 : 0;
    if (s.frames >= frames) { s.phase = 'top'; s.frames = 0; s.excursion = 0; }
  } else if (s.phase === 'top') {
    s.excursion = Math.max(s.excursion, value);
    s.deepFrames = value >= attempt ? (s.deepFrames || 0) + 1 : s.deepFrames || 0;
    if (value > down) {
      s.frames += 1;
      if (s.frames >= frames) { s.phase = 'bottom'; s.frames = 0; s.peak = value; s.startAt = now; }
    } else {
      s.frames = 0;
      if (value < up) {
        // An attempt is a real dip held for a few frames, not a one-frame spike.
        if (s.excursion >= attempt && s.deepFrames >= frames) tried = { depth: s.excursion };
        s.excursion = value; s.deepFrames = 0;
      }
    }
  } else {
    s.peak = Math.max(s.peak, value);
    s.frames = value < up ? s.frames + 1 : 0;
    if (s.frames >= frames) {
      if (now - s.lastAt >= minMs) { s.count += 1; rep = { depth: s.peak, ms: now - s.startAt, at: now }; s.lastAt = now; }
      s.phase = 'top'; s.frames = 0; s.peak = 0; s.excursion = 0; s.deepFrames = 0;
    }
  }
  return { state: s, rep, attempt: tried };
}

/* ───────────── Holds ───────────── */

export function createHold() { return { since: null, lastOk: -Infinity, seconds: 0, best: 0 }; }

/** Continuous time while `ok`; a gap shorter than `graceMs` does not break the hold. */
export function stepHold(previous, ok, now, graceMs = 500) {
  const s = { ...(previous || createHold()) };
  if (ok) {
    if (s.since === null) s.since = now;
    s.lastOk = now; s.seconds = (now - s.since) / 1000; s.best = Math.max(s.best, s.seconds);
  } else if (s.since !== null && now - s.lastOk > graceMs) { s.since = null; s.seconds = 0; }
  return s;
}

/* ───────────── Error confirmation ───────────── */

/** A repetition error is confirmed when it shows up in `need` of the last `size` repetitions. */
export function confirmByReps(history, errors, size = 3, need = 2) {
  const next = [...(history || []), [...new Set(errors || [])]].slice(-size);
  const counts = {};
  for (const list of next) for (const tag of list) counts[tag] = (counts[tag] || 0) + 1;
  return { history: next, confirmed: Object.keys(counts).filter(tag => counts[tag] >= need) };
}

/**
 * A continuous error (during a hold) is confirmed after `holdMs`. `started`
 * lists tags confirmed on this frame: one observation per episode.
 */
export function stepLiveErrors(previous, tags, now, holdMs = 1200) {
  const old = previous || {};
  const state = {}; const confirmed = []; const started = [];
  for (const tag of new Set(tags || [])) {
    const since = old[tag]?.since ?? now;
    const wasConfirmed = Boolean(old[tag]?.confirmed);
    const isConfirmed = now - since >= holdMs;
    state[tag] = { since, confirmed: isConfirmed };
    if (isConfirmed) confirmed.push(tag);
    if (isConfirmed && !wasConfirmed) started.push(tag);
  }
  return { state, confirmed, started };
}

/** Coefficient of variation of the gaps between events: 0 for a perfect metronome. */
export function rhythmSpread(times) {
  if (!Array.isArray(times) || times.length < 4) return null;
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter(g => g > 0);
  if (gaps.length < 3) return null;
  const average = mean(gaps);
  const deviation = Math.sqrt(mean(gaps.map(g => (g - average) ** 2)));
  return average > 0 ? deviation / average : null;
}
