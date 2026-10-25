import { LOCAL_VOICES, localVoice } from './voice-models.js';
import { createVoiceStore } from './voice-cache.js';
import { configureUtterance } from './speech.js';

const abortError = () => new DOMException('Озвучивание отменено', 'AbortError');

export function createTrainerAudio({ store = createVoiceStore(), makeWorker = () => new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' }), makeContext = () => new (window.AudioContext || window.webkitAudioContext)(), synth = () => globalThis.speechSynthesis } = {}) {
  const listeners = new Set();
  const states = Object.fromEntries(LOCAL_VOICES.map(v => [v.id, { status: 'unknown', progress: 0 }]));
  const versions = Object.fromEntries(LOCAL_VOICES.map(v => [v.id, 0]));
  let audioContext, worker, workerVoice, request = null, source, download = null, serial = 0, nextId = 0, playing = false;
  let status = '';
  const notify = message => { if (message !== undefined) status = message; for (const fn of listeners) fn(); };
  function stopWorker(error = abortError()) { const old = request; request = null; worker?.terminate(); worker = null; workerVoice = null; if (old) { clearTimeout(old.timer); old.reject(error); } }
  function cancel({ release = false } = {}) {
    serial++; playing = false; synth()?.cancel();
    if (source) { try { source.stop(); } catch { /* ended */ } source.disconnect(); source = null; }
    if (request || release) stopWorker();
  }
  function unlock() {
    try { audioContext ??= makeContext(); if (audioContext.state === 'suspended') audioContext.resume().catch(() => {}); } catch { /* system speech remains available */ }
  }
  function generate(text, voice, rate, timeoutMs) {
    if (workerVoice !== voice.id) stopWorker();
    worker ??= makeWorker(); workerVoice = voice.id;
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      request = { id, resolve, reject, timer: setTimeout(() => stopWorker(new Error('Локальный голос не ответил вовремя.')), timeoutMs) };
      worker.onmessage = ({ data }) => {
        if (!request || data.id !== request.id) return;
        if (data.type === 'status') { notify(data.message); return; }
        if (!['audio', 'error'].includes(data.type)) return;
        const current = request; request = null; clearTimeout(current.timer);
        if (data.type === 'error') current.reject(new Error(data.message));
        else if (data.type === 'audio') current.resolve(data);
      };
      worker.onerror = () => { const current = request; request = null; if (current) { clearTimeout(current.timer); current.reject(new Error('Не удалось запустить локальный голос.')); } stopWorker(); };
      worker.postMessage({ id, voiceId: voice.id, text, rate });
    });
  }
  const systemSpeak = (text, prefs, personality) => {
    const service = synth(); if (!service || typeof SpeechSynthesisUtterance === 'undefined') return false;
    service.speak(configureUtterance(new SpeechSynthesisUtterance(text), prefs, personality, service.getVoices())); return true;
  };
  return {
    get supported() { return Boolean(globalThis.navigator?.storage?.getDirectory && typeof Worker !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext)); },
    get speaking() { return playing || Boolean(request) || Boolean(synth()?.speaking); },
    get downloading() { return Boolean(download); },
    get status() { return status; },
    get states() { return Object.fromEntries(Object.entries(states).map(([key, value]) => [key, { ...value }])); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    unlock,
    cancel,
    async refresh() {
      for (const voice of LOCAL_VOICES) {
        if (download?.voiceId === voice.id) continue;
        const version = versions[voice.id];
        const cached = await store.has(voice);
        if (download?.voiceId === voice.id || version !== versions[voice.id]) continue;
        states[voice.id] = { status: cached ? 'cached' : 'missing', progress: cached ? 1 : 0 }; notify();
      }
    },
    async downloadVoice(id) {
      const voice = localVoice(id); if (!voice) throw new Error('Неизвестный голос.');
      if (download) throw new Error('Дождись текущего скачивания.');
      versions[id]++;
      const controller = new AbortController(); download = { voiceId: id, controller, promise: null };
      states[id] = { status: 'downloading', progress: 0 }; notify(`Скачиваем голос «${voice.name}»…`);
      const job = store.download(voice, { signal: controller.signal, onProgress(progress) { if (controller.signal.aborted) return; states[id].progress = progress; notify(`Скачивание голоса: ${Math.floor(progress * 100)}%`); } });
      download.promise = job;
      try { await job; if (!await store.has(voice)) throw new Error('Не удалось сохранить голос. Попробуй скачать ещё раз.'); controller.signal.throwIfAborted(); states[id] = { status: 'cached', progress: 1 }; notify(`Голос «${voice.name}» скачан. Нажми «Прослушать голос».`); }
      catch (error) { states[id] = { status: 'missing', progress: 0 }; notify(error.name === 'AbortError' ? 'Скачивание голоса отменено.' : error.message); throw error; }
      finally { download = null; notify(); }
    },
    async cancelDownload() { const job = download; if (!job) return; job.controller.abort(); try { await job.promise; } catch { /* cancelled */ } },
    async speak(raw, prefs, personality, { timeoutMs = 45000 } = {}) {
      const text = String(raw || '').trim().slice(0, 280); if (!text) return false;
      cancel(); const run = serial; const voice = localVoice(prefs.voiceId);
      if (!voice) return systemSpeak(text, prefs, personality);
      unlock();
      try {
        if (!await store.has(voice)) throw new Error('Сначала скачай выбранный голос. Пока используется голос браузера.');
        if (run !== serial) return false;
        playing = true; notify('Готовим озвучивание…');
        const data = await generate(text, voice, personality.voiceRate, timeoutMs);
        if (run !== serial) return false;
        if (!audioContext || audioContext.state !== 'running') throw new Error('Нажми «Прослушать голос», чтобы разрешить звук.');
        const pcm = new Float32Array(data.pcm);
        if (!pcm.length || pcm.some(n => !Number.isFinite(n)) || !Number.isFinite(data.sampleRate) || data.sampleRate < 8000 || data.sampleRate > 48000) throw new Error('Голос вернул некорректный звук.');
        const buffer = audioContext.createBuffer(1, pcm.length, data.sampleRate); buffer.copyToChannel(pcm, 0);
        source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination);
        source.onended = () => { if (run === serial) { playing = false; source?.disconnect(); source = null; notify('Озвучивание завершено.'); } };
        source.start(); notify(`Говорит ${voice.name}`); return true;
      } catch (error) {
        if (run !== serial || error.name === 'AbortError') return false;
        playing = false; stopWorker(); notify(`${error.message} Используем системный голос.`);
        return systemSpeak(text, prefs, personality);
      }
    },
    async release() { cancel({ release: true }); try { await audioContext?.suspend(); } catch { /* closed */ } },
    async dispose() { await this.cancelDownload(); await this.release(); try { await audioContext?.close(); } catch { /* closed */ } audioContext = null; },
  };
}

export const trainerAudio = createTrainerAudio();
