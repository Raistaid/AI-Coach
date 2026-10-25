// Single-threaded CPU speech. Neither text nor audio is sent to a TTS service.
import { localVoice } from './voice-models.js';
import { createVoiceStore } from './voice-cache.js';

const PHONEMIZER = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-o91UDS6e.js';
const PHONEME_ASSETS = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
let engine = null, ort, phonemize, config, activeVoice;

self.onmessage = async ({ data }) => {
  const { id, voiceId, text, rate = 1 } = data;
  try {
    const voice = localVoice(voiceId);
    if (!voice || typeof text !== 'string' || !text.trim() || text.length > 280) throw new Error('Некорректный запрос озвучивания.');
    if (!engine || activeVoice !== voiceId) {
      const stored = await createVoiceStore().read(voice); // no implicit model download
      self.postMessage({ id, type: 'status', message: 'Подготавливаем локальный голос…' });
      const [runtime, module] = await Promise.all([import('https://esm.sh/onnxruntime-web@1.18.0/wasm'), import(PHONEMIZER)]);
      ort = runtime.default || runtime; phonemize = module.createPiperPhonemize;
      ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
      if (engine) await engine.release();
      config = stored.config;
      engine = await ort.InferenceSession.create(await stored.model.arrayBuffer(), { executionProviders: ['wasm'] });
      activeVoice = voiceId;
    }
    let ids;
    const module = await phonemize({
      print(value) { const result = JSON.parse(value); if (Array.isArray(result.phoneme_ids)) ids = result.phoneme_ids; },
      printErr() {},
      locateFile(url) { return url.endsWith('.wasm') ? `${PHONEME_ASSETS}.wasm` : url.endsWith('.data') ? `${PHONEME_ASSETS}.data` : url; },
    });
    module.callMain(['-l', config.espeak.voice, '--input', JSON.stringify([{ text: text.trim() }]), '--espeak_data', '/espeak-ng-data']);
    if (!ids?.length || ids.some(n => !Number.isSafeInteger(n))) throw new Error('Не удалось подготовить произношение.');
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([ids.length], BigInt), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([config.inference.noise_scale, config.inference.length_scale / Math.max(.5, Math.min(1.5, rate)), config.inference.noise_w]), [3]),
    };
    const result = await engine.run(feeds);
    const pcm = new Float32Array(result.output.data);
    if (!pcm.length || pcm.some(n => !Number.isFinite(n))) throw new Error('Не удалось синтезировать звук.');
    self.postMessage({ id, type: 'audio', pcm: pcm.buffer, sampleRate: config.audio.sample_rate }, [pcm.buffer]);
  } catch (error) { self.postMessage({ id, type: 'error', message: error.message || 'Голос недоступен на этом устройстве.' }); }
};
