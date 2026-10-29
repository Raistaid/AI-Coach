import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { localVoice } from './app/voice-models.js';

const browserBundle = await readFile(new URL('./app/vendor/ort.wasm-1.18.0.min.js', import.meta.url), 'utf8');
const script = await readFile(new URL('./app/tts-worker.js', import.meta.url), 'utf8');
// Replace only module loading so the actual classic-worker message handler runs
// in a browser-like VM without Node globals or real network/storage access.
function harness({ missing = false, brokenRuntime = false } = {}) {
  const messages = [], imports = [], sessions = [], feeds = [];
  let reads = 0, releases = 0;
  const runtime = {
    env: { wasm: {} },
    Tensor: class { constructor(type, data, shape) { Object.assign(this, { type, data, shape }); } },
    InferenceSession: { async create(buffer, options) {
      sessions.push({ buffer, options });
      return { async release() { releases++; }, async run(input) { feeds.push(input); return { output: { data: Float32Array.of(0, .1, -.1) } }; } };
    } },
  };
  const self = { postMessage: data => messages.push(data) };
  const context = vm.createContext({ self, Float32Array, BigInt64Array,
    importScripts(url) { imports.push(url); if (brokenRuntime) throw new Error('network unavailable'); vm.runInContext(browserBundle, context); self.ort = runtime; },
    async loadModule(url) {
      if (url === './voice-models.js') return { localVoice };
      if (url === './voice-cache.js') return { createVoiceStore: () => ({ async read() {
        reads++; if (missing) throw new Error('Голос ещё не скачан полностью.');
        return { config: { espeak: { voice: 'ru' }, audio: { sample_rate: 22050 }, inference: { noise_scale: .667, length_scale: 1, noise_w: .8 } }, model: new Blob(['model']) };
      } }) };
      assert.match(url, /piper-tts-web@1\.0\.5/);
      return { createPiperPhonemize: async options => ({ callMain() { options.print(JSON.stringify({ phoneme_ids: [1, 2, 3] })); } }) };
    },
  });
  vm.runInContext(script.replace(/\bimport\(/g, 'loadModule('), context);
  return { self, messages, imports, sessions, feeds, runtime, get reads() { return reads; }, get releases() { return releases; },
    send: (voiceId = 'piper:ru_RU-dmitri-medium', text = 'Привет') => self.onmessage({ data: { id: 7, voiceId, text, rate: .7 } }) };
}

test('classic worker loads browser ONNX bundle and produces PCM with saved speed', async () => {
  const h = harness(); await h.send();
  assert.deepEqual(h.imports, ['./vendor/ort.wasm-1.18.0.min.js']);
  assert.equal(h.runtime.env.wasm.numThreads, 1);
  assert.equal(h.runtime.env.wasm.proxy, false);
  assert.equal(h.runtime.env.wasm.wasmPaths, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/');
  assert.equal(h.sessions[0].options.executionProviders[0], 'wasm');
  assert.ok(Math.abs(h.feeds[0].scales.data[1] - 1 / .7) < .0001);
  assert.equal(h.messages.at(-1).type, 'audio');
  assert.equal(h.messages.at(-1).sampleRate, 22050);
  assert.equal(new Float32Array(h.messages.at(-1).pcm).length, 3);
  await h.send(); assert.equal(h.sessions.length, 1, 'reuse the prepared voice');
  await h.send('piper:ru_RU-denis-medium');
  assert.equal(h.sessions.length, 2); assert.equal(h.releases, 1);
  assert.equal(h.imports.length, 1);
});

test('worker reports unavailable cache/runtime and invalid requests without fake audio', async () => {
  for (const options of [{ missing: true }, { brokenRuntime: true }]) {
    const h = harness(options); await h.send();
    assert.equal(h.messages.at(-1).type, 'error');
    assert.equal(h.messages.some(m => m.type === 'audio'), false);
  }
  const h = harness(); await h.send('unknown');
  assert.equal(h.messages.at(-1).type, 'error'); assert.equal(h.reads, 0);
  await h.send('piper:ru_RU-dmitri-medium', ''); assert.equal(h.reads, 0);
});
