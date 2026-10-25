// The live coach's message budget: who speaks and when. Every candidate has a
// kind. Lesson events always pass; a view problem is said only after it has
// lasted a moment, and only a few times; a correction waits for a gap and is
// not repeated soon; praise is for milestones only; a nudge comes after a long
// pause. A minute holds a handful of remarks at most. Pure; unit-tested.

export const BUDGET = {
  gap: 6000,            // between two remarks of any kind (lesson events excepted)
  errorGap: 5000,       // a correction waits a little after the previous remark
  sameTag: 25000,       // the same correction is not repeated sooner
  praiseSameTag: 10000,
  framingDelay: 1500,   // a view problem must last this long before the coach says it
  framingRepeat: 12000,
  framingMax: 3,        // after that the screen keeps showing it and the voice is quiet
  framingReset: 5000,   // a long good view lets the warnings be said again later
  attemptGap: 3000,     // «not counted, go deeper» comes right after the attempt
  attemptSameTag: 15000,
  pendingMs: 4000,      // a correction blocked by the gap waits this long for its turn
  idle: 15000,          // no counted movement for this long brings one nudge
  idleRepeat: 30000,
  perMinute: 8,
  lessonGap: 1500,
};
const ORDER = { safety: 6, lesson: 5, framing: 4, attempt: 3.5, error: 3, praise: 2, idle: 1 };

export function createPolicy() {
  return {
    lastAt: -Infinity, lessonAt: -Infinity, tagAt: {}, recent: [], pending: null,
    framing: { tag: null, since: null, said: 0, at: -Infinity, okSince: null },
    activityAt: null, idleAt: -Infinity,
  };
}

/** View state each frame: `tag` names the problem, null while the athlete is fully in view. */
export function noteView(previous, tag, now) {
  const framing = { ...previous.framing };
  if (!tag) {
    if (framing.okSince === null) framing.okSince = now;
    framing.tag = null; framing.since = null;
    if (now - framing.okSince >= BUDGET.framingReset) framing.said = 0;
  } else {
    framing.okSince = null;
    if (framing.tag !== tag) { framing.tag = tag; framing.since = framing.since ?? now; }
  }
  return { ...previous, framing };
}

/** A counted movement, an attempt or a growing hold: the athlete is busy, no nudges. */
export function noteActivity(previous, now) { return { ...previous, activityAt: now }; }

function allowed(policy, cue, now, recent) {
  const tagAt = policy.tagAt[cue.tag] ?? -Infinity;
  switch (cue.kind) {
    case 'safety': return true;
    case 'lesson': return now - policy.lessonAt >= BUDGET.lessonGap;
    case 'framing': {
      const f = policy.framing;
      return f.since !== null && now - f.since >= BUDGET.framingDelay && now - f.at >= BUDGET.framingRepeat
        && f.said < BUDGET.framingMax && now - policy.lastAt >= 3000;
    }
    case 'attempt': return now - policy.lastAt >= BUDGET.attemptGap && now - tagAt >= BUDGET.attemptSameTag && recent.length < BUDGET.perMinute;
    case 'error': return now - policy.lastAt >= BUDGET.errorGap && now - tagAt >= BUDGET.sameTag && recent.length < BUDGET.perMinute;
    case 'praise': return now - policy.lastAt >= BUDGET.gap && now - tagAt >= BUDGET.praiseSameTag && recent.length < BUDGET.perMinute;
    case 'idle': {
      const since = policy.activityAt ?? now;
      return now - since >= BUDGET.idle && now - policy.idleAt >= BUDGET.idleRepeat && now - policy.lastAt >= BUDGET.gap && recent.length < BUDGET.perMinute;
    }
    default: return false;
  }
}

/**
 * Picks at most one cue to say now. Returns { policy, pick }. A correction that
 * only waits for the gap is kept for a few seconds and said when its turn comes.
 */
export function choose(previous, cues, now) {
  const recent = previous.recent.filter(at => now - at < 60000);
  const waiting = previous.pending && now <= previous.pending.until ? [previous.pending.cue] : [];
  const ranked = [...(cues || []), ...waiting].filter(Boolean)
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => (ORDER[b.cue.kind] || 0) - (ORDER[a.cue.kind] || 0) || (b.cue.priority || 0) - (a.cue.priority || 0) || a.index - b.index);
  const found = ranked.find(({ cue }) => allowed(previous, cue, now, recent));
  if (!found) {
    // Keep the most important correction for later instead of dropping it.
    // Only one-off events wait; a lasting problem comes back on its own while it lasts.
    const keep = ranked.find(({ cue }) => cue.once && (cue.kind === 'error' || cue.kind === 'attempt') && cue !== previous.pending?.cue);
    const pending = keep ? { cue: keep.cue, until: now + BUDGET.pendingMs } : waiting.length ? previous.pending : null;
    return { policy: { ...previous, recent, pending }, pick: null };
  }
  const pick = found.cue;
  const next = { ...previous, recent, pending: previous.pending?.cue === pick || previous.pending?.cue?.tag === pick.tag ? null : (waiting.length ? previous.pending : null), tagAt: { ...previous.tagAt, [pick.tag]: now }, lastAt: now };
  if (pick.kind === 'lesson' || pick.kind === 'safety') next.lessonAt = now;
  else next.recent = [...recent, now];
  if (pick.kind === 'framing') next.framing = { ...previous.framing, said: previous.framing.said + 1, at: now };
  if (pick.kind === 'idle') next.idleAt = now;
  return { policy: next, pick };
}
