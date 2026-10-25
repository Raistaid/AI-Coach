// Squats: depth from how far the hips go down (calibrated on the athlete's own
// standing height) and from the knee angle, so it works facing the camera or
// side-on. A dip that is not deep enough is an attempt: not counted, and the
// coach says why. Side-on the coach checks the back, facing the camera the knees.
import { stepReps, createReps, legCompression, kneeDepth } from '../coach-motion.js';
import { stanceLesson, repLesson, REP_MARKS } from './common.js';
import { puppet, sized, wave, FLOOR, SIZE } from './puppet.js';

const REPS = { down: 0.25, up: 0.09, attempt: 0.11, frames: 2, minMs: 700 };
const mean = (list) => list.reduce((sum, v) => sum + v, 0) / list.length;

// Depth: the hip-to-ankle height compared with standing (works facing the camera
// or side-on), and side-on also the knee bend; the deeper reading wins.
function depthOf(f, calib) {
  const knees = f.knee.filter(Number.isFinite);
  const bend = knees.length ? kneeDepth(mean(knees)) : null;
  const squeeze = legCompression(f, calib);
  if (squeeze === null) return bend;
  return bend === null ? squeeze : Math.max(squeeze, bend);
}

/** Side-view squat of depth p (0 standing, 1 below parallel) for the demo. */
export function squatPose(p, { aspect = 9 / 16, lean = 0, size = SIZE } = {}) {
  const B = sized(size);
  const rad = (d) => d * Math.PI / 180;
  const thigh = 80 * p; const shin = -25 * p;
  const height = B.thigh * Math.cos(rad(thigh)) + B.shin * Math.cos(rad(shin));
  const ankleX = 0.52 * aspect;
  const hipX = ankleX - (B.thigh * Math.sin(rad(thigh)) + B.shin * Math.sin(rad(shin)));
  const arm = { upper: 75 * p, fore: 75 * p };
  return puppet({ aspect, view: 'side', size, hip: { x: hipX, y: FLOOR - 0.02 * size - height }, torso: 35 * p + lean * p, legs: [{ thigh, shin }, { thigh, shin }], arms: [arm, arm] });
}

export default {
  id: 'squats',
  name: 'Приседания',
  short: 'Присед',
  emoji: '🏋️',
  category: 'strength',
  level: 'Новичок',
  minutes: 6,
  needsBall: false,
  goal: 'Приседаю с контролем',
  tagline: 'Глубина, спина, колени',
  camera: 'Телефон на уровне пояса в 2–3 метрах. Встань боком или лицом: боком видна спина, лицом — колени.',
  description: 'Стойка, пять приседаний и восемь чистых повторов. Тренер меряет глубину по опусканию таза и не засчитывает неглубокие попытки.',
  metric: { key: 'reps', label: 'повторов', forms: ['повтор', 'повтора', 'повторов'], progress: 'Повторы', rhythmWords: ['повторы', 'повторами'] },
  view(f) { return f.legVisible.some(Boolean) ? null : 'show-feet'; },

  measure({ f, calib, still, now }, memo = { reps: createReps(), count: 0, clean: 0, cur: null }) {
    const m = { ...memo };
    const depth = depthOf(f, calib);
    const before = m.reps.phase;
    const step = stepReps(m.reps, depth, now, REPS);
    m.reps = step.state;
    const moving = Number.isFinite(depth) && depth > REPS.up;
    if (moving) {
      const cur = m.cur || { maxTilt: 0, minKnees: Infinity, side: true, front: true };
      const ratio = f.kneeGap && f.ankleGap ? f.kneeGap / f.ankleGap : null;
      m.cur = {
        maxTilt: Math.max(cur.maxTilt, f.tilt),
        minKnees: ratio === null ? cur.minKnees : Math.min(cur.minKnees, ratio),
        side: cur.side && f.facing < 0.45, front: cur.front && f.facing > 0.55,
      };
    }
    let event = null; let milestone = null;
    if (step.rep) {
      const cur = m.cur || {};
      const errors = [];
      if (step.rep.depth < 0.33) errors.push('squat-shallow');
      if (cur.side && cur.maxTilt > 52) errors.push('squat-torso');
      if (cur.front && cur.minKnees < 0.72) errors.push('squat-knees');
      if (step.rep.ms < 450) errors.push('squat-fast');
      m.count += 1; if (!errors.length) m.clean += 1;
      event = { type: 'rep', errors, clean: !errors.length, depth: step.rep.depth };
      if (REP_MARKS.includes(m.count)) milestone = { tag: 'squats-good', vars: { reps: m.count } };
      m.cur = null;
    } else if (step.attempt) {
      event = { type: 'attempt', errors: ['squat-attempt'], depth: step.attempt.depth };
      m.cur = null;
    } else if (before === 'top' && m.reps.phase === 'top' && Number.isFinite(depth) && depth < REPS.up) m.cur = null;
    return {
      memo: m, event, milestone, phase: m.reps.phase,
      activity: moving || Boolean(event),
      ready: still && Number.isFinite(depth) && depth < 0.08 && f.tilt < 15,
      counts: { reps: m.count, clean: m.clean },
    };
  },

  lessons: [
    stanceLesson({
      seconds: 2, goal: 'Встань прямо, ноги на ширине плеч, 2 секунды',
      intro: {
        strict: 'Шаг 1: встань прямо, ноги на ширине плеч. Замри на две секунды.',
        fun: 'Шаг 1: встань ровно и замри на две секунды. Я запоминаю твой рост!',
        calm: 'Шаг 1: встань прямо, ноги на ширине плеч. Постой спокойно две секунды, я настроюсь на тебя.',
      },
    }),
    repLesson({
      id: 'five', title: 'Пять приседаний', short: '5 повторов', target: 5,
      goal: 'Пять приседаний: таз назад и вниз, пятки на полу',
      intro: {
        strict: 'Шаг 2: пять приседаний. Таз назад, пятки на полу, корпус ровно.',
        fun: 'Шаг 2: пять приседаний. Садись на невидимый стул!',
        calm: 'Шаг 2: пять приседаний в удобной глубине. Таз назад, пятки остаются на полу.',
      },
    }),
    repLesson({
      id: 'clean8', title: 'Восемь чистых', short: '8 чистых', target: 8, clean: true,
      goal: 'Восемь приседаний без замечаний: глубина, спина, колени, темп',
      intro: {
        strict: 'Шаг 3: восемь чистых повторов. Засчитываю только без ошибок.',
        fun: 'Шаг 3: восемь идеальных приседаний! Считаю только чистые.',
        calm: 'Шаг 3: восемь приседаний с хорошей техникой. Засчитываются повторы без замечаний.',
      },
    }),
  ],

  errors: {
    'squat-attempt': { label: 'Неглубокие попытки не засчитаны', advice: 'Опускай таз ниже, до уровня коленей, если нет боли.', priority: 4 },
    'squat-shallow': { label: 'Неглубокий присед', advice: 'Опускай таз ниже, пятки на полу.', priority: 2 },
    'squat-torso': { label: 'Сильный наклон корпуса', advice: 'Грудь вперёд, взгляд перед собой; если спина заваливается, присядь чуть выше.', priority: 3 },
    'squat-knees': { label: 'Колени сводились внутрь', advice: 'Направляй колени по линии носков.', priority: 3 },
    'squat-fast': { label: 'Слишком быстрый темп', advice: 'Опускайся за две секунды и поднимайся плавно.', priority: 1 },
  },

  result: (m) => ({ key: 'reps', value: m.reps, label: 'повторов' }),
  summaryLine: (m) => `Повторов: ${m.reps}, без замечаний: ${m.clean}.`,
  answer: (m) => `Засчитано повторов: ${m.reps}, без замечаний: ${m.clean}.`,
  rhythm: 'reps',

  demo(t, aspect) {
    if (t < 3) return { points: squatPose(0, { aspect }) };
    const k = Math.floor((t - 3) / 2.6); const at = ((t - 3) % 2.6) / 2.6;
    // Two shallow repetitions bring a confirmed remark, one dip is a not-counted attempt, two lean forward.
    const plan = [1, 1, 0.78, 0.78, 1, 0.56, 1, 1, 1, 1, 1, 1];
    const n = k % plan.length;
    const lean = n === 9 || n === 10 ? 32 : 0;
    return { points: squatPose(plan[n] * wave(at, { down: 0.38, hold: 0.08 }), { aspect, lean }) };
  },

  phrases: {
    'squat-attempt': {
      strict: ['Не засчитал: присядь глубже.', 'Это полприседа. Не считаю. Ниже.', 'Мало глубины, повтор не засчитан.', 'Не засчитано. Таз до уровня коленей.', 'Ниже. Иначе не считаю.'],
      fun: ['Почти! Этот не засчитал, опустись пониже.', 'Стул ещё далеко! Глубже, и засчитаю.', 'Полприседа — это полрадости. Давай ниже!', 'Не засчитал, но ты близко. Ещё чуть-чуть!', 'Глубже, и счётчик щёлкнет!'],
      calm: ['Этот повтор не засчитан: не хватило глубины. Попробуй опуститься ниже.', 'Опускай таз до уровня коленей, тогда повтор засчитается.', 'Чуть глубже, насколько комфортно, и счёт пойдёт.', 'Попытка неглубокая. Опускайся медленно и немного ниже.', 'Для зачёта нужен присед поглубже. Не торопись.'],
    },
    'squat-shallow': {
      strict: ['Мало глубины. Таз ниже.', 'Глубже. Бёдра к параллели.', 'Неглубоко. Опускайся ниже.', 'Глубина мала. Пятки на полу, ниже.', 'Ниже, до уровня коленей.'],
      fun: ['Ещё чуть ниже, и будет идеально!', 'Неглубоко! Представь низкую табуретку.', 'Глубже, глубже, ты сможешь!', 'Таз пониже, и мышцы скажут спасибо.', 'Почти идеально. Ещё немного глубины!'],
      calm: ['Приседания получаются неглубокими. Попробуй опускаться ниже.', 'Опускай таз до уровня коленей, если нет боли.', 'Чуть глубже, пятки остаются на полу.', 'Глубина чуть меньше нужной. Опускайся медленно и ниже.', 'Попробуй присесть немного глубже.'],
    },
    'squat-torso': {
      strict: ['Корпус завален. Грудь выше.', 'Спина ровно, взгляд вперёд.', 'Сильный наклон. Меньше глубина, грудь вперёд.', 'Не кланяйся. Корпус выше.', 'Плечи над коленями, не ниже.'],
      fun: ['Не кланяйся полу! Грудь вперёд.', 'Спина ровная, как доска. Пробуем!', 'Корпус уехал вперёд. Выпрямись, красавчик!', 'Грудь гордо вперёд, ты же чемпион.', 'Наклон велик. Чуть меньше глубины, и будет супер.'],
      calm: ['Корпус сильно наклоняется вперёд. Держи грудь выше.', 'Держи спину ровно и смотри перед собой.', 'Если спина заваливается, присядь чуть выше.', 'Попробуй держать корпус вертикальнее.', 'Грудь вперёд, плечи расправлены.'],
    },
    'squat-knees': {
      strict: ['Колени сводишь внутрь. Разводи их.', 'Колени по линии носков.', 'Не заваливай колени внутрь.', 'Колени смотрят туда же, куда носки.', 'Колени шире, над стопами.'],
      fun: ['Колени целуются! Разведи их над носками.', 'Колени внутрь не пускаем!', 'Чуть шире колени, и присед станет безопаснее.', 'Колени смотрят на носки, как фары на дорогу.', 'Раздвинь колени, будто держишь мяч между ними.'],
      calm: ['Колени уходят внутрь. Направляй их по линии носков.', 'Держи колени над стопами, не своди их.', 'Чуть разведи колени наружу во время приседа.', 'Колени и носки смотрят в одну сторону.', 'Следи, чтобы колени не заваливались внутрь.'],
    },
    'squat-fast': {
      strict: ['Слишком быстро. Вниз на два счёта.', 'Медленнее. Контроль, а не скорость.', 'Не падай вниз. Плавно.', 'Темп ниже. Две секунды вниз.', 'Без рывков.'],
      fun: ['Ого, скоростные приседания! Давай помедленнее.', 'Не спеши, мышцам нравится плавность.', 'Вниз на раз-два, вверх на раз-два.', 'Тормози, это не гонка!', 'Медленнее — и эффект больше.'],
      calm: ['Ты приседаешь очень быстро. Попробуй опускаться за две секунды.', 'Плавнее: медленно вниз и спокойно вверх.', 'Контроль важнее скорости.', 'Не падай в присед, опускайся плавно.', 'Чуть медленнее, так бережнее для коленей.'],
    },
    'squats-good': {
      strict: ['Повтор {reps}. Хорошая глубина.', 'Повтор {reps}. Так и держи.', 'Счёт {reps}. Темп ровный.', 'Есть {reps}. Продолжай.', 'Повтор {reps}. Техника в порядке.'],
      fun: ['Повтор {reps}! Ноги говорят спасибо.', 'Уже {reps}! Невидимый стул в восторге.', 'Счёт {reps}. Красиво!', 'Повтор {reps}! Ты в ударе.', 'Уже {reps}! Вот это темп.'],
      calm: ['Повтор {reps}. Хорошо получается.', 'Уже {reps}. Продолжай в своём темпе.', 'Счёт {reps}. Дыши ровно.', 'Отлично, повтор {reps}. Спина ровная.', 'Повтор {reps}. Всё правильно.'],
    },
    'squats-idle': {
      strict: ['Жду присед. Ноги на ширине плеч.', 'Начинай. Таз назад и вниз.', 'Присед. Поехали.', 'Готов? Первый повтор.', 'Не стой. Работаем.'],
      fun: ['Невидимый стул ждёт тебя!', 'Ну что, присядем? Я считаю.', 'Пора двигаться! Первый присед за тобой.', 'Я заскучал. Давай пару приседаний!', 'Готов? Таз назад, и поехали.'],
      calm: ['Когда будешь готов, начинай приседать. Я считаю повторы.', 'Встань удобно и начни первый присед.', 'Можно начинать: таз назад, колени над носками.', 'Не торопись. Начни, когда почувствуешь готовность.', 'Я жду первый повтор.'],
    },
  },
};
