// Keepie-uppie (чеканка). Flagship skill: lessons gated by real observations,
// a ball tracker for touches and drops, and remarks about the lift, the support
// knee, the torso and the arms, confirmed over several lifts before they are said.
import { stanceLesson, REP_MARKS } from './common.js';
import { confirmByReps } from '../coach-motion.js';
import { puppet, wave, standHip, SIZE } from './puppet.js';

const STANCE_SECONDS = 3;
const STREAK_MARKS = [3, 5, 10, 15, 20, 30, 50];

// A streak counts for a series lesson only from the moment the lesson started:
// touches made during the previous step are not re-used.
function streakProgress(ball, memo) {
  const streak = ball.streak || 0;
  const baseline = memo ? (streak < memo.baseline ? 0 : memo.baseline) : streak;
  const best = Math.max(memo?.best || 0, streak - baseline);
  return { progress: best, memo: { baseline, best } };
}

/** Front view: a light lift of one foot (0..1) and the arms out for balance. */
function footballPose(lift, { aspect, side = 1, high = false, armsIn = false }) {
  const size = SIZE;
  const thigh = (high ? 95 : 42) * lift; const shin = -(high ? 20 : 55) * lift;
  const legs = [{ thigh: 3, shin: 3 }, { thigh: 3, shin: 3 }];
  legs[side] = { thigh: 3 + thigh, shin: 3 + shin, plane: 'sagittal' };
  const arm = armsIn ? { upper: 6, fore: 4 } : { upper: 28, fore: 34 };
  const bob = 0.004 * Math.sin(lift * Math.PI);
  return puppet({ aspect, size, hip: { x: 0.5 * aspect, y: standHip(size) - 0.006 + bob }, legs, arms: [arm, arm] });
}

export default {
  id: 'football',
  name: 'Чеканка мяча',
  short: 'Чеканка',
  emoji: '⚽',
  category: 'football',
  level: 'Новичок',
  minutes: 10,
  needsBall: true,
  goal: 'Учусь чеканить мяч',
  tagline: 'От стойки до серии касаний',
  camera: 'Телефон на земле у стены в 2–3 метрах, лицом к нему. Видно всё тело и мяч.',
  description: 'Шесть шагов: стойка, подъёмы без мяча, первое касание и серии. Тренер переводит дальше только по тому, что реально видит.',
  metric: {
    key: 'touches', label: 'касаний', forms: ['касание', 'касания', 'касаний'], progress: 'Лучшая серия', fallbackProgress: 'Подъёмы стопы', rhythmWords: ['касания', 'касаниями'], fallbackRhythmWords: ['подъёмы стопы', 'подъёмами'],
    fallbackKey: 'lifts', fallbackLabel: 'подъёмов стопы', fallbackForms: ['подъём стопы', 'подъёма стопы', 'подъёмов стопы'],
    fallbackNote: 'Мяч не виден: считаем подъёмы стопы, не касания.',
  },
  view(f) { return f.legVisible[0] && f.legVisible[1] ? null : 'show-feet'; },

  measure({ f, feet, still }, memo = { count: 0, clean: 0, lift: null }) {
    const m = { ...memo };
    let event = null; let milestone = null;
    if (feet.raised) {
      const lift = m.lift || { maxTilt: 0, minSupport: 180, spread: false };
      m.lift = { maxTilt: Math.max(lift.maxTilt, f.tilt), minSupport: Math.min(lift.minSupport, feet.supportKnee ?? 180), spread: lift.spread || feet.armsSpread };
    }
    if (feet.liftCompleted) {
      const lift = m.lift || { maxTilt: f.tilt, minSupport: 180, spread: feet.armsSpread };
      const errors = [];
      if (feet.liftHigh) errors.push('lift-high');
      if (f.facing < 0.45 && lift.minSupport > 174) errors.push('support-knee'); // a knee bend is visible only side-on
      if (lift.maxTilt > 28) errors.push('torso');
      if (!lift.spread) errors.push('arms-closed');
      m.count += 1; if (!errors.length) m.clean += 1;
      event = { type: 'rep', errors, clean: !errors.length };
      if (REP_MARKS.includes(m.count)) milestone = { tag: 'lift-done', vars: { lifts: m.count } };
      m.lift = null;
    }
    return { memo: m, event, milestone, activity: Boolean(feet.raised || feet.liftCompleted), ready: still && !feet.raised, counts: { reps: m.count, clean: m.clean } };
  },

  /** Ball cues: drops, first touch, streak milestones, a ball kicked sideways, a missing ball. */
  cues({ ball, lesson, now }, cues, memo = { sides: [] }) {
    const next = { ...memo };
    const observed = [];
    const ballStep = Boolean(lesson?.needsBall);
    let list = ballStep ? cues.filter(c => c.tag !== 'lift-done') : [...cues];
    if (ball.event === 'drop') { list.push({ kind: 'attempt', tag: 'ball-drop', once: true, priority: 3, vars: { streak: ball.lastStreak } }); observed.push('ball-drop'); }
    if (ball.event === 'touch') {
      if (ball.touches === 1) list.push({ kind: 'praise', tag: 'ball-touch', vars: { touches: 1 } });
      else if (STREAK_MARKS.includes(ball.streak)) list.push({ kind: 'praise', tag: 'ball-streak', vars: { streak: ball.streak } });
      const check = confirmByReps(next.sides, ball.awayFromBody ? ['ball-side'] : []);
      next.sides = check.history;
      if (ball.awayFromBody) observed.push('ball-side');
      if (check.confirmed.includes('ball-side') && ball.awayFromBody) list.push({ kind: 'error', tag: 'ball-side', once: true, priority: 2 });
    }
    if (ballStep && !ball.seen && now - (Number.isFinite(ball.lastSeenAt) ? ball.lastSeenAt : -Infinity) > 4000) list.push({ kind: 'error', tag: 'ball-missing', priority: 2 });
    return { cues: list, memo: next, observed };
  },

  lessons: [
    stanceLesson({
      seconds: STANCE_SECONDS, title: 'Стойка', short: 'Стойка',
      goal: 'Стой устойчиво 3 секунды, колени мягкие',
      intro: {
        strict: 'Шаг 1: стойка. Ноги на ширине плеч, колени мягкие, стой спокойно 3 секунды.',
        fun: 'Шаг 1: стойка! Ноги на ширине плеч, колени чуть согнуты, замри на 3 секунды.',
        calm: 'Шаг 1: стойка. Встань удобно, слегка согни колени и постой спокойно 3 секунды.',
      },
    }),
    {
      id: 'lifts', title: 'Подъёмы без мяча', short: 'Подъёмы', target: 6, unit: '',
      goal: 'Сделай 6 невысоких подъёмов стопы',
      intro: {
        strict: 'Шаг 2: без мяча. Шесть невысоких подъёмов стопы, опорное колено мягкое.',
        fun: 'Шаг 2: мяч пока отдыхает. Шесть лёгких подъёмов стопы, как будто чеканишь воздух!',
        calm: 'Шаг 2: пока без мяча. Сделай шесть невысоких подъёмов стопы, не спеша.',
      },
      update({ motion }, memo = { count: 0 }) {
        const event = motion?.event;
        const count = (memo.count || 0) + (event?.type === 'rep' && !event.errors.includes('lift-high') ? 1 : 0);
        return { progress: count, memo: { count } };
      },
    },
    {
      id: 'touch', title: 'Одно касание', short: 'Касание', target: 3, unit: '', needsBall: true,
      goal: 'Подбрось руками, одно касание, поймай. 3 раза',
      intro: {
        strict: 'Шаг 3: мяч в руки. Подброс, одно касание подъёмом, ловим. Три удачных.',
        fun: 'Шаг 3: время мяча! Подбрось, коснись один раз и поймай. Три раза, и ты герой.',
        calm: 'Шаг 3: возьми мяч в руки. Подбрось, сделай одно касание и поймай. Нужно три таких.',
      },
      update({ ball }, memo = { count: 0 }) {
        const count = (memo.count || 0) + (ball.event === 'touch' ? 1 : 0);
        return { progress: count, memo: { count } };
      },
    },
    {
      id: 'series3', title: 'Серия из 3', short: 'Серия 3', target: 3, unit: '', needsBall: true,
      goal: 'Три касания подряд, не роняя мяч',
      intro: {
        strict: 'Шаг 4: серия. Три касания подряд. Невысоко, в ровном ритме.',
        fun: 'Шаг 4: серия из трёх! Невысоко, ритмично, не спеши.',
        calm: 'Шаг 4: серия. Попробуй три касания подряд, невысоко и спокойно.',
      },
      update({ ball }, memo) { return streakProgress(ball, memo); },
    },
    {
      id: 'series5', title: 'Серия из 5', short: 'Серия 5', target: 5, unit: '', needsBall: true,
      goal: 'Пять касаний подряд',
      intro: {
        strict: 'Шаг 5: пять подряд. Держи мяч на уровне колена.',
        fun: 'Шаг 5: пятёрочка подряд! Мяч не выше колена, взгляд на мяч.',
        calm: 'Шаг 5: теперь пять касаний подряд. Держи мяч невысоко.',
      },
      update({ ball }, memo) { return streakProgress(ball, memo); },
    },
    {
      id: 'series10', title: 'Серия из 10', short: 'Серия 10', target: 10, unit: '', needsBall: true,
      goal: 'Десять касаний подряд',
      intro: {
        strict: 'Шаг 6: десять подряд. Ритм и мягкое колено.',
        fun: 'Шаг 6, финальный: десять подряд! Ты уже почти чеканишь.',
        calm: 'Шаг 6: десять касаний подряд. Спокойный ритм важнее силы.',
      },
      update({ ball }, memo) { return streakProgress(ball, memo); },
    },
  ],

  errors: {
    'lift-high': { label: 'Стопа поднималась выше колена', advice: 'Делай удар короче: мяч до пояса, стопа не выше колена.', priority: 3 },
    'support-knee': { label: 'Опорная нога была прямой', advice: 'Чуть сгибай опорное колено, оно гасит качание.', priority: 2 },
    torso: { label: 'Корпус заваливался', advice: 'Держи плечи над тазом и смотри на мяч.', priority: 2 },
    'arms-closed': { label: 'Руки прижаты к телу', advice: 'Разводи руки в стороны, это балансир.', priority: 1 },
    'ball-side': { label: 'Мяч уходил в сторону', advice: 'Бей серединой подъёма, носок на себя.', priority: 2 },
    'ball-drop': { label: 'Частые потери мяча', advice: 'Начинай с одного касания и ловли, потом серии.', priority: 3 },
    'ball-missing': { label: 'Мяч часто не был виден', advice: 'Больше света и мяч перед собой, ближе к центру кадра.', priority: 2 },
  },

  result: (m) => (m.ballEverSeen ? { key: 'touches', value: m.touches, label: 'касаний' } : { key: 'lifts', value: m.lifts, label: 'подъёмов стопы' }),
  summaryLine: (m) => `Мяч ${m.ballSeen ? 'виден' : 'не виден'}. Касаний: ${m.touches}, серия сейчас: ${m.streak}, лучшая серия: ${m.bestStreak}, потерь мяча: ${m.drops}. Подъёмов стопы без мяча: ${m.lifts}.`,
  answer: (m) => (m.ballEverSeen
    ? `Засчитано касаний: ${m.touches}. Лучшая серия: ${m.bestStreak}.${m.ballSeen ? '' : ' Сейчас мяч не виден.'}`
    : `Подъёмов стопы: ${m.lifts}. Мяч ещё не распознан, поэтому касания не считаются.`),
  rhythm: 'touches',

  demo(t, aspect) {
    if (t < 4) return { points: footballPose(0, { aspect }) };
    if (t < 14) {
      // Light lifts; the fourth and fifth go too high, so the coach remarks on it.
      const k = Math.floor((t - 4) / 1.5); const at = ((t - 4) % 1.5) / 1.5;
      return { points: footballPose(wave(at, { down: 0.3, hold: 0.1 }), { aspect, side: k % 2, high: k === 3 || k === 4 }) };
    }
    // With the ball: the foot meets it every 1.3 s, the ball bounces between the foot and the waist.
    const at = ((t - 14) % 1.3) / 1.3;
    const lift = wave(at, { down: 0.18, hold: 0.04 });
    const points = footballPose(lift * 0.8, { aspect, side: 1 });
    const foot = points[32];
    const bounce = Math.sin(Math.PI * at);
    const ball = [{ x: foot.x + 0.012, y: foot.y - 0.05 - bounce * 0.2, w: 0.07, h: 0.07 * aspect / 0.5625, score: 0.9 }];
    return { points, ball };
  },

  phrases: {
    'ball-drop': {
      strict: ['Мяч упал. Подними и начни серию заново. Было {streak}.', 'Потерял мяч. Короче удар, носок на себя.', 'Упал. Смотри на мяч до самого касания.', 'Серия прервана на {streak}. Снова, спокойнее.', 'Мяч на земле. Подброс руками и заново.'],
      fun: ['Мяч решил отдохнуть. Было {streak}, сейчас будет больше!', 'Упал, бывает! Подними и покажи ему, кто главный.', 'Серия на {streak} сорвалась. Следующая будет длиннее!', 'Мяч сбежал. Коротким ударом возвращаем его в игру.', 'Ничего, это тренировка. Подброс и погнали снова.'],
      calm: ['Мяч упал, ничего страшного. Серия была {streak}. Подними и попробуй снова.', 'Потеря мяча. Удар короче, и смотри на мяч.', 'Начни заново с подброса руками. Спокойно.', 'Мяч на земле. Передохни секунду и продолжай.', 'Серия прервалась на {streak}. В следующей держи ритм ровнее.'],
    },
    'ball-streak': {
      strict: ['{streak} подряд. Не ускоряйся.', 'Серия {streak}. Держи ритм.', '{streak} касаний. Колено мягкое, продолжай.', 'Уже {streak}. Мяч не выше колена.', '{streak} подряд засчитано.'],
      fun: ['{streak} подряд! Да ты чеканишь!', 'Серия {streak}, огонь! Не останавливайся.', '{streak} касаний подряд. Вот это ритм!', 'Ого, {streak}! Рекорд близко.', '{streak}! Мяч тебя слушается.'],
      calm: ['{streak} касаний подряд. Хороший ритм.', 'Серия {streak}. Продолжай так же спокойно.', 'Уже {streak} подряд. Колено мягкое, всё правильно.', '{streak} касаний. Дыши ровно и продолжай.', 'Отличная серия: {streak}.'],
    },
    'ball-touch': {
      strict: ['Касание засчитано. Всего {touches}.', 'Есть касание. Следующее такое же невысокое.', 'Касание {touches}. Ловить мяч не обязательно, продолжай.', 'Вижу контакт с мячом. Ритм.', 'Касание. Теперь второе подряд.'],
      fun: ['Касание! Уже {touches}, мяч доволен.', 'Есть контакт! Давай ещё одно.', 'Бум, касание {touches}. Красиво!', 'Мяч коснулся стопы, как надо!', 'Вот оно! Продолжай в том же духе.'],
      calm: ['Касание засчитано, всего {touches}. Хорошо.', 'Вижу касание. Продолжай так же мягко.', 'Касание {touches}. Держи мяч невысоко.', 'Хороший контакт с мячом. Ещё раз.', 'Получилось. Попробуй следующее касание.'],
    },
    'lift-high': {
      strict: ['Слишком высоко. Короче удар, мяч уйдёт вверх.', 'Стопа выше колена. Короткий импульс.', 'Не маши ногой. Невысокий подъём.', 'Высоко. Чеканка — это короткие удары.', 'Опусти амплитуду. Мяч должен лететь до колена.'],
      fun: ['Эй, это не кунг-фу! Стопу пониже.', 'Слишком высоко, мяч улетит в космос. Короче удар!', 'Нога выше колена. Делай маленький тычок.', 'Амплитуду поменьше, и мяч останется рядом.', 'Короткий удар, как щелчок. Пробуем!'],
      calm: ['Стопа поднимается выше колена. Сделай удар короче, тогда мяч не уйдёт высоко.', 'Поменьше амплитуду. Невысокий подъём держит мяч рядом.', 'Короткий импульс стопой, без размаха.', 'Попробуй поднимать стопу ниже, до уровня колена.', 'Мягкий короткий удар. Высота мяча до пояса.'],
    },
    'support-knee': {
      strict: ['Опорная нога прямая. Согни колено.', 'Согни опорное колено, будет устойчивее.', 'Колено опорной ноги замкнуто. Мягче.', 'Прямая опорная нога. Чуть присядь.', 'Опора жёсткая. Согни колено на пару градусов.'],
      fun: ['Опорная нога как столб. Чуть согни колено, станет легче!', 'Согни опорное колено, иначе качает.', 'Колено мягче, ты же не статуя!', 'Чуть присядь на опорной ноге, и баланс вернётся.', 'Пружинь опорным коленом, это секрет.'],
      calm: ['Опорная нога почти прямая. Слегка согни колено, будет устойчивее.', 'Смягчи опорное колено, это даст равновесие.', 'Попробуй чуть присесть на опорной ноге.', 'Опорное колено мягкое, как пружина.', 'Небольшой сгиб опорной ноги поможет держать баланс.'],
    },
    torso: {
      strict: ['Корпус завален. Плечи над тазом.', 'Выпрямись. Плечи над тазом.', 'Наклон корпуса. Вернись в центр.', 'Не заваливайся вбок. Центр тяжести над опорой.', 'Корпус в сторону. Выровняйся.'],
      fun: ['Тебя ведёт в сторону! Плечи над тазом.', 'Корпус заваливается. Выпрямись, как струна.', 'Не падай, тренировка ещё идёт! Плечи ровно.', 'Корпус в центр, и всё получится.', 'Выровняй плечи над тазом, баланс вернётся.'],
      calm: ['Корпус заметно смещён. Верни плечи над тазом.', 'Вижу наклон корпуса. Выровняйся спокойно.', 'Держи плечи над тазом, взгляд на мяч.', 'Чуть выпрямись, центр тяжести над опорой.', 'Корпус ближе к центру, это поможет равновесию.'],
    },
    'arms-closed': {
      strict: ['Руки прижаты. Разведи для баланса.', 'Руки в стороны. Это твой балансир.', 'Разведи руки, станет устойчивее.', 'Не прижимай руки к телу.', 'Руки чуть шире для равновесия.'],
      fun: ['Руки как крылья! Разведи их для баланса.', 'Раскинь руки, канатоходцы не зря так делают.', 'Руки прижаты, как у пингвина. Разведи!', 'Чуть разведи руки, и качать перестанет.', 'Руки в стороны, лови равновесие.'],
      calm: ['Разведи руки немного в стороны. Это помогает держать баланс.', 'Руки чуть шире, тогда будет устойчивее.', 'Попробуй не прижимать руки к телу.', 'Руки в стороны, как балансир.', 'Свободные руки помогают равновесию.'],
    },
    'ball-side': {
      strict: ['Мяч уходит в сторону. Бей серединой подъёма, носок на себя.', 'Мяч не над стопой. Носок на себя.', 'Удар серединой подъёма, не боком.', 'Мяч в сторону. Стопа ровно под мячом.', 'Держи мяч перед собой.'],
      fun: ['Мяч убегает вбок! Носок на себя, бей серединой подъёма.', 'Мяч хочет сбежать. Держи его перед собой!', 'Бей ровно подъёмом, и мяч вернётся.', 'Стопа под мяч, носок на себя. Секрет раскрыт!', 'Мяч не любит боковые удары. Серединой!'],
      calm: ['Мяч уходит в сторону. Бей серединой подъёма, носок на себя.', 'Старайся держать мяч перед собой.', 'Стопа ровно под мячом, удар серединой.', 'Чуть поправь: носок на себя, тогда мяч полетит вверх.', 'Мяч смещается. Удар ровнее, по центру.'],
    },
    'ball-missing': {
      strict: ['Не вижу мяч. Покажи его камере.', 'Мяч не в кадре. Возьми его в руки.', 'Нужен мяч. Возьми его и встань в кадр.', 'Мяча нет. Без него шаг не засчитаю.', 'Покажи мяч камере.'],
      fun: ['Где мяч? Без него скучно!', 'Мяч спрятался. Покажи его камере.', 'Нужен мяч, он главный герой этого шага.', 'Возьми мяч в руки, и продолжим.', 'Мяч не вижу. Он точно рядом?'],
      calm: ['Пока не вижу мяч. Возьми его в руки и покажи камере.', 'Для этого шага нужен мяч в кадре.', 'Мяч не виден. Проверь свет и положи его перед собой.', 'Покажи мяч камере, тогда я смогу считать касания.', 'Без мяча этот шаг не засчитывается. Возьми его.'],
    },
    'lift-done': {
      strict: ['Подъём засчитан. Всего {lifts}.', 'Есть подъём. Следующий такой же низкий.', 'Подъём {lifts}. Колено мягкое.', 'Вижу подъём и возврат. Ещё.', 'Засчитано. Ритм.'],
      fun: ['Подъём {lifts}! Воздух отчеканен.', 'Есть! Ещё один такой же.', 'Красивый подъём. Мяч бы оценил!', 'Подъём {lifts}, ритм хороший.', 'Так, так, вижу движение. Продолжай!'],
      calm: ['Вижу подъём и возврат стопы. Всего {lifts}.', 'Подъём засчитан. Продолжай невысоко.', 'Хорошо. Ещё один такой же подъём.', 'Подъём {lifts}. Сохраняй равновесие.', 'Получилось. Следующий в том же темпе.'],
    },
    'football-idle': {
      strict: ['Стой устойчиво. Начни с одного подъёма стопы.', 'Жду движение. Один невысокий подъём.', 'Ноги видны. Начинай.', 'Готов. Подброс руками и одно касание.', 'Начни. Невысокий подъём стопы.'],
      fun: ['Вижу тебя целиком. Поехали!', 'Всё в кадре. Покажи первый подъём стопы!', 'Готов? Один лёгкий подъём, и мы в игре.', 'Ноги видны, мяч рядом? Начинаем!', 'Жду твоё первое движение.'],
      calm: ['Ноги видны. Начни с одного невысокого подъёма стопы.', 'Всё в кадре. Начинай, когда будешь готов.', 'Можно начинать: один невысокий подъём.', 'Я тебя вижу. Попробуй первое движение.', 'Готово к тренировке. Начни спокойно.'],
    },
  },
};
