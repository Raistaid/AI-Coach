import test from 'node:test';
import assert from 'node:assert/strict';
import { keywordPlan, parsePlan, buildPlannerMessages, planReplyText, nextInPlan, describeCatalog, MAX_PLAN } from './coach-planner.js';
import { SKILL_LIST } from './skills/index.js';

test('keyword planner maps a keepie-uppie goal to the football skill', () => {
  const r = keywordPlan('Хочу научиться чеканить мяч', SKILL_LIST);
  assert.deepEqual(r.plan, ['football']);
  assert.match(r.reply, /Чеканка мяча/);
});

test('keyword planner puts balance before football when the ball keeps falling', () => {
  const r = keywordPlan('хочу чеканить, но мяч всё время падает и меня качает', SKILL_LIST);
  assert.deepEqual(r.plan, ['balance', 'football']);
  assert.match(r.reply, /1\. Баланс на одной ноге → 2\. Чеканка мяча/);
});

test('keyword planner adds balance for a complete beginner and squats for leg strength', () => {
  assert.deepEqual(keywordPlan('никогда не играл, хочу чеканить с нуля', SKILL_LIST).plan, ['balance', 'football']);
  assert.deepEqual(keywordPlan('Хочу укрепить ноги перед футболом', SKILL_LIST).plan, ['squats', 'lunges', 'football']);
  assert.deepEqual(keywordPlan('Хочу много узнать', SKILL_LIST).plan, [], '"много" must not match "ноги"');
  assert.deepEqual(keywordPlan('дарова ты шаришь за футбик', SKILL_LIST).plan, ['football'], 'slang for football still finds the skill');
});

test('an unknown goal yields an empty plan and an honest reply naming the catalog', () => {
  const r = keywordPlan('Хочу научиться плавать', SKILL_LIST);
  assert.deepEqual(r.plan, []);
  assert.match(r.reply, /пока нет навыка/);
  for (const s of SKILL_LIST) assert.ok(r.reply.includes(s.name));
});

test('LLM reply passes when it is JSON with known ids and catalog numbers', () => {
  const raw = 'Вот ответ: {"plan":["balance","football"],"reply":"Сначала баланс, 3 шага за 5 минут, потом чеканка."}';
  const r = parsePlan(raw, SKILL_LIST);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, ['balance', 'football']);
  assert.equal(r.source, 'llm');
});

test('LLM reply is rejected for invented skills, invented numbers, English, emoji, bad JSON and over-long text', () => {
  assert.equal(parsePlan('{"plan":["handstand"],"reply":"ок"}', SKILL_LIST).reason, 'unknown-skill');
  assert.equal(parsePlan('{"plan":["football"],"reply":"За 9 дней научишься."}', SKILL_LIST).reason, 'invented-number');
  assert.equal(parsePlan('{"plan":["football"],"reply":"Start with juggling drills"}', SKILL_LIST).reason, 'not-russian');
  assert.equal(parsePlan('{"plan":["football"],"reply":"Поехали ⚽"}', SKILL_LIST).reason, 'emoji');
  assert.equal(parsePlan('просто текст без объекта', SKILL_LIST).reason, 'no-json');
  assert.equal(parsePlan('{"plan":["football"],"reply":"' + 'а'.repeat(400) + '"}', SKILL_LIST).reason, 'too-long');
  assert.equal(parsePlan('{"plan":[42],"reply":"ок"}', SKILL_LIST).reason, 'unknown-skill');
});

test('plan is deduplicated and capped, empty plan with honest reply is accepted', () => {
  const r = parsePlan('{"plan":["football","football","balance","squats","balance"],"reply":"Маршрут готов."}', SKILL_LIST);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, ['football', 'balance', 'squats']);
  assert.ok(r.plan.length <= MAX_PLAN);
  const none = parsePlan('{"plan":[],"reply":"Такого навыка пока нет, ближе всего баланс."}', SKILL_LIST);
  assert.equal(none.ok, true); assert.deepEqual(none.plan, []);
});

test('planner messages carry only the catalog, demand JSON and keep short history', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  const messages = buildPlannerMessages('хочу чеканить', SKILL_LIST, history);
  assert.equal(messages[0].role, 'system');
  for (const s of SKILL_LIST) assert.ok(messages[0].content.includes(`id: ${s.id}`));
  assert.match(messages[0].content, /JSON/);
  assert.match(messages[0].content, /Не придумывай/);
  assert.equal(messages.length, 1 + 4 + 1);
  assert.equal(messages.at(-1).content, 'хочу чеканить');
  assert.equal(describeCatalog(SKILL_LIST).split('\n').length, SKILL_LIST.length);
});

test('reply text and next step in the route are deterministic', () => {
  assert.match(planReplyText(['squats'], SKILL_LIST), /Приседания/);
  assert.equal(nextInPlan(['balance', 'football'], 'balance'), 'football');
  assert.equal(nextInPlan(['balance', 'football'], 'football'), null);
  assert.equal(nextInPlan(['balance'], 'squats'), null);
  assert.equal(nextInPlan(undefined, 'squats'), null);
});

import { pluralize } from './coach-planner.js';
test('russian plural forms', () => {
  assert.equal(pluralize(1, ['шаг', 'шага', 'шагов']), '1 шаг');
  assert.equal(pluralize(3, ['шаг', 'шага', 'шагов']), '3 шага');
  assert.equal(pluralize(6, ['шаг', 'шага', 'шагов']), '6 шагов');
  assert.equal(pluralize(11, ['минута', 'минуты', 'минут']), '11 минут');
  assert.equal(pluralize(22, ['минута', 'минуты', 'минут']), '22 минуты');
});

test('answers to the coach\'s own question find a skill; Cyrillic word edges hold', () => {
  const plan = (q) => keywordPlan(q, SKILL_LIST).plan;
  assert.deepEqual(plan('ноги'), ['squats', 'lunges'], 'the coach asks «мяч, ноги, руки или пресс?»');
  assert.deepEqual(plan('мяч'), ['football']);
  assert.deepEqual(plan('равновесие'), ['balance']);
  assert.deepEqual(plan('хочу силу'), ['squats']);
  assert.deepEqual(plan('сильные ноги'), ['squats', 'lunges']);
  assert.deepEqual(plan('бью стопой'), ['football']);
  assert.deepEqual(plan('хочу много узнать'), [], 'a stem inside another word does not count');
  assert.deepEqual(plan('стоять на одной ноге'), ['balance'], 'one-leg stance is balance, not squats');
});

test('the new skills are found by their own words and ordered from simple to complex', () => {
  const plan = (q) => keywordPlan(q, SKILL_LIST).plan;
  assert.deepEqual(plan('хочу отжиматься'), ['pushups']);
  assert.deepEqual(plan('хочу накачать пресс'), ['plank']);
  assert.deepEqual(plan('сильные руки и пресс'), ['plank', 'pushups']);
  assert.deepEqual(plan('нужна разминка перед игрой'), ['jacks']);
  assert.deepEqual(plan('хочу улучшить выносливость и бег'), ['highknees']);
  assert.deepEqual(plan('выпады'), ['lunges']);
  assert.deepEqual(plan('хочу похудеть, кардио'), ['jacks', 'highknees']);
  assert.deepEqual(plan('у меня плохая осанка и слабая спина'), ['plank']);
});
