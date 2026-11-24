// Apex Training member app. Free, no account needed: browse the Workout Library (the coach's classes),
// download or save any workout for offline use, look up exercises, and read and post comments.
// Display only: the content comes from the data files the coach publishes.
import { SITE } from './config.js';
import { h, fill, metaLine, factsLine, libraryIndex, resolveWorkout, nowIn } from './common.js';
import { buildWorkoutPage, fileName } from './download.js';
import { typeInfo, classesOn, addDays, weekdayOf, sameClass } from './classes.js';
import { buildSegments, timerSummary, totalSeconds, secLabel } from './timer.js';

const app = document.getElementById('app');
const banner = document.getElementById('banner');
const show = (...nodes) => fill(app, ...nodes);
const SAVED_KEY = 'apex.saved'; // workouts saved on this device: { id: workout }
const PIC_CACHE = 'apex-saved-v1';

let data = null; // { workouts: [...published, library exercises and class type filled in], settings, library, index }

// ---------- data ----------
async function getJson(name) {
  const res = await fetch(`data/${name}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${name}`);
  return res.json();
}

async function loadData() {
  try {
    const [w, st, lib, cls] = await Promise.all([getJson('workouts.json'), getJson('settings.json'),
      getJson('exercises.json').catch(() => ({ exercises: [] })), getJson('classes.json').catch(() => ({ types: [] }))]);
    const index = libraryIndex(lib);
    // "about": the coach's short description of the class type (Grid, Hyrox…), kept with the workout so it also works offline
    const withAbout = (x) => ({ ...x, about: typeInfo(cls, x.category)?.description || '' });
    data = { workouts: (w.workouts || []).filter((x) => x.published).map((x) => withAbout(resolveWorkout(x, index))), settings: st, library: lib, index, classes: cls };
    return true;
  } catch { return false; }
}

const byId = (id) => data?.workouts.find((w) => w.id === id) || savedAll()[id] || null;

// ---------- small bits ----------
function setBanner(msg) { banner.textContent = msg || ''; banner.hidden = !msg; }
function setTab(name) {
  for (const t of ['home', 'week', 'workouts', 'exercises', 'comments']) {
    const a = document.getElementById(`tab-${t}`);
    a.classList.toggle('on', t === name);
    if (t === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

// "Thu 20 Nov 2026 · 06:00 · Virgin Active Sandton"
export function niceDate(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-ZA', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00Z`));
}
const classLine = (w) => [niceDate(w.date), w.time, w.club].filter(Boolean).join(' · ');
const googleUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(`${q} exercise how to`)}`;
const googleLink = (q, label) => h('a', { href: googleUrl(q), target: '_blank', rel: 'noopener noreferrer' }, label || `Search Google for “${q}”`);
const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '') || b.id - a.id;

function card(w) {
  const cover = w.exercises.find((e) => e.image)?.image || w.photos?.[0]?.image;
  return h('a', { class: 'card', href: `#/w/${w.id}` },
    cover ? h('img', { src: cover, alt: '', loading: 'lazy' }) : h('div', { class: 'ph', 'aria-hidden': 'true' }, '🏋️'),
    h('div', { class: 'card-body' },
      h('h3', {}, w.title),
      [w.time, w.club].some(Boolean) ? h('p', { class: 'class-line' }, [w.time, w.club && `📍 ${w.club}`].filter(Boolean).join(' · ')) : null, // the date is the group heading
      h('p', { class: 'muted' }, [w.category, metaLine(w)].filter(Boolean).join(' · '))));
}

function playlist(w) {
  if (!w.playlist?.length) return null;
  return h('section', { class: 'playlist' },
    h('h2', {}, '🎵 Class playlist'),
    h('p', { class: 'muted note' }, 'The music played in this class, on YouTube.'),
    h('ul', {}, w.playlist.map((p, i) => h('li', {}, h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.title || (w.playlist.length > 1 ? `Playlist ${i + 1}` : 'Open the playlist'))))));
}

// Short cues for doing an exercise correctly
const keyPointList = (list) => (list?.length ? h('ul', { class: 'key-points' }, list.map((k) => h('li', {}, k))) : null);

function exerciseList(w) {
  return h('ol', { class: 'exercises' }, w.exercises.map((e) => {
    const facts = factsLine(e);
    return h('li', { class: 'ex' },
      h('h2', {}, e.library_id && data ? h('a', { href: `#/e/${e.library_id}` }, e.name) : e.name),
      facts ? h('p', { class: 'facts' }, facts) : null,
      e.image ? h('img', { src: e.image, alt: `How to do ${e.name}`, loading: 'lazy' }) : null,
      e.muscles ? h('p', {}, h('b', {}, 'Muscles: '), e.muscles) : null,
      e.equipment ? h('p', {}, h('b', {}, 'Equipment: '), e.equipment) : null,
      keyPointList(e.key_points),
      e.movement ? h('details', { class: 'how' }, h('summary', {}, 'Full description'), h('p', {}, e.movement)) : null,
      e.cues ? h('p', {}, e.movement ? h('b', {}, 'Coach’s notes: ') : null, e.cues) : null,
      !e.library_id && e.name ? h('p', { class: 'muted note' }, 'Not sure how? ', googleLink(e.name, 'Look it up on Google')) : null);
  }));
}

// ---------- any workout: download, or save for offline use (free, no account) ----------
function savedAll() { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') || {}; } catch { return {}; } }
const isSaved = (id) => !!savedAll()[id];

async function saveOffline(w) {
  if ('caches' in window) {
    const cache = await caches.open(PIC_CACHE);
    await Promise.all([...w.exercises.map((e) => e.image), w.timer?.image, ...(w.photos || []).map((p) => p.image)].filter(Boolean).map((p) => cache.add(p).catch(() => {})));
  }
  try { localStorage.setItem(SAVED_KEY, JSON.stringify({ ...savedAll(), [w.id]: w })); }
  catch { throw new Error('Your browser would not let us save on this device.'); }
}

function removeSaved(w) {
  const all = savedAll();
  delete all[w.id];
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
}

async function download(w) {
  const page = await buildWorkoutPage(w, SITE.name, async (path) => {
    const res = await fetch(path);
    return res.ok ? toDataUrl(await res.blob()) : null;
  });
  const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
  const a = h('a', { href: url, download: fileName(w) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function workoutActions(w) {
  const status = h('p', { class: 'muted', role: 'status' });
  const dl = h('button', { class: 'btn', onclick: async (e) => {
    e.target.disabled = true;
    status.textContent = 'Preparing your download…';
    try { await download(w); status.textContent = 'Downloaded. Open the file on any device, or print it to PDF.'; }
    catch { status.textContent = 'Could not download. Check your connection and try again.'; }
    e.target.disabled = false;
  } }, 'Download workout');
  const save = h('button', { class: 'btn ghost' });
  const paint = () => { save.textContent = isSaved(w.id) ? '✓ Saved for offline (tap to remove)' : 'Save for offline use'; };
  paint();
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      if (isSaved(w.id)) { removeSaved(w); status.textContent = 'Removed from this device.'; }
      else { await saveOffline(w); status.textContent = 'Saved. This workout now opens without internet.'; }
    } catch (err) { status.textContent = err.message; }
    save.disabled = false;
    paint();
  });
  return h('div', {}, h('div', { class: 'actions' }, dl, save), status);
}

// ---------- comments: GitHub Discussions shown with giscus ----------
const commentsOn = () => !!data?.settings?.comments?.enabled;

// One comment thread (a GitHub Discussion), named by `term`: "workout-<id>" or "member-comments".
function commentThread(term) {
  const c = data.settings.comments;
  const box = h('div', { class: 'giscus' });
  const s = document.createElement('script');
  Object.entries({
    src: 'https://giscus.app/client.js', 'data-repo': SITE.repo, 'data-repo-id': c.repo_id, 'data-category': c.category,
    'data-category-id': c.category_id, 'data-mapping': 'specific', 'data-term': term, 'data-strict': '1',
    'data-reactions-enabled': '1', 'data-emit-metadata': '0', 'data-input-position': 'top', 'data-theme': 'preferred_color_scheme',
    'data-lang': 'en', 'data-loading': 'lazy', crossorigin: 'anonymous',
  }).forEach(([k, v]) => s.setAttribute(k, v));
  s.async = true;
  return [box, s];
}

const postNote = () => h('p', { class: 'muted comments-note' }, 'Reading is open to everyone. To post, sign in with a free GitHub account.');

// Comments under one workout
function comments(w) {
  if (!commentsOn()) return null;
  return h('section', { class: 'reviews' }, h('h2', {}, 'Comments & reviews'), postNote(), commentThread(`workout-${w.id}`));
}

// Comments go to Breeze Kobola's social media: Facebook and Instagram (links set on the coach page)
function socialButtons() {
  const s = data?.settings?.social || {};
  const btn = (url, cls, icon, label) => url
    ? h('a', { class: `btn social ${cls}`, href: url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { 'aria-hidden': 'true' }, icon), ` ${label}`)
    : h('span', { class: `btn social ${cls} soon`, 'aria-disabled': 'true' }, h('span', { 'aria-hidden': 'true' }, icon), ` ${label}`, h('small', {}, 'Coming soon'));
  return h('div', { class: 'social-row' },
    btn(s.facebook, 'fb', 'f', 'Comment on Facebook'),
    btn(s.instagram, 'ig', '◎', 'Comment on Instagram'));
}
function commentsView() {
  setTab('comments');
  setBanner('');
  show(
    h('h1', {}, 'Comments'),
    h('p', {}, `Share feedback, questions and your results with ${SITE.coach} on social media.`),
    socialButtons(),
    commentsOn() ? h('section', { class: 'reviews' }, postNote(), commentThread('member-comments')) : null);
}

function supportCard() {
  if (!data?.settings.donate?.url) return null;
  return h('div', { class: 'support-card' },
    h('p', {}, 'Apex Training is free. If it helps you, you can chip in. It is completely optional.'),
    h('a', { href: '#/support' }, `♥ Support ${SITE.coach}`));
}

// ---------- views ----------
// Workouts grouped by class date (newest day first); classes on the same day in time order.
function groupedByDay(workouts) {
  const days = new Map();
  for (const w of [...workouts].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.time || '').localeCompare(b.time || '') || a.id - b.id)) {
    const key = w.date || '';
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(w);
  }
  return [...days].map(([day, list]) => h('section', { class: 'day-group' },
    h('h2', { class: 'day-head' }, day ? niceDate(day) : 'No date', list.length > 1 ? h('span', { class: 'muted' }, ` · ${list.length} classes`) : null),
    h('div', { class: 'grid' }, list.map(card))));
}

// The Workout Library: every class the coach has run, newest first. Loved a class? Redo it any time.
function listView() {
  setTab('workouts');
  setBanner('');
  const workouts = data.workouts;
  let query = '';
  let club = '';
  let type = '';
  const box = h('div');
  const clubs = [...new Set(workouts.map((w) => w.club).filter(Boolean))].sort();
  const types = [...new Set(workouts.map((w) => w.category).filter(Boolean))].sort();
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Club' });
  const typeChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Class type' });
  const chip = (value, on, label, pick) => h('button', { class: `chip${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => { pick(value); draw(); } }, label);
  const draw = () => {
    const q = query.toLowerCase();
    const shown = workouts.filter((w) => (!club || w.club === club) && (!type || w.category === type) && (!q || [w.title, w.category, w.level, w.description, w.club, niceDate(w.date), ...w.exercises.map((e) => e.name)].join(' ').toLowerCase().includes(q)));
    fill(box, shown.length ? groupedByDay(shown) : h('p', { class: 'muted pad' }, workouts.length ? 'No workouts match.' : `No workouts yet. ${SITE.coach} adds each class after it has been run.`));
    fill(chips, ['', ...clubs].map((c) => chip(c, c === club, c || 'All clubs', (v) => { club = v; })));
    fill(typeChips, ['', ...types].map((c) => chip(c, c === type, c || 'All classes', (v) => { type = v; })));
  };
  show(
    h('h1', {}, 'Workout Library'),
    h('p', { class: 'muted' }, 'Every class, newest first. Tap one to redo it.'),
    h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'Search by name, club, date or exercise', 'aria-label': 'Search workouts', oninput: (e) => { query = e.target.value; draw(); } }),
      clubs.length > 1 ? chips : null,
      types.length > 1 ? typeChips : null),
    box,
    supportCard());
  draw();
}

// Offline: the workouts saved on this device
function offlineView() {
  setTab('workouts');
  const saved = Object.values(savedAll());
  setBanner('You are offline. Showing the workouts saved on this device.');
  show(h('h1', {}, 'Saved workouts'),
    saved.length ? groupedByDay(saved) : h('p', { class: 'muted' }, 'Nothing is saved on this device yet. When you are online, open a workout and tap “Save for offline use”.'));
}

function detailView(id) {
  setTab('workouts');
  const w = byId(id);
  setBanner(!data && w ? 'You are offline. Showing your saved copy.' : '');
  if (!w) { show(h('p', { class: 'pad' }, 'This workout is not available.'), h('a', { class: 'pad', href: '#/workouts' }, '← Workout Library')); return; }
  show(
    h('a', { class: 'back', href: '#/workouts' }, '← Workout Library'),
    h('article', { class: 'detail' },
      h('h1', {}, w.title),
      w.date || w.time ? h('p', { class: 'class-line' }, '📅 ', [niceDate(w.date), w.time].filter(Boolean).join(' · ')) : null,
      w.club ? h('p', { class: 'class-line' }, '📍 ', w.club) : null,
      h('p', { class: 'muted' }, [w.category, metaLine(w)].filter(Boolean).join(' · ')),
      w.about ? h('p', { class: 'about' }, h('b', {}, `About ${w.category}: `), w.about) : null,
      w.description ? h('p', {}, w.description) : null,
      workoutActions(w),
      timerPanel(w),
      photoGallery(w),
      playlist(w),
      exerciseList(w),
      h('section', { class: 'comment-on' }, h('h2', {}, '💬 Comment on this class'), socialButtons()),
      data ? comments(w) : null));
}

// ---------- home: what Apex Training is, at a glance ----------
// Kept short on purpose: one big next step, the music, one move to try, and three steps.
const STRIP = [1, 88, 74, 13, 40, 36, 12, 59, 84]; // pictures shown on the home screen
const today = () => new Date().toISOString().slice(0, 10);
function musicCard(m) {
  return h('a', { class: 'music-card', href: m.url, target: '_blank', rel: 'noopener noreferrer' },
    h('span', { class: 'music-icon', 'aria-hidden': 'true' }, '🎵'),
    h('span', {}, h('strong', {}, m.title || 'Today’s playlist'), h('span', { class: 'sub' }, 'Tap to play it on YouTube')));
}
function homeView() {
  setTab('home');
  setBanner('');
  const lib = (data.library.exercises || []).filter((x) => x.image);
  const strip = STRIP.map((id) => lib.find((x) => x.id === id)).filter(Boolean);
  const n = [...today()].reduce((a, c) => a + c.charCodeAt(0), 0);
  const move = lib.length ? lib[n % lib.length] : null; // a different move each day
  const latest = [...data.workouts].sort(byDate)[0];
  const music = data.settings.music;
  show(
    h('section', { class: 'home-hero' },
      h('p', { class: 'kicker' }, 'Apex Training'),
      h('h1', {}, `${SITE.coach}’s classes.`, h('br'), h('span', { class: 'hl' }, 'Any time. Free.')),
      h('p', { class: 'hero-sub' }, 'Loved a class? Redo it with the timer, the music and how to do every move.'),
      h('a', { class: 'btn hero-go', href: latest ? `#/w/${latest.id}` : '#/workouts' }, latest ? '▶  Start the latest class' : 'See the classes'),
      strip.length ? h('div', { class: 'strip', 'aria-label': 'Some of the moves' }, strip.map((x) =>
        h('a', { class: 'strip-card', href: `#/e/${x.id}` }, h('img', { src: x.image, alt: x.name, loading: 'lazy' })))) : null),
    music?.url ? musicCard(music) : null,
    (() => {
      const c = nextClass();
      return c ? h('a', { class: 'move next', href: '#/week' },
        h('span', { class: 'next-time' }, h('span', { class: 'sub' }, c.when), h('strong', {}, c.time)),
        h('span', {}, h('span', { class: 'kicker' }, 'Next class'), h('strong', {}, c.type),
          h('span', { class: 'sub' }, `📅 ${c.dateText}`), h('span', { class: 'sub' }, `📍 ${[c.club, c.place].filter(Boolean).join(', ')}`))) : null;
    })(),
    move ? h('a', { class: 'move', href: `#/e/${move.id}` },
      h('img', { src: move.image, alt: '' }),
      h('span', {}, h('span', { class: 'kicker' }, 'Move of the day'), h('strong', {}, move.name), h('span', { class: 'sub' }, move.summary || 'Tap to see how to do it'))) : null,
    h('div', { class: 'home-steps' }, [
      ['1', 'Pick a class', '#/workouts'],
      ['2', 'Press start', latest ? `#/w/${latest.id}` : '#/workouts'],
      ['3', 'Learn the moves', '#/exercises'],
    ].map(([num, label, href]) => h('a', { class: 'home-step', href }, h('span', { class: 'num', 'aria-hidden': 'true' }, num), h('span', {}, label)))));
}

// ---------- this week: the coach's classes, Monday to Sunday ----------
function nextClass() {
  const now = nowIn(SITE.timezone);
  for (let i = 0; i < 8; i++) {
    const day = addDays(now.date, i);
    const c = classesOn(data.classes, day).find((x) => i > 0 || x.time >= now.time);
    if (c) return { ...c, when: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : niceDate(day).split(',')[0], dateText: niceDate(day) };
  }
  return null;
}
function weekView() {
  setTab('week');
  setBanner('');
  const now = nowIn(SITE.timezone);
  const monday = addDays(now.date, -((weekdayOf(now.date) + 6) % 7));
  const days = [...Array(7)].map((_, i) => addDays(monday, i));
  const shortDay = (d) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00Z`));
  const count = days.reduce((a, d) => a + classesOn(data.classes, d).length, 0);
  show(
    h('h1', {}, 'This week'),
    h('p', { class: 'muted' }, count ? `${count} classes with ${SITE.coach}. Tap one to see what it is.` : 'No classes on the timetable this week.'),
    days.map((d) => {
      const list = classesOn(data.classes, d);
      const today = d === now.date;
      return h('section', { class: `week-day${today ? ' today' : ''}${d < now.date ? ' past' : ''}` },
        h('h2', { class: 'day-head' }, today ? `Today · ${shortDay(d)}` : shortDay(d)),
        list.length ? list.map((c) => {
          const t = typeInfo(data.classes, c.type);
          const w = data.workouts.find((x) => sameClass(x, c));
          const done = d < now.date || (today && c.time < now.time);
          return h('details', { class: 'week-class' },
            h('summary', {},
              h('span', { class: 'wc-time' }, c.time),
              h('span', { class: 'wc-main' }, h('strong', {}, c.type),
                h('span', { class: 'sub muted' }, [`📍 ${[c.club, c.place].filter(Boolean).join(', ')}`, t?.minutes ? `${t.minutes} min` : '', c.adhoc ? 'extra class' : ''].filter(Boolean).join(' · '))),
              w ? h('span', { class: 'wc-tag' }, 'Workout ✓') : null),
            h('p', { class: 'class-line' }, `📅 ${shortDay(d)}, ${c.time}`, h('br'), `📍 ${[c.club, c.place].filter(Boolean).join(', ')}`),
            t?.description ? h('p', {}, t.description) : h('p', { class: 'muted' }, `Ask ${SITE.coach} about this class.`),
            h('div', { class: 'actions' },
              w ? h('a', { class: 'btn', href: `#/w/${w.id}` }, done ? '▶ Redo this class' : '▶ Open the workout') : null,
              t?.link ? h('a', { class: 'btn ghost', href: t.link, target: '_blank', rel: 'noopener noreferrer' }, 'Virgin Active page') : null));
        }) : h('p', { class: 'muted rest' }, 'No classes'));
    }));
}

// ---------- class timer ----------
// Pictures and screenshots the coach added for the class; tap one to see it full size.
function photoGallery(w) {
  if (!w.photos?.length) return null;
  return h('section', { class: 'gallery' },
    h('h2', {}, '📷 From the class'),
    w.photos.map((p, i) => h('figure', {},
      h('a', { href: p.image, target: '_blank', rel: 'noopener' }, h('img', { src: p.image, alt: p.caption || `Picture ${i + 1} from the class`, loading: 'lazy' })),
      p.caption ? h('figcaption', { class: 'muted' }, p.caption) : null)));
}

function timerPanel(w) {
  const summary = timerSummary(w.timer);
  const segs = buildSegments(w.timer, w.exercises.map((e) => e.name));
  if (!summary && !w.timer?.notes && !w.timer?.image) return null;
  const total = totalSeconds(segs);
  return h('section', { class: 'timer-panel' },
    h('h2', {}, '⏱ Class timer'),
    summary ? h('p', { class: 'facts' }, summary, total ? h('span', { class: 'muted' }, ` · about ${secLabel(total)}`) : null) : null,
    w.timer?.notes ? h('p', {}, w.timer.notes) : null,
    w.timer?.image ? h('img', { src: w.timer.image, alt: `${SITE.coach}’s timer settings`, loading: 'lazy' }) : null,
    segs.length ? h('a', { class: 'btn', href: `#/t/${w.id}` }, '▶ Start the timer') : null);
}

let stopTimer = null; // cleans up a running timer when you leave the page
function timerView(id) {
  setTab('workouts');
  const w = byId(id);
  const segs = w ? buildSegments(w.timer, w.exercises.map((e) => e.name)) : [];
  if (!w || !segs.length) { show(h('p', { class: 'pad' }, 'This workout has no timer.'), h('a', { class: 'pad', href: '#/workouts' }, '← Workout Library')); return; }
  setBanner('');
  let i = 0;
  let left = segs[0].sec;       // seconds left in this step (or seconds so far, for a stopwatch)
  let running = false;
  let last = 0;
  let tick = null;
  let lock = null;
  let audio = null;
  let sound = true;
  const clock = h('div', { class: 'timer-clock', role: 'timer', 'aria-live': 'off' });
  const phase = h('div', { class: 'timer-phase' });
  const label = h('div', { class: 'timer-label' });
  const nextEl = h('p', { class: 'muted' });
  const step = h('p', { class: 'muted' });
  const box = h('div', { class: 'timer-box' }, phase, clock, label, nextEl, step);
  const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const beep = (freq, ms) => {
    if (!sound || !audio) return;
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = freq; g.gain.value = 0.2;
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  };
  const paint = () => {
    const s = segs[i];
    box.dataset.phase = s.phase;
    phase.textContent = s.phase === 'work' ? (s.countUp ? 'GO' : 'WORK') : s.phase === 'rest' ? 'REST' : 'GET READY';
    clock.textContent = fmt(left);
    label.textContent = s.label;
    nextEl.textContent = s.next ? `${s.phase === 'work' ? 'Then' : 'Next'}: ${s.next}` : '';
    step.textContent = s.round && s.rounds > 1 ? `Round ${s.round} of ${s.rounds}` : '';
  };
  const go = (k) => {
    i = Math.max(0, Math.min(segs.length - 1, k));
    left = segs[i].countUp ? 0 : segs[i].sec;
    paint();
  };
  const finish = () => {
    running = false;
    clearInterval(tick);
    box.dataset.phase = 'done';
    phase.textContent = 'DONE';
    clock.textContent = segs[i].countUp ? fmt(left) : '0:00';
    label.textContent = 'Great work!';
    nextEl.textContent = '';
    step.textContent = '';
    beep(660, 700);
    startBtn.textContent = '↺ Start again';
    lock?.release?.().catch(() => {}); lock = null;
  };
  const loop = () => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    const s = segs[i];
    if (s.countUp) {
      left += dt;
      if (s.sec && left >= s.sec) { finish(); return; }
    } else {
      const before = Math.ceil(left);
      left -= dt;
      const after = Math.ceil(left);
      if (after !== before && after > 0 && after <= 3) beep(880, 120);
      if (left <= 0) {
        if (i === segs.length - 1) { finish(); return; }
        go(i + 1);
        beep(segs[i].phase === 'work' ? 1320 : 520, 400);
      }
    }
    paint();
  };
  const wake = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; } };
  const onVisible = () => { if (running && document.visibilityState === 'visible') wake(); };
  const startBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; } }
    if (box.dataset.phase === 'done') go(0);
    running = !running;
    if (running) { last = performance.now(); tick = setInterval(loop, 100); wake(); }
    else { clearInterval(tick); lock?.release?.().catch(() => {}); lock = null; }
    startBtn.textContent = running ? '⏸ Pause' : '▶ Resume';
  } }, '▶ Start');
  const soundBtn = h('button', { class: 'btn ghost', type: 'button', 'aria-pressed': 'true', onclick: () => {
    sound = !sound; soundBtn.textContent = sound ? '🔊 Sound on' : '🔇 Sound off'; soundBtn.setAttribute('aria-pressed', String(sound));
  } }, '🔊 Sound on');
  document.addEventListener('visibilitychange', onVisible);
  stopTimer = () => { clearInterval(tick); lock?.release?.().catch(() => {}); document.removeEventListener('visibilitychange', onVisible); audio?.close?.().catch(() => {}); };
  go(0);
  show(
    h('a', { class: 'back', href: `#/w/${w.id}` }, `← ${w.title}`),
    h('p', { class: 'muted' }, timerSummary(w.timer)),
    box,
    h('div', { class: 'actions timer-controls' },
      h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Previous step', onclick: () => go(i - 1) }, '⏮'),
      startBtn,
      h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Next step', onclick: () => go(i + 1) }, '⏭'),
      soundBtn),
    h('p', { class: 'muted note' }, 'Keep this page open while you train. The screen stays on where your phone allows it.'));
}

// ---------- exercise library ----------
function sourceLinks(list) {
  if (!list?.length) return null;
  return h('p', { class: 'muted note' }, 'Guidance: ', list.map((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title)]));
}

function libraryView() {
  setTab('exercises');
  setBanner('');
  const lib = data.library;
  const groups = (lib.equipment || []).map((q) => q.name);
  for (const x of lib.exercises) if (x.equipment && !groups.includes(x.equipment)) groups.push(x.equipment);
  let query = '';
  let group = '';
  const list = h('div');
  const online = h('div');
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Equipment' });
  const draw = () => {
    const q = query.toLowerCase();
    const shown = lib.exercises.filter((x) => (!group || x.equipment === group) && (!q || `${x.name} ${x.equipment} ${x.summary || ''} ${x.movement}`.toLowerCase().includes(q)));
    const sections = groups.filter((g) => !group || g === group).map((g) => {
      const items = shown.filter((x) => x.equipment === g);
      if (!items.length) return null;
      const note = lib.equipment?.find((x) => x.name === g)?.note;
      return h('section', { class: 'lib-group' },
        h('h2', {}, g, ' ', h('span', { class: 'muted' }, `(${items.length})`)),
        note ? h('p', { class: 'muted note' }, note) : null,
        h('div', { class: 'grid' }, items.map((x) => h('a', { class: 'card', href: `#/e/${x.id}` },
          x.image ? h('img', { src: x.image, alt: '', loading: 'lazy' }) : h('div', { class: 'ph', 'aria-hidden': 'true' }, '🏋️'),
          h('div', { class: 'card-body' }, h('h3', {}, x.name), x.summary ? h('p', { class: 'muted summary' }, x.summary) : null)))));
    });
    fill(list, sections.some(Boolean) ? sections : h('p', { class: 'muted pad' }, lib.exercises.length ? 'That exercise is not in the library.' : 'The exercise library is empty.'));
    fill(online, query.trim() ? h('p', { class: 'google-search' }, 'Not what you need? ', googleLink(query.trim())) : null);
    fill(chips, ['', ...groups].map((g) => h('button', { class: `chip${g === group ? ' on' : ''}`, 'aria-pressed': g === group ? 'true' : 'false', onclick: () => { group = g; draw(); } }, g || 'All')));
  };
  show(
    h('h1', {}, 'Exercise library'),
    h('p', { class: 'muted' }, 'Tap an exercise to see how to do it. Can’t find one? Search, then use “Search Google”.'),
    lib.guide?.intro ? h('details', { class: 'about' }, h('summary', {}, 'About these exercises'), h('p', { class: 'muted' }, lib.guide.intro)) : null,
    h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises', oninput: (e) => { query = e.target.value; draw(); } }),
      online,
      chips),
    list);
  draw();
}

function exerciseView(id) {
  setTab('exercises');
  setBanner('');
  const x = data.index.get(id);
  if (!x) { show(h('p', { class: 'pad' }, 'This exercise is not in the library.'), h('a', { class: 'pad', href: '#/exercises' }, '← Exercise library')); return; }
  const note = data.library.equipment?.find((q) => q.name === x.equipment);
  const usedIn = data.workouts.filter((w) => w.exercises.some((e) => e.library_id === id));
  show(
    h('a', { class: 'back', href: '#/exercises' }, '← Exercise library'),
    h('article', { class: 'detail' },
      h('h1', {}, x.name),
      x.equipment ? h('span', { class: 'chip static' }, x.equipment) : null,
      x.image ? h('img', { class: 'hero', src: x.image, alt: `How to do ${x.name}` }) : null,
      x.summary ? h('p', { class: 'lead' }, x.summary) : null,
      x.key_points?.length ? [h('h2', {}, 'Key points'), keyPointList(x.key_points)] : null,
      h('h2', {}, 'How to do it'),
      h('p', {}, x.movement),
      note?.note ? h('p', { class: 'support-card' }, h('b', {}, `${x.equipment}: `), note.note) : null,
      sourceLinks(x.sources),
      usedIn.length ? h('div', {}, h('h2', {}, 'In these workouts'), h('ul', {}, usedIn.map((w) => h('li', {}, h('a', { href: `#/w/${w.id}` }, w.title))))) : null));
}

function supportView() {
  setTab('');
  setBanner('');
  const d = data.settings.donate || {};
  if (!d.url) {
    show(h('h1', {}, 'Apex Training is free'), h('p', {}, 'Everything here is free to use. Thank you for training with us.'), h('a', { class: 'btn ghost', href: '#/workouts' }, 'Back to the workout library'));
    return;
  }
  const out = { target: '_blank', rel: 'noopener noreferrer' };
  const host = new URL(d.url).hostname;
  const presets = d.amount_url ? d.amounts.map((n) => h('a', { class: 'btn', href: d.amount_url.split('{amount}').join(String(n)), ...out }, `R${n}`)) : [];
  show(
    h('h1', {}, `Support ${SITE.coach}`),
    h('p', {}, h('strong', {}, 'Apex Training is free to use.')),
    h('p', {}, d.message || 'If these workouts help you, you can say thanks with a donation of any size. It is completely optional and does not unlock anything.'),
    presets.length ? h('div', { class: 'amounts', role: 'group', 'aria-label': 'Choose an amount' }, presets) : null,
    h('a', { class: presets.length ? 'btn ghost' : 'btn', href: d.url, ...out }, presets.length ? 'Choose another amount' : 'Donate'),
    h('p', { class: 'muted note' }, `You pay on the secure ${host} page, not here. Apex Training never sees your card or bank details. Donations are voluntary gifts.`),
    h('a', { class: 'back', href: '#/' }, '← Back'));
}

async function route() {
  const path = (location.hash || '#/').slice(1);
  stopTimer?.(); stopTimer = null;
  if (!data) await loadData();
  let m;
  if ((m = path.match(/^\/w\/(\d+)$/))) detailView(Number(m[1]));
  else if ((m = path.match(/^\/t\/(\d+)$/))) timerView(Number(m[1]));
  else if (!data) offlineView();                       // offline and nothing cached: show what is saved
  else if (path === '/' || path === '') homeView();
  else if (path === '/workouts') listView();
  else if (path === '/week') weekView();
  else if (path === '/exercises') libraryView();
  else if ((m = path.match(/^\/e\/(\d+)$/))) exerciseView(Number(m[1]));
  else if (path === '/support') supportView();
  else if (path === '/comments') commentsView();
  else listView();
  document.getElementById('support-link').hidden = !data?.settings.donate?.url;
  const ml = document.getElementById('music-link'); // the day's playlist, on every page
  ml.hidden = !data?.settings.music?.url;
  if (!ml.hidden) { ml.href = data.settings.music.url; ml.title = data.settings.music.title || 'Today’s playlist'; }
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

// refresh: the installed app has no browser refresh button
document.getElementById('refresh').addEventListener('click', async () => {
  try { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); } catch { /* ignore */ }
  location.reload();
});
