// Jumping jacks, facing the camera. One jack = from closed (arms down, feet
// together) to open (hands up, feet wide) and back. A jump with only the legs or
// only the arms is an attempt: not counted, and the coach says which part was
// missing. Hands below the head or a narrow stance are remarks; an uneven
// rhythm too, once there are enough jumps to judge it.
import { rhythmSpread } from '../coach-motion.js';
import { stanceLesson, repLesson, REP_MARKS } from './common.js';
import { puppet, standHip } from './puppet.js';

const SIZE = 0.6; // arms overhead need room: the drawn athlete stands farther away

function shape(f, calib) {
  const width = calib?.shoulderWidth || f.shoulderWidth || 0.1;
  const spread = f.ankleGap !== null ? f.ankleGap / width : null;
  const lifts = f.wristLift.filter(Number.isFinite);
  const both = lifts.length === 2;
  return {
    spread,
    armsUp: both && Math.min(...lifts) > 0.15, // clearly above the shoulders
    armsDown: both && Math.max(...lifts) < 0.1,
    overHead: f.wristOverHead[0] && f.wristOverHead[1],
    legsOut: spread !== null && spread > 1.6,
    legsIn: spread !== null && spread < 1.25,
  };
}

/** Front view: openness 0 (closed) to 1 (open); `arms`/`legs` scale each part for the demo mistakes. */
export function jackPose(open, { aspect = 9 / 16, arms = 1, legs = 1, hop = 0 } = {}) {
  const leg = { thigh: 2 + 17 * open * legs };
  const arm = { upper: 8 + 152 * open * arms, fore: 6 + 166 * open * arms };
  return puppet({ aspect, size: SIZE, hip: { x: 0.5 * aspect, y: standHip(SIZE) - hop }, legs: [leg, leg], arms: [arm, arm] });
}

export default {
  id: 'jacks',
  name: 'Прыжки «звёздочка»',
  short: 'Звёздочка',
  emoji: '⭐',
  category: 'cardio',
  level: 'Новичок',
  minutes: 4,
  needsBall: false,
  goal: 'Разогреваюсь и держу ритм',
  tagline: 'Руки над головой, ноги шире, ровный ритм',
  camera: 'Телефон вертикально в 3 метрах, лицом к нему: в кадре руки над головой и стопы.',
  description: 'Стойка, пять прыжков и двадцать в ровном ритме. Засчитывается прыжок, где руки поднялись вверх, а ноги разошлись шире плеч.',
  metric: { key: 'reps', label: 'прыжков', forms: ['прыжок', 'прыжка', 'прыжков'], progress: 'Прыжки', rhythmWords: ['прыжки', 'прыжками'] },
  view(f) {
    if (!f.legVisible[0] || !f.legVisible[1]) return 'show-feet';
    if (!f.armSeen[0] || !f.armSeen[1]) return 'show-body';
    return f.facing < 0.3 ? 'turn-front' : null;
  },

  measure({ f, calib, still, now }, memo = { jack: { phase: 'idle', arms: false, legs: false, maxSpread: 0, overHead: false }, count: 0, clean: 0, times: [] }) {
    const m = { ...memo, jack: { ...memo.jack } };
    const s = shape(f, calib);
    const j = m.jack;
    let event = null; let milestone = null;
    if (j.phase === 'idle') {
      if (s.armsDown && s.legsIn) j.phase = 'closed';
    } else if (j.phase === 'closed') {
      if (s.armsUp || s.legsOut) Object.assign(j, { phase: 'open', arms: s.armsUp, legs: s.legsOut, maxSpread: s.spread || 0, overHead: s.overHead });
    } else {
      j.arms = j.arms || s.armsUp; j.legs = j.legs || s.legsOut;
      j.maxSpread = Math.max(j.maxSpread, s.spread || 0); j.overHead = j.overHead || s.overHead;
      if (s.armsDown && s.legsIn) {
        if (j.arms && j.legs) {
          const errors = [];
          if (!j.overHead) errors.push('jacks-arms');
          if (j.maxSpread < 1.8) errors.push('jacks-legs');
          // Rhythm of one continuous run: a pause or a missed jump starts a new run.
          m.times = m.times.length && now - m.times.at(-1) > 2500 ? [now] : [...m.times, now].slice(-9);
          const spread = m.times.length >= 8 ? rhythmSpread(m.times) : null;
          if (spread !== null && spread > 0.3) errors.push('jacks-tempo');
          m.count += 1; if (!errors.length) m.clean += 1;
          event = { type: 'rep', errors, clean: !errors.length };
          if (REP_MARKS.includes(m.count)) milestone = { tag: 'jacks-good', vars: { reps: m.count } };
        } else {
          event = { type: 'attempt', errors: [j.arms ? 'jacks-legs' : 'jacks-arms'] };
          m.times = [];
        }
        Object.assign(j, { phase: 'closed', arms: false, legs: false, maxSpread: 0, overHead: false });
      }
    }
    return {
      memo: m, event, milestone, phase: j.phase,
      activity: j.phase === 'open' || Boolean(event),
      ready: still && s.armsDown && s.legsIn,
      counts: { reps: m.count, clean: m.clean },
    };
  },

  lessons: [
    stanceLesson({
      seconds: 2, goal: 'Встань лицом к камере, руки вдоль тела, 2 секунды',
      intro: {
        strict: 'Шаг 1: встань лицом к камере, ноги вместе, руки вдоль тела. Две секунды.',
        fun: 'Шаг 1: встань ровно лицом ко мне. Замри на две секунды, сейчас будем прыгать!',
        calm: 'Шаг 1: встань лицом к камере, ноги вместе, руки вниз. Постой две секунды.',
      },
    }),
    repLesson({
      id: 'five', title: 'Пять прыжков', short: '5 прыжков', target: 5,
      goal: 'Пять прыжков: руки над головой, ноги шире плеч',
      intro: {
        strict: 'Шаг 2: пять прыжков. Руки над головой, ноги шире плеч.',
        fun: 'Шаг 2: пять звёздочек! Руки вверх, ноги в стороны.',
        calm: 'Шаг 2: пять прыжков. В прыжке руки вверх над головой, ноги шире плеч.',
      },
    }),
    repLesson({
      id: 'twenty', title: 'Двадцать в ритме', short: '20 прыжков', target: 20,
      goal: 'Двадцать прыжков в ровном ритме',
      intro: {
        strict: 'Шаг 3: двадцать прыжков. Ровный ритм.',
        fun: 'Шаг 3: двадцать звёздочек подряд, как метроном!',
        calm: 'Шаг 3: двадцать прыжков в ровном темпе. Дыши свободно.',
      },
    }),
  ],

  errors: {
    'jacks-arms': { label: 'Руки не поднимались над головой', advice: 'В прыжке поднимай руки до хлопка над головой.', priority: 3 },
    'jacks-legs': { label: 'Ноги расходились узко', advice: 'Ставь стопы шире плеч в каждом прыжке.', priority: 2 },
    'jacks-tempo': { label: 'Неровный ритм', advice: 'Считай про себя «раз-два» и прыгай в этот счёт.', priority: 1 },
  },

  result: (m) => ({ key: 'reps', value: m.reps, label: 'прыжков' }),
  summaryLine: (m) => `Прыжков: ${m.reps}, без замечаний: ${m.clean}.`,
  answer: (m) => `Засчитано прыжков: ${m.reps}, без замечаний: ${m.clean}.`,
  rhythm: 'reps',

  demo(t, aspect) {
    if (t < 3) return { points: jackPose(0, { aspect }) };
    const k = Math.floor((t - 3) / 1); const at = ((t - 3) % 1) / 1;
    const plan = [{}, {}, {}, {}, {}, { arms: 0 }, {}, {}, { arms: 0.62 }, { arms: 0.62 }, {}, {}, { legs: 0.65 }, { legs: 0.65 }, {}, {}, {}, {}];
    const step = plan[k % plan.length];
    const open = Math.sin(Math.PI * Math.min(1, at / 0.8)) ** 0.6;
    return { points: jackPose(at < 0.8 ? open : 0, { aspect, arms: step.arms ?? 1, legs: step.legs ?? 1, hop: 0.015 * Math.sin(Math.PI * Math.min(1, at / 0.8)) }) };
  },

  phrases: {
    'jacks-arms': {
      strict: ['Руки выше. Над головой.', 'Руки до конца вверх.', 'Не засчитал: руки не поднялись.', 'Хлопок над головой.', 'Руки выше головы.'],
      fun: ['Руки к небу! Звёздочка должна сиять.', 'Хлопни над головой, это и есть звёздочка!', 'Руки ленятся! Выше, до самого потолка.', 'Подними руки, будто машешь другу через поле!', 'Руки вверх, и будет настоящая звезда!'],
      calm: ['Поднимай руки выше, до уровня над головой.', 'В каждом прыжке руки поднимаются над головой.', 'Попробуй свести ладони над головой.', 'Руки выше, тогда прыжок засчитается целиком.', 'Руки чуть выше, плечи расслаблены.'],
    },
    'jacks-legs': {
      strict: ['Ноги шире.', 'Стопы шире плеч.', 'Не засчитал: ноги не разошлись.', 'Шире расставляй ноги.', 'Ноги в стороны.'],
      fun: ['Ноги, не стесняйтесь, шире!', 'Звёздочка с узкими лучами не считается. Шире ноги!', 'Ноги в стороны, как ножницы!', 'Шире шаг в прыжке, ты сможешь!', 'Раздвинь ноги пошире, и будет зачёт.'],
      calm: ['Расставляй ноги шире плеч в прыжке.', 'Стопы приземляются шире, чем плечи.', 'Чуть шире ноги, тогда прыжок засчитается.', 'Ноги в стороны и обратно вместе.', 'Пробуй приземляться на ширину чуть больше плеч.'],
    },
    'jacks-tempo': {
      strict: ['Ритм рваный. Держи темп.', 'Ровнее. Раз-два.', 'Не сбивайся. Ровный счёт.', 'Темп пляшет. Выровняй.', 'Ритм.'],
      fun: ['Ритм гуляет! Представь метроном.', 'Раз-два, раз-два, как под музыку!', 'Держи ритм, ты же не джаз играешь!', 'Ровнее, и будет красиво!', 'Найди свой бит и держись его.'],
      calm: ['Ритм получается неровным. Считай про себя «раз-два».', 'Попробуй прыгать в одном темпе.', 'Ровный ритм экономит силы.', 'Не спеши и не замедляйся, держи один темп.', 'Дыши ровно, и ритм выровняется.'],
    },
    'jacks-good': {
      strict: ['Прыжок {reps}. Хорошо.', 'Есть {reps}. Ритм держи.', 'Счёт {reps}.', 'Уже {reps}. Продолжай.', 'Прыжок {reps} засчитан.'],
      fun: ['Прыжок {reps}! Ты сияешь, звезда.', 'Уже {reps}! Вот это разогрев.', 'Счёт {reps}. Красиво!', 'Прыжок {reps}! Ещё!', 'Уже {reps}! Ритм огонь.'],
      calm: ['Прыжок {reps}. Хороший ритм.', 'Уже {reps}. Дыши свободно.', 'Счёт {reps}. Продолжай в своём темпе.', 'Отлично, уже {reps}.', 'Прыжок {reps}, всё правильно.'],
    },
    'jacks-idle': {
      strict: ['Жду прыжок.', 'Начинай. Руки вверх, ноги в стороны.', 'Прыгаем.', 'Готов? Первый прыжок.', 'Работаем.'],
      fun: ['Пора сиять! Первая звёздочка за тобой.', 'Ну что, попрыгаем?', 'Я считаю, начинай!', 'Руки вверх, ноги в стороны, поехали!', 'Разогреемся?'],
      calm: ['Когда будешь готов, начинай прыжки. Я считаю.', 'Можно начинать: руки вверх, ноги в стороны.', 'Не торопись, начни в удобном темпе.', 'Я жду первый прыжок.', 'Начни спокойно, ритм придёт.'],
    },
  },
};
