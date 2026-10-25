// Skill planner: turns "I want to learn X" into a route through the catalog.
// The route is built ONLY from existing skills. A local LLM may propose the
// route and a reply, but code validates every id and number; without the LLM a
// keyword matcher does the job. Pure functions, unit-tested in planner.test.mjs.

// Foundation first: balance, then strength, then cardio, the ball last.
const ORDER = ['balance', 'squats', 'lunges', 'plank', 'pushups', 'jacks', 'highknees', 'football'];
// \b does not see Cyrillic letters, so word edges are written with \p{L} look-arounds.
const LEGS = '(?<!\\p{L})ног(?:и|ам|ами|ах|у)?(?!\\p{L})';
const KEYWORDS = {
  balance: /баланс|равновес|устойчив|пада|качает|шата|координац|одной ноге|на одной/,
  squats: new RegExp(`присед|${LEGS}|бедр|ягодиц|укреп|окреп`, 'u'),
  lunges: new RegExp(`выпад|${LEGS}|ягодиц`, 'u'),
  plank: /планк|пресс|(?<!\p{L})кор(?:а|у)?(?!\p{L})|корпус|(?<!\p{L})живот|(?<!\p{L})спин(?:а|у|ы|ой)?(?!\p{L})|осанк/u,
  pushups: /отжим|(?<!\p{L})рук(?:и|ам|ами|ах|у)?(?!\p{L})|груд|трицепс|плеч/u,
  jacks: /звездочк|прыж|прыга|разогр|размин|кардио/u,
  highknees: /(?<!\p{L})бег(?:а|ом|ать)?(?!\p{L})|колен\p{L}* (вверх|выше)|высок\p{L}* колен|вынослив|похуд|(?<!\p{L})жир|скорост|быстр\p{L}* ног/u,
  football: /чекан|мяч|футб|набив|жонгл|подъ[её]м|стоп(?:ой|у|а|ы)(?!\p{L})|удар/u,
};
// «Сила» alone means legs first; «сильные руки» goes to the arms.
const STRENGTH = /(?<!\p{L})сил(?:у|ы|а|ьн)/u;
const STRENGTH_SKILLS = ['squats', 'lunges', 'plank', 'pushups'];
const BEGINNER = /с нуля|новичок|никогда|первый раз|не умею/;
export const MAX_PLAN = 3;

const normalize = (value) => String(value || '').toLowerCase().replace(/ё/g, 'е');
const byId = (skills) => new Map(skills.map(s => [s.id, s]));

/** Russian plural: pluralize(3, ['шаг', 'шага', 'шагов']) → «3 шага». */
export function pluralize(n, forms) {
  const value = Math.abs(Math.round(n));
  const mod10 = value % 10; const mod100 = value % 100;
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  return `${n} ${form}`;
}
const steps = (n) => pluralize(n, ['шаг', 'шага', 'шагов']);
const minutes = (n) => pluralize(n, ['минута', 'минуты', 'минут']);

/** Catalog text for the LLM: ids, names and what each skill needs. */
export function describeCatalog(skills) {
  return skills.map(s => `- id: ${s.id}; навык: ${s.name}; уровень: ${s.level}; ${s.lessons.length} шагов, ${s.minutes} мин; ${s.needsBall ? 'нужен мяч' : 'без инвентаря'}; ${s.description}`).join('\n');
}

/** Human reply written by code, used without the LLM or when its reply failed validation. */
export function planReplyText(plan, skills) {
  const map = byId(skills);
  const picked = plan.map(id => map.get(id)).filter(Boolean);
  if (!picked.length) {
    return `В каталоге пока нет навыка под эту цель. Сейчас есть: ${skills.map(s => `«${s.name}»`).join(', ')}. Выбери один из них или опиши цель иначе.`;
  }
  if (picked.length === 1) {
    const s = picked[0];
    return `Для этого подойдёт «${s.name}»: ${s.tagline.toLowerCase()}. ${steps(s.lessons.length)}, около ${minutes(s.minutes)}.`;
  }
  const list = picked.map((s, i) => `${i + 1}. ${s.name}`).join(' → ');
  const first = picked[0];
  const why = first.id === 'balance' ? 'устойчивость нужна раньше, чем удар по мячу.'
    : first.category === 'strength' ? 'сила ног и корпуса держит технику.'
    : first.category === 'cardio' ? 'разогрев и выносливость нужны в любом движении.' : 'идём от простого к сложному.';
  return `Собрал маршрут из ${picked.length} навыков: ${list}. Начнём с «${picked[0].name}»: ${why}`;
}

/** Offline fallback: keyword matching over the catalog. Always returns a validated plan. */
export function keywordPlan(message, skills) {
  const q = normalize(message);
  const ids = byId(skills);
  const matched = ORDER.filter(id => ids.has(id) && KEYWORDS[id].test(q));
  if (STRENGTH.test(q) && ids.has('squats') && !matched.some(id => STRENGTH_SKILLS.includes(id))) matched.splice(ORDER.indexOf('squats') <= 0 ? 0 : matched.filter(id => ORDER.indexOf(id) < ORDER.indexOf('squats')).length, 0, 'squats');
  if (matched.includes('football') && !matched.includes('balance') && ids.has('balance') && BEGINNER.test(q)) matched.unshift('balance');
  const plan = matched.slice(0, MAX_PLAN);
  return { ok: true, plan, reply: planReplyText(plan, skills), source: 'keywords', reason: '' };
}

/** Messages for the local LLM. The catalog is the only knowledge it gets. */
export function buildPlannerMessages(message, skills, history = []) {
  const system = [
    'Ты тренер приложения Aimo. Человек пишет, чему хочет научиться.',
    `Собери маршрут только из навыков каталога, от простого к сложному, не больше ${MAX_PLAN}. Используй только id из каталога.`,
    'Каталог:',
    describeCatalog(skills),
    'Ответь строго одним JSON-объектом без пояснений: {"plan":["id"],"reply":"одна-две фразы по-русски, на «ты», почему такой порядок"}.',
    'Если ни один навык не подходит, верни "plan":[] и в reply честно скажи, что такого навыка в каталоге пока нет, и предложи ближайший.',
    'Не придумывай навыки, числа и обещания. Без эмодзи.',
  ].join('\n');
  const past = history.slice(-4).filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content).map(m => ({ role: m.role, content: String(m.content) }));
  return [{ role: 'system', content: system }, ...past, { role: 'user', content: String(message || '').trim() }];
}

function allowedNumbers(skills, plan) {
  const set = new Set([1, 2, 3, plan.length]);
  for (const s of skills) { set.add(s.minutes); set.add(s.lessons.length); }
  return set;
}

/** Validates the LLM answer: JSON, known ids only, Russian, no invented numbers. */
export function parsePlan(raw, skills) {
  const textValue = String(raw || '');
  const start = textValue.indexOf('{'); const end = textValue.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, reason: 'no-json', plan: [], reply: '' };
  let data;
  try { data = JSON.parse(textValue.slice(start, end + 1)); } catch { return { ok: false, reason: 'bad-json', plan: [], reply: '' }; }
  const ids = byId(skills);
  const rawPlan = Array.isArray(data?.plan) ? data.plan : [];
  if (rawPlan.some(id => typeof id !== 'string' || !ids.has(id))) return { ok: false, reason: 'unknown-skill', plan: [], reply: '' };
  const plan = [...new Set(rawPlan)].slice(0, MAX_PLAN);
  const reply = String(data?.reply || '').replace(/\s+/g, ' ').trim();
  if (reply.length > 320) return { ok: false, reason: 'too-long', plan, reply };
  if (/\p{Extended_Pictographic}/u.test(reply)) return { ok: false, reason: 'emoji', plan, reply };
  if (reply) {
    const letters = reply.match(/\p{L}/gu) || [];
    const cyrillic = reply.match(/\p{Script=Cyrillic}/gu) || [];
    if (letters.length < 3 || cyrillic.length / letters.length < 0.8) return { ok: false, reason: 'not-russian', plan, reply };
    const allowed = allowedNumbers(skills, plan);
    const numbers = (reply.match(/\d+/g) || []).map(Number);
    if (numbers.some(n => !allowed.has(n))) return { ok: false, reason: 'invented-number', plan, reply };
  }
  return { ok: true, reason: '', plan, reply, source: 'llm' };
}

/** The skill after `skillId` in the route, or null. */
export function nextInPlan(plan, skillId) {
  const list = Array.isArray(plan) ? plan : [];
  const index = list.indexOf(skillId);
  return index === -1 ? null : list[index + 1] || null;
}
