import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainerAudio } from './app/trainer-audio.js';
import { LOCAL_VOICES, voiceFiles } from './app/voice-models.js';
import { createVoiceStore } from './app/voice-cache.js';
const voice = LOCAL_VOICES[0], other = LOCAL_VOICES[1], personality = { voiceRate: 1, voicePitch: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(store = { has: async () => true }) {
  const workers = [], sources = [], spoken = [];
  const context = { state: 'running', destination: {}, createBuffer: (_, count, rate) => ({ count, rate, copyToChannel(pcm) { this.pcm = pcm; } }), createBufferSource() { const s = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } }; sources.push(s); return s; }, async suspend() { this.state = 'suspended'; }, async resume() { this.state = 'running'; }, async close() { this.state = 'closed'; } };
  const service = { cancel() {}, getVoices: () => [{ lang: 'ru-RU', voiceURI: 'milena', name: 'Милена' }], speak: u => spoken.push(u) };
  const audio = createTrainerAudio({ store, makeWorker() { const w = { postMessage(data) { this.sent = data; }, terminate() { this.terminated = true; } }; workers.push(w); return w; }, makeContext: () => context, synth: () => service });
  return { audio, workers, sources, spoken, context, reply(data = {}) { const w = workers.at(-1); w.onmessage({ data: { id: w.sent.id, type: 'audio', pcm: Float32Array.from([0, .1, -.1]).buffer, sampleRate: 22050, ...data } }); } };
}
// Keep native fallback observable without requesting any OS speech in Node.
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
test('selected downloaded speaker produces PCM playback with the real selected ID', async () => {
  const h = harness(); const result = h.audio.speak('Привет', { voiceId: voice.id }, personality); await tick();
  assert.equal(h.workers[0].sent.voiceId, voice.id); assert.equal(h.workers[0].sent.text, 'Привет');
  assert.equal(h.audio.speaking, true); h.reply(); assert.equal(await result, true);
  assert.equal(h.sources[0].started, true); assert.equal(h.sources[0].buffer.rate, 22050); assert.equal(h.spoken.length, 0);
  h.sources[0].onended(); assert.equal(h.audio.speaking, false); await h.audio.dispose();
});
test('cancel terminates pending inference and ignores its late audio, without speaking fallback', async () => {
  const h = harness(); const result = h.audio.speak('Стоп', { voiceId: voice.id }, personality); await tick();
  h.audio.cancel(); h.reply(); assert.equal(await result, false); assert.equal(h.workers[0].terminated, true);
  assert.equal(h.sources.length, 0); assert.equal(h.spoken.length, 0);
});
test('switching speaker replaces worker; release stops playback and unloads model', async () => {
  const h = harness(); let result = h.audio.speak('Раз', { voiceId: voice.id }, personality); await tick(); h.reply(); await result;
  result = h.audio.speak('Два', { voiceId: other.id }, personality); await tick();
  assert.equal(h.sources[0].stopped, true); assert.equal(h.workers[0].terminated, true); assert.equal(h.workers[1].sent.voiceId, other.id);
  h.reply(); await result; await h.audio.release(); assert.equal(h.sources[1].stopped, true); assert.equal(h.workers[1].terminated, true); assert.equal(h.context.state, 'suspended');
});
test('uncached speaker falls back to Russian system voice without implicit download', async () => {
  const h = harness({ has: async () => false, download() { assert.fail('implicit download'); } });
  assert.equal(await h.audio.speak('Текст', { voiceId: voice.id }, personality), true);
  assert.equal(h.workers.length, 0); assert.equal(h.spoken[0].voice.name, 'Милена'); assert.match(h.audio.status, /скачай/);
});
test('worker errors, invalid PCM and timeout use the system fallback', async () => {
  for (const mode of ['error', 'invalid', 'timeout']) {
    const h = harness(); const result = h.audio.speak('Подсказка', { voiceId: voice.id }, personality, { timeoutMs: mode === 'timeout' ? 10 : 1000 }); await tick();
    if (mode === 'error') h.reply({ type: 'error', message: 'WASM недоступен' });
    if (mode === 'invalid') h.reply({ pcm: Float32Array.from([NaN]).buffer });
    assert.equal(await result, true); assert.equal(h.spoken.length, 1); assert.equal(h.sources.length, 0); assert.equal(h.workers[0].terminated, true);
  }
});
test('system voice selection preserves the native voice', async () => {
  const h = harness(); await h.audio.speak('Текст', { voiceId: 'milena' }, personality);
  assert.equal(h.spoken[0].voice.voiceURI, 'milena'); assert.equal(h.workers.length, 0);
});
test('download is not marked ready unless cache verification succeeds', async () => {
  const h = harness({ has: async () => false, download: async () => {} });
  await assert.rejects(h.audio.downloadVoice(voice.id), /сохранить/);
  assert.equal(h.audio.states[voice.id].status, 'missing'); assert.equal(h.audio.downloading, false);
});
test('cancelled downloads remain missing and do not report success', async () => {
  const h = harness({ has: async () => true, download: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
  const pending = h.audio.downloadVoice(voice.id); const checked = assert.rejects(pending, { name: 'AbortError' });
  await h.audio.cancelDownload(); await checked; assert.equal(h.audio.states[voice.id].status, 'missing'); assert.equal(h.audio.downloading, false);
});
test('late initial cache check cannot overwrite completed download', async () => {
  let resolveCheck, first = true;
  const h = harness({ has: async () => { if (first) { first = false; return new Promise(resolve => { resolveCheck = resolve; }); } return true; }, download: async () => {} });
  const check = h.audio.refresh(); await h.audio.downloadVoice(voice.id); resolveCheck(false); await check;
  assert.equal(h.audio.states[voice.id].status, 'cached');
});
function fakeFiles() {
  const files = new Map();
  const dir = { async getDirectoryHandle() { return dir; }, async getFileHandle(name, options) {
    if (!files.has(name) && !options?.create) throw new Error('missing');
    return { async getFile() { return files.get(name) || new Blob(); }, async createWritable() { const parts = []; return { async write(data) { parts.push(data); }, async close() { files.set(name, new Blob(parts)); }, async abort() {} }; } };
  } };
  return { dir, files };
}
const config = JSON.stringify({ espeak: { voice: 'ru' }, audio: { sample_rate: 22050 } });
const tinyVoice = { ...voice, configBytes: new TextEncoder().encode(config).length, modelBytes: 3 };
const responseFor = url => new Response(url.endsWith('.json') ? config : new Uint8Array([1, 2, 3]));
test('cache verifies both files, parses config and reports durable completed progress', async () => {
  const { dir, files } = fakeFiles(), progress = [];
  const store = createVoiceStore({ getDirectory: async () => dir, fetcher: async url => responseFor(url) });
  assert.equal(await store.has(tinyVoice), false); await store.download(tinyVoice, { onProgress: n => progress.push(n) });
  assert.equal(await store.has(tinyVoice), true); assert.equal(files.size, 2); assert.equal(progress.at(-1), 1);
  files.set(voiceFiles(tinyVoice)[1].name, new Blob([new Uint8Array([1])])); assert.equal(await store.has(tinyVoice), false);
});
test('truncated network response does not become a downloaded voice', async () => {
  const { dir } = fakeFiles(); const store = createVoiceStore({ getDirectory: async () => dir, fetcher: async url => url.endsWith('.json') ? responseFor(url) : new Response(new Uint8Array([1])) });
  await assert.rejects(store.download(tinyVoice), /не полностью/); assert.equal(await store.has(tinyVoice), false);
});
test('aborted fetch and unavailable storage are handled without a false ready state', async () => {
  const { dir } = fakeFiles(); const controller = new AbortController(); controller.abort();
  const store = createVoiceStore({ getDirectory: async () => dir, fetcher: async () => assert.fail('aborted fetch') });
  await assert.rejects(store.download(tinyVoice, { signal: controller.signal }), { name: 'AbortError' });
  const unavailable = createVoiceStore({ getDirectory: async () => { throw new Error('storage denied'); } });
  assert.equal(await unavailable.has(tinyVoice), false); await assert.rejects(unavailable.download(tinyVoice), /storage denied/);
});
