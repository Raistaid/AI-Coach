// Single-leg balance: a raised foot held with an upright torso. The hold keeps
// counting through a wobble shorter than half a second; a tilted torso stops the
// clock and, if it lasts, brings a remark. The last step asks for the other leg.
import { createHold, stepHold } from '../coach-motion.js';
import { stanceLesson, holdLesson, crossedMark } from './common.js';
import { puppet, standHip, SIZE } from './puppet.js';

function level(f) {
  const [l, r] = f.strict.shoulder;
  const slope = l && r ? Math.abs(l.y - r.y) / f.torsoLen : 0;
  return f.tilt < 20 && slope < 0.3;
}

/** Front view: standing, one foot raised (side 0 or 1), optional torso lean. */
function balancePose(raise, { aspect, side = 1, lean = 0, sway = 0 }) {
  const size = SIZE;
  const legs = [{ thigh: 2, shin: 2 }, { thigh: 2, shin: 2 }];
  legs[side] = { thigh: 2 + 50 * raise, shin: 2 - 70 * raise, plane: 'sagittal' };
  const arm = { upper: 10 + 30 * raise, fore: 14 + 30 * raise };
  return puppet({ aspect, size, hip: { x: 0.5 * aspect + sway, y: standHip(size) }, torso: lean, legs, arms: [arm, arm] });
}

export default {
  id: 'balance',
  name: 'Баланс на одной ноге',
  short: 'Баланс',
  emoji: '🧘',
  category: 'football',
  level: 'Новичок',
  minutes: 5,
  needsBall: false,
  goal: 'Улучшаю баланс',
  tagline: 'Устойчивость для чеканки',
  camera: 'Телефон на уровне пояса в 2 метрах, встань лицом к нему. Рядом опора на всякий случай.',
  description: 'Четыре шага: подними стопу, удержи 5 и 10 секунд, затем 5 секунд на другой ноге. Время идёт, только пока корпус ровный.',
  metric: { key: 'balanceSeconds', label: 'с баланса', forms: ['секунда баланса', 'секунды баланса', 'секунд баланса'], unit: 'с', progress: 'Лучшее удержание, с' },
  view(f) { return f.legVisible[0] && f.legVisible[1] ? null : 'show-feet'; },

  measure({ f, feet, still, now }, memo = { hold: createHold(), bySide: [0, 0], side: -1 }) {
    const m = { ...memo, bySide: [...memo.bySide] };
    const upright = level(f);
    const ok = feet.raised && upright;
    const before = m.hold.best;
    m.hold = stepHold(m.hold, ok, now, 400);
    if (ok) m.side = feet.raisedSide;
    if (m.hold.since !== null && m.side >= 0) m.bySide[m.side] = Math.max(m.bySide[m.side], m.hold.seconds);
    const mark = crossedMark(before, m.hold.best);
    return {
      memo: m,
      milestone: mark ? { tag: 'balance-good', vars: { seconds: mark } } : null,
      live: feet.raised && !upright ? ['balance-align'] : [],
      hold: { active: m.hold.since !== null, seconds: m.hold.seconds, best: m.hold.best, side: m.side },
      activity: Boolean(feet.raised), ready: still && !feet.raised,
      counts: { hold: m.hold.seconds, best: m.hold.best, left: Math.floor(m.bySide[0]), right: Math.floor(m.bySide[1]) },
    };
  },

  lessons: [
    holdLesson({
      id: 'raise', title: 'Подними стопу', short: 'Подъём', seconds: 1,
      goal: 'Подними одну стопу и удержи секунду',
      intro: {
        strict: 'Шаг 1: подними одну стопу. Держи корпус ровно одну секунду.',
        fun: 'Шаг 1: фламинго! Подними одну стопу хотя бы на секунду.',
        calm: 'Шаг 1: слегка подними одну стопу и удержи её секунду. Опора рядом поможет.',
      },
    }),
    holdLesson({
      id: 'hold5', title: 'Удержи 5 секунд', short: '5 секунд', seconds: 5,
      goal: 'Пять секунд на одной ноге, корпус ровно',
      intro: {
        strict: 'Шаг 2: пять секунд на одной ноге. Плечи ровно.',
        fun: 'Шаг 2: пять секунд как статуя. Только не каменей!',
        calm: 'Шаг 2: удержи равновесие пять секунд. Смотри в одну точку.',
      },
    }),
    holdLesson({
      id: 'hold10', title: 'Удержи 10 секунд', short: '10 секунд', seconds: 10,
      goal: 'Десять секунд на одной ноге',
      intro: {
        strict: 'Шаг 3: десять секунд. Дыши ровно.',
        fun: 'Шаг 3: десять секунд! Фламинго одобряет.',
        calm: 'Шаг 3: десять секунд. Дыши спокойно, взгляд на одну точку.',
      },
    }),
    {
      id: 'other', title: 'Другая нога', short: 'Смена ноги', target: 5, unit: 'с',
      goal: 'Пять секунд на другой ноге',
      intro: {
        strict: 'Шаг 4: смени ногу. Пять секунд на другой.',
        fun: 'Шаг 4: а теперь другая нога! Пять секунд, и ты сбалансирован со всех сторон.',
        calm: 'Шаг 4: смени ногу и удержи равновесие пять секунд.',
      },
      update({ motion }, memo) {
        const hold = motion?.hold;
        const first = memo?.first ?? (hold?.side >= 0 ? hold.side : null);
        const current = hold?.active && first !== null && hold.side === 1 - first ? hold.seconds : 0;
        const best = Math.max(memo?.best || 0, current);
        return { progress: Math.min(5, best), memo: { first, best } };
      },
    },
  ],

  errors: {
    'balance-align': { label: 'Наклон корпуса при балансе', advice: 'Найди точку перед собой, плечи ровно, центр над опорной ногой.', priority: 2 },
  },

  result: (m) => ({ key: 'balanceSeconds', value: m.bestHold, label: 'с баланса' }),
  summaryLine: (m) => `Лучшее удержание: ${m.bestHold} секунд. Левая нога: ${m.left} с, правая: ${m.right} с.`,
  answer: (m) => `Лучшее непрерывное удержание: ${m.bestHold} с.`,
  rhythm: null,

  demo(t, aspect) {
    const ramp = (from, to) => Math.max(0, Math.min(1, (t - from) / (to - from)));
    if (t < 3) return { points: balancePose(0, { aspect }) };
    if (t < 20) {
      // Right foot up for a long hold with a lean that stops the clock for a moment.
      const lean = t > 13 && t < 16 ? 24 : 0;
      return { points: balancePose(Math.min(ramp(3, 3.6), 1 - ramp(19.4, 20)), { aspect, side: 1, lean, sway: 0.004 * Math.sin(t * 2.3) }) };
    }
    if (t < 22) return { points: balancePose(0, { aspect }) };
    // Then the other leg.
    return { points: balancePose(ramp(22, 22.6), { aspect, side: 0, sway: 0.004 * Math.sin(t * 2.1) }) };
  },

  phrases: {
    'balance-align': {
      strict: ['Наклон корпуса. Плечи ровно, взгляд вперёд.', 'Корпус уходит. Выровняйся.', 'Плечи неровно. Поправь.', 'Держи корпус вертикально.', 'Не заваливайся. Центр над опорой.'],
      fun: ['Качает, как на корабле! Плечи ровно.', 'Корпус в сторону поплыл. Возвращаем.', 'Выровняй плечи, фламинго так не падают.', 'Взгляд вперёд, плечи ровно, ты справишься.', 'Чуть выпрямись, и качка пройдёт.'],
      calm: ['Вижу наклон корпуса. Попробуй выровнять плечи и держи взгляд перед собой.', 'Корпус уходит в сторону. Спокойно выровняйся.', 'Найди точку перед собой и держи плечи ровно.', 'Небольшой наклон. Верни центр над опорной ногой.', 'Выпрямись мягко, без рывка.'],
    },
    'balance-good': {
      strict: ['{seconds} секунд. Держи.', 'Уже {seconds} секунд. Корпус ровно.', '{seconds} секунд на одной ноге. Дыши.', 'Есть {seconds} секунд. Не опускай.', 'Удержание {seconds} секунд. Хорошо.'],
      fun: ['{seconds} секунд! Фламинго аплодирует.', 'Уже {seconds} секунд, ты как статуя!', 'Ого, {seconds} секунд на одной ноге!', '{seconds} секунд! Баланс на уровне цирка.', 'Держишь {seconds} секунд. Огонь!'],
      calm: ['Уже {seconds} секунд. Хорошо держишь равновесие.', '{seconds} секунд на одной ноге. Дыши спокойно.', 'Удержание {seconds} секунд. Корпус ровный.', 'Отлично, {seconds} секунд. Продолжай.', '{seconds} секунд. Взгляд на одну точку.'],
    },
    'balance-idle': {
      strict: ['Подними одну стопу. Опора рядом.', 'Жду подъём стопы.', 'Стопу вверх. Начинай.', 'Готов. Одна нога в воздухе.', 'Начни упражнение: подними стопу.'],
      fun: ['Покажи фламинго! Одна стопа вверх.', 'Готов? Подними стопу, держись за что-нибудь, если нужно.', 'Одна нога отдыхает, вторая работает. Поехали!', 'Поднимай стопу, я считаю секунды.', 'Начинаем! Стопа вверх.'],
      calm: ['Для упражнения на баланс слегка подними одну стопу. При необходимости держись за устойчивую опору.', 'Начни, когда будешь готов: подними одну стопу.', 'Найди точку перед собой и подними стопу.', 'Всё в кадре. Подними стопу спокойно.', 'Можно начинать упражнение.'],
    },
  },
};
