// Lunges, side-on: one step forward, both knees bend, the back knee goes down
// toward the floor. Depth from the hips and the front knee; a dip with the feet
// together is a squat, not a lunge, and is not counted. The front leg is the
// one whose knee stays higher; both legs are counted separately.
import { stepReps, createReps, legCompression, kneeDepth } from '../coach-motion.js';
import { stanceLesson, repLesson, REP_MARKS } from './common.js';
import { puppet, sized, wave, FLOOR, SIZE } from './puppet.js';

const REPS = { down: 0.22, up: 0.08, attempt: 0.11, frames: 2, minMs: 800 };

function depthOf(f, calib) {
  const knees = f.knee.filter(Number.isFinite);
  const bend = knees.length ? kneeDepth(Math.min(...knees)) : null;
  const squeeze = legCompression(f, calib);
  if (squeeze === null) return bend;
  return bend === null ? squeeze : Math.max(squeeze, bend);
}
function splitOf(f, calib) {
  const [l, r] = f.loose.ankle;
  if (!l || !r) return 0;
  return Math.abs(l.x - r.x) / (calib?.legLen || f.legScale);
}
/** How far the front knee passes the toes, in shin lengths (> 0 means past the toes). */
function kneeOverToe(f, front) {
  const knee = f.loose.knee[front]; const toe = f.loose.toe[front]; const heel = f.loose.heel[front]; const ankle = f.loose.ankle[front];
  if (!knee || !toe || !heel || !ankle) return 0;
  const dir = Math.sign(toe.x - heel.x) || 1;
  const shin = Math.hypot(knee.x - ankle.x, knee.y - ankle.y) || 0.1;
  return (knee.x - toe.x) * dir / shin;
}

/** Side-view lunge of depth p with `front` leg (0/1) forward, for the demo. */
export function lungePose(p, { aspect = 9 / 16, front = 0, lean = 0, kneeForward = false, short = false, size = SIZE } = {}) {
  const B = sized(size);
  const rad = (d) => d * Math.PI / 180;
  const frontLeg = { thigh: 80 * p, shin: (kneeForward ? -32 : -4) * p };
  const backLeg = short ? frontLeg : { thigh: -15 * p, shin: -80 * p };
  const legs = front === 0 ? [frontLeg, backLeg] : [backLeg, frontLeg];
  const height = B.thigh * Math.cos(rad(frontLeg.thigh)) + B.shin * Math.cos(rad(frontLeg.shin));
  const arm = { upper: 8, fore: 8 };
  return puppet({ aspect, view: 'side', size, near: front, hip: { x: 0.46 * aspect, y: FLOOR - 0.02 * size - height }, torso: lean * p, legs, arms: [arm, arm] });
}

export default {
  id: 'lunges',
  name: 'Выпады',
  short: 'Выпады',
  emoji: '🦵',
  category: 'strength',
  level: 'Новичок',
  minutes: 7,
  needsBall: false,
  goal: 'Укрепляю ноги и баланс',
  tagline: 'Глубина, корпус, обе ноги',
  camera: 'Телефон на уровне пояса в 2–3 метрах. Встань боком к нему, чтобы был виден шаг вперёд.',
  description: 'Стойка, по два выпада на каждую ногу и серия из десяти. Тренер не засчитывает присед вместо выпада и следит за коленом и корпусом.',
  metric: { key: 'reps', label: 'выпадов', forms: ['выпад', 'выпада', 'выпадов'], progress: 'Выпады', rhythmWords: ['выпады', 'выпадами'] },
  view(f) {
    if (!f.legSeen[0] || !f.legSeen[1]) return 'show-feet';
    return f.facing > 0.55 ? 'turn-side' : null;
  },

  measure({ f, calib, still, now }, memo = { reps: createReps(), count: 0, clean: 0, left: 0, right: 0, cur: null }) {
    const m = { ...memo };
    const depth = depthOf(f, calib);
    const before = m.reps.phase;
    const step = stepReps(m.reps, depth, now, REPS);
    m.reps = step.state;
    const moving = Number.isFinite(depth) && depth > REPS.up;
    if (moving) {
      const cur = m.cur || { maxTilt: 0, maxSplit: 0, deepest: -1, front: 0, over: 0 };
      const next = { ...cur, maxTilt: Math.max(cur.maxTilt, f.tilt), maxSplit: Math.max(cur.maxSplit, splitOf(f, calib)) };
      if (depth > cur.deepest) {
        const [kl, kr] = f.kneeY;
        next.deepest = depth;
        next.front = Number.isFinite(kl) && Number.isFinite(kr) ? (kl <= kr ? 0 : 1) : f.near;
        next.over = kneeOverToe(f, next.front);
      }
      m.cur = next;
    }
    let event = null; let milestone = null;
    if (step.rep) {
      const cur = m.cur || { maxTilt: 0, maxSplit: 0, front: f.near, over: 0 };
      if (cur.maxSplit < 0.35) {
        event = { type: 'attempt', errors: ['lunge-step'] }; // feet together: a squat, not a lunge
      } else {
        const errors = [];
        if (step.rep.depth < 0.3) errors.push('lunge-shallow');
        if (cur.maxTilt > 24) errors.push('lunge-torso');
        if (cur.over > 0.14) errors.push('lunge-knee');
        m.count += 1; if (!errors.length) m.clean += 1;
        if (cur.front === 0) m.left += 1; else m.right += 1;
        event = { type: 'rep', errors, clean: !errors.length, side: cur.front, depth: step.rep.depth };
        if (REP_MARKS.includes(m.count)) milestone = { tag: 'lunges-good', vars: { reps: m.count } };
      }
      m.cur = null;
    } else if (step.attempt) {
      event = { type: 'attempt', errors: ['lunge-attempt'] }; m.cur = null;
    } else if (before === 'top' && m.reps.phase === 'top' && Number.isFinite(depth) && depth < REPS.up) m.cur = null;
    return {
      memo: m, event, milestone, phase: m.reps.phase,
      activity: moving || Boolean(event),
      ready: still && Number.isFinite(depth) && depth < 0.06 && f.tilt < 15 && splitOf(f, calib) < 0.3,
      counts: { reps: m.count, clean: m.clean, left: m.left, right: m.right },
    };
  },

  lessons: [
    stanceLesson({
      seconds: 2, goal: 'Встань боком к камере, ноги вместе, 2 секунды',
      intro: {
        strict: 'Шаг 1: встань боком к камере, ноги вместе. Две секунды неподвижно.',
        fun: 'Шаг 1: покажи профиль! Ноги вместе, замри на две секунды.',
        calm: 'Шаг 1: встань боком к камере, ноги вместе, и постой спокойно две секунды.',
      },
    }),
    {
      id: 'both', title: 'По два на каждую ногу', short: '2 + 2', target: 4, unit: '',
      goal: 'Два выпада правой ногой и два левой',
      intro: {
        strict: 'Шаг 2: по два выпада на каждую ногу. Заднее колено почти до пола.',
        fun: 'Шаг 2: по два выпада каждой ногой. Пусть обе ноги получат свою порцию!',
        calm: 'Шаг 2: сделай по два выпада каждой ногой. Шаг вперёд, оба колена сгибаются.',
      },
      update({ motion }, memo) {
        const counts = motion?.counts || {};
        const base = memo?.base || { left: counts.left || 0, right: counts.right || 0 };
        const left = Math.min(2, (counts.left || 0) - base.left);
        const right = Math.min(2, (counts.right || 0) - base.right);
        return { progress: left + right, memo: { base } };
      },
    },
    repLesson({
      id: 'ten', title: 'Десять выпадов', short: '10 выпадов', target: 10,
      goal: 'Десять выпадов, чередуя ноги',
      intro: {
        strict: 'Шаг 3: десять выпадов, ноги чередуй. Корпус вертикально.',
        fun: 'Шаг 3: десятка выпадов! Чередуй ноги, как на прогулке, только круче.',
        calm: 'Шаг 3: десять выпадов в спокойном темпе. Чередуй ноги, корпус держи ровно.',
      },
    }),
  ],

  errors: {
    'lunge-attempt': { label: 'Неглубокие попытки не засчитаны', advice: 'Опускай заднее колено почти до пола.', priority: 4 },
    'lunge-step': { label: 'Ноги стояли слишком близко', advice: 'Делай широкий шаг вперёд: выпад, а не присед.', priority: 4 },
    'lunge-shallow': { label: 'Неглубокие выпады', advice: 'Оба колена сгибаются примерно до прямого угла.', priority: 2 },
    'lunge-torso': { label: 'Наклон корпуса вперёд', advice: 'Держи корпус вертикально, взгляд перед собой.', priority: 3 },
    'lunge-knee': { label: 'Колено уходило за носок', advice: 'Шагай шире, переднее колено над пяткой.', priority: 3 },
  },

  result: (m) => ({ key: 'reps', value: m.reps, label: 'выпадов' }),
  summaryLine: (m) => `Выпадов: ${m.reps}, без замечаний: ${m.clean}. Левой ногой: ${m.left}, правой: ${m.right}.`,
  answer: (m) => `Засчитано выпадов: ${m.reps}: левой ногой ${m.left}, правой ${m.right}.`,
  rhythm: 'reps',

  demo(t, aspect) {
    if (t < 3) return { points: lungePose(0, { aspect }) };
    const k = Math.floor((t - 3) / 3); const at = ((t - 3) % 3) / 3;
    const plan = [{}, {}, { depth: 0.66 }, { depth: 0.66 }, {}, { short: true }, {}, { lean: 30 }, { lean: 30 }, {}, { kneeForward: true }, { kneeForward: true }, {}, {}];
    const step = plan[k % plan.length];
    const p = (step.depth || 1) * wave(at, { down: 0.35, hold: 0.1 });
    return { points: lungePose(p, { aspect, front: k % 2, lean: step.lean || 0, kneeForward: step.kneeForward, short: step.short }) };
  },

  phrases: {
    'lunge-attempt': {
      strict: ['Не засчитал: опустись ниже.', 'Мало глубины. Заднее колено к полу.', 'Не считается. Глубже.', 'Полвыпада не считаю. Ниже.', 'Колено почти до пола, тогда засчитаю.'],
      fun: ['Почти! Заднее колено должно почти поцеловать пол.', 'Этот не засчитал, но ты близко!', 'Глубже, и счётчик тебя заметит!', 'Пол ждёт твоё колено. Чуть ниже!', 'Ещё немного глубины, и будет зачёт.'],
      calm: ['Этот выпад не засчитан: не хватило глубины. Опускайся ниже.', 'Опускай заднее колено ближе к полу, тогда повтор засчитается.', 'Чуть глубже, насколько удобно.', 'Попытка неглубокая. Не спеши, опускайся плавно.', 'Для зачёта оба колена сгибаются сильнее.'],
    },
    'lunge-step': {
      strict: ['Это присед, а не выпад. Шаг шире.', 'Ноги рядом. Шагни вперёд.', 'Нужен широкий шаг. Не засчитано.', 'Шагни дальше. Тогда засчитаю.', 'Шире шаг вперёд.'],
      fun: ['Это был присед! Для выпада шагни вперёд пошире.', 'Ноги стоят рядом. Сделай большой шаг, как великан!', 'Шире шаг, и выпад засчитается.', 'Ты присел, а нужен выпад. Шагни вперёд!', 'Больше шаг, меньше присед!'],
      calm: ['Ноги стояли близко, это больше похоже на присед. Сделай широкий шаг вперёд.', 'Для выпада шагни вперёд на длину шага.', 'Чуть шире шаг, тогда я засчитаю выпад.', 'Поставь ногу дальше вперёд и опускайся вниз.', 'Широкий шаг вперёд, оба колена сгибаются.'],
    },
    'lunge-shallow': {
      strict: ['Мало глубины. Оба колена под прямым углом.', 'Глубже. Заднее колено ниже.', 'Неглубоко. Опускайся до конца.', 'Ниже. Бедро передней ноги параллельно полу.', 'Глубина мала.'],
      fun: ['Глубже, глубже! Колено к полу.', 'Почти идеально, ещё немного глубины.', 'Опустись ниже, и мышцы скажут спасибо.', 'Чуть ниже, ты справишься!', 'Глубина — твой лучший друг. Ниже!'],
      calm: ['Выпады получаются неглубокими. Сгибай оба колена сильнее.', 'Опускай заднее колено ближе к полу.', 'Переднее бедро почти параллельно полу.', 'Чуть глубже, если нет боли.', 'Опускайся медленно и немного ниже.'],
    },
    'lunge-torso': {
      strict: ['Корпус вертикально.', 'Не наклоняйся вперёд.', 'Спина ровно, плечи над тазом.', 'Наклон. Выпрямись.', 'Грудь вперёд, корпус прямо.'],
      fun: ['Не падай вперёд! Корпус ровно, как свечка.', 'Корпус уехал вперёд. Выпрямись!', 'Спина ровная, взгляд вперёд, улыбка по желанию.', 'Ты не кланяешься публике. Корпус прямо!', 'Плечи над тазом, и красота.'],
      calm: ['Корпус наклоняется вперёд. Держи его вертикально.', 'Плечи над тазом, взгляд перед собой.', 'Попробуй держать спину прямее.', 'Чуть выпрямись, так нагрузка правильнее.', 'Корпус ровно, движение спокойное.'],
    },
    'lunge-knee': {
      strict: ['Колено ушло за носок. Шаг шире.', 'Переднее колено над пяткой.', 'Колено вперёд не уводи.', 'Шире шаг, колено назад.', 'Колено за носком. Поправь.'],
      fun: ['Колено убегает за носок! Шагни шире.', 'Переднее колено над пяткой, а не над носком.', 'Колено, не торопись вперёд!', 'Шире шаг, и колено вернётся на место.', 'Береги колено: оно над стопой.'],
      calm: ['Переднее колено уходит дальше носка. Сделай шаг шире.', 'Держи переднее колено над пяткой.', 'Опускайся вниз, а не вперёд.', 'Чуть шире шаг, так безопаснее для колена.', 'Колено над стопой, вес на пятке передней ноги.'],
    },
    'lunges-good': {
      strict: ['Выпад {reps}. Хорошо.', 'Есть {reps}. Чередуй ноги.', 'Счёт {reps}. Корпус ровно.', 'Выпад {reps} засчитан.', 'Уже {reps}. Продолжай.'],
      fun: ['Выпад {reps}! Ноги в огне.', 'Уже {reps}! Красиво шагаешь.', 'Счёт {reps}. Ты как танцор!', 'Выпад {reps}, отличная глубина!', 'Уже {reps}! Не останавливайся.'],
      calm: ['Выпад {reps}. Хорошая техника.', 'Уже {reps}. Продолжай в своём темпе.', 'Счёт {reps}. Дыши ровно.', 'Выпад {reps}, всё правильно.', 'Отлично, уже {reps}.'],
    },
    'lunges-idle': {
      strict: ['Жду выпад. Шаг вперёд.', 'Начинай. Шаг и вниз.', 'Выпад. Поехали.', 'Готов? Первый выпад.', 'Работаем.'],
      fun: ['Шагни вперёд, я жду твой первый выпад!', 'Ноги заскучали. Выпад?', 'Давай, широкий шаг и вниз!', 'Пора шагать! Я считаю.', 'Покажи свой лучший выпад.'],
      calm: ['Когда будешь готов, шагни вперёд и опустись вниз.', 'Я жду первый выпад.', 'Можно начинать: шаг вперёд, оба колена сгибаются.', 'Не торопись, начни спокойно.', 'Начни с любой ноги.'],
    },
  },
};
