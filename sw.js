// Offline support: after the first visit the app shell and the on-device vision models
// work without a network (a stage, a sports ground). Same-origin files: network first,
// so a new deploy shows up at once and the cache is only a fallback. Versioned CDN
// files (MediaPipe, the WebLLM library, the pose and object models): cache first, their
// URLs carry the version and never change. WebLLM keeps its own model caches and Piper
// voices live in OPFS; neither is touched here. The Piper runtime comes from esm.sh with
// unversioned polyfills, so it is not cached: offline the browser voice reads the phrases.
const CACHE = 'aimo-v1';
const SHELL = [
  './', './index.html', './styles.css',
  './app/main.js', './app/chat.js', './app/live.js', './app/store.js', './app/ui.js', './app/viewport.js',
  './app/model-manager.js', './app/speech.js', './app/trainer-audio.js', './app/tts-worker.js',
  './app/voice-cache.js', './app/voice-models.js', './app/voice-queue.js',
  './coach-engine.js', './coach-motion.js', './coach-policy.js', './coach-llm.js', './coach-planner.js', './coach-talk.js',
  './coach-progress.js', './coach-objects.js', './coach-questions.js', './rhythm.js', './llm-worker.js',
  './skills/index.js', './skills/common.js', './skills/puppet.js', './skills/football.js', './skills/balance.js', './skills/squats.js',
  './skills/lunges.js', './skills/pushups.js', './skills/plank.js', './skills/jacks.js', './skills/highknees.js',
];
const IMMUTABLE = [
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@\d/,
  /^https:\/\/storage\.googleapis\.com\/mediapipe-models\//,
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm@\d/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('aimo-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (IMMUTABLE.some(pattern => pattern.test(request.url))) { event.respondWith(cacheFirst(request)); return; }
  if (new URL(request.url).origin === self.location.origin) event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200) cache.put(request, response.clone());
  return response;
}
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.status === 200) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') { const shell = await cache.match('./index.html'); if (shell) return shell; }
    throw error;
  }
}
