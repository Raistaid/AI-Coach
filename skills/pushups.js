// Push-ups, side-on with the phone on the floor. Counted only in the push-up
// position (the body along the floor), by the elbow angle: down past 115°,
// back up past 148°. Knee push-ups count too: the body line is shoulder–hip–knee.
// Sagging or raised hips and a short range are remarks; a dip that is not deep
// enough is an attempt and is not counted.
import { stepReps, createReps, clamp } from '../coach-motion.js';
import { stanceLesson, repLesson, REP_MARKS } from './common.js';
import { lying, sized, wave } from './puppet.js';

const REPS = { down: 0.64, up: 0.17, attempt: 0.36, frames: 2, minMs: 600 };
const SIZE = 0.6;

export const inPushupPosition = (f) => f.horizontal !== null && f.horizontal < 40 && f.tilt > 45;
function elbowOf(f) {
  const near = f.elbow[f.near]; const far = f.elbow[1 - f.near];
  return Number.isFinite(near) ? near : Number.isFinite(far) ? far : null;
}

/** Side-view push-up: `height` of the shoulders above the floor (0..1 of the top), hips `sag`. */
export function pushupPose(depth, { aspect = 9 / 16, sag = 0, floor } = {}) {
  const B = sized(SIZE);
  const length = B.shin + B.thigh + B.torso;
  const topHeight = 0.275 * SIZE; const bottomHeight = 0.1 * SIZE;
  const topAngle = Math.asin(topHeight / length) * 180 / Math.PI;
  const top = lying({ aspect, angle: topAngle, size: SIZE, floor });
  const handX = top[11].x * aspect;
  const height = topHeight - (topHeight - bottomHeight) * depth;
  return lying({ aspect, angle: Math.asin(height / length) * 180 / Math.PI, handX, sag: sag * depth, size: SIZE, feetX: top[27].x * aspect, floor });
}

export default {
  id: 'pushups',
  name: 'Отжимания',
  short: 'Отжимания',
  emoji: '💪',
  category: 'strength',
  level: 'Новичок',
  minutes: 6,
  needsBall: false,
  goal: 'Сильные руки и корпус',
  tagline: 'Амплитуда и ровная линия тела',
  camera: 'Телефон на полу боком к тебе в 2–3 метрах: в кадре от головы до стоп. Можно с колен.',
  description: 'Упор лёжа, три отжимания и пять чистых. Тренер считает по углу в локтях только в упоре и следит, чтобы таз не провисал и не поднимался.',
  metric: { key: 'reps', label: 'отжиманий', forms: ['отжимание', 'отжимания', 'отжиманий'], progress: 'Отжимания', rhythmWords: ['отжимания', 'отжиманиями'] },
  view(f) {
    const near = f.near;
    if (!f.armSeen[near] || !f.loose.hip[near] || !(f.loose.knee[near] || f.loose.ankle[near])) return 'show-body';
    return f.tilt > 45 && f.facing > 0.6 ? 'turn-side' : null;
  },

  measure({ f, now }, memo = { reps: createReps(), count: 0, clean: 0, cur: null, outSince: null }) {
    const m = { ...memo };
    const position = inPushupPosition(f);
    const elbow = elbowOf(f);
    if (!position) {
      m.outSince = m.outSince ?? now;
      if (now - m.outSince > 1500) { m.reps = { ...m.reps, phase: 'idle', frames: 0, excursion: 0 }; m.cur = null; }
    } else m.outSince = null;
    const depth = position && elbow !== null ? clamp((160 - elbow) / 70, 0, 1.4) : null;
    const before = m.reps.phase;
    const step = stepReps(m.reps, depth, now, REPS);
    m.reps = step.state;
    const moving = Number.isFinite(depth) && depth > REPS.up;
    if (moving) {
      const cur = m.cur || { minElbow: 180, maxSag: -Infinity, minSag: Infinity };
      m.cur = {
        minElbow: Math.min(cur.minElbow, elbow),
        maxSag: f.hipOffset === null ? cur.maxSag : Math.max(cur.maxSag, f.hipOffset),
        minSag: f.hipOffset === null ? cur.minSag : Math.min(cur.minSag, f.hipOffset),
      };
    }
    let event = null; let milestone = null;
    if (step.rep) {
      const cur = m.cur || { minElbow: 180, maxSag: 0, minSag: 0 };
      const errors = [];
      if (cur.minElbow > 100) errors.push('pushup-shallow');
      if (cur.maxSag > 0.18) errors.push('pushup-sag');
      if (cur.minSag < -0.25) errors.push('pushup-pike');
      m.count += 1; if (!errors.length) m.clean += 1;
      event = { type: 'rep', errors, clean: !errors.length };
      if (REP_MARKS.includes(m.count)) milestone = { tag: 'pushups-good', vars: { reps: m.count } };
      m.cur = null;
    } else if (step.attempt) {
      event = { type: 'attempt', errors: ['pushup-attempt'] }; m.cur = null;
    } else if (before === 'top' && m.reps.phase === 'top' && Number.isFinite(depth) && depth < REPS.up) m.cur = null;
    const straight = f.hipOffset !== null && f.hipOffset < 0.15 && f.hipOffset > -0.2;
    return {
      memo: m, event, milestone, phase: m.reps.phase,
      activity: moving || Boolean(event),
      ready: position && elbow !== null && elbow > 150 && straight,
      idle: position ? 'pushups-idle' : 'pushups-position',
      counts: { reps: m.count, clean: m.clean },
    };
  },

  lessons: [
    stanceLesson({
      id: 'plank', title: 'Упор лёжа', short: 'Упор', seconds: 3,
      goal: 'Прямые руки под плечами, тело в одну линию, 3 секунды',
      intro: {
        strict: 'Шаг 1: упор лёжа. Руки под плечами, тело в одну линию. Три секунды.',
        fun: 'Шаг 1: прими упор лёжа и стань ровным, как доска. Три секунды!',
        calm: 'Шаг 1: прими упор лёжа: руки под плечами, тело ровное. Можно с колен. Подержи три секунды.',
      },
    }),
    repLesson({
      id: 'three', title: 'Три отжимания', short: '3 повтора', target: 3,
      goal: 'Три отжимания: грудь к полу, локти назад',
      intro: {
        strict: 'Шаг 2: три отжимания. Грудь к полу, локти назад.',
        fun: 'Шаг 2: три отжимания! Пол ждёт твою грудь.',
        calm: 'Шаг 2: три отжимания в спокойном темпе. Опускайся грудью к полу, локти отводи назад.',
      },
    }),
    repLesson({
      id: 'clean5', title: 'Пять чистых', short: '5 чистых', target: 5, clean: true,
      goal: 'Пять отжиманий без замечаний: глубина и ровный таз',
      intro: {
        strict: 'Шаг 3: пять чистых отжиманий. Таз не провисает.',
        fun: 'Шаг 3: пять идеальных отжиманий. Считаю только красивые!',
        calm: 'Шаг 3: пять отжиманий с хорошей техникой. Засчитываются повторы без замечаний.',
      },
    }),
  ],

  errors: {
    'pushup-attempt': { label: 'Неглубокие попытки не засчитаны', advice: 'Опускайся ниже: локти сгибаются до прямого угла.', priority: 4 },
    'pushup-shallow': { label: 'Неполная амплитуда', advice: 'Опускай грудь ближе к полу, локти до прямого угла.', priority: 2 },
    'pushup-sag': { label: 'Таз провисал', advice: 'Напряги живот и ягодицы: тело в одну линию.', priority: 3 },
    'pushup-pike': { label: 'Таз поднимался вверх', advice: 'Опусти таз в линию с плечами и коленями.', priority: 3 },
  },

  result: (m) => ({ key: 'reps', value: m.reps, label: 'отжиманий' }),
  summaryLine: (m) => `Отжиманий: ${m.reps}, без замечаний: ${m.clean}.`,
  answer: (m) => `Засчитано отжиманий: ${m.reps}, без замечаний: ${m.clean}.`,
  rhythm: 'reps',

  demo(t, aspect) {
    const floor = 0.72; // drawn mid-frame so the controls do not cover the athlete
    if (t < 3.5) return { points: pushupPose(0, { aspect, floor }) };
    const k = Math.floor((t - 3.5) / 2.4); const at = ((t - 3.5) % 2.4) / 2.4;
    const plan = [{}, {}, {}, { depth: 0.22 }, {}, { sag: 0.07 }, { sag: 0.07 }, {}, { depth: 0.45 }, { depth: 0.45 }, { sag: -0.09 }, { sag: -0.09 }, {}, {}];
    const step = plan[k % plan.length];
    return { points: pushupPose((step.depth || 1) * wave(at, { down: 0.38, hold: 0.06 }), { aspect, sag: step.sag || 0, floor }) };
  },

  phrases: {
    'pushup-attempt': {
      strict: ['Не засчитал: ниже.', 'Мало амплитуды. Грудь к полу.', 'Не считается. Локти до прямого угла.', 'Полотжимания не считаю.', 'Ниже, тогда засчитаю.'],
      fun: ['Почти! Ещё чуть ниже, и засчитаю.', 'Пол ждёт ближе! Опустись ещё.', 'Этот не засчитал. Грудь к полу!', 'Глубже, ты сможешь!', 'Ещё немного ниже, и будет зачёт.'],
      calm: ['Это отжимание не засчитано: не хватило глубины. Опускайся ниже.', 'Сгибай локти до прямого угла, тогда повтор засчитается.', 'Опускай грудь ближе к полу. Можно с колен.', 'Попытка неглубокая. Не спеши.', 'Чуть глубже, насколько получается.'],
    },
    'pushup-shallow': {
      strict: ['Мало амплитуды. Ниже.', 'Грудь ближе к полу.', 'Локти до прямого угла.', 'Неглубоко. Опускайся до конца.', 'Амплитуда больше.'],
      fun: ['Чуть ниже, и будет идеально!', 'Пол не кусается, опускайся ближе!', 'Амплитуда — это суперсила. Больше!', 'Почти идеально. Ещё немного вниз!', 'Глубже, и руки станут сильнее.'],
      calm: ['Отжимания получаются неглубокими. Опускайся ниже.', 'Попробуй опускать грудь ближе к полу.', 'Локти сгибаются примерно до прямого угла.', 'Если тяжело, отжимайся с колен, но на полную глубину.', 'Чуть больше амплитуды, если нет боли.'],
    },
    'pushup-sag': {
      strict: ['Таз провисает. Напряги живот.', 'Тело в одну линию. Таз выше.', 'Не прогибайся в пояснице.', 'Живот и ягодицы в тонусе.', 'Провис. Поправь таз.'],
      fun: ['Таз провисает, как гамак! Напряги живот.', 'Тело ровное, как доска. Таз чуть выше!', 'Пресс включаем, поясницу бережём!', 'Не прогибайся, ты же не мостик делаешь!', 'Подтяни живот, и линия станет идеальной.'],
      calm: ['Таз провисает вниз. Напряги живот и ягодицы.', 'Держи тело в одну линию от плеч до коленей.', 'Чуть подними таз, береги поясницу.', 'Если трудно держать линию, перейди на колени.', 'Тело ровное, живот подтянут.'],
    },
    'pushup-pike': {
      strict: ['Таз высоко. Опусти.', 'Тело в одну линию. Таз ниже.', 'Не поднимай таз.', 'Таз в линию с плечами.', 'Горка. Выровняй тело.'],
      fun: ['Это не горка! Опусти таз.', 'Таз поднялся к небу. Вернём его в линию!', 'Тело как доска, а не как треугольник!', 'Таз чуть ниже, и будет красиво.', 'Опусти таз, и отжимание станет честным.'],
      calm: ['Таз поднимается вверх. Опусти его в линию с плечами.', 'Держи тело ровным, без угла в тазу.', 'Чуть опусти таз и напряги живот.', 'Линия от плеч до коленей прямая.', 'Таз ниже, нагрузка уйдёт в руки и грудь.'],
    },
    'pushups-good': {
      strict: ['Повтор {reps}. Хорошо.', 'Есть {reps}. Линия ровная.', 'Счёт {reps}. Продолжай.', 'Отжимание {reps} засчитано.', 'Уже {reps}. Темп держи.'],
      fun: ['Отжимание {reps}! Руки из стали.', 'Уже {reps}! Пол впечатлён.', 'Счёт {reps}. Красиво!', 'Повтор {reps}! Ты в форме.', 'Уже {reps}! Не сдавайся.'],
      calm: ['Повтор {reps}. Хорошая техника.', 'Уже {reps}. Дыши ровно.', 'Счёт {reps}. Продолжай в своём темпе.', 'Отжимание {reps}, всё правильно.', 'Отлично, уже {reps}.'],
    },
    'pushups-idle': {
      strict: ['Жду отжимание.', 'Начинай. Грудь к полу.', 'Отжимание. Поехали.', 'Готов? Первый повтор.', 'Работаем.'],
      fun: ['Пол ждёт твоё первое отжимание!', 'Ну что, отожмёмся?', 'Руки готовы? Поехали!', 'Я считаю, начинай!', 'Давай, первое отжимание за тобой.'],
      calm: ['Когда будешь готов, начинай отжиматься. Я считаю.', 'Можно начинать: грудь к полу, локти назад.', 'Не торопись, начни спокойно.', 'Можно с колен, главное — полная амплитуда.', 'Я жду первое отжимание.'],
    },
    'pushups-position': {
      strict: ['Прими упор лёжа.', 'Руки под плечами, тело в линию.', 'Ложись в упор. Начинаем.', 'Упор лёжа, лицом в сторону.', 'Встань в упор боком к камере.'],
      fun: ['Пора на пол! Прими упор лёжа.', 'Упор лёжа, звезда, и начинаем.', 'Ложись в упор, будем качать руки!', 'Камера ждёт тебя в упоре лёжа.', 'Руки в пол, тело ровно, поехали!'],
      calm: ['Прими упор лёжа боком к камере: руки под плечами, тело ровное.', 'Можно начать с колен, это тоже засчитывается.', 'Опустись в упор, когда будешь готов.', 'Руки под плечами, ладони на полу.', 'Я начну считать, когда ты будешь в упоре.'],
    },
  },
};
