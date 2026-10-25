import test from 'node:test';
import assert from 'node:assert/strict';
import { russianVoices, selectedVoice, configureUtterance, createVoiceQuestion } from './app/speech.js';
const voices = [{ lang: 'en-US', name: 'English', voiceURI: 'en' }, { lang: 'ru-RU', name: 'Первый', voiceURI: 'ru1', default: true }, { lang: 'ru_RU', name: 'Второй', voiceURI: 'ru2' }];
function fixture(extra = {}) {
  const instances = [], texts = [], states = [], timers = new Set();
  class Recognition { constructor() { instances.push(this); } start() { this.started = true; this.onstart?.(); } abort() { this.aborted = true; } }
  const input = createVoiceQuestion({ Recognition, onText: t => texts.push(t), onState: (s, m) => states.push([s, m]), setTimer: fn => { timers.add(fn); return fn; }, clearTimer: fn => timers.delete(fn), ...extra });
  return { input, instances, texts, states, timers };
}
test('voice choice selects the saved Russian voice and falls back when it disappears', () => {
  assert.equal(russianVoices(voices).length, 2); assert.equal(selectedVoice(voices, 'ru2').name, 'Второй');
  assert.equal(selectedVoice(voices, 'missing').voiceURI, 'ru1'); assert.equal(selectedVoice([], 'missing'), null);
  const utterance = configureUtterance({}, { voiceId: 'ru2' }, { voiceRate: 1.1, voicePitch: .9 }, voices);
  assert.equal(utterance.voice.voiceURI, 'ru2'); assert.equal(utterance.lang, 'ru-RU'); assert.equal(utterance.rate, 1.1);
});
test('saved speech speed and mute volume apply to browser speech', () => {
  const utterance = configureUtterance({}, { voiceRate: 1.4, voiceVolume: 0 }, { voiceRate: .9, voicePitch: 1 }, voices);
  assert.equal(utterance.rate, 1.4); assert.equal(utterance.volume, 0);
});
test('microphone starts only on explicit start, handles one final result and releases recognition', () => {
  const f = fixture(); assert.equal(f.instances.length, 0);
  f.input.start(); const r = f.instances[0]; assert.equal(r.lang, 'ru-RU'); assert.equal(r.continuous, false);
  const callback = r.onresult;
  callback({ resultIndex: 0, results: [{ 0: { transcript: 'Сколько получилось?' }, isFinal: true }] });
  callback({ results: [{ 0: { transcript: 'Поздний результат' }, isFinal: true }] });
  assert.deepEqual(f.texts, ['Сколько получилось?']); assert.equal(r.aborted, true); assert.equal(f.input.listening, false); assert.equal(f.timers.size, 0);
});
test('denied microphone/network errors show an actionable error without restarting', () => {
  for (const error of ['not-allowed', 'network', 'audio-capture']) {
    const f = fixture(); f.input.start(); f.instances[0].onerror({ error });
    assert.equal(f.instances.length, 1); assert.equal(f.input.listening, false); assert.equal(f.texts.length, 0);
    assert.equal(f.states.at(-1)[0], 'error'); assert.match(f.states.at(-1)[1], /вопрос/);
  }
});
test('stop/navigation aborts the mic and invalidates late result callbacks', () => {
  const f = fixture(); f.input.start(); const old = f.instances[0].onresult;
  f.input.abort(); old({ results: [{ 0: { transcript: 'Поздний вопрос' }, isFinal: true }] });
  assert.deepEqual(f.texts, []); assert.equal(f.timers.size, 0); assert.equal(f.instances[0].aborted, true);
});
test('silence timeout and recognition end both release the mic', () => {
  const f = fixture(); f.input.start(); [...f.timers][0](); assert.equal(f.input.listening, false);
  f.input.start(); f.instances.at(-1).onend(); assert.equal(f.input.listening, false); assert.equal(f.timers.size, 0);
});
test('unsupported or throwing recognition gracefully leaves typed questions available', () => {
  const f = fixture({ Recognition: null }); f.input.start(); assert.equal(f.input.supported, false); assert.match(f.states.at(-1)[1], /Напиши вопрос/);
  const broken = fixture({ Recognition: class { constructor() { throw new Error('disabled'); } } });
  assert.doesNotThrow(() => broken.input.start()); assert.equal(broken.states.at(-1)[0], 'error');
});
