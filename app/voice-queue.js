// One voice at a time and no cutting off: a new phrase never interrupts the one
// being spoken. At most one phrase waits; a more important one takes its place,
// a stale one is dropped (a remark about a rep from five seconds ago is noise).
// Stopping — pause, finish, a question — fades the voice out. DOM-free; tested.

export const VOICE_PRIORITY = { question: 4, lesson: 3, warning: 2, tip: 2, success: 1 };
const WAIT_MS = { 4: 12000, 3: 9000, 2: 4000, 1: 2500 };

/**
 * `start(text, item, done)` begins speaking and must call `done()` once when the
 * phrase ends or fails (it may return false or a promise of false when nothing
 * started). `stop()` silences the current phrase.
 */
export function createVoiceQueue({ start, stop = () => {}, now = () => Date.now() } = {}) {
  let busy = false; let pending = null; let serial = 0;
  function finish(id) {
    if (id !== serial) return;
    busy = false;
    const next = pending; pending = null;
    if (next && now() <= next.until) play(next);
  }
  function play(item) {
    busy = true;
    const id = ++serial; let ended = false;
    const done = () => { if (!ended) { ended = true; finish(id); } };
    try { Promise.resolve(start(item.text, item, done)).then(ok => { if (ok === false) done(); }, done); } catch { done(); }
  }
  return {
    /** Returns 'spoken', 'queued' or 'dropped'. */
    say(text, { priority = 2 } = {}) {
      const value = String(text || '').trim();
      if (!value) return 'dropped';
      const item = { text: value, priority, until: now() + (WAIT_MS[priority] ?? 3000) };
      if (!busy) { play(item); return 'spoken'; }
      if (!pending || priority >= pending.priority || now() > pending.until) { pending = item; return 'queued'; }
      return 'dropped';
    },
    stop() { pending = null; serial++; busy = false; stop(); },
    get busy() { return busy; },
    get pending() { return pending?.text ?? null; },
  };
}
