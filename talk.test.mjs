import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, looksLikeGoal, talkReply, STRONG_INTENTS, normalizeTalk, metricPhrase } from './coach-talk.js';

const summary = { skillId: 'football', skillName: 'Чеканка мяча', demo: false, seconds: 67, metricValue: 4, metricLabel: 'касаний', lessonsDone: 2, lessonsTotal: 6, mistake: 'стопа поднималась выше колена (3 раз).' };
const stats = { trainings: 3, minutes: 12, bestStreak: 5, days: 2 };
const base = { name: 'Наран', personality: 'calm', summary: null, stats: { trainings: 0, minutes: 0, bestStreak: 0, days: 0 }, lastRecord: null, skillName: 'Чеканка мяча', canStart: false };
const numbers = (text) => (text.match(/\d+/g) || []).map(Number);

test('everyday phrases are recognised, punctuation and case do not matter', () => {
  const cases = {
    'Как дела?': 'howAreYou', 'привет, как ты': 'howAreYou', 'что нового': 'howAreYou',
    'Спасибо!': 'thanks', 'спс': 'thanks', 'устал': 'tired', 'не получается(': 'tired',
    'нормально': 'positive', 'всё отлично': 'positive', 'Привет': 'greet', 'дарова': 'greet',
    'как у меня получилось?': 'results', 'мой прогресс': 'results', 'кто ты': 'help', 'что ты умеешь': 'help',
    'да': 'yes', 'давай': 'yes', 'нет': 'no', 'не сейчас': 'no', 'пока': 'bye',
    'болит колено после чеканки': 'pain', 'больно': 'pain',
  };
  for (const [message, intent] of Object.entries(cases)) assert.equal(detectIntent(message), intent, message);
  assert.equal(normalizeTalk('  Как   ДЕЛА?!  '), 'как дела');
});

test('goals and lookalikes are not swallowed by small talk', () => {
  assert.equal(detectIntent('давай научимся чеканить'), null, '«давай» inside a goal is not a bare yes');
  assert.equal(detectIntent('можно ли научиться летать'), null, '«можно ли» is a goal question, not consent');
  assert.equal(detectIntent('дальше'), null);
  assert.notEqual(detectIntent('хочу без травм тренироваться'), 'pain', 'avoiding injury is a goal, not pain');
  assert.equal(detectIntent('больше касаний'), null, '«больше» is not «боль»');
  assert.equal(looksLikeGoal('хочу научиться стоять на руках'), true);
  assert.equal(looksLikeGoal('как дела'), false);
  assert.equal(looksLikeGoal('что думаешь о погоде'), false);
});

test('pain, results, «как дела» and help beat skill words', () => {
  for (const intent of ['pain', 'results', 'howAreYou', 'help']) assert.equal(STRONG_INTENTS.has(intent), true);
  for (const intent of ['greet', 'yes', 'thanks']) assert.equal(STRONG_INTENTS.has(intent), false);
});

test('«как дела» after a live session talks about that session with its real numbers only', () => {
  const reply = talkReply('howAreYou', { ...base, summary }, 0);
  assert.match(reply.text, /Чеканка мяча/);
  assert.match(reply.text, /01:07 в движении/);
  assert.match(reply.text, /шагов 2 из 6/);
  assert.equal(reply.offer, true);
  const allowed = new Set([1, 7, 4, 2, 6]);
  for (const n of numbers(reply.text)) assert.ok(allowed.has(n), `invented number ${n}`);
  assert.doesNotMatch(reply.text, /нет навыка|каталоге/);
});

test('without history the coach invents no numbers; a demo is called a demo', () => {
  for (const intent of ['howAreYou', 'thanks', 'positive', 'greet', 'help', 'bye', 'no', 'tired', null]) {
    for (const personality of ['strict', 'fun', 'calm']) {
      const reply = talkReply(intent, { ...base, personality }, 1);
      assert.ok(reply.text.length > 10, `${intent}/${personality}`);
      assert.deepEqual(numbers(reply.text), [], `${intent}/${personality}: ${reply.text}`);
      assert.doesNotMatch(reply.text, /нет навыка/);
    }
  }
  assert.match(talkReply('howAreYou', { ...base, summary: { ...summary, demo: true } }).text, /демо/);
});

test('results come from the real history', () => {
  const reply = talkReply('results', { ...base, stats, lastRecord: { skillName: 'Баланс на одной ноге', lessonsDone: 3, lessonsTotal: 3 } });
  assert.match(reply.text, /3 тренировки, 12 минут в движении, лучшая серия 5, 2 дня подряд/);
  assert.match(reply.text, /«Баланс на одной ноге», шагов 3 из 3/);
  assert.match(talkReply('results', base).text, /нет эфиров/);
});

test('pain advice is the same for every personality and never suggests training on', () => {
  const replies = ['strict', 'fun', 'calm'].map(personality => talkReply('pain', { ...base, personality, canStart: true }));
  assert.equal(new Set(replies.map(r => r.text)).size, 1);
  assert.match(replies[0].text, /остановись/);
  assert.match(replies[0].text, /врачу/);
  assert.equal(replies[0].action, undefined);
});

test('«да» starts the live screen only after the coach offered it', () => {
  assert.equal(talkReply('yes', { ...base, canStart: true }).action, 'start');
  assert.equal(talkReply('yes', { ...base, canStart: false }).action, undefined);
});

test('personality changes the tone, not the facts', () => {
  const tones = ['strict', 'fun', 'calm'].map(personality => talkReply('howAreYou', { ...base, personality, summary }, 0).text);
  assert.equal(new Set(tones).size, 3);
  for (const text of tones) assert.match(text, /01:07 в движении, 4 касания, шагов 2 из 6/);
});

test('tiredness after a session points at the real main mistake', () => {
  assert.match(talkReply('tired', { ...base, summary }).text, /стопа поднималась выше колена/);
  assert.doesNotMatch(talkReply('tired', { ...base, summary: { ...summary, mistake: 'явных ошибок тренер не заметил.' } }).text, /главное/);
});

test('metric phrases agree with the number', () => {
  assert.equal(metricPhrase(4, 'касаний'), '4 касания');
  assert.equal(metricPhrase(1, 'подъёмов стопы'), '1 подъём стопы');
  assert.equal(metricPhrase(11, 'повторов'), '11 повторов');
  assert.equal(metricPhrase(22, 'с баланса'), '22 секунды баланса');
  assert.equal(metricPhrase(3, 'шагов'), '3 шагов', 'unknown labels are left as they are');
});

test('«давай потренируемся» is an invitation to train, not «не понял»', () => {
  for (const message of ['Давай потренируемся', 'хочу потренироваться', 'го тренироваться', 'давай позанимаемся', 'начнём']) assert.equal(detectIntent(message), 'train', message);
  const reply = talkReply('train', { ...base, skillName: 'Приседания' });
  assert.match(reply.text, /«Приседания»/);
  assert.equal(reply.offer, true, 'the next «давай» opens the live screen');
  assert.equal(detectIntent('устал тренироваться'), 'tired', 'tiredness wins over training');
  assert.notEqual(detectIntent('хочу научиться чеканить'), 'train');
});
