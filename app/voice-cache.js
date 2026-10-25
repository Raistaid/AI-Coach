import { voiceFiles } from './voice-models.js';

export function createVoiceStore({ getDirectory = () => navigator.storage.getDirectory(), fetcher = (...args) => fetch(...args) } = {}) {
  const directory = async () => (await getDirectory()).getDirectoryHandle('aimo-voices-v1', { create: true });
  async function read(voice) {
    const dir = await directory();
    const files = await Promise.all(voiceFiles(voice).map(async spec => {
      const file = await (await dir.getFileHandle(spec.name)).getFile();
      if (file.size !== spec.bytes) throw new Error('Голос ещё не скачан полностью.');
      return file;
    }));
    const config = JSON.parse(await files[0].text());
    if (config.espeak?.voice !== 'ru' || !Number.isFinite(config.audio?.sample_rate)) throw new Error('Некорректная модель голоса.');
    return { config, model: files[1] };
  }
  return {
    read,
    async has(voice) { try { await read(voice); return true; } catch { return false; } },
    async download(voice, { signal, onProgress = () => {} } = {}) {
      const dir = await directory(); let done = 0;
      const specs = voiceFiles(voice), total = specs.reduce((n, file) => n + file.bytes, 0);
      for (const spec of specs) {
        signal?.throwIfAborted();
        const response = await fetcher(spec.url, { signal });
        if (!response.ok || !response.body) throw new Error('Не удалось скачать голос. Проверь интернет и свободное место.');
        const reader = response.body.getReader(); const handle = await dir.getFileHandle(spec.name, { create: true });
        const writer = await handle.createWritable(); let received = 0;
        try {
          for (;;) {
            signal?.throwIfAborted(); const { done: finished, value } = await reader.read(); if (finished) break;
            received += value.byteLength;
            if (received > spec.bytes) throw new Error('Размер модели голоса не совпал с ожидаемым.');
            await writer.write(value); onProgress((done + received) / total);
          }
          if (received !== spec.bytes) throw new Error('Голос скачался не полностью. Попробуй ещё раз.');
          signal?.throwIfAborted(); await writer.close(); done += received;
        } catch (error) { try { await writer.abort(); } catch { /* closed */ } try { await reader.cancel(); } catch { /* disconnected */ } throw error; }
      }
      await read(voice); signal?.throwIfAborted(); onProgress(1);
    },
  };
}
