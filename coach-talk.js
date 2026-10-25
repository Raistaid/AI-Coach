// Small talk in the chat: greetings, «как дела», thanks, mood, tiredness, pain,
// questions about results, yes/no after an offer. Rules answer instantly and offline.
// Every number the coach says comes from the person's real history or the last
// session; the personality changes the tone, never the facts, and the advice on
// pain is identical for every personality. Pure functions, tested in talk.test.mjs.
import { pluralize } from './coach-planner.js';
import { SKILL_LIST } from './skills/index.js';

/** Lower case, ё → е, punctuation and emoji dropped, single spaces. */
export const normalizeTalk = (value) => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// Order matters: the first match wins. Word edges use \p{L} because \b ignores Cyrillic.
const PATTERNS = [
  ['pain', /(болит|болят|больно|(?<!\p{L})боль(?!\p{L})|травмировал|потянул|растянул|ушиб)/u],
  ['results', /(как (у меня )?(получилось|прошло|успехи|результат\p{L}*)|(мой|мои) (прогресс|успехи|результаты|итоги)|сколько (тренировок|я )|статистик|покажи итог)/u],
  ['howAreYou', /(как (у тебя )?(дела|жизнь|настроение|поживаешь)|как ты(?!\p{L})|как сам(?!\p{L})|что нового|чо как|как оно)/u],
  ['help', /(кто ты|что ты (умеешь|можешь|такое)|(?<!\p{L})помощь(?!\p{L})|(?<!\p{L})help(?!\p{L})|как (это |ты )?работает)/u],
  ['thanks', /(спасиб|(?<!\p{L})спс(?!\p{L})|благодар|(?<!\p{L})thanks?(?!\p{L})|сенкс)/u],
  ['tired', /(устал|тяжело|сложно|не получается|не выходит|трудно|(?<!\p{L})лень(?!\p{L}))/u],
  ['train', /(потренир|тренируемся|тренироваться|позанима|(?<!\p{L})заниматься|размяться|разомн|(?<!\p{L})начн[её]м(?!\p{L})|давай трен|го трен)/u],
  ['bye', /^(пока|до свидания|до встречи|увидимся|спокойной ночи|bye)(?!\p{L})/u],
  ['greet', /^(привет\p{L}*|здравств\p{L}*|хай|йо|дарова|здорова?|салют|доброе утро|добрый (день|вечер)|доброй ночи|hi|hello)(?!\p{L})/u],
  ['yes', /^(да|давай|го|погнали|ок|окей|конечно|ага|угу|можно|хочу)( (да|давай|конечно|го|погнали))?$/u],
  ['no', /^(нет|не хочу|не сейчас|потом|позже|не надо)( (спасибо|пока))?$/u],
  ['positive', /^(норм\p{L}*|хорошо|отлично|супер|класс|круто|кайф|огонь|прекрасно|неплохо|все (хорошо|отлично|норм\p{L}*))( \p{L}+){0,3}$/u],
];
/** Intents that win even over skill words: «болит колено после чеканки» is about pain, not a route. */
export const STRONG_INTENTS = new Set(['pain', 'results', 'howAreYou', 'help']);

export function detectIntent(message) {
  const text = normalizeTalk(message);
  if (!text) return null;
  for (const [name, pattern] of PATTERNS) if (pattern.test(text)) return name;
  return null;
}

/** A message that states a learning goal; only those may get «такого навыка пока нет». */
export function looksLikeGoal(message) {
  return /(хочу|хотел\p{L}*|научи|научить|уметь|освоить|трениров|улучшить|прокачать|подтянуть|стать|(?<!\p{L})цель|как (мне )?начать|можно ли)/u.test(normalizeTalk(message));
}

// Summary labels are stored in the «many» form; sentences need the right number agreement.
// Every skill declares its forms, so a new skill brings its own grammar.
const METRIC_FORMS = Object.fromEntries(SKILL_LIST.flatMap(skill => {
  const m = skill.metric;
  const list = [[m.label, m.forms]];
  if (m.fallbackLabel && m.fallbackForms) list.push([m.fallbackLabel, m.fallbackForms]);
  return list.filter(([label, forms]) => label && Array.isArray(forms));
}));
/** «4 касания», «1 подъём стопы», «12 секунд баланса»; unknown labels stay as they are. */
export function metricPhrase(value, label) {
  const forms = METRIC_FORMS[label];
  return forms ? pluralize(Number(value) || 0, forms) : `${value} ${label || ''}`.trim();
}

const formatTime = (seconds) => `${String(Math.floor((seconds || 0) / 60)).padStart(2, '0')}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const pick = (list, seed) => list[Math.abs(Math.floor(seed || 0)) % list.length];
const byTone = (bank, personality, seed) => pick(bank[personality] || bank.calm, seed);

function sessionLine(summary) {
  const parts = [`${summary.demo ? 'демо' : 'эфир'} «${summary.skillName}»`, `${formatTime(summary.seconds)} в движении`];
  if (!summary.demo && summary.metricValue) parts.push(metricPhrase(summary.metricValue, summary.metricLabel));
  parts.push(`шагов ${summary.lessonsDone} из ${summary.lessonsTotal}`);
  return parts.join(', ');
}

function resultsText(c) {
  const { stats, lastRecord } = c;
  if (!stats?.trainings) return 'Пока в истории нет эфиров с камерой: демо туда не записывается. Начни эфир, и здесь появятся итоги.';
  const parts = [pluralize(stats.trainings, ['тренировка', 'тренировки', 'тренировок'])];
  parts.push(stats.minutes > 0 ? `${pluralize(stats.minutes, ['минута', 'минуты', 'минут'])} в движении` : 'меньше минуты в движении');
  if (stats.bestStreak) parts.push(`лучшая серия ${stats.bestStreak}`);
  if (stats.days > 1) parts.push(`${pluralize(stats.days, ['день', 'дня', 'дней'])} подряд`);
  let text = `Всего ${parts.join(', ')}.`;
  if (lastRecord) text += ` Последний эфир: «${lastRecord.skillName}», шагов ${lastRecord.lessonsDone} из ${lastRecord.lessonsTotal}.`;
  return text;
}

const PAIN = 'Если что-то болит, остановись: боль — сигнал прекратить упражнение. Дай телу отдых. Если боль сильная или не проходит, обратись к врачу. Я подсказываю технику, но оценить травму не могу.';

/**
 * Reply for a detected intent. `c` = { name, personality, summary, stats, lastRecord, skillName, canStart }.
 * Returns { text, offer, action }: offer marks a reply that invites to start, action 'start' opens the live screen.
 */
export function talkReply(intent, c = {}, seed = 0) {
  const p = c.personality || 'calm';
  const name = c.name || 'друг';
  const skill = c.skillName || 'Чеканка мяча';
  const s = c.summary;
  switch (intent) {
    case 'pain':
      return { text: PAIN, offer: false };
    case 'results': {
      const tail = { strict: 'Дальше закрепляем.', fun: 'Растём!', calm: 'Каждая тренировка идёт в копилку.' }[p] || '';
      return { text: c.stats?.trainings ? `${resultsText(c)} ${tail}` : resultsText(c), offer: true };
    }
    case 'howAreYou': {
      if (s && s.demo) return { text: 'Всё хорошо! Это было демо на нарисованном спортсмене, оно ничего не измеряет. Попробуем настоящий эфир с камерой?', offer: true };
      if (s) {
        const line = capital(sessionLine(s));
        return { text: byTone({
          strict: [`Нормально, работаем. ${line}. Повторим или следующий шаг?`, `В строю. ${line}. Закрепим повтором?`],
          fun: [`Отлично, после такого эфира настроение огонь! ${line}. Как ощущения? Ещё раунд?`, `Супер! ${line}. Мяч уже скучает, повторим?`],
          calm: [`Всё хорошо, спасибо. ${line}. Как ощущения после тренировки? Можем повторить или перейти к следующему шагу.`, `Спасибо, всё спокойно. ${line}. Как самочувствие? Если есть силы, повторим.`],
        }, p, seed), offer: true };
      }
      return { text: byTone({
        strict: [`Нормально. Готов работать. Начнём с «${skill}»?`, `В строю. Есть десять минут на «${skill}»?`],
        fun: [`Отлично, рвусь в бой! А у тебя как? «${skill}» ждёт.`, `Лучше всех! Разомнёмся? Предлагаю «${skill}».`],
        calm: [`Всё хорошо, спасибо. А у тебя как? Если есть пара свободных минут, начнём с «${skill}».`, `Спасибо, всё спокойно. Как настроение? Можем потренировать «${skill}».`],
      }, p, seed), offer: true };
    }
    case 'help':
      return { text: 'Я тренер прямо на твоём телефоне: через камеру смотрю на позу и мяч, веду по шагам урока и подсказываю в эфире. Напиши цель, нажми навык в кружках сверху или «Начать эфир». Видео никуда не отправляется.', offer: false };
    case 'thanks':
      return { text: byTone({ strict: ['Пожалуйста. Работаем дальше.'], fun: ['Всегда пожалуйста! Ты молодец, что тренируешься.'], calm: ['Пожалуйста! Обращайся в любой момент.'] }, p, seed), offer: false };
    case 'tired': {
      const base = byTone({
        strict: ['Отдых тоже часть тренировки. Пауза, вода, потом один короткий спокойный подход.'],
        fun: ['Даже чемпионы устают! Передохни, попей воды и возвращайся, я подожду.'],
        calm: ['Это нормально. Сделай паузу и попей воды. Потом попробуй один короткий подход в спокойном темпе.'],
      }, p, seed);
      const hint = s && !s.demo && s.mistake && !/не заметил/.test(s.mistake) ? ` В прошлом эфире главное, над чем поработать: ${s.mistake}` : '';
      return { text: base + hint, offer: false };
    }
    case 'positive':
      return { text: byTone({ strict: ['Хорошо. Тогда следующий подход?'], fun: ['Вот это настрой! Держим темп, повторим?'], calm: ['Рад это слышать. Продолжим, когда захочешь.'] }, p, seed), offer: true };
    case 'bye':
      return { text: byTone({ strict: ['До встречи. Не пропускай тренировки.'], fun: ['Пока-пока! Возвращайся, мяч скучает.'], calm: [`До встречи, ${name}! Хорошего дня.`] }, p, seed), offer: false };
    case 'greet':
      return { text: byTone({ strict: [`Привет, ${name}. Чем займёмся?`], fun: [`Привет, ${name}! Чему научимся сегодня?`], calm: [`Привет, ${name}! Чему хочешь научиться сегодня?`] }, p, seed), offer: false };
    case 'train':
      return { text: byTone({
        strict: [`Работаем. Предлагаю «${skill}». Открываю эфир?`],
        fun: [`Вот это настрой! Предлагаю «${skill}». Погнали в эфир?`],
        calm: [`Отлично. Предлагаю начать с «${skill}». Открыть эфир?`],
      }, p, seed), offer: true };
    case 'yes':
      if (c.canStart) return { text: `Поехали! Открываю эфир: «${skill}».`, offer: false, action: 'start' };
      return { text: 'Отлично! Напиши, что хочешь потренировать, или выбери навык в кружках сверху.', offer: false };
    case 'no':
      return { text: byTone({ strict: ['Понял. Когда будешь в деле, пиши.'], fun: ['Без проблем, я никуда не денусь!'], calm: ['Хорошо, без спешки. Когда захочешь, просто напиши.'] }, p, seed), offer: false };
    default:
      return { text: byTone({
        strict: ['Не понял. Я про тренировки: напиши цель, например «хочу научиться чеканить».'],
        fun: ['Хм, это за пределами моего стадиона! Я разбираюсь в тренировках: напиши цель, например «хочу научиться чеканить».'],
        calm: ['Не совсем понял. Я помогаю с тренировками: соберу маршрут под цель, запущу эфир или покажу итоги. Например: «хочу научиться чеканить».'],
      }, p, seed), offer: false };
  }
}
