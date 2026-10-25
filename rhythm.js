// Rhythm of the counted events (ball touches, foot lifts, squat reps), built only from
// the moments the engine counted them. No video, no guesses: fewer than three events
// give no verdict. Pure functions, tested in rhythm.test.mjs.

export const MIN_EVENTS = 3;
/** An interval longer than this many medians is a pause or a dropped ball, not rhythm. */
export const BREAK_FACTOR = 3;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * { count, breaks, meanMs, evenness } where evenness is 0–100: 100 means equal
 * intervals, it falls with the spread of the intervals (coefficient of variation).
 * meanMs and evenness are null until there are enough events to judge.
 */
export function rhythmStats(times) {
  const t = (Array.isArray(times) ? times : []).filter(Number.isFinite).sort((a, b) => a - b);
  const all = t.slice(1).map((value, i) => value - t[i]).filter(d => d > 0);
  if (t.length < MIN_EVENTS || all.length < 2) return { count: t.length, breaks: 0, meanMs: null, evenness: null };
  const limit = median(all) * BREAK_FACTOR;
  const steady = all.filter(d => d <= limit);
  const breaks = all.length - steady.length;
  if (steady.length < 2) return { count: t.length, breaks, meanMs: null, evenness: null };
  const mean = steady.reduce((sum, d) => sum + d, 0) / steady.length;
  const spread = Math.sqrt(steady.reduce((sum, d) => sum + (d - mean) ** 2, 0) / steady.length);
  return { count: t.length, breaks, meanMs: Math.round(mean), evenness: Math.round(100 * Math.max(0, 1 - spread / mean)) };
}

/** Events per time slot, for a small bar strip. The sum always equals the number of events. */
export function rhythmBuckets(times, durationMs, buckets = 24) {
  const out = new Array(buckets).fill(0);
  if (!(durationMs > 0)) return out;
  for (const value of Array.isArray(times) ? times : []) {
    if (!Number.isFinite(value) || value < 0) continue;
    out[Math.min(buckets - 1, Math.floor((value / durationMs) * buckets))] += 1;
  }
  return out;
}

/** «Ровность ритма 86%, в среднем 1,4 с между касаниями, перерывов: 1.» */
export function rhythmText(stats, between = 'событиями') {
  if (!stats || stats.evenness === null) return `Мало засчитанных движений, чтобы оценить ритм: нужно хотя бы ${MIN_EVENTS}.`;
  const seconds = (stats.meanMs / 1000).toFixed(1).replace('.', ',');
  return `Ровность ритма ${stats.evenness}%, в среднем ${seconds} с между ${between}${stats.breaks ? `, перерывов: ${stats.breaks}` : ''}.`;
}
