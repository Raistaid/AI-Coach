// Keeps the app shell sized to the part of the screen the person actually sees.
// On phones the on-screen keyboard shrinks the visual viewport, and iOS also
// pans the page to reveal the focused field. The shell follows the visual
// viewport (height and offset), so the header stays on top, the composer sits
// right above the keyboard and the tab bar stays put underneath it.
// The decision functions are pure and tested in viewport.test.mjs.

export const KEYBOARD_MIN_PX = 120;
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image', 'hidden']);

export function isEditable(node) {
  if (!node || node.disabled || node.readOnly) return false;
  if (node.isContentEditable) return true;
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return !NON_TEXT_INPUTS.has(String(node.type || 'text').toLowerCase());
}

/** Full screen height without the keyboard, updated on every viewport change. */
export function nextBaseline(previous, height, editing, widthChanged, layoutHeight = 0) {
  if (widthChanged) return editing ? Math.max(height, layoutHeight || 0) : height;
  if (!editing) return height;
  return Math.max(previous || 0, height);
}

/** The keyboard counts as open only on touch screens, while typing, after a real shrink. */
export function keyboardOpen({ height, baseline, editing, coarse }) {
  return Boolean(coarse && editing && baseline > 0 && Number.isFinite(height) && baseline - height >= KEYBOARD_MIN_PX);
}

export function initViewport({ root = document.documentElement, onChange = () => {} } = {}) {
  const vv = window.visualViewport;
  const coarse = window.matchMedia('(pointer: coarse)');
  let baseline = 0; let lastWidth = 0; let frame = 0;

  function sync() {
    frame = 0;
    if (vv && vv.scale > 1.01) return; // pinch zoom: keep the layout untouched
    const height = vv ? vv.height : window.innerHeight;
    const width = vv ? vv.width : window.innerWidth;
    const top = vv ? Math.max(0, vv.offsetTop) : 0;
    const editing = isEditable(document.activeElement);
    const widthChanged = Math.abs(width - lastWidth) > 1; lastWidth = width;
    baseline = nextBaseline(baseline, height, editing, widthChanged, root.clientHeight);
    root.style.setProperty('--vvh', `${Math.round(height)}px`);
    root.style.setProperty('--vvt', `${Math.round(top)}px`);
    onChange({ keyboard: keyboardOpen({ height, baseline, editing, coarse: coarse.matches }), height });
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };

  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', () => setTimeout(schedule, 120));
  document.addEventListener('focusin', () => { schedule(); setTimeout(schedule, 320); });
  document.addEventListener('focusout', () => {
    schedule();
    // iOS sometimes leaves the page panned after the keyboard closes.
    setTimeout(() => { if (!isEditable(document.activeElement)) { window.scrollTo(0, 0); schedule(); } }, 120);
  });
  sync();
}
