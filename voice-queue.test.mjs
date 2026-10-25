import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceQueue, VOICE_PRIORITY } from './app/voice-queue.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let clock = 0; const started = []; let stops = 0;
  const queue = createVoiceQueue({ start: (text, item, done) => { started.push({ text, done }); return true; }, stop: () => { stops += 1; }, now: () => clock });
  return { queue, started, get stops() { return stops; }, advance(ms) { clock += ms; } };
}

test('a new phrase never cuts off the one being spoken', async () => {
  const h = harness();
  assert.equal(h.queue.say('Шаг 2: пять приседаний.', { priority: VOICE_PRIORITY.lesson }), 'spoken');
  assert.equal(h.queue.say('Повтор 5.', { priority: VOICE_PRIORITY.success }), 'queued');
  assert.equal(h.started.length, 1, 'the second phrase waits');
  assert.equal(h.stops, 0, 'nothing was stopped');
  h.started[0].done(); await tick();
  assert.equal(h.started.length, 2);
  assert.equal(h.started[1].text, 'Повтор 5.');
});

test('one phrase waits; a more important one replaces it, a less important one is dropped', () => {
  const h = harness();
  h.queue.say('Шаг 1.', { priority: 3 });
  h.queue.say('Молодец.', { priority: 1 });
  assert.equal(h.queue.say('Колени наружу.', { priority: 2 }), 'queued');
  assert.equal(h.queue.pending, 'Колени наружу.');
  assert.equal(h.queue.say('Повтор 10.', { priority: 1 }), 'dropped');
  assert.equal(h.queue.pending, 'Колени наружу.');
});

test('a stale phrase is not said late', async () => {
  const h = harness();
  h.queue.say('Длинная фраза про технику.', { priority: 3 });
  h.queue.say('Повтор 5.', { priority: 1 });
  h.advance(6000);
  h.started[0].done(); await tick();
  assert.equal(h.started.length, 1, 'praise from six seconds ago is dropped');
  assert.equal(h.queue.busy, false);
});

test('stop silences the voice and forgets the waiting phrase; late callbacks are ignored', async () => {
  const h = harness();
  h.queue.say('Раз.', { priority: 2 }); h.queue.say('Два.', { priority: 2 });
  h.queue.stop();
  assert.equal(h.stops, 1); assert.equal(h.queue.pending, null); assert.equal(h.queue.busy, false);
  h.started[0].done(); await tick();
  assert.equal(h.started.length, 1, 'the old phrase finishing does not start the forgotten one');
  assert.equal(h.queue.say('Три.'), 'spoken');
});

test('a phrase that could not start frees the voice', async () => {
  let clock = 0; const texts = [];
  const queue = createVoiceQueue({ start: async (text) => { texts.push(text); return false; }, now: () => clock });
  queue.say('Не прозвучит.');
  await tick(); await tick();
  assert.equal(queue.busy, false);
  assert.equal(queue.say('Следующая.'), 'spoken');
});
