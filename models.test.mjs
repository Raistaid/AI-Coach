import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelManager } from './app/model-manager.js';
const models = { default: { id: 'large' }, small: { id: 'small' } };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const cache = new Set(); const loads = [], unloaded = [];
  const client = id => ({ modelId: id, async unload() { unloaded.push(id); } });
  const manager = createModelManager({ models, hasCached: async id => cache.has(id), load: async config => { loads.push(config); cache.add(config.modelId); return client(config.modelId); }, ...options });
  return { manager, cache, loads, unloaded, client };
}
test('download verifies cache and unloads GPU; it does not activate the coach', async () => {
  const f = fixture(); await f.manager.download('small');
  assert.equal(f.manager.states.small.status, 'cached'); assert.equal(f.manager.loaded, null);
  assert.deepEqual(f.unloaded, ['small']); assert.equal(f.manager.busy, false);
  const state = f.manager.states; state.small.status = 'missing'; assert.equal(f.manager.states.small.status, 'cached');
});
test('activation cannot silently download a model missing from cache', async () => {
  const f = fixture(); await assert.rejects(f.manager.activate('small'), /Сначала скачай/);
  assert.equal(f.loads.length, 0); assert.equal(f.manager.states.small.status, 'missing');
});
test('same activation shares a single worker; release unloads it', async () => {
  const f = fixture(); f.cache.add('small');
  const first = f.manager.activate('small'), second = f.manager.activate('small');
  assert.equal(first, second); const coach = await first;
  assert.equal(f.loads.length, 1); assert.equal(f.manager.loaded, coach);
  await f.manager.release(); assert.equal(f.manager.loaded, null); assert.deepEqual(f.unloaded, ['small']);
});
test('parallel downloads and live-session downloads are rejected', async () => {
  const f = fixture(); const first = f.manager.download('small');
  await assert.rejects(f.manager.download('default'), /текущей загрузки/); await first;
  await assert.rejects(fixture({ isLive: () => true }).manager.download('small'), /завершения эфира/);
  await assert.rejects(fixture({ canLoad: () => false }).manager.download('small'), /WebGPU/);
});
test('failure to persist cache never displays downloaded state', async () => {
  const f = fixture({ hasCached: async () => false });
  await assert.rejects(f.manager.download('small'), /не подтвердил/);
  assert.equal(f.manager.states.small.status, 'error'); assert.equal(f.manager.loaded, null); assert.equal(f.manager.busy, false);
  assert.deepEqual(f.unloaded, ['small']);
});
test('cancelled loading aborts its worker and ignores late progress', async () => {
  let config;
  const f = fixture({ load: async options => { config = options; return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))); } });
  const loading = f.manager.download('small'); const rejected = assert.rejects(loading, { name: 'AbortError' });
  await turn(); await f.manager.cancelDownload(); await rejected;
  assert.equal(config.signal.aborted, true); assert.equal(f.manager.busy, false);
  config.onProgress({ progress: 1, text: 'Late completion' });
  assert.equal(f.manager.states.small.status, 'unknown');
});
test('even a late client returned after cancellation is unloaded rather than activated', async () => {
  let resolveLoad;
  const f = fixture({ load: () => new Promise(resolve => { resolveLoad = resolve; }) });
  const loading = f.manager.download('small'); const rejected = assert.rejects(loading, { name: 'AbortError' });
  await turn(); const cancel = f.manager.cancelDownload(); resolveLoad(f.client('small')); await cancel; await rejected;
  assert.deepEqual(f.unloaded, ['small']); assert.equal(f.manager.loaded, null);
});
test('refresh checks real cache eviction; an old refresh cannot overwrite a completed download', async () => {
  const f = fixture(); f.cache.add('small'); await f.manager.refresh();
  assert.equal(f.manager.states.small.status, 'cached'); f.cache.delete('small'); await f.manager.refresh();
  assert.equal(f.manager.states.small.status, 'missing');
  let oldResult, calls = 0;
  const g = fixture({ hasCached: id => id === 'large' && calls++ === 0 ? new Promise(resolve => { oldResult = resolve; }) : Promise.resolve(true) });
  const refresh = g.manager.refresh(); await g.manager.download('default'); oldResult(false); await refresh;
  assert.equal(g.manager.states.default.status, 'cached'); assert.equal(g.manager.states.small.status, 'cached');
});
test('dispose cancels loading and prevents future activation', async () => {
  let config;
  const f = fixture({ hasCached: async () => true, load: async options => { config = options; return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))); } });
  const loading = f.manager.activate('small'); const rejected = assert.rejects(loading, { name: 'AbortError' }); await turn();
  await f.manager.dispose(); await rejected; assert.equal(config.signal.aborted, true);
  await assert.rejects(f.manager.activate('small'), { name: 'AbortError' });
});
