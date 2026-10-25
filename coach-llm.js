// Local "live coach": a small LLM running in the browser through WebLLM.
// It only ever receives a numeric summary of the session, never frames.
// Every reply is validated by code; on failure the rule-based phrase is used.
import { PERSONALITIES, personalityId } from './skills/common.js';
import { getSkill, SKILL_LIST } from './skills/index.js';

export const WEBLLM_VERSION = '0.2.86';
export const WEBLLM_URL = `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/+esm`;
export const LLM_MODELS = {
  default: { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 · 1.5B', size: 'около 1 ГБ' },
  small: { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 · 0.5B', size: 'около 400 МБ' },
};
export const LIVE_MAX_CHARS = 150;
export const FINAL_MAX_CHARS = 520;
// Mistake names come from the catalog: every skill describes its own errors.
const MISTAKE_LABELS = {
  'no-person': 'спортсмен вне кадра', 'show-feet': 'стопы вне кадра',
  ...Object.fromEntries(SKILL_LIST.flatMap(skill => Object.entries(skill.errors || {}).map(([tag, info]) => [tag, info.label.toLowerCase()]))),
};

export const supportsWebGPU = () => typeof navigator !== 'undefined' && Boolean(navigator.gpu);

let webllmPromise;
async function loadWebLLM() {
  if (!webllmPromise) webllmPromise = import(WEBLLM_URL).catch(cause => {
    webllmPromise = null;
    const error = new Error('Не удалось загрузить библиотеку WebLLM. Проверь интернет.'); error.cause = cause; throw error;
  });
  return webllmPromise;
}
export async function hasCachedModel(modelId) {
  if (!Object.values(LLM_MODELS).some(model => model.id === modelId)) throw new Error('Неизвестная модель.');
  const webllm = await loadWebLLM();
  return webllm.hasModelInCache(modelId);
}

/** Numbers only. This is the whole context the model gets. */
export function buildSummary(snapshot = {}) {
  const skill = getSkill(snapshot.skillId);
  const lesson = snapshot.lesson || {};
  const mistake = snapshot.mainMistake || null;
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
  return {
    skill: skill.name, skillId: skill.id,
    personality: personalityId(snapshot.personality),
    lessonTitle: lesson.title || '',
    lessonIndex: Math.min(n(lesson.index) + 1, n(lesson.total) || 1),
    lessonTotal: n(lesson.total),
    lessonProgress: n(lesson.progress), lessonTarget: n(lesson.target),
    lessonsDone: n(snapshot.lessonsDone),
    seconds: n(snapshot.seconds),
    touches: n(snapshot.touches), streak: n(snapshot.streak), bestStreak: n(snapshot.bestStreak), drops: n(snapshot.drops),
    lifts: n(snapshot.lifts), reps: n(snapshot.reps), clean: n(snapshot.clean), left: n(snapshot.left), right: n(snapshot.right),
    hold: n(snapshot.hold), bestHold: n(snapshot.bestHold ?? snapshot.balanceSeconds), balanceSeconds: n(snapshot.bestHold ?? snapshot.balanceSeconds),
    ballSeen: Boolean(snapshot.ballSeen),
    visiblePercent: Math.max(0, Math.min(100, n(snapshot.visiblePercent))),
    mainMistake: mistake ? (MISTAKE_LABELS[mistake.tag] || mistake.tag) : '',
    mistakeCount: n(mistake?.count),
    cues: n(snapshot.cues),
  };
}

export function allowedNumbers(summary) {
  const values = new Set();
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === 'number' && key !== 'cues') values.add(value);
  }
  values.add(Math.floor(summary.seconds / 60)); values.add(summary.seconds % 60);
  return values;
}

function describeSummary(summary) {
  const skill = getSkill(summary.skillId);
  const lines = [
    `Навык: ${summary.skill}.`,
    summary.lessonTotal ? `Шаг ${summary.lessonIndex} из ${summary.lessonTotal}: ${summary.lessonTitle}, прогресс ${summary.lessonProgress} из ${summary.lessonTarget}.` : '',
    `Выполнено шагов: ${summary.lessonsDone}. Время тренировки: ${summary.seconds} секунд.`,
    skill.summaryLine(summary),
    `Спортсмен был виден ${summary.visiblePercent}% времени.`,
    summary.mainMistake ? `Главная ошибка: ${summary.mainMistake}, замечена ${summary.mistakeCount} раз.` : 'Явных ошибок не замечено.',
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildMessages(summary, mode = 'live') {
  const personality = PERSONALITIES[summary.personality] || PERSONALITIES.calm;
  const system = [
    `Ты тренер по навыку «${summary.skill}» и ведёшь прямой эфир тренировки.`,
    `Характер: ${personality.name.toLowerCase()}. ${personality.description}`,
    'Ты видишь только числовую сводку ниже. Никаких других фактов нет.',
    'Правила: пиши по-русски, обращайся на «ты», без эмодзи, без кавычек, без списков.',
    'Используй только числа из сводки. Не называй числа, которых нет в сводке. Не оценивай то, чего в сводке нет.',
    mode === 'final'
      ? 'Напиши итог тренировки: три коротких предложения. Что получилось, главная ошибка, следующий шаг.'
      : 'Напиши одну короткую фразу для спортсмена прямо сейчас, не больше 18 слов.',
  ].join(' ');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Сводка:\n${describeSummary(summary)}` },
  ];
}

/** Code-level guard: length, language, and no invented numbers. */
export function validateReply(reply, summary, mode = 'live') {
  const text = String(reply || '').replace(/\s+/g, ' ').replace(/^["«»'\s]+|["«»'\s]+$/g, '').trim();
  if (!text) return { ok: false, reason: 'empty', text };
  const limit = mode === 'final' ? FINAL_MAX_CHARS : LIVE_MAX_CHARS;
  if (text.length > limit) return { ok: false, reason: 'too-long', text };
  const letters = text.match(/\p{L}/gu) || [];
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu) || [];
  if (letters.length < 3 || cyrillic.length / letters.length < 0.8) return { ok: false, reason: 'not-russian', text };
  if (/\p{Extended_Pictographic}/u.test(text)) return { ok: false, reason: 'emoji', text };
  const allowed = allowedNumbers(summary);
  const numbers = (text.match(/\d+(?:[.,]\d+)?/g) || []).map(v => Number(v.replace(',', '.')));
  const invented = numbers.find(v => !allowed.has(v));
  if (invented !== undefined) return { ok: false, reason: 'invented-number', text };
  if (/%/.test(text) && !text.includes(`${summary.visiblePercent}%`)) return { ok: false, reason: 'invented-number', text };
  return { ok: true, reason: '', text };
}

/**
 * Loads WebLLM inside a Web Worker. Resolves to a coach object with
 * `generate(summary, mode)` and `unload()`. Throws a friendly error when the
 * device cannot run the model.
 */
export async function createLocalCoach({ modelId = LLM_MODELS.default.id, onStatus = () => {}, onProgress = () => {}, signal } = {}) {
  if (!supportsWebGPU()) throw new Error('В этом браузере нет WebGPU. Живой тренер недоступен, подсказки по правилам работают.');
  if (typeof Worker === 'undefined') throw new Error('Этот браузер не поддерживает Web Worker.');
  const aborted = () => { if (signal?.aborted) throw new DOMException('Загрузка отменена', 'AbortError'); };
  aborted();
  const webllm = await loadWebLLM();
  aborted();
  const cached = await webllm.hasModelInCache(modelId).catch(() => false);
  aborted();
  onStatus(cached ? 'Модель найдена в кеше, запускаем…' : 'Скачиваем модель живого тренера…');
  const worker = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' });
  let engine;
  let abortLoad;
  try {
    const loading = webllm.CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: (report) => onProgress({ progress: report.progress ?? 0, text: report.text ?? '' }),
    });
    const cancellation = new Promise((_, reject) => {
      abortLoad = () => { worker.terminate(); reject(new DOMException('Загрузка отменена', 'AbortError')); };
      signal?.addEventListener('abort', abortLoad, { once: true });
      if (signal?.aborted) abortLoad();
    });
    engine = await Promise.race([loading, cancellation]);
  } catch (cause) {
    worker.terminate();
    if (cause.name === 'AbortError') throw cause;
    const error = new Error('Не удалось запустить модель на этом устройстве. Возможно, не хватает памяти GPU.');
    error.cause = cause;
    throw error;
  } finally { if (abortLoad) signal?.removeEventListener('abort', abortLoad); }
  onStatus('Живой тренер готов');
  let busy = false;
  let closed = false;
  return {
    modelId, cached,
    get busy() { return busy; },
    async generate(summary, mode = 'live') {
      if (closed || busy) return null;
      busy = true;
      try {
        const reply = await engine.chat.completions.create({
          messages: buildMessages(summary, mode),
          temperature: 0.7, top_p: 0.9,
          max_tokens: mode === 'final' ? 220 : 60,
        });
        const text = reply?.choices?.[0]?.message?.content ?? '';
        const checked = validateReply(text, summary, mode);
        return checked.ok ? checked.text : null;
      } catch (error) {
        console.warn('Aimo local LLM:', error);
        return null;
      } finally { busy = false; }
    },
    /** Free-form chat for the skill planner. Returns raw text; the caller validates it. */
    async chat(messages, { maxTokens = 200, temperature = 0.4 } = {}) {
      if (closed || busy) return null;
      busy = true;
      try {
        const reply = await engine.chat.completions.create({ messages, temperature, top_p: 0.9, max_tokens: maxTokens });
        return reply?.choices?.[0]?.message?.content ?? '';
      } catch (error) {
        console.warn('Aimo local LLM chat:', error);
        return null;
      } finally { busy = false; }
    },
    async unload() {
      if (closed) return;
      closed = true;
      try { await engine.unload(); } catch { /* worker may already be gone */ }
      worker.terminate();
    },
  };
}
