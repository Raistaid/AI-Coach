// Chat screen: a thread with the coach, like a direct-message conversation.
// The coach answers from the skill planner (keywords or the local LLM); every
// message is stored on the device. Live sessions post their summary here.
import { SKILL_LIST, getSkill, PERSONALITIES } from '../skills/index.js';
import { keywordPlan, buildPlannerMessages, parsePlan, planReplyText, pluralize } from '../coach-planner.js';
import { $, text, el, icon, toast, haptic, bus, timeLabel, relativeDate, formatTime } from './ui.js';
import * as store from './store.js';

const ctx = { prefs: null, profile: null, history: [], chats: [], thread: null, ensureLiveCoach: null, getLiveCoach: null, busy: false, llmHistory: [] };
const steps = (n) => pluralize(n, ['шаг', 'шага', 'шагов']);

export function initChat({ prefs, profile, history, ensureLiveCoach, getLiveCoach }) {
  Object.assign(ctx, { prefs, profile, history, ensureLiveCoach, getLiveCoach });
  ctx.chats = store.loadChats();
  $('chatForm').addEventListener('submit', (event) => { event.preventDefault(); send($('chatInput').value); });
  $('newChatBtn').addEventListener('click', () => { newThread(); haptic(); toast('Новый чат'); });
  $('drawerNew').addEventListener('click', () => { newThread(); bus.emit('drawer', false); });
  $('drawerClear').addEventListener('click', () => {
    if (!ctx.chats.length) return;
    ctx.chats = []; store.saveChats([]); openFresh(); toast('Чаты удалены');
  });
  $('chatList').addEventListener('scroll', () => { /* keep native momentum */ }, { passive: true });
}

export function setProfile(profile) { ctx.profile = profile; }
export function setHistory(history) { ctx.history = history; renderStories(); }
export function currentThread() { return ctx.thread; }

function greetingText() {
  const name = ctx.profile?.name || 'друг';
  return `${store.greeting(name)} Я твой тренер. Напиши, чему хочешь научиться, или выбери навык в кружках сверху.`;
}

/** App start: reuse an untouched chat, otherwise open a new one. */
export function openFresh() {
  const { chats, thread } = store.freshThread(ctx.chats, greetingText());
  ctx.chats = chats; ctx.thread = thread; ctx.llmHistory = [];
  store.saveChats(chats); renderThread(); renderDrawer(); renderStories();
}
export function newThread() {
  const thread = store.createThread(greetingText());
  ctx.chats = [thread, ...ctx.chats].slice(0, store.MAX_THREADS); ctx.thread = thread; ctx.llmHistory = [];
  store.saveChats(ctx.chats); renderThread(); renderDrawer();
}
export function openThread(id) {
  const thread = ctx.chats.find(t => t.id === id); if (!thread) return;
  ctx.thread = thread; ctx.llmHistory = [];
  renderThread(); renderDrawer();
}
function deleteThread(id) {
  ctx.chats = ctx.chats.filter(t => t.id !== id); store.saveChats(ctx.chats);
  if (ctx.thread?.id === id) openFresh(); else renderDrawer();
  toast('Чат удалён');
}
function persist() { ctx.chats = store.replaceThread(ctx.chats, ctx.thread); store.saveChats(ctx.chats); }
function push(message) {
  const { thread, message: msg } = store.appendMessage(ctx.thread, message);
  ctx.thread = thread; persist(); appendNode(msg); renderDrawer();
  return msg;
}

/* ───────────── Rendering ───────────── */

function renderThread() {
  const list = $('chatList'); list.replaceChildren();
  let lastDay = '';
  for (const message of ctx.thread.messages) {
    const day = relativeDate(message.at);
    if (day !== lastDay) { list.append(el('div', 'day-sep', day)); lastDay = day; }
    list.append(messageNode(message));
  }
  text('chatSub', `${PERSONALITIES[ctx.prefs.personality].name} тренер · ИИ на устройстве`);
  renderChips(); scrollBottom();
}
function appendNode(message) {
  const list = $('chatList');
  const day = relativeDate(message.at);
  const lastSep = [...list.querySelectorAll('.day-sep')].at(-1);
  if (!lastSep || lastSep.textContent !== day) list.append(el('div', 'day-sep', day));
  list.append(messageNode(message)); renderChips(); scrollBottom();
}
function scrollBottom() { const list = $('chatList'); requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; }); }

function messageNode(message) {
  if (message.role === 'system') return el('div', 'sys-msg', message.text);
  const mine = message.role === 'user';
  const wrap = el('div', `msg ${mine ? 'me' : 'them'} ${message.type}`);
  wrap.dataset.id = message.id;
  if (!mine) { const avatar = el('span', 'avatar tiny coach'); avatar.append(icon('i-spark')); wrap.append(avatar); }
  const bubble = el('div', 'bubble');
  if (message.type === 'text') bubble.append(el('p', null, message.text));
  if (message.type === 'route') bubble.append(routeCard(message.data || {}));
  if (message.type === 'skill') bubble.append(skillCard(message.data || {}));
  if (message.type === 'summary') bubble.append(summaryCard(message.data || {}));
  if (message.meta) bubble.append(el('small', 'msg-meta', message.meta));
  const foot = el('div', 'msg-foot');
  foot.append(el('time', 'msg-time', timeLabel(message.at)));
  if (message.liked) { const heart = el('span', 'msg-like'); heart.append(icon('i-heart')); foot.append(heart); }
  bubble.append(foot); wrap.append(bubble);
  if (!mine) wrap.addEventListener('dblclick', () => toggleLike(message.id, wrap));
  return wrap;
}
function toggleLike(id, node) {
  const thread = { ...ctx.thread, messages: ctx.thread.messages.map(m => (m.id === id ? { ...m, liked: !m.liked } : m)) };
  ctx.thread = thread; persist();
  const fresh = messageNode(thread.messages.find(m => m.id === id)); node.replaceWith(fresh);
  if (thread.messages.find(m => m.id === id).liked) { const burst = el('span', 'like-burst'); burst.append(icon('i-heart')); fresh.append(burst); setTimeout(() => burst.remove(), 900); haptic(8); }
}

function routeCard(data) {
  const plan = (data.plan || []).filter(id => SKILL_LIST.some(s => s.id === id));
  const card = el('div', 'card');
  card.append(el('b', 'card-title', data.goal ? `Маршрут: ${data.goal}` : 'Твой маршрут'));
  const list = el('ol', 'card-steps');
  plan.forEach(id => { const s = getSkill(id); list.append(el('li', null, `${s.emoji} ${s.name} · ${steps(s.lessons.length)} · ${s.minutes} мин`)); });
  card.append(list);
  if (plan.length) {
    const start = el('button', 'btn-primary small'); start.type = 'button';
    start.append(icon('i-camera'), document.createTextNode(` Начать: ${getSkill(plan[0]).name}`));
    start.addEventListener('click', () => bus.emit('start-live', { skillId: plan[0], mode: 'camera' }));
    card.append(start);
  }
  return card;
}
function skillCard(data) {
  const skill = getSkill(data.skillId);
  const card = el('div', 'card');
  const head = el('div', 'card-skill'); head.append(el('span', 'skill-emoji', skill.emoji));
  const copy = el('div'); copy.append(el('b', 'card-title', skill.name), el('small', null, `${skill.level} · ${steps(skill.lessons.length)} · ${skill.minutes} мин${skill.needsBall ? ' · нужен мяч' : ''}`));
  head.append(copy); card.append(head, el('p', 'card-text', skill.description));
  const row = el('div', 'card-row');
  const start = el('button', 'btn-primary small'); start.type = 'button'; start.append(icon('i-camera'), document.createTextNode(' Начать эфир'));
  start.addEventListener('click', () => bus.emit('start-live', { skillId: skill.id, mode: 'camera' }));
  const demo = el('button', 'btn-ghost small', 'Демо'); demo.type = 'button';
  demo.addEventListener('click', () => bus.emit('start-live', { skillId: skill.id, mode: 'demo' }));
  row.append(start, demo); card.append(row);
  return card;
}
function summaryCard(data) {
  const card = el('div', 'card summary');
  card.append(el('b', 'card-title', `${data.demo ? 'Демо' : 'Эфир'} · ${data.skillName || ''}`));
  const stats = el('div', 'card-stats');
  for (const [value, label] of [[formatTime(data.seconds || 0), 'в движении'], [String(data.metricValue ?? 0), data.metricLabel || ''], [`${data.lessonsDone ?? 0}/${data.lessonsTotal ?? 0}`, 'шагов']]) {
    const cell = el('div'); cell.append(el('b', null, value), el('span', null, label)); stats.append(cell);
  }
  card.append(stats);
  for (const [label, value] of [['Получилось', data.done], ['Главная ошибка', data.mistake], ['Следующий шаг', data.next]]) {
    if (!value) continue;
    const line = el('p', 'card-line'); line.append(el('b', null, `${label}: `), document.createTextNode(value)); card.append(line);
  }
  if (data.live) { const live = el('p', 'card-line llm'); live.append(el('span', 'badge-llm', 'живой тренер'), document.createTextNode(` ${data.live}`)); card.append(live); }
  if (data.demo) card.append(el('small', 'card-note', 'Симуляция на нарисованном спортсмене. В историю не записана.'));
  const again = el('button', 'btn-ghost small', data.demo ? 'Запустить эфир с камерой' : 'Повторить'); again.type = 'button';
  again.addEventListener('click', () => bus.emit('start-live', { skillId: data.skillId || ctx.prefs.skill, mode: 'camera' }));
  card.append(again);
  return card;
}

function renderChips() {
  const chips = $('chatChips'); chips.replaceChildren();
  const fresh = store.isFresh(ctx.thread);
  const items = fresh
    ? ['Хочу научиться чеканить, но мяч падает', 'Хочу укрепить ноги', 'Не знаю, с чего начать', 'Покажи демо']
    : ['Начать эфир', 'Покажи демо', 'Другая цель'];
  for (const label of items) {
    const chip = el('button', 'chip', label); chip.type = 'button';
    chip.addEventListener('click', () => send(label));
    chips.append(chip);
  }
}

export function renderStories() {
  const row = $('storiesRow'); row.replaceChildren();
  const seen = new Set(ctx.history.map(s => s.skill));
  for (const skill of SKILL_LIST) {
    const story = el('button', `story${seen.has(skill.id) ? ' seen' : ''}${ctx.prefs.plan.includes(skill.id) ? ' planned' : ''}`); story.type = 'button';
    story.setAttribute('aria-label', skill.name);
    const ring = el('span', 'story-ring'); ring.append(el('span', 'story-emoji', skill.emoji)); story.append(ring, el('span', 'story-name', skill.short || skill.name.split(' ')[0]));
    story.addEventListener('click', () => bus.emit('open-skill', skill.id));
    row.append(story);
  }
}

export function renderDrawer() {
  const list = $('drawerList'); list.replaceChildren();
  if (!ctx.chats.length) { list.append(el('p', 'drawer-empty', 'Здесь появится история чатов.')); return; }
  for (const thread of ctx.chats) {
    const item = el('div', `drawer-item${thread.id === ctx.thread?.id ? ' is-active' : ''}`);
    const open = el('button', 'drawer-open'); open.type = 'button';
    const emoji = el('span', 'drawer-emoji', thread.skill ? getSkill(thread.skill).emoji : '✦');
    const copy = el('div', 'drawer-copy');
    const last = thread.messages.at(-1);
    copy.append(el('b', null, store.threadTitle(thread)), el('small', null, last ? (last.type === 'text' ? last.text : last.type === 'summary' ? 'Итог эфира' : last.type === 'route' ? 'Маршрут' : 'Навык') : ''));
    const when = el('time', 'drawer-when', relativeDate(thread.updatedAt || thread.createdAt));
    open.append(emoji, copy, when);
    open.addEventListener('click', () => { openThread(thread.id); bus.emit('drawer', false); });
    const del = el('button', 'icon-btn drawer-del'); del.type = 'button'; del.setAttribute('aria-label', 'Удалить чат'); del.append(icon('i-trash'));
    del.addEventListener('click', (event) => { event.stopPropagation(); deleteThread(thread.id); });
    item.append(open, del); list.append(item);
  }
}

/* ───────────── Conversation ───────────── */

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
function setTyping(on) { $('chatTyping').hidden = !on; if (on) scrollBottom(); }

async function coachSays(message, extra = {}) {
  setTyping(true); await wait(350 + Math.min(900, message.length * 12)); setTyping(false);
  return push({ role: 'coach', type: 'text', text: message, ...extra });
}

export async function send(raw) {
  const query = String(raw || '').trim();
  if (!query || ctx.busy) return;
  ctx.busy = true; $('chatSend').disabled = true;
  $('chatInput').value = ''; haptic(6);
  push({ role: 'user', type: 'text', text: query });
  const q = query.toLowerCase();
  try {
    if (/^(покажи )?демо/.test(q)) {
      await coachSays('Запускаю демо на нарисованном спортсмене. Это симуляция интерфейса, а не анализ камеры.');
      bus.emit('start-live', { skillId: ctx.prefs.skill, mode: 'demo' });
    } else if (/^(начать эфир|начни|поехали|старт|начать)/.test(q)) {
      const skill = getSkill(ctx.prefs.skill);
      await coachSays(`Открываю эфир: ${skill.name}. ${skill.camera}`);
      bus.emit('start-live', { skillId: skill.id, mode: 'camera' });
    } else if (/не знаю|с чего начать|помоги выбрать/.test(q)) {
      await coachSays('Давай так: что ближе одним словом, мяч, ноги или равновесие? Или нажми на навык в кружках сверху, расскажу о нём.');
    } else if (/^(другая цель|другой навык)/.test(q)) {
      await coachSays('Напиши новую цель своими словами, соберу маршрут заново.');
    } else if (/^(привет|здравствуй|хай|йо)/.test(q)) {
      await coachSays(`Привет, ${ctx.profile.name}! Чему хочешь научиться сегодня?`);
    } else {
      await plan(query);
    }
  } finally { ctx.busy = false; $('chatSend').disabled = false; }
}

async function plan(query) {
  setTyping(true);
  let result = null;
  if (ctx.prefs.liveCoach) {
    try {
      const coach = await ctx.ensureLiveCoach();
      const raw = await coach.chat(buildPlannerMessages(query, SKILL_LIST, ctx.llmHistory), { maxTokens: 220 });
      const parsed = parsePlan(raw, SKILL_LIST);
      if (parsed.ok) result = parsed; else console.warn('Aimo planner: LLM reply rejected,', parsed.reason);
    } catch (error) { console.warn('Aimo planner: LLM unavailable', error?.message); }
  } else await wait(500);
  const viaLlm = Boolean(result);
  if (!result) result = keywordPlan(query, SKILL_LIST);
  const reply = result.reply || planReplyText(result.plan, SKILL_LIST);
  ctx.llmHistory.push({ role: 'user', content: query }, { role: 'assistant', content: reply });
  setTyping(false);
  push({ role: 'coach', type: 'text', text: reply, meta: viaLlm ? 'живой тренер · проверено по каталогу' : ctx.prefs.liveCoach ? 'подбор по ключевым словам' : '' });
  if (result.plan.length) {
    ctx.prefs.plan = result.plan; ctx.prefs.planGoal = query; ctx.prefs.skill = result.plan[0]; store.savePrefs(ctx.prefs);
    push({ role: 'coach', type: 'route', data: { plan: result.plan, goal: query }, skill: result.plan[0] });
    bus.emit('prefs-changed'); renderStories();
  }
}

/** Called by the skill sheet: the coach introduces a skill inside the chat. */
export async function introduceSkill(skillId) {
  const skill = getSkill(skillId);
  ctx.prefs.skill = skill.id; store.savePrefs(ctx.prefs); bus.emit('prefs-changed');
  push({ role: 'coach', type: 'skill', data: { skillId: skill.id }, skill: skill.id });
}

/** Called when a live session ends. */
export function postSummary(data) {
  push({ role: 'system', type: 'text', text: `${data.demo ? 'Демо' : 'Эфир'} завершён · ${formatTime(data.seconds || 0)}` });
  push({ role: 'coach', type: 'summary', data, skill: data.skillId });
}
export function postSystem(message) { push({ role: 'system', type: 'text', text: message }); }
