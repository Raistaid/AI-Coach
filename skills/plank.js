// Plank, side-on: the clock runs only while the body is a straight line. If the
// hips sag or rise, time pauses within half a second and the coach says what to
// fix once it lasts. Forearms or straight arms, knees allowed.
import { createHold, stepHold } from '../coach-motion.js';
import { holdLesson, crossedMark } from './common.js';
import { lying, sized } from './puppet.js';

const SIZE = 0.6;
export const inPlank = (f) => f.horizontal !== null && f.horizontal < 35 && f.tilt > 50;
const sagOf = (f) => (f.hipOffset === null ? null : f.hipOffset);

export function plankPose({ aspect = 9 / 16, sag = 0, breath = 0, floor } = {}) {
  const B = sized(SIZE);
  const length = B.shin + B.thigh + B.torso;
  const angle = Math.asin((0.15 * SIZE) / length) * 180 / Math.PI + breath;
  return lying({ aspect, angle, forearms: true, sag, size: SIZE, floor });
}

export default {
  id: 'plank',
  name: 'Планка',
  short: 'Планка',
  emoji: '📏',
  category: 'strength',
  level: 'Новичок',
  minutes: 4,
  needsBall: false,
  goal: 'Крепкий корпус',
  tagline: 'Ровная линия тела',
  camera: 'Телефон на полу боком к тебе в 2–3 метрах: в кадре от головы до стоп. Можно с колен.',
  description: 'Три шага: 10, 20 и 30 секунд в ровной планке. Время идёт, только пока таз не провисает и не поднимается.',
  metric: { key: 'bestHold', label: 'с планки', forms: ['секунда планки', 'секунды планки', 'секунд планки'], unit: 'с', progress: 'Лучшая планка, с' },
  view(f) {
    const near = f.near;
    if (!f.loose.shoulder[near] || !f.loose.hip[near] || !(f.loose.knee[near] || f.loose.ankle[near])) return 'show-body';
    return f.tilt > 50 && f.facing > 0.6 ? 'turn-side' : null;
  },

  measure({ f, now }, memo = { hold: createHold() }) {
    const m = { ...memo };
    const position = inPlank(f);
    const sag = sagOf(f);
    const straight = sag !== null && sag < 0.15 && sag > -0.2;
    const before = m.hold.best;
    m.hold = stepHold(m.hold, position && straight, now, 600);
    const mark = crossedMark(before, m.hold.best, [10, 20, 30, 45, 60, 90, 120]);
    const live = position && sag !== null ? (sag >= 0.15 ? ['plank-sag'] : sag <= -0.2 ? ['plank-pike'] : []) : [];
    return {
      memo: m, live,
      milestone: mark ? { tag: 'plank-good', vars: { seconds: mark } } : null,
      hold: { active: m.hold.since !== null, seconds: m.hold.seconds, best: m.hold.best, side: -1 },
      activity: position, ready: position && straight,
      idle: position ? 'plank-idle' : 'plank-position',
      counts: { hold: m.hold.seconds, best: m.hold.best },
    };
  },

  lessons: [
    holdLesson({
      id: 'hold10', title: 'Десять секунд', short: '10 секунд', seconds: 10,
      goal: 'Десять секунд ровной планки',
      intro: {
        strict: 'Шаг 1: планка десять секунд. Тело в одну линию.',
        fun: 'Шаг 1: превращаемся в доску на десять секунд!',
        calm: 'Шаг 1: прими планку боком к камере: локти под плечами, тело ровное. Десять секунд. Можно с колен.',
      },
    }),
    holdLesson({
      id: 'hold20', title: 'Двадцать секунд', short: '20 секунд', seconds: 20,
      goal: 'Двадцать секунд без провиса',
      intro: {
        strict: 'Шаг 2: двадцать секунд. Живот напряжён.',
        fun: 'Шаг 2: двадцать секунд! Дыши, доска.',
        calm: 'Шаг 2: двадцать секунд в планке. Дыши ровно, живот подтянут.',
      },
    }),
    holdLesson({
      id: 'hold30', title: 'Тридцать секунд', short: '30 секунд', seconds: 30,
      goal: 'Тридцать секунд ровной линии',
      intro: {
        strict: 'Шаг 3: тридцать секунд. Без провиса.',
        fun: 'Шаг 3: тридцать секунд, финальный босс!',
        calm: 'Шаг 3: тридцать секунд. Если устал, отдохни и начни снова.',
      },
    }),
  ],

  errors: {
    'plank-sag': { label: 'Таз провисал', advice: 'Напряги живот и ягодицы, таз в линию с плечами.', priority: 3 },
    'plank-pike': { label: 'Таз поднимался вверх', advice: 'Опусти таз: тело одной линией от плеч до стоп.', priority: 2 },
  },

  result: (m) => ({ key: 'bestHold', value: m.bestHold, label: 'с планки' }),
  summaryLine: (m) => `Лучшая ровная планка: ${m.bestHold} секунд.`,
  answer: (m) => `Лучшая ровная планка: ${m.bestHold} с. Сейчас: ${m.hold} с.`,
  rhythm: null,

  demo(t, aspect) {
    const breath = 0.6 * Math.sin(t * 1.4);
    // A straight hold, then the hips sag (the clock pauses), then straight again, later a raised pike.
    const sag = t > 13 && t < 16.5 ? 0.075 * Math.min(1, (t - 13) / 0.6) : t > 41 && t < 44 ? -0.09 * Math.min(1, (t - 41) / 0.6) : 0;
    return { points: plankPose({ aspect, sag, breath, floor: 0.72 }) };
  },

  phrases: {
    'plank-sag': {
      strict: ['Таз провисает. Время стоит.', 'Напряги живот. Таз выше.', 'Провис в пояснице. Выровняй.', 'Тело в линию. Таз вверх.', 'Ягодицы в тонус. Таз выше.'],
      fun: ['Таз провис, и часы встали! Подтяни живот.', 'Гамак не засчитываю. Таз чуть выше!', 'Доска, а не мостик! Живот в тонус.', 'Таз вверх, и время снова пойдёт.', 'Пресс включаем, поясницу спасаем!'],
      calm: ['Таз провисает, время на паузе. Напряги живот и ягодицы.', 'Подними таз в линию с плечами.', 'Береги поясницу: тело ровное от плеч до стоп.', 'Если тяжело держать линию, опусти колени на пол.', 'Подтяни живот, и время снова пойдёт.'],
    },
    'plank-pike': {
      strict: ['Таз высоко. Опусти.', 'Не горка. Тело в линию.', 'Таз ниже, время стоит.', 'Выровняй тело.', 'Таз в линию с плечами.'],
      fun: ['Это горка, а не доска! Таз ниже.', 'Таз улетел вверх. Возвращаем!', 'Опусти таз, и часы пойдут.', 'Ровная доска, без треугольников!', 'Таз чуть ниже, и будет идеально.'],
      calm: ['Таз поднят вверх, время на паузе. Опусти его в линию.', 'Держи тело одной линией от плеч до стоп.', 'Чуть опусти таз и напряги живот.', 'Ровная линия нагружает корпус правильно.', 'Опусти таз, и время снова пойдёт.'],
    },
    'plank-good': {
      strict: ['{seconds} секунд. Держи.', 'Уже {seconds} секунд. Линия ровная.', '{seconds} секунд. Дыши.', 'Есть {seconds} секунд.', '{seconds} секунд. Не проседай.'],
      fun: ['{seconds} секунд! Ты настоящая доска.', 'Уже {seconds} секунд, огонь!', '{seconds} секунд, пресс благодарит!', 'Держишь {seconds} секунд. Красиво!', '{seconds} секунд! Ещё немного.'],
      calm: ['Уже {seconds} секунд. Хорошо держишь.', '{seconds} секунд. Дыши спокойно.', 'Отлично, {seconds} секунд ровной планки.', '{seconds} секунд. Линия ровная.', 'Уже {seconds} секунд. Продолжай.'],
    },
    'plank-idle': {
      strict: ['Держи линию.', 'Тело ровно. Время идёт.', 'Планка. Держим.', 'Не двигайся. Держи.', 'Ровно.'],
      fun: ['Держим доску!', 'Ровнее, и время побежит быстрее!', 'Ты доска, а доски не двигаются!', 'Держимся!', 'Ровная линия, звезда!'],
      calm: ['Держи тело ровной линией.', 'Дыши спокойно, тело ровное.', 'Время идёт, пока линия ровная.', 'Держись в своём темпе.', 'Если устал, отдохни и начни снова.'],
    },
    'plank-position': {
      strict: ['Прими планку.', 'Локти под плечами, тело в линию.', 'Ложись в планку. Начинаем.', 'Планка боком к камере.', 'В планку.'],
      fun: ['Пора стать доской! Прими планку.', 'Планка ждёт тебя на полу!', 'Локти в пол, тело ровно, поехали!', 'Время для планки!', 'Ложись в планку, я засекаю время.'],
      calm: ['Прими планку боком к камере: локти под плечами, тело ровное.', 'Можно начать с колен, это тоже планка.', 'Опустись в планку, когда будешь готов.', 'Локти под плечами, взгляд в пол.', 'Я начну считать время, когда тело будет ровным.'],
    },
  },
};
