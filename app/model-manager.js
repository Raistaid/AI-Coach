// One loading worker at a time. Cache status comes from WebLLM, never from a
// localStorage flag. Dependency injection keeps lifecycle/race tests GPU-free.
export function createModelManager({ models, load, hasCached, canLoad = () => true, isLive = () => false, onChange = () => {} }) {
  const states = Object.fromEntries(Object.keys(models).map(key => [key, { status: 'unknown', progress: 0, message: 'Статус ещё не проверен' }]));
  const revisions = Object.fromEntries(Object.keys(models).map(key => [key, 0]));
  let loaded = null, pending = null, disposed = false, refreshId = 0;
  const notify = () => { if (!disposed) onChange(); };
  const checkAbort = task => { if (disposed || task.controller.signal.aborted) throw new DOMException('Загрузка отменена', 'AbortError'); };
  async function dropLoaded() { const old = loaded; loaded = null; if (old) await old.unload(); }

  function run(key, purpose) {
    if (!Object.hasOwn(models, key)) return Promise.reject(new Error('Неизвестная модель.'));
    if (disposed) return Promise.reject(new DOMException('Менеджер закрыт', 'AbortError'));
    if (purpose === 'activate' && loaded?.modelId === models[key].id) return Promise.resolve(loaded);
    if (pending) {
      if (pending.key === key && pending.purpose === purpose) return pending.promise;
      return Promise.reject(new Error('Дождись завершения текущей загрузки.'));
    }
    if (!canLoad()) return Promise.reject(new Error('Для этих моделей нужен браузер с WebGPU.'));
    if (purpose === 'download' && isLive()) return Promise.reject(new Error('Скачай модель после завершения эфира, чтобы не замедлять анализ.'));
    revisions[key]++; // an older check for this model must not overwrite a completed load
    const task = { key, purpose, controller: new AbortController(), promise: null };
    pending = task;
    states[key] = { status: 'loading', progress: 0, message: purpose === 'download' ? 'Подготавливаем скачивание…' : 'Запускаем модель…' };
    task.promise = (async () => {
      let client = null;
      try {
        await dropLoaded(); checkAbort(task);
        if (purpose === 'activate' && !await hasCached(models[key].id)) {
          states[key] = { status: 'missing', progress: 0, message: 'Сначала скачай эту модель' };
          throw new Error('Сначала скачай выбранную модель в разделе «Локальные модели».');
        }
        checkAbort(task);
        client = await load({
          modelId: models[key].id, signal: task.controller.signal,
          onStatus(message) { if (pending === task && !task.controller.signal.aborted && !disposed) { states[key].message = message; notify(); } },
          onProgress({ progress }) {
            if (pending !== task || task.controller.signal.aborted || disposed) return;
            states[key].progress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
            states[key].message = `${purpose === 'download' ? 'Скачивание и подготовка' : 'Запуск модели'}: ${Math.round(states[key].progress * 100)}%`; notify();
          },
        });
        checkAbort(task);
        if (purpose === 'download') {
          if (!await hasCached(models[key].id)) throw new Error('Браузер не подтвердил сохранение модели. Освободи место и попробуй снова.');
          checkAbort(task); await client.unload(); client = null; checkAbort(task);
        } else { loaded = client; client = null; }
        states[key] = { status: 'cached', progress: 1, message: purpose === 'download' ? 'Скачана на это устройство' : 'Модель запущена' };
        return purpose === 'activate' ? loaded : true;
      } catch (error) {
        if (client) await client.unload();
        if (error.name === 'AbortError') states[key] = { status: 'unknown', progress: 0, message: 'Загрузка отменена. Статус кеша будет проверен снова.' };
        else if (states[key].status !== 'missing') states[key] = { status: 'error', progress: 0, message: error.message || 'Не удалось загрузить модель' };
        throw error;
      } finally { if (pending === task) pending = null; notify(); }
    })();
    notify(); return task.promise;
  }
  return {
    get loaded() { return loaded; },
    get busy() { return Boolean(pending); },
    get downloading() { return pending?.purpose === 'download'; },
    get states() { return Object.fromEntries(Object.entries(states).map(([key, value]) => [key, { ...value }])); },
    activate: key => run(key, 'activate'),
    download: key => run(key, 'download'),
    async refresh() {
      const id = ++refreshId;
      await Promise.all(Object.keys(models).map(async key => {
        if (pending?.key === key) return;
        const revision = revisions[key];
        states[key] = { ...states[key], status: 'checking', message: 'Проверяем кеш…' }; notify();
        try {
          const cached = await hasCached(models[key].id);
          if (id !== refreshId || revision !== revisions[key] || disposed || pending?.key === key) return;
          states[key] = { status: cached ? 'cached' : 'missing', progress: cached ? 1 : 0, message: cached ? 'Скачана на это устройство' : 'Ещё не скачана' };
        } catch {
          if (id !== refreshId || revision !== revisions[key] || disposed || pending?.key === key) return;
          states[key] = { status: 'error', progress: 0, message: 'Не удалось проверить кеш. Проверь интернет.' };
        }
        notify();
      }));
    },
    async cancelDownload() {
      if (pending?.purpose !== 'download') return;
      const task = pending; task.controller.abort();
      try { await task.promise; } catch { /* user cancellation */ }
    },
    async release() {
      if (pending?.purpose === 'activate') { const task = pending; task.controller.abort(); try { await task.promise; } catch { /* cancelled */ } }
      await dropLoaded(); notify();
    },
    async dispose() {
      disposed = true; refreshId++;
      if (pending) { const task = pending; task.controller.abort(); try { await task.promise; } catch { /* cancelled */ } }
      await dropLoaded();
    },
  };
}
