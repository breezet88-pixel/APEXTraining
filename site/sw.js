// Service worker: makes Apex Training installable and usable offline.
// Works under any sub-path (e.g. /APEXTraining/ on GitHub Pages). The coach page is never cached.
const SHELL = 'apex-shell-v3';
const RUNTIME = 'apex-runtime-v1';
const KEEP = [SHELL, RUNTIME, 'apex-saved-v1'];
const SCOPE = self.registration.scope; // ends with '/'
const ASSETS = ['', 'index.html', 'css/styles.css', 'js/app.js', 'js/common.js', 'js/config.js', 'js/download.js', 'js/classes.js', 'js/timer.js',
  'manifest.webmanifest', 'icons/apex-logo.jpg', 'icons/favicon-48.png', 'icons/icon-192.png'].map((p) => new URL(p, SCOPE).href);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const hit = await caches.match(req);
  const fresh = fetch(req).then(async (res) => {
    if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return; // other sites (GitHub, giscus) go straight through
  const path = req.url.slice(SCOPE.length).split('?')[0];
  if (path.startsWith('admin') || path.startsWith('js/admin') || path.startsWith('js/github')) return; // never cache the coach page
  if (req.mode === 'navigate') e.respondWith(fetch(req).catch(() => caches.match(new URL('index.html', SCOPE).href)));
  else if (path.startsWith('data/')) e.respondWith(networkFirst(req));             // newest workouts when online
  else if (path.startsWith('images/')) e.respondWith(caches.match(req).then((hit) => hit || networkFirst(req))); // names never change
  else e.respondWith(staleWhileRevalidate(req));
});
