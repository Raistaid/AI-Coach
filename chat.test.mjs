import test from 'node:test';
import assert from 'node:assert/strict';
import { llmHandles, focusSkill, describeKnowledge, buildChatContext, buildChatMessages, historyMessages, validateChatReply, tidyReply, invitesToTrain, allowedChatNumbers, CHAT_MAX_CHARS, CHAT_HISTORY_TURNS } from './coach-chat.js';
import { SKILL_LIST } from './skills/index.js';

const stats = { trainings: 3, minutes: 12, bestStreak: 5, days: 2 };
const summary = { skillId: 'football', skillName: 'Чеканка мяча', demo: false, seconds: 67, metricValue: 4, metricLabel: 'касаний', lessonsDone: 2, lessonsTotal: 6, mistake: 'стопа поднималась выше колена (3 раз).', next: 'Серия из 3' };
const base = { name: 'Наран', personality: 'calm', stats, lastRecord: { skillName: 'Чеканка мяча', lessonsDone: 2, lessonsTotal: 6 }, summary, plan: ['balance', 'football'], skillId: 'football', skills: SKILL_LIST };
const numbers = (text) => (text.match(/\d+/g) || []).map(Number);

test('the model answers free questions and small talk; safety, numbers and actions stay with the rules', () => {
  for (const intent of [null, 'greet', 'howAreYou', 'thanks', 'tired', 'positive', 'bye']) assert.equal(llmHandles(intent), true, String(intent));
  for (const intent of ['pain', 'results', 'help', 'yes', 'no', 'train']) assert.equal(llmHandles(intent), false, intent);
});

test('the skill in focus follows the message, otherwise the chosen skill', () => {
  assert.equal(focusSkill('как правильно приседать?', 'football', SKILL_LIST).id, 'squats');
  assert.equal(focusSkill('что мне делать дальше', 'balance', SKILL_LIST).id, 'balance');
  assert.equal(focusSkill('привет', 'nope', SKILL_LIST).id, SKILL_LIST[0].id);
});

test('knowledge describes the focus skill with its lessons and advice, the rest by name only', () => {
  const football = SKILL_LIST.find(s => s.id === 'football');
  const text = describeKnowledge(football, SKILL_LIST);
  assert.match(text, /Навык в фокусе: «Чеканка мяча»/);
  assert.match(text, /6 шагов/);
  assert.match(text, /Стойка/);
  assert.match(text, /опорное колено/i);
  for (const s of SKILL_LIST.filter(s => s.id !== 'football')) assert.ok(text.includes(`«${s.name}»`), s.name);
  assert.doesNotMatch(text, /Неглубокий присед/, 'other skills do not bring their error lists');
});

test('context holds only real facts; every number in it is allowed, nothing else', () => {
  const context = buildChatContext({ ...base, query: 'как дела?' });
  assert.equal(context.personality, 'calm');
  assert.equal(context.focus, 'football');
  assert.match(context.facts, /Спортсмен: Наран/);
  assert.match(context.facts, /3 тренировки, 12 минут в движении, лучшая серия 5, 2 дня подряд/);
  assert.match(context.facts, /Последний эфир в этом чате: «Чеканка мяча», 67 секунд, 4 касания, шагов 2 из 6/);
  assert.match(context.facts, /Маршрут спортсмена: Баланс на одной ноге → Чеканка мяча/);
  for (const n of numbers(context.facts)) assert.ok(context.numbers.has(n), `number ${n} from the facts is allowed`);
  assert.equal(context.numbers.has(25), false);
  const empty = buildChatContext({ name: 'Макс', personality: 'fun', stats: { trainings: 0 }, skills: SKILL_LIST, query: 'привет' });
  assert.match(empty.facts, /тренировок с камерой ещё не было/);
  assert.doesNotMatch(empty.facts, /Последний эфир/);
  assert.match(buildChatContext({ ...base, summary: { ...summary, demo: true }, query: 'ну как' }).facts, /демо на нарисованном спортсмене/);
});

test('numbers from the question itself are allowed, so the coach may answer «3 раза в неделю?»', () => {
  const allowed = allowedChatNumbers('Факты без чисел.', 'можно тренироваться 4 раза в неделю по 20 минут?');
  for (const n of [1, 2, 3, 4, 20]) assert.ok(allowed.has(n));
  assert.equal(allowed.has(5), false);
});

test('messages: Russian system prompt with the rules and the facts, recent history, the question last', () => {
  const context = buildChatContext({ ...base, query: 'как правильно чеканить?' });
  const history = historyMessages([
    { role: 'coach', type: 'text', text: 'Привет!' }, { role: 'user', type: 'text', text: 'привет' },
    { role: 'coach', type: 'summary', data: {} }, { role: 'system', type: 'text', text: 'Эфир отменён' },
    { role: 'coach', type: 'text', text: 'Чем займёмся?' },
  ]);
  assert.deepEqual(history.map(m => m.role), ['assistant', 'user', 'assistant'], 'cards and system notes are not history for the model');
  const messages = buildChatMessages('как правильно чеканить?', context, history);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Опирайся только на факты/);
  assert.match(messages[0].content, /Начать эфир/);
  assert.match(messages[0].content, /обратиться к врачу/);
  assert.match(messages[0].content, /Навык в фокусе: «Чеканка мяча»/);
  assert.equal(messages.at(-1).role, 'user');
  assert.equal(messages.at(-1).content, 'как правильно чеканить?');
  assert.equal(messages.length, 1 + 3 + 1);
  const long = historyMessages(Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'coach' : 'user', type: 'text', text: `m${i}` })));
  assert.equal(long.length, CHAT_HISTORY_TURNS);
  assert.match(buildChatMessages('эй', buildChatContext({ ...base, personality: 'strict', query: 'эй' }))[0].content, /Характер: строгий/);
});

test('a short Russian reply with real numbers passes and is tidied', () => {
  const context = buildChatContext({ ...base, query: 'как у меня дела с чеканкой?' });
  const r = validateChatReply('Тренер: «В последнем эфире 4 касания и 2 шага из 6, стопу держи не выше колена. Повторим?»', context);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.text, 'В последнем эфире 4 касания и 2 шага из 6, стопу держи не выше колена. Повторим?');
  assert.equal(invitesToTrain(r.text), true);
  assert.equal(invitesToTrain('Молодец, так держать.'), false);
});

test('invented numbers, percentages, English, emoji, lists, diagnoses and long replies are rejected', () => {
  const context = buildChatContext({ ...base, query: 'как дела' });
  assert.equal(validateChatReply('Ты сделал 25 касаний!', context).reason, 'invented-number');
  assert.equal(validateChatReply('Точность 90 процентов, точнее 90%.', context).reason, 'invented-number');
  assert.equal(validateChatReply('Great job, keep going!', context).reason, 'not-russian');
  assert.equal(validateChatReply('Молодец 🔥', context).reason, 'emoji');
  assert.equal(validateChatReply('Сделай так:\n- стойка\n- подъёмы', context).reason, 'list');
  assert.equal(validateChatReply('Похоже, у тебя растяжение связок.', context).reason, 'diagnosis');
  assert.equal(validateChatReply('Да. '.repeat(CHAT_MAX_CHARS), context).reason, 'too-long');
  assert.equal(validateChatReply('', context).reason, 'empty');
  assert.equal(validateChatReply(null, context).reason, 'empty');
});

test('a reply cut mid-sentence keeps only its finished sentences', () => {
  assert.equal(tidyReply('Держи колено мягким и смотри на мяч. Когда почувствуешь ритм, добавь'), 'Держи колено мягким и смотри на мяч.');
  assert.equal(tidyReply('«Начни с одного касания!»'), 'Начни с одного касания!');
  assert.equal(tidyReply('Короткий обрывок без'), 'Короткий обрывок без', 'too short to cut: the validator decides');
});
