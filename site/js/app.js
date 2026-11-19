// Apex Training member app. Free, no account needed: view workouts, read and post comments
// (GitHub Discussions), and download or save today's workout of the day.
// Display only: the content comes from the data files the coach publishes.
import { SITE } from './config.js';
import { h, fill, metaLine, factsLine, todayIn } from './common.js';
import { buildWorkoutPage, fileName } from './download.js';

const app = document.getElementById('app');
const banner = document.getElementById('banner');
const show = (...nodes) => fill(app, ...nodes);
const SAVED_KEY = 'apex.wod';
const PIC_CACHE = 'apex-saved-v1';

let data = null; // { workouts: [...published], schedule: {days}, settings }

// ---------- data ----------
async function getJson(name) {
  const res = await fetch(`data/${name}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${name}`);
  return res.json();
}

async function loadData() {
  try {
    const [w, s, st] = await Promise.all([getJson('workouts.json'), getJson('schedule.json'), getJson('settings.json')]);
    data = { workouts: (w.workouts || []).filter((x) => x.published), schedule: s.days || {}, settings: st };
    return true;
  } catch { return false; }
}

const byId = (id) => data?.workouts.find((w) => w.id === id) || null;
function todaysWorkout() {
  const day = todayIn(SITE.timezone);
  return { day, workout: data ? byId(Number(data.schedule[day])) : null };
}

// ---------- small bits ----------
function setBanner(msg) { banner.textContent = msg || ''; banner.hidden = !msg; }
function setTab(name) {
  for (const t of ['today', 'workouts']) document.getElementById(`tab-${t}`).classList.toggle('on', t === name);
}

function card(w) {
  const cover = w.exercises.find((e) => e.image)?.image;
  return h('a', { class: 'card', href: `#/w/${w.id}` },
    cover ? h('img', { src: cover, alt: '', loading: 'lazy' }) : h('div', { class: 'ph', 'aria-hidden': 'true' }, '🏋️'),
    h('div', { class: 'card-body' },
      h('h3', {}, w.title),
      w.category ? h('span', { class: 'chip static' }, w.category) : null,
      h('p', { class: 'muted' }, metaLine(w))));
}

function exerciseList(w) {
  return h('ol', { class: 'exercises' }, w.exercises.map((e) => {
    const facts = factsLine(e);
    return h('li', { class: 'ex' },
      h('h2', {}, e.name),
      facts ? h('p', { class: 'facts' }, facts) : null,
      e.image ? h('img', { src: e.image, alt: `How to do ${e.name}`, loading: 'lazy' }) : null,
      e.muscles ? h('p', {}, h('b', {}, 'Muscles: '), e.muscles) : null,
      e.equipment ? h('p', {}, h('b', {}, 'Equipment: '), e.equipment) : null,
      e.cues ? h('p', {}, e.cues) : null);
  }));
}

// ---------- today's workout: download / save offline (free, no account) ----------
function getSaved() { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || 'null'); } catch { return null; } }

async function saveOffline(day, w) {
  if ('caches' in window) {
    const cache = await caches.open(PIC_CACHE);
    await Promise.all(w.exercises.filter((e) => e.image).map((e) => cache.add(e.image).catch(() => {})));
  }
  try { localStorage.setItem(SAVED_KEY, JSON.stringify({ day, workout: w })); }
  catch { throw new Error('Your browser would not let us save on this device.'); }
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
}

async function download(day, w) {
  const page = await buildWorkoutPage(w, day, SITE.name, async (path) => {
    const res = await fetch(path);
    return res.ok ? toDataUrl(await res.blob()) : null;
  });
  const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
  const a = h('a', { href: url, download: fileName(w.title, day) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function wodActions(day, w) {
  const status = h('p', { class: 'muted', role: 'status' });
  const dl = h('button', { class: 'btn', onclick: async (e) => {
    e.target.disabled = true;
    status.textContent = 'Preparing your download…';
    try { await download(day, w); status.textContent = 'Downloaded. Open the file on any device, or print it to PDF.'; }
    catch { status.textContent = 'Could not download. Check your connection and try again.'; }
    e.target.disabled = false;
  } }, 'Download today’s workout');
  const isSaved = () => getSaved()?.day === day && getSaved()?.workout.id === w.id;
  const save = h('button', { class: 'btn ghost' });
  const paint = () => { save.textContent = isSaved() ? '✓ Saved for offline (tap to remove)' : 'Save for offline use'; };
  paint();
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      if (isSaved()) { localStorage.removeItem(SAVED_KEY); status.textContent = 'Removed from this device.'; }
      else { await saveOffline(day, w); status.textContent = 'Saved. Today’s workout now opens without internet.'; }
    } catch (err) { status.textContent = err.message; }
    save.disabled = false;
    paint();
  });
  return h('div', {}, h('div', { class: 'actions' }, dl, save), status);
}

// ---------- comments: GitHub Discussions shown with giscus ----------
function comments(w) {
  const c = data.settings.comments || {};
  if (!c.enabled) return null;
  const box = h('div', { class: 'giscus' });
  const s = document.createElement('script');
  Object.entries({
    src: 'https://giscus.app/client.js', 'data-repo': SITE.repo, 'data-repo-id': c.repo_id, 'data-category': c.category,
    'data-category-id': c.category_id, 'data-mapping': 'specific', 'data-term': `workout-${w.id}`, 'data-strict': '1',
    'data-reactions-enabled': '1', 'data-emit-metadata': '0', 'data-input-position': 'top', 'data-theme': 'preferred_color_scheme',
    'data-lang': 'en', 'data-loading': 'lazy', crossorigin: 'anonymous',
  }).forEach(([k, v]) => s.setAttribute(k, v));
  s.async = true;
  return h('section', { class: 'reviews' },
    h('h2', {}, 'Comments & reviews'),
    h('p', { class: 'muted comments-note' }, 'Reading is open to everyone. To post, sign in with a free GitHub account.'),
    box, s);
}

function supportCard() {
  if (!data?.settings.donate?.url) return null;
  return h('div', { class: 'support-card' },
    h('p', {}, 'Apex Training is free. If it helps you, you can chip in. It is completely optional.'),
    h('a', { href: '#/support' }, '♥ Support the coach'));
}

// ---------- views ----------
function todayView(online) {
  setTab('today');
  let day; let w;
  if (online) ({ day, workout: w } = todaysWorkout());
  else { const s = getSaved(); day = s?.day; w = s?.workout; }
  setBanner(online ? '' : 'You are offline. Showing the workout you saved on this device.');
  if (!w) {
    show(h('h1', {}, 'Today’s workout'),
      h('p', { class: 'muted' }, online ? 'The coach has not posted today’s workout yet. Check back soon, or browse all workouts.' : 'Nothing saved on this device yet.'),
      online ? h('a', { class: 'btn ghost', href: '#/workouts' }, 'Browse workouts') : null);
    return;
  }
  const cover = w.exercises.find((e) => e.image)?.image;
  show(
    h('p', { class: 'eyebrow' }, `Workout of the day · ${day}`),
    h('h1', {}, w.title),
    h('p', { class: 'muted' }, [w.category, metaLine(w)].filter(Boolean).join(' · ')),
    cover ? h('img', { class: 'hero', src: cover, alt: '' }) : null,
    w.description ? h('p', {}, w.description) : null,
    online ? h('a', { class: 'btn ghost', href: `#/w/${w.id}` }, 'See all exercises & comments') : exerciseList(w),
    wodActions(day, w),
    online ? supportCard() : null);
}

function listView() {
  setTab('workouts');
  setBanner('');
  const workouts = data.workouts;
  let query = '';
  let cat = '';
  const grid = h('div', { class: 'grid' });
  const cats = [...new Set(workouts.map((w) => w.category).filter(Boolean))].sort();
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Category' });
  const draw = () => {
    const q = query.toLowerCase();
    const shown = workouts.filter((w) => (!cat || w.category === cat) && (!q || `${w.title} ${w.category} ${w.level} ${w.description}`.toLowerCase().includes(q)));
    fill(grid, shown.length ? shown.map(card) : h('p', { class: 'muted pad' }, workouts.length ? 'No workouts match.' : 'No workouts yet. Check back soon.'));
    fill(chips, ['', ...cats].map((c) => h('button', { class: `chip${c === cat ? ' on' : ''}`, 'aria-pressed': c === cat ? 'true' : 'false', onclick: () => { cat = c; draw(); } }, c || 'All')));
  };
  show(
    h('h1', { class: 'sr-only' }, 'All workouts'),
    h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'Search workouts', 'aria-label': 'Search workouts', oninput: (e) => { query = e.target.value; draw(); } }),
      cats.length ? chips : null),
    grid);
  draw();
}

function detailView(id) {
  setTab('workouts');
  setBanner('');
  const w = byId(id);
  if (!w) { show(h('p', { class: 'pad' }, 'This workout is not available.'), h('a', { class: 'pad', href: '#/workouts' }, '← All workouts')); return; }
  const { day, workout: wod } = todaysWorkout();
  const isWod = wod?.id === w.id;
  show(
    h('a', { class: 'back', href: '#/workouts' }, '← All workouts'),
    h('article', { class: 'detail' },
      h('h1', {}, w.title),
      isWod ? h('p', { class: 'eyebrow' }, 'Today’s workout of the day') : null,
      h('p', { class: 'muted' }, [w.category, metaLine(w)].filter(Boolean).join(' · ')),
      w.description ? h('p', {}, w.description) : null,
      isWod ? wodActions(day, w) : h('p', { class: 'muted note' }, 'Downloads are available for the workout of the day.'),
      exerciseList(w),
      comments(w)));
}

function supportView() {
  setTab('');
  setBanner('');
  const d = data.settings.donate || {};
  if (!d.url) {
    show(h('h1', {}, 'Apex Training is free'), h('p', {}, 'Everything here is free to use. Thank you for training with us.'), h('a', { class: 'btn ghost', href: '#/' }, 'Back to today’s workout'));
    return;
  }
  const out = { target: '_blank', rel: 'noopener noreferrer' };
  const host = new URL(d.url).hostname;
  const presets = d.amount_url ? d.amounts.map((n) => h('a', { class: 'btn', href: d.amount_url.split('{amount}').join(String(n)), ...out }, `R${n}`)) : [];
  show(
    h('h1', {}, 'Support the coach'),
    h('p', {}, h('strong', {}, 'Apex Training is free to use.')),
    h('p', {}, d.message || 'If these workouts help you, you can say thanks with a donation of any size. It is completely optional and does not unlock anything.'),
    presets.length ? h('div', { class: 'amounts', role: 'group', 'aria-label': 'Choose an amount' }, presets) : null,
    h('a', { class: presets.length ? 'btn ghost' : 'btn', href: d.url, ...out }, presets.length ? 'Choose another amount' : 'Donate'),
    h('p', { class: 'muted note' }, `You pay on the secure ${host} page, not here. Apex Training never sees your card or bank details. Donations are voluntary gifts.`),
    h('a', { class: 'back', href: '#/' }, '← Back'));
}

async function route() {
  const path = (location.hash || '#/').slice(1);
  if (!data) await loadData();
  let m;
  if (!data) todayView(false);                         // offline and nothing cached: show what is saved
  else if ((m = path.match(/^\/w\/(\d+)$/))) detailView(Number(m[1]));
  else if (path === '/workouts') listView();
  else if (path === '/support') supportView();
  else todayView(true);
  document.getElementById('support-link').hidden = !data?.settings.donate?.url;
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();

// ---------- install + offline ----------
const installBtn = document.getElementById('install');
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferred;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; installBtn.hidden = false; });
addEventListener('appinstalled', () => { installBtn.hidden = true; });
if (ios && !standalone) installBtn.hidden = false;
installBtn.addEventListener('click', async () => {
  if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; installBtn.hidden = true; }
  else setBanner('To install on iPhone or iPad: tap the Share button, then “Add to Home Screen”.');
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
