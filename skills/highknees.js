// High knees, facing the camera: running on the spot with the knee up to hip
// height. The knee height is measured against the athlete's own standing thigh
// length (taken in step 1), so it works at any distance. Each leg is counted;
// a knee below the hip line is an attempt or a remark, and so are a leaning
// torso and a slow pace.
import { kneeRise } from '../coach-motion.js';
import { stanceLesson, repLesson, REP_MARKS } from './common.js';
import { puppet, standHip, SIZE } from './puppet.js';

const UP = 0.55; const DOWN = 0.25; const GOOD = 0.8;

/** Front view: left/right knee lift 0..1 (1 = thigh level with the hip). */
export function kneesPose(left, right, { aspect = 9 / 16, lean = 0 } = {}) {
  const leg = (lift) => ({ thigh: 2 + 88 * lift, shin: 2 - 10 * lift, plane: 'sagittal' });
  const arm = (swing) => ({ upper: 10 + 40 * swing, fore: 30 + 70 * swing, plane: 'sagittal' });
  const hop = 0.012 * Math.max(left, right);
  return puppet({ aspect, size: SIZE, hip: { x: 0.5 * aspect, y: standHip(SIZE) - hop }, torso: lean, legs: [leg(left), leg(right)], arms: [arm(right), arm(left)] });
}

export default {
  id: 'highknees',
  name: 'Бег с высоким подниманием бедра',
  short: 'Колени',
  emoji: '🏃',
  category: 'cardio',
  level: 'Новичок',
  minutes: 4,
  needsBall: false,
  goal: 'Выносливость и быстрые ноги',
  tagline: 'Колено до пояса, быстрый темп',
  camera: 'Телефон на уровне пояса в 2–3 метрах, встань лицом к нему. Видно стопы.',
  description: 'Стойка, десять шагов и тридцать в быстром темпе. Шаг засчитывается, когда колено поднимается почти до уровня бедра.',
  metric: { key: 'reps', label: 'шагов', forms: ['шаг', 'шага', 'шагов'], progress: 'Шаги', rhythmWords: ['шаги', 'шагами'] },
  view(f) { return f.legVisible[0] && f.legVisible[1] ? null : 'show-feet'; },

  measure({ f, calib, still, now }, memo = { legs: [{ phase: 'down', peak: 0, maxTilt: 0 }, { phase: 'down', peak: 0, maxTilt: 0 }], count: 0, clean: 0, left: 0, right: 0, times: [] }) {
    const m = { ...memo, legs: memo.legs.map(leg => ({ ...leg })) };
    let event = null; let milestone = null;
    const rises = [0, 1].map(side => kneeRise(f, calib, side));
    rises.forEach((rise, side) => {
      if (!Number.isFinite(rise) || event) return;
      const leg = m.legs[side];
      if (leg.phase === 'down') {
        if (rise > UP) Object.assign(leg, { phase: 'up', peak: rise, maxTilt: f.tilt });
        else if (rise > 0.3) leg.peak = Math.max(leg.peak, rise);
        else if (rise < DOWN && leg.peak > 0.3) { event = { type: 'attempt', errors: ['knees-low'], side }; leg.peak = 0; }
      } else {
        leg.peak = Math.max(leg.peak, rise); leg.maxTilt = Math.max(leg.maxTilt, f.tilt);
        if (rise < DOWN) {
          const errors = [];
          if (leg.peak < GOOD) errors.push('knees-low');
          if (leg.maxTilt > 18) errors.push('knees-lean');
          m.times = [...m.times, now].slice(-7);
          const gaps = m.times.slice(1).map((t, i) => t - m.times[i]);
          if (m.count >= 6 && gaps.length >= 5 && gaps.reduce((a, b) => a + b, 0) / gaps.length > 750) errors.push('knees-slow');
          m.count += 1; if (!errors.length) m.clean += 1;
          if (side === 0) m.left += 1; else m.right += 1;
          event = { type: 'rep', errors, clean: !errors.length, side };
          if (REP_MARKS.includes(m.count)) milestone = { tag: 'knees-good', vars: { reps: m.count } };
          Object.assign(leg, { phase: 'down', peak: 0, maxTilt: 0 });
        }
      }
    });
    const lifting = m.legs.some(leg => leg.phase === 'up');
    return {
      memo: m, event, milestone, phase: lifting ? 'up' : 'down',
      activity: lifting || Boolean(event),
      ready: still && f.tilt < 15 && rises.every(r => !Number.isFinite(r) || r < 0.15),
      counts: { reps: m.count, clean: m.clean, left: m.left, right: m.right },
    };
  },

  lessons: [
    stanceLesson({
      seconds: 2, goal: 'Встань прямо лицом к камере, 2 секунды',
      intro: {
        strict: 'Шаг 1: встань прямо лицом к камере. Две секунды, я замерю ноги.',
        fun: 'Шаг 1: встань ровно и замри на две секунды, я запоминаю длину твоих ног!',
        calm: 'Шаг 1: встань прямо лицом к камере и постой две секунды. Так я пойму, где уровень бедра.',
      },
    }),
    repLesson({
      id: 'ten', title: 'Десять шагов', short: '10 шагов', target: 10,
      goal: 'Десять шагов: колено до уровня бедра',
      intro: {
        strict: 'Шаг 2: десять шагов на месте. Колено до пояса.',
        fun: 'Шаг 2: десять шагов! Колени к поясу, как будто бежишь по лестнице.',
        calm: 'Шаг 2: десять шагов на месте. Поднимай колено до уровня бедра.',
      },
    }),
    repLesson({
      id: 'thirty', title: 'Тридцать в темпе', short: '30 шагов', target: 30,
      goal: 'Тридцать шагов в быстром темпе',
      intro: {
        strict: 'Шаг 3: тридцать шагов. Быстро и высоко.',
        fun: 'Шаг 3: тридцать шагов! Включаем турбо.',
        calm: 'Шаг 3: тридцать шагов в бодром темпе. Корпус прямо, дыши свободно.',
      },
    }),
  ],

  errors: {
    'knees-low': { label: 'Колени поднимались низко', advice: 'Поднимай колено до уровня бедра.', priority: 3 },
    'knees-lean': { label: 'Корпус отклонялся', advice: 'Держи корпус прямо, работай руками.', priority: 2 },
    'knees-slow': { label: 'Медленный темп', advice: 'Чаще шаги: короткие быстрые подъёмы колен.', priority: 1 },
  },

  result: (m) => ({ key: 'reps', value: m.reps, label: 'шагов' }),
  summaryLine: (m) => `Шагов: ${m.reps}, без замечаний: ${m.clean}. Левой ногой: ${m.left}, правой: ${m.right}.`,
  answer: (m) => `Засчитано шагов: ${m.reps}: левой ${m.left}, правой ${m.right}.`,
  rhythm: 'reps',

  demo(t, aspect) {
    if (t < 3) return { points: kneesPose(0, 0, { aspect }) };
    const period = t > 24 && t < 29 ? 1.3 : 0.8; // a slow stretch in the middle
    const cycle = (t - 3) / period; const k = Math.floor(cycle); const at = cycle - k;
    const low = k % 14 === 9 || k % 14 === 10 ? 0.66 : 1;
    const lift = Math.sin(Math.PI * Math.min(1, at / 0.5)) * (at < 0.5 ? 1 : 0) * low;
    const other = Math.sin(Math.PI * Math.min(1, Math.max(0, at - 0.5) / 0.5)) * (at >= 0.5 ? 1 : 0) * low;
    return { points: kneesPose(lift, other, { aspect }) };
  },

  phrases: {
    'knees-low': {
      strict: ['Колено выше. До пояса.', 'Низко. Бедро параллельно полу.', 'Выше колени.', 'Колено до уровня бедра.', 'Поднимай выше.'],
      fun: ['Колени, выше! Как будто перешагиваешь забор.', 'Выше колено, ты же спринтер!', 'Колено к поясу, и будет зачёт!', 'Представь, что под тобой лужа. Выше!', 'Колени вверх, мы же не гуляем!'],
      calm: ['Колено поднимается низко. Попробуй до уровня бедра.', 'Поднимай колено выше, бедро почти параллельно полу.', 'Чуть выше колени, темп можно немного снизить.', 'Выше колено, корпус остаётся прямым.', 'Подъём колена до пояса засчитывается полностью.'],
    },
    'knees-lean': {
      strict: ['Корпус прямо.', 'Не отклоняйся.', 'Спина ровно, работай руками.', 'Корпус уходит. Выпрямись.', 'Плечи над тазом.'],
      fun: ['Не заваливайся! Корпус ровно, как у бегуна.', 'Спина прямая, руки работают!', 'Ты бежишь, а не танцуешь лимбо!', 'Выпрямись, и бежать станет легче.', 'Плечи над тазом, и вперёд!'],
      calm: ['Корпус отклоняется. Держи его прямо.', 'Плечи над тазом, руки помогают ритму.', 'Чуть выпрямись, так легче держать баланс.', 'Спина прямая, взгляд вперёд.', 'Держи корпус ровно, колени работают.'],
    },
    'knees-slow': {
      strict: ['Темп выше.', 'Быстрее. Чаще шаги.', 'Медленно. Ускорься.', 'Быстрее ноги.', 'Темп.'],
      fun: ['Включай турбо! Быстрее шаги.', 'Быстрее, будто пол горячий!', 'Скорость! Ты же спринтер!', 'Чаще-чаще-чаще!', 'Ускоряемся, финиш близко!'],
      calm: ['Темп медленный. Попробуй чаще шаги.', 'Чуть быстрее, если дыхание позволяет.', 'Короткие быстрые подъёмы колен.', 'Ускорься немного, держи колени высоко.', 'Темп бодрее, руки помогают.'],
    },
    'knees-good': {
      strict: ['Шаг {reps}. Хорошо.', 'Есть {reps}. Держи темп.', 'Счёт {reps}.', 'Уже {reps}. Продолжай.', 'Шаг {reps} засчитан.'],
      fun: ['Шаг {reps}! Ноги летают.', 'Уже {reps}! Скорость что надо.', 'Счёт {reps}. Огонь!', 'Шаг {reps}! Продолжай!', 'Уже {reps}, ты как ракета!'],
      calm: ['Шаг {reps}. Хороший темп.', 'Уже {reps}. Дыши свободно.', 'Счёт {reps}. Продолжай.', 'Отлично, уже {reps}.', 'Шаг {reps}, всё правильно.'],
    },
    'highknees-idle': {
      strict: ['Жду шаги.', 'Начинай. Колено вверх.', 'Бег на месте. Поехали.', 'Готов? Первый шаг.', 'Работаем.'],
      fun: ['Побежали на месте! Колени к поясу.', 'Ноги готовы? Поехали!', 'Я считаю, начинай!', 'Колено вверх, и погнали!', 'Разогреемся?'],
      calm: ['Когда будешь готов, начинай бег на месте. Я считаю шаги.', 'Можно начинать: колено вверх до уровня бедра.', 'Начни в удобном темпе.', 'Я жду первый шаг.', 'Не торопись, ритм придёт.'],
    },
  },
};
