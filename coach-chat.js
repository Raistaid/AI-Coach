// Free conversation in the chat with the local LLM. The model gets only facts
// the app really has: the person's name and the chosen character, real history
// numbers, the last session summary, the current route and the skill catalog
// (the skill in focus in detail, the rest in one line). Code decides which
// intents the model may answer, builds the prompt and validates every reply:
// Russian, short, no emoji, no invented numbers. On any failure the caller
// falls back to the rule-based phrase bank. Pure functions, tested in chat.test.mjs.
import { PERSONALITIES, personalityId } from './skills/common.js';
import { keywordPlan, pluralize } from './coach-planner.js';
import { metricPhrase } from './coach-talk.js';

export const CHAT_MAX_CHARS = 420;
export const CHAT_MAX_TOKENS = 150;
export const CHAT_HISTORY_TURNS = 6;
// Safety and actions stay with the rules: pain, results with real numbers, help about the
// app, consent («да»/«нет» may open the live screen) and goals (the planner answers those).
const LLM_INTENTS = new Set([null, 'greet', 'howAreYou', 'thanks', 'tired', 'positive', 'bye']);
export const llmHandles = (intent) => LLM_INTENTS.has(intent ?? null);

const TONE = {
  strict: 'Говори коротко и по делу, без лишних слов, как требовательный тренер.',
  fun: 'Говори живо и с лёгкой шуткой, подбадривай, но оставайся точным.',
  calm: 'Говори мягко и спокойно, объясняй понятно, не торопи.',
};
const steps = (n) => pluralize(n, ['шаг', 'шага', 'шагов']);
const minutes = (n) => pluralize(n, ['минута', 'минуты', 'минут']);
const seconds = (n) => pluralize(n, ['секунда', 'секунды', 'секунд']);

/** The skill the message is about; otherwise the one chosen in the app. */
export function focusSkill(query, skillId, skills) {
  const mentioned = keywordPlan(query, skills).plan[0];
  return skills.find(s => s.id === mentioned) || skills.find(s => s.id === skillId) || skills[0];
}

/** Catalog knowledge for the model: the focus skill in detail, the others by name. */
export function describeKnowledge(focus, skills) {
  const lessons = (focus.lessons || []).map((lesson, i) => `${i + 1}. ${lesson.title}: ${lesson.goal || ''}`.trim()).join('; ');
  const errors = Object.values(focus.errors || {}).map(e => `${e.label.toLowerCase()} — ${e.advice}`).join(' ');
  const others = skills.filter(s => s.id !== focus.id).map(s => `«${s.name}»`).join(', ');
  return [
    `Навык в фокусе: «${focus.name}», уровень ${focus.level.toLowerCase()}, ${steps(focus.lessons.length)}, около ${minutes(focus.minutes)}, ${focus.needsBall ? 'нужен мяч' : 'без инвентаря'}.`,
    `О навыке: ${focus.description}`,
    `Камера: ${focus.camera}`,
    lessons ? `Шаги урока: ${lessons}.` : '',
    errors ? `Типичные ошибки и советы: ${errors}` : '',
    others ? `Другие навыки в приложении: ${others}.` : '',
  ].filter(Boolean).join('\n');
}

function historyLine(stats, lastRecord) {
  if (!stats?.trainings) return 'История: тренировок с камерой ещё не было, цифр по результатам нет.';
  const parts = [pluralize(stats.trainings, ['тренировка', 'тренировки', 'тренировок'])];
  parts.push(stats.minutes > 0 ? `${minutes(stats.minutes)} в движении` : 'меньше минуты в движении');
  if (stats.bestStreak) parts.push(`лучшая серия ${stats.bestStreak}`);
  if (stats.days > 1) parts.push(`${pluralize(stats.days, ['день', 'дня', 'дней'])} подряд`);
  let line = `История: ${parts.join(', ')}.`;
  if (lastRecord) line += ` Последняя запись: «${lastRecord.skillName}», шагов ${lastRecord.lessonsDone} из ${lastRecord.lessonsTotal}.`;
  return line;
}
function summaryLine(s) {
  if (!s) return '';
  if (s.demo) return 'В этом чате было демо на нарисованном спортсмене: оно ничего не измеряет.';
  const parts = [`«${s.skillName}»`, seconds(Math.round(s.seconds || 0))];
  if (s.metricValue) parts.push(metricPhrase(s.metricValue, s.metricLabel));
  parts.push(`шагов ${s.lessonsDone ?? 0} из ${s.lessonsTotal ?? 0}`);
  let line = `Последний эфир в этом чате: ${parts.join(', ')}.`;
  if (s.mistake) line += ` Главная ошибка: ${s.mistake}`;
  if (s.next) line += ` Следующий шаг: ${s.next}`;
  return line;
}

/**
 * Everything the model may rely on. `c` = { name, personality, stats, lastRecord, summary,
 * plan, skillId, query, skills }. Returns { personality, focus, facts, numbers }.
 */
export function buildChatContext(c = {}) {
  const skills = c.skills || [];
  const personality = personalityId(c.personality);
  const focus = focusSkill(c.query || '', c.skillId, skills);
  const plan = (c.plan || []).map(id => skills.find(s => s.id === id)).filter(Boolean);
  const facts = [
    `Спортсмен: ${c.name || 'друг'}. Характер тренера: ${PERSONALITIES[personality].name.toLowerCase()}.`,
    historyLine(c.stats, c.lastRecord),
    summaryLine(c.summary),
    plan.length ? `Маршрут спортсмена: ${plan.map(s => s.name).join(' → ')}.` : '',
    focus ? describeKnowledge(focus, skills) : '',
  ].filter(Boolean).join('\n');
  return { personality, focus: focus?.id || '', facts, numbers: allowedChatNumbers(facts, c.query) };
}

/** Numbers the reply may contain: those in the facts, in the question itself, and 1–3. */
export function allowedChatNumbers(facts, query = '') {
  const set = new Set([1, 2, 3]);
  for (const match of `${facts}\n${query}`.match(/\d+/g) || []) set.add(Number(match));
  return set;
}

/** Last turns of the thread as plain chat messages for the model. */
export function historyMessages(messages, turns = CHAT_HISTORY_TURNS) {
  return (messages || [])
    .filter(m => m && m.type === 'text' && (m.role === 'user' || m.role === 'coach') && m.text)
    .slice(-turns)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.text).slice(0, 400) }));
}

export function buildChatMessages(query, context, history = []) {
  const personality = PERSONALITIES[context.personality] || PERSONALITIES.calm;
  const system = [
    'Ты Aimo, тренер в приложении на телефоне: через камеру ты следишь за позой и мячом и ведёшь человека по шагам урока в прямом эфире. Сейчас ты переписываешься с ним в чате.',
    `Характер: ${personality.name.toLowerCase()}. ${TONE[personality.id] || TONE.calm}`,
    'Правила: пиши по-русски, на «ты», одно-три коротких предложения, без списков, без эмодзи, без кавычек вокруг ответа.',
    'Опирайся только на факты ниже. Не называй числа, которых нет в фактах или в вопросе. Не выдумывай результаты, наблюдения и обещания.',
    'Техника и советы — только из описания навыков ниже; если просят то, чего в приложении нет, честно скажи и предложи ближайший навык.',
    'Если человек пишет о боли, травме или плохом самочувствии, скажи остановиться и при сильной или не проходящей боли обратиться к врачу.',
    'Эфир запускаешь не ты: человек нажимает «Начать эфир». Можешь предложить это, но не говори, что уже начал.',
    'Факты:',
    context.facts,
  ].join('\n');
  const past = (history || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content).slice(-CHAT_HISTORY_TURNS);
  return [{ role: 'system', content: system }, ...past, { role: 'user', content: String(query || '').trim() }];
}

/** Cleans the model output: no «Тренер:» prefix, no wrapping quotes, single spaces, a finished last sentence. */
export function tidyReply(raw) {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^(тренер|aimo|ответ)\s*[:：]\s*/iu, '').replace(/^["«»'\s]+|["«»'\s]+$/g, '').trim();
  // A reply cut by max_tokens or a timeout keeps only its finished sentences.
  if (text && !/[.!?…]$/.test(text)) { const end = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?')); if (end > 20) text = text.slice(0, end + 1); }
  return text;
}

/** Code-level guard for a chat reply: non-empty, short, Russian, no emoji, no invented numbers. */
export function validateChatReply(raw, context, query = '') {
  const text = tidyReply(raw);
  if (!text) return { ok: false, reason: 'empty', text };
  if (text.length > CHAT_MAX_CHARS) return { ok: false, reason: 'too-long', text };
  const letters = text.match(/\p{L}/gu) || [];
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu) || [];
  if (letters.length < 3 || cyrillic.length / letters.length < 0.8) return { ok: false, reason: 'not-russian', text };
  if (/\p{Extended_Pictographic}/u.test(text)) return { ok: false, reason: 'emoji', text };
  if (/(^|\n)\s*([-•*]|\d+[.)])\s/.test(String(raw || '').trim())) return { ok: false, reason: 'list', text };
  const allowed = context?.numbers || allowedChatNumbers(context?.facts || '', query);
  const numbers = (text.match(/\d+(?:[.,]\d+)?/g) || []).map(v => Number(v.replace(',', '.')));
  if (numbers.some(v => !allowed.has(v))) return { ok: false, reason: 'invented-number', text };
  if (/%/.test(text) && !/\d\s?%/.test(context?.facts || '')) return { ok: false, reason: 'invented-number', text };
  if (/(?:^|[^\p{L}])(диагноз|у тебя (растяжение|перелом|разрыв|воспаление))/iu.test(text)) return { ok: false, reason: 'diagnosis', text };
  return { ok: true, reason: '', text };
}

/** A reply that invites to train switches the quick replies to «Давай / Не сейчас». */
export const invitesToTrain = (text) => /\?/.test(text) && /(эфир|потренир|тренировк|начн[её]м|повторим|попробу|приступ)/iu.test(text);
