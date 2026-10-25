// A drawn athlete for the demo mode and the tests: joint angles in, 33
// MediaPipe-style landmarks out. Geometry is in uniform units (the frame
// height); x is divided by the frame aspect at the end, exactly like a camera
// frame. Limb angles are degrees from "hanging straight down": in a side view
// positive means forward, in a front view positive means outward, and a
// `plane: 'sagittal'` limb in a front view moves toward the camera, so only its
// height changes on screen. Pure functions.

export const BODY = { thigh: 0.19, shin: 0.19, torso: 0.235, upperArm: 0.145, foreArm: 0.135, neck: 0.1, hipHalf: 0.045, shoulderHalf: 0.075 };
export const FLOOR = 0.92;
export const SIZE = 0.82; // the drawn athlete stands about two metres from the phone
export const sized = (size = SIZE) => Object.fromEntries(Object.entries(BODY).map(([key, value]) => [key, value * size]));
/** Hip height of a straight-legged athlete whose feet are on the floor. */
export const standHip = (size = SIZE) => FLOOR - (BODY.thigh + BODY.shin) * size - 0.02 * size;
const rad = (deg) => deg * Math.PI / 180;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (v, k) => ({ x: v.x * k, y: v.y * k });

/** Smooth 0→1→0 over one cycle; `at` is the share of the cycle, holds at the ends. */
export function wave(at, { down = 0.4, hold = 0.1 } = {}) {
  const t = ((at % 1) + 1) % 1;
  if (t < down) return (1 - Math.cos(Math.PI * t / down)) / 2;
  if (t < down + hold) return 1;
  const up = Math.max(0.05, 1 - down - hold - 0.12);
  if (t < down + hold + up) return (1 + Math.cos(Math.PI * (t - down - hold) / up)) / 2;
  return 0;
}

function limb(view, facing, outward, plane, deg, length) {
  if (view === 'side') return { x: Math.sin(rad(deg)) * length * facing, y: Math.cos(rad(deg)) * length };
  if (plane === 'sagittal') return { x: 0, y: Math.cos(rad(deg)) * length };
  return { x: Math.sin(rad(deg)) * length * outward, y: Math.cos(rad(deg)) * length };
}

/**
 * Standing or moving athlete. `hip` is the hip centre in uniform units, `torso`
 * the lean from upright (side view: forward; front view: to the image right).
 */
export function puppet({ view = 'front', facing = 1, hip, torso = 0, legs = [], arms = [], aspect = 9 / 16, near = 0, size = SIZE } = {}) {
  const side = view === 'side';
  const B = sized(size);
  const centre = hip || { x: 0.5 * aspect, y: standHip(size) };
  const lean = side ? { x: Math.sin(rad(torso)) * facing, y: -Math.cos(rad(torso)) } : { x: Math.sin(rad(torso)), y: -Math.cos(rad(torso)) };
  const shoulderMid = add(centre, scale(lean, B.torso));
  // MediaPipe "left" is the athlete's left: on the image right when facing the camera.
  const across = (s, half) => (side ? (s === 0 ? -0.004 : 0.004) : (s === 0 ? half : -half));
  const joints = { shoulder: [], elbow: [], wrist: [], hip: [], knee: [], ankle: [], heel: [], toe: [] };
  for (const s of [0, 1]) {
    const outward = s === 0 ? 1 : -1;
    const hipPoint = { x: centre.x + across(s, B.hipHalf), y: centre.y };
    const leg = legs[s] || {};
    const knee = add(hipPoint, limb(view, facing, outward, leg.plane, leg.thigh || 0, B.thigh));
    const ankle = add(knee, limb(view, facing, outward, leg.plane, leg.shin ?? leg.thigh ?? 0, B.shin));
    joints.hip.push(hipPoint); joints.knee.push(knee); joints.ankle.push(ankle);
    joints.heel.push(side ? add(ankle, { x: -0.016 * facing * size, y: 0.018 * size }) : add(ankle, { x: 0, y: 0.016 * size }));
    joints.toe.push(side ? add(ankle, { x: 0.045 * facing * size, y: 0.021 * size }) : add(ankle, { x: 0.011 * outward * size, y: 0.03 * size }));
    const shoulder = { x: shoulderMid.x + across(s, B.shoulderHalf), y: shoulderMid.y };
    const arm = arms[s] || {};
    const elbow = add(shoulder, limb(view, facing, outward, arm.plane, arm.upper ?? 6, B.upperArm));
    const wrist = add(elbow, limb(view, facing, outward, arm.plane, arm.fore ?? arm.upper ?? 4, B.foreArm));
    joints.shoulder.push(shoulder); joints.elbow.push(elbow); joints.wrist.push(wrist);
  }
  const nose = add(shoulderMid, add(scale(lean, B.neck), side ? { x: 0.025 * facing * size, y: 0 } : { x: 0, y: 0 }));
  return landmarks(joints, nose, { aspect, view, near, facing, size });
}

/**
 * Athlete along the floor in a side view: push-ups and planks. `angle` is the
 * body line above the floor in degrees, `sag` moves the hips toward the floor
 * (negative lifts them), `hands` are on the floor at `handX` or the forearms
 * rest under the shoulders (`forearms: true`).
 */
export function lying({ aspect = 9 / 16, facing = 1, feetX = null, angle = 20, sag = 0, handX = null, forearms = false, near = 0, size = 0.6, floor = FLOOR } = {}) {
  const B = sized(size);
  const length = (B.shin + B.thigh + B.torso + B.neck) * Math.cos(rad(angle));
  const ankle = { x: feetX ?? (aspect - length * facing) / 2, y: floor - 0.03 * size };
  const u = { x: Math.cos(rad(angle)) * facing, y: -Math.sin(rad(angle)) };
  const n = { x: Math.sin(rad(angle)) * facing, y: Math.cos(rad(angle)) }; // toward the floor
  const knee = add(ankle, scale(u, B.shin));
  const line = add(knee, scale(u, B.thigh));
  const hip = add(line, scale(n, sag * size));
  const shoulder = add(line, scale(u, B.torso));
  let elbow; let wrist;
  if (forearms) {
    elbow = { x: shoulder.x, y: floor - 0.025 * size };
    wrist = { x: elbow.x + B.foreArm * facing, y: floor - 0.025 * size };
  } else {
    wrist = { x: handX ?? shoulder.x, y: floor - 0.02 * size };
    const d = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y);
    const a = B.upperArm; const b = B.foreArm;
    const reach = Math.min(d, a + b - 1e-6);
    const toward = { x: (wrist.x - shoulder.x) / d, y: (wrist.y - shoulder.y) / d };
    const cos = Math.max(-1, Math.min(1, (a * a + reach * reach - b * b) / (2 * a * reach)));
    const turn = Math.acos(cos) * -facing; // elbows point back toward the feet
    const dir = { x: toward.x * Math.cos(turn) - toward.y * Math.sin(turn), y: toward.x * Math.sin(turn) + toward.y * Math.cos(turn) };
    elbow = add(shoulder, scale(dir, a));
  }
  const pair = (p, dx = 0.003) => [{ x: p.x - dx, y: p.y }, { x: p.x + dx, y: p.y }];
  const joints = {
    shoulder: pair(shoulder), elbow: pair(elbow), wrist: pair(wrist), hip: pair(hip), knee: pair(knee), ankle: pair(ankle),
    heel: pair(add(ankle, { x: -0.01 * facing, y: -0.02 * size })), toe: pair({ x: ankle.x - 0.003 * facing, y: floor - 0.003 }),
  };
  const nose = add(shoulder, add(scale(u, B.neck * 0.95), { x: 0, y: 0.01 * size }));
  return landmarks(joints, nose, { aspect, view: 'side', near, facing, size });
}

/** Fills the 33 MediaPipe slots from the main joints; face and hand points sit around them. */
function landmarks(j, nose, { aspect, view, near, facing, size = SIZE }) {
  const out = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.97, presence: 0.98 }));
  const put = (i, p, vis) => { out[i] = { x: p.x / aspect, y: p.y, z: 0, visibility: vis, presence: 0.98 }; };
  const sideVis = (s) => (view === 'side' ? (s === near ? 0.96 : 0.74) : 0.97);
  put(0, nose, 0.97);
  const eye = view === 'side' ? { x: 0.01 * facing, y: -0.018 } : { x: 0.018, y: -0.018 };
  [[1, 0.6], [2, 1], [3, 1.4]].forEach(([i, k]) => put(i, add(nose, { x: eye.x * k * (view === 'side' ? 1 : 1), y: eye.y }), 0.95));
  [[4, 0.6], [5, 1], [6, 1.4]].forEach(([i, k]) => put(i, add(nose, { x: view === 'side' ? eye.x * k : -eye.x * k, y: eye.y }), 0.95));
  put(7, add(nose, { x: view === 'side' ? -0.03 * facing : 0.035, y: -0.005 }), 0.9);
  put(8, add(nose, { x: view === 'side' ? -0.03 * facing : -0.035, y: -0.005 }), 0.9);
  put(9, add(nose, { x: view === 'side' ? 0 : 0.01, y: 0.02 }), 0.95);
  put(10, add(nose, { x: view === 'side' ? 0 : -0.01, y: 0.02 }), 0.95);
  const pairs = [['shoulder', 11], ['elbow', 13], ['wrist', 15], ['hip', 23], ['knee', 25], ['ankle', 27], ['heel', 29], ['toe', 31]];
  for (const [name, base] of pairs) for (const s of [0, 1]) put(base + s, j[name][s], sideVis(s));
  for (const s of [0, 1]) {
    const w = j.wrist[s]; const e = j.elbow[s];
    const dir = { x: w.x - e.x, y: w.y - e.y }; const len = Math.hypot(dir.x, dir.y) || 1;
    const tip = { x: dir.x / len * 0.03, y: dir.y / len * 0.03 };
    put(17 + s, add(w, { x: tip.x - 0.006, y: tip.y }), sideVis(s));
    put(19 + s, add(w, { x: tip.x + 0.006, y: tip.y }), sideVis(s));
    put(21 + s, add(w, { x: tip.x * 0.5 + 0.008, y: tip.y * 0.5 }), sideVis(s));
  }
  return out;
}

/** Tiny deterministic jitter, like real landmark noise: amplitude in uniform units. */
export function jitter(points, amount, seed = 1) {
  let state = Math.abs(Math.floor(seed * 9973)) % 2147483647 || 1;
  const next = () => { state = (state * 48271) % 2147483647; return state / 2147483647 - 0.5; };
  return points.map(p => ({ ...p, x: p.x + next() * 2 * amount, y: p.y + next() * 2 * amount }));
}
