// Shared vocabulary for every skill module. Pure data and tiny helpers only.

export const PERSONALITIES = {
  strict: { id: 'strict', name: 'Строгий', short: 'Строгий', voiceRate: 1.08, voicePitch: 0.9, description: 'Коротко, по делу, без лишних слов.' },
  fun: { id: 'fun', name: 'Весёлый', short: 'Весёлый', voiceRate: 1.05, voicePitch: 1.15, description: 'Подбадривает и шутит, но замечает всё.' },
  calm: { id: 'calm', name: 'Спокойный', short: 'Спокойный', voiceRate: 0.96, voicePitch: 1, description: 'Мягко объясняет и не торопит.' },
};
export const DEFAULT_PERSONALITY = 'calm';
export const personalityId = (id) => PERSONALITIES[id] ? id : DEFAULT_PERSONALITY;

// Phrases every skill needs: camera framing. Safety-related, so the tone stays
// clear in every personality.
export const COMMON_PHRASES = {
  'no-person': {
    strict: [
      'Не вижу тебя целиком. Поставь телефон устойчиво и войди в кадр.',
      'В кадре нет тела. Отойди и встань перед камерой.',
      'Камера тебя потеряла. Вернись в кадр полностью.',
      'Нужно видеть плечи и таз. Встань в кадр.',
      'Стоп. Сначала встань так, чтобы было видно всё тело.',
    ],
    fun: [
      'Эй, куда пропал? Вернись в кадр целиком!',
      'Камера скучает: не видит тебя. Встань перед телефоном.',
      'Пока вижу только пустоту. Заходи в кадр, тренируемся!',
      'Телефон поставь устойчиво и покажись целиком.',
      'Тренер в эфире, а спортсмена нет. Вернись в кадр!',
    ],
    calm: [
      'Пока не вижу тебя целиком. Поставь телефон устойчиво и войди в кадр.',
      'Сделай шаг назад, чтобы в кадр попали плечи и таз.',
      'Камера пока тебя не видит. Встань перед ней полностью.',
      'Проверь, что телефон не упал, и вернись в кадр.',
      'Когда будешь в кадре целиком, продолжим.',
    ],
  },
  'show-feet': {
    strict: [
      'Не вижу колени и стопы. Отойди дальше от телефона.',
      'Стопы должны быть в кадре. Шаг назад.',
      'Ноги обрезаны. Отойди или опусти телефон ниже.',
      'Нужны колени и стопы в кадре. Ещё шаг назад.',
      'Нижняя часть тела не видна. Поправь камеру.',
    ],
    fun: [
      'Где твои ноги? Отойди на шаг, чтобы я видел стопы!',
      'Вижу только верх. Покажи колени и стопы, без них не посчитаю.',
      'Ноги спрятались. Сделай шаг назад от телефона.',
      'Камере нужен вид на стопы. Чуть дальше, пожалуйста!',
      'Ещё шаг назад, и я увижу всю картину.',
    ],
    calm: [
      'В кадре должны быть видны колени и стопы. Отойди от телефона немного дальше.',
      'Сделай шаг назад или опусти телефон ниже, чтобы было видно ноги.',
      'Мне нужно видеть стопы. Отойди на шаг.',
      'Нижняя часть тела пока не видна. Поправь положение камеры.',
      'Когда стопы будут в кадре, продолжим.',
    ],
  },
  'show-body': {
    strict: [
      'Не вижу всё тело. Отойди дальше от телефона.',
      'Руки или ноги вне кадра. Поправь камеру.',
      'Нужно всё тело: от головы до стоп. Шаг назад.',
      'Часть тела обрезана. Отодвинь телефон.',
      'Встань так, чтобы кадр видел тебя целиком.',
    ],
    fun: [
      'Ты не помещаешься в кадр! Отойди чуть дальше.',
      'Кадр обрезал половину чемпиона. Отодвинь телефон!',
      'Покажись целиком, от макушки до пяток.',
      'Шаг назад, и я увижу всю картину.',
      'Камере нужен вид на всё тело. Чуть дальше, пожалуйста!',
    ],
    calm: [
      'Мне нужно видеть всё тело. Отойди немного дальше от телефона.',
      'Часть тела вне кадра. Поставь телефон дальше или ниже.',
      'Проверь, что в кадре и голова, и стопы.',
      'Когда будешь виден целиком, продолжим.',
      'Отодвинь телефон, чтобы в кадр поместились руки и ноги.',
    ],
  },
  'turn-side': {
    strict: [
      'Повернись боком к камере. Так видно глубину.',
      'Встань боком. Лицом я не вижу угол в коленях.',
      'Боком к телефону. Тогда засчитаю.',
      'Нужен профиль. Повернись на девяносто градусов.',
      'Развернись боком и продолжай.',
    ],
    fun: [
      'Покажи профиль! Боком я вижу всё до градуса.',
      'Повернись боком, как на фото в паспорте, только веселее.',
      'Боком к камере, и я стану точнее.',
      'Развернись на четверть оборота, и поехали!',
      'Профиль — твоя лучшая сторона для этого упражнения.',
    ],
    calm: [
      'Для этого упражнения встань боком к камере: так видно углы в суставах.',
      'Повернись боком к телефону, тогда я смогу считать правильно.',
      'Профилем к камере тренер видит глубину движения.',
      'Развернись боком и продолжай в своём темпе.',
      'Поставь телефон сбоку от себя, так будет видно технику.',
    ],
  },
  'turn-front': {
    strict: [
      'Повернись лицом к камере.',
      'Встань лицом к телефону. Мне нужны обе руки и ноги.',
      'Лицом к камере. Тогда засчитаю.',
      'Развернись к телефону.',
      'Нужно стоять лицом, а не боком.',
    ],
    fun: [
      'Повернись ко мне лицом, я хочу видеть обе руки!',
      'Лицом к камере, звезда!',
      'Развернись к телефону, так я увижу всё.',
      'Профиль красивый, но тут нужен анфас!',
      'Лицом к камере, и поехали дальше.',
    ],
    calm: [
      'Для этого упражнения встань лицом к камере.',
      'Повернись к телефону лицом, чтобы я видел обе стороны тела.',
      'Лицом к камере будет видно и руки, и ноги.',
      'Развернись к телефону и продолжай.',
      'Встань прямо перед камерой.',
    ],
  },
  'lesson-done': {
    strict: ['Шаг засчитан.', 'Готово.', 'Зачёт.', 'Есть.', 'Выполнено.'],
    fun: ['Есть! Шаг в кармане.', 'Красота, шаг закрыт!', 'Отлично получилось!', 'Ура, следующий уровень!', 'Так держать!'],
    calm: ['Шаг выполнен.', 'Хорошо, получилось.', 'Этот шаг закрыт.', 'Отлично.', 'Готово, молодец.'],
  },
  'course-complete': {
    strict: [
      'Все шаги урока выполнены. Продолжай серию, я считаю.',
      'Урок пройден. Дальше работаем на результат.',
      'Программа закрыта. Теперь увеличивай серию.',
      'Все шаги засчитаны. Продолжай в том же темпе.',
      'Урок завершён. Можешь закончить или продолжить серию.',
    ],
    fun: [
      'Все шаги пройдены! Теперь просто кайфуй и бей рекорды.',
      'Урок закрыт, ты молодец! Продолжай, я считаю серию.',
      'Финиш программы! Дальше свободная игра.',
      'Ты прошёл весь урок. Теперь рекорды!',
      'Программа выполнена. Хочешь ещё? Я с тобой.',
    ],
    calm: [
      'Все шаги урока выполнены. Можешь продолжить серию или завершить тренировку.',
      'Урок пройден. Продолжай в своём темпе, я считаю.',
      'Программа закончена. Дальше свободная практика.',
      'Все шаги получились. Отличная работа.',
      'Урок завершён. Продолжай, если есть силы.',
    ],
  },
};

// Picks a phrase deterministically from the bank, avoiding the previous index.
export function pickPhrase(bank, personality, previousIndex = -1, seed = 0) {
  const list = bank?.[personalityId(personality)] || bank?.calm || [];
  if (!list.length) return { text: '', index: -1 };
  if (list.length === 1) return { text: list[0], index: 0 };
  let index = Math.abs(Math.floor(seed)) % list.length;
  if (index === previousIndex) index = (index + 1) % list.length;
  return { text: list[index], index };
}

export function fillTemplate(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) => (vars[key] === undefined || vars[key] === null ? match : String(vars[key])));
}

/* ───────────── Catalog structure and lesson builders ───────────── */

export const CATEGORIES = [
  { id: 'football', name: 'Футбол', note: 'Мяч, баланс и координация' },
  { id: 'strength', name: 'Сила', note: 'Ноги, руки и корпус' },
  { id: 'cardio', name: 'Кардио', note: 'Ритм и выносливость' },
];

/** First step of most skills: stand in the start position and hold still. It also calibrates the coach. */
export function stanceLesson({ id = 'stance', title = 'Исходное положение', short = 'Стойка', seconds = 2, goal, intro }) {
  return {
    id, title, short, target: seconds, unit: 'с', goal, intro,
    update({ motion, now }, memo = {}) {
      if (!motion?.ready) return { progress: 0, memo: { since: null } };
      const since = memo.since ?? now;
      return { progress: Math.min(seconds, (now - since) / 1000), memo: { since } };
    },
  };
}

/** Repetitions counted since the step began; `clean` counts only repetitions without remarks. */
export function repLesson({ id, title, short, target, goal, intro, clean = false }) {
  return {
    id, title, short, target, unit: '', goal, intro, clean,
    update({ motion }, memo = { count: 0 }) {
      const event = motion?.event;
      const count = (memo.count || 0) + (event?.type === 'rep' && (!clean || event.clean) ? 1 : 0);
      return { progress: count, memo: { count } };
    },
  };
}

/** The longest continuous hold reached during this step. */
export function holdLesson({ id, title, short, seconds, goal, intro }) {
  return {
    id, title, short, target: seconds, unit: 'с', goal, intro,
    update({ motion }, memo = { best: 0 }) {
      const current = motion?.hold?.active ? motion.hold.seconds : 0;
      const best = Math.max(memo.best || 0, current);
      return { progress: Math.min(seconds, best), memo: { best } };
    },
  };
}

/** Praise only on round numbers: the first repetition, then every fifth or tenth. */
export const REP_MARKS = [1, 5, 10, 15, 20, 30, 40, 50, 75, 100];
export const HOLD_MARKS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
/** The hold mark crossed between two readings, or null. */
export function crossedMark(before, after, marks = HOLD_MARKS) {
  return marks.find(mark => before < mark && after >= mark) ?? null;
}

/** The athlete left the frame: a movement in progress is dropped, totals are kept. */
export function pauseMemo(memo) {
  if (!memo || typeof memo !== 'object') return memo;
  const next = { ...memo, cur: null };
  if (memo.reps) next.reps = { ...memo.reps, phase: 'idle', frames: 0, peak: 0, excursion: 0 };
  if (memo.hold) next.hold = { ...memo.hold, since: null, seconds: 0 };
  if (Array.isArray(memo.legs)) next.legs = memo.legs.map(leg => ({ ...leg, phase: 'down', frames: 0, peak: 0 }));
  if (memo.jack) next.jack = { ...memo.jack, phase: 'idle', frames: 0, arms: false, legs: false, maxSpread: 0, overHead: false };
  if ('lift' in memo) next.lift = null;
  return next;
}
