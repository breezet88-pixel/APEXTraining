// Apex Training coach page. The only place anything is added, changed or removed.
// Each save is a commit to the GitHub repository (see github.js); GitHub Pages republishes the site.
import { SITE } from './config.js';
import { h, fill, todayIn, nowIn, libraryIndex } from './common.js';
import { cleanWorkouts, cleanClasses, cleanSettings, cleanDonate, cleanMusic, cleanLibrary, checkLinks, usedImages, IMAGE_PATH, DataError } from './validate.js';
import { DAY_NAMES, WEEK_ORDER, classesOn, sameClass, suggestClass, typeInfo, clubsOf, addDays } from './classes.js';
import { TIMER_TYPES, timerSummary, buildSegments, totalSeconds, secLabel, effective } from './timer.js';
import { createGitHub, bytesToBase64, GitHubError } from './github.js';
import { draftWorkout } from './draft.js';

const app = document.getElementById('app');
const tabs = document.getElementById('admin-tabs');
const show = (...nodes) => fill(app, ...nodes);
const KEY_STORE = 'apex.coachKey';
const STYLE_KEY = 'apex.imageStyle';
const MAX_PICTURE = 5 * 1024 * 1024;
const DATA = (f) => `${SITE.root}/data/${f}`;

const state = {
  gh: null,
  head: null,               // commit the data below was loaded from
  workouts: null, classes: null, settings: null, library: null,
  pending: new Map(),       // new pictures not saved yet: path -> base64
  previews: new Map(),      // path -> blob: URL, so new pictures show before GitHub Pages republishes
};

// ---------- key storage (this device only) ----------
const keyGet = () => { try { return localStorage.getItem(KEY_STORE) || sessionStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
const keySet = (k, remember) => { try { (remember ? localStorage : sessionStorage).setItem(KEY_STORE, k); } catch { /* ignore */ } };
const keyClear = () => { try { localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE); } catch { /* ignore */ } };

const say = (el, msg, bad) => { el.textContent = msg; el.className = bad ? 'err' : 'muted'; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const picSrc = (path) => state.previews.get(path) || path;
let fieldSeq = 0;
function field(label, input) { const id = `f${++fieldSeq}`; input.id = id; return h('div', {}, h('label', { for: id }, label), input); }

// ---------- image prompt (paste into your AI image tool) ----------
const DEFAULT_STYLE =
  'Clean flat vector illustration in a consistent style: the same adult athlete in every picture, plain face, dark grey fitted sportswear, ' +
  'solid white background, soft ground shadow. Small teal (#0f766e) arrows show the direction of movement. ' +
  'Same character, same line weight and same colours across the whole series. Landscape 4:3.';
const DEFAULT_RULES = 'Show the same adult athlete in two separate panels: starting position and main movement or finishing position. ' +
  'Use additional panels for exercises with several stages. Keep the entire body and equipment visible, with small arrows indicating movement.';
const SAFE = 'Anatomically correct proportions and natural joint angles, exactly two arms and two legs, correct number of fingers. ' +
  'No text or labels, no watermark, no extra people or equipment.';
const getStyle = () => { try { return localStorage.getItem(STYLE_KEY) || DEFAULT_STYLE; } catch { return DEFAULT_STYLE; } };
const setStyle = (v) => { try { localStorage.setItem(STYLE_KEY, v); } catch { /* ignore */ } };
const rules = () => state.library?.guide?.image_rules || DEFAULT_RULES;
const withKit = (x) => (x.equipment && !/bodyweight/i.test(x.equipment) ? ` (equipment: ${x.equipment})` : '');
// A library exercise: uses its image cue and movement description.
function libraryPrompt(x, style) {
  return [
    `Instructional fitness illustration of the exercise "${x.name || 'the exercise'}"${withKit(x)}.`,
    rules(),
    x.image_cue ? `What to show: ${x.image_cue}` : '',
    x.movement ? `How the movement is done: ${x.movement}` : '',
    SAFE,
    `Style: ${style}`,
  ].filter(Boolean).join('\n\n');
}
// A one-off exercise typed into a workout.
function buildPrompt(ex, style) {
  return [
    `Instructional fitness illustration of the exercise "${ex.name || 'the exercise'}"${withKit(ex)}.`,
    rules(),
    ex.muscles ? `Working muscles: ${ex.muscles}.` : '',
    ex.cues ? `Correct form to show: ${ex.cues}` : '',
    SAFE,
    `Style: ${style}`,
  ].filter(Boolean).join('\n\n');
}

// ---------- shared editor pieces ----------
function sniff(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  const ascii = (s, e) => String.fromCharCode(...b.subarray(s, e));
  if (b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (b.length > 6 && ascii(0, 4) === 'GIF8') return 'gif';
  return null;
}

// Big photos and screenshots are made smaller before upload (longest side 1600 px), so pages stay fast
// on phone data and the repository stays small. Returns a new picture path, waiting to be saved.
const MAX_SIDE = 1600;
async function addPicture(file) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let kind = sniff(bytes);
  if (!kind) throw new DataError(`“${file.name}” is not a PNG, JPG, WebP or GIF picture.`);
  if (bytes.length > 20 * 1024 * 1024) throw new DataError(`“${file.name}” is over 20 MB.`);
  let blob = file;
  if (kind !== 'gif') {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      if (scale < 1 || bytes.length > 1024 * 1024) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        if (out && out.size < bytes.length) { blob = out; bytes = new Uint8Array(await out.arrayBuffer()); kind = 'jpg'; }
      }
      bmp.close?.();
    } catch { /* keep the original */ }
  }
  if (bytes.length > MAX_PICTURE) throw new DataError(`“${file.name}” is still over 5 MB. Use a smaller picture.`);
  const name = `images/${[...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')}.${kind}`;
  state.pending.set(name, bytesToBase64(bytes));
  state.previews.set(name, URL.createObjectURL(blob));
  return name;
}

// Picture upload + preview + remove, for any object with an `image` field.
function pictureEditor(obj, label, status, redraw) {
  const preview = h('img', { class: 'thumb', alt: 'Picture', hidden: !obj.image, src: obj.image ? picSrc(obj.image) : undefined });
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    let name;
    try { name = await addPicture(f); } catch (err) { say(status, err.message, true); return; }
    obj.image = name;
    preview.src = picSrc(name);
    preview.hidden = false;
    say(status, 'Picture added. It goes online when you save.');
  } });
  return h('div', {}, field(label, input), preview,
    obj.image ? h('button', { class: 'btn danger small', type: 'button', onclick: () => { obj.image = ''; redraw(); } }, 'Remove picture') : null);
}

// "✨ Create image prompt" button with a copyable box.
function promptEditor(makeText, status) {
  const box = h('textarea', { readonly: true, rows: 10, 'aria-label': 'Image prompt' });
  const wrap = h('div', { hidden: true }, box,
    h('div', { class: 'toolrow' }, h('button', { class: 'btn small', type: 'button', onclick: async () => {
      box.select();
      try { await navigator.clipboard.writeText(box.value); say(status, 'Prompt copied. Paste it into your image tool.'); }
      catch { say(status, 'Select the text and copy it.'); }
    } }, 'Copy prompt')));
  return h('div', {}, h('div', { class: 'toolrow' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { box.value = makeText(); wrap.hidden = false; } }, '✨ Create image prompt')), wrap);
}

const styleEditor = () => h('details', { class: 'panel' }, h('summary', {}, 'Picture style used in every prompt'),
  h('p', { class: 'muted' }, 'Keep this the same for every exercise so all your pictures look like one set.'),
  h('textarea', { rows: 4, value: getStyle(), 'aria-label': 'Picture style', oninput: (e) => setStyle(e.target.value) }));

// ---------- loading and saving ----------
async function loadAll() {
  const head = await state.gh.headSha();
  const read = async (f, fallback) => { const t = await state.gh.readText(DATA(f), head); return t ? JSON.parse(t) : fallback; };
  const workouts = cleanWorkouts(await read('workouts.json', { workouts: [] }));
  const library = cleanLibrary(await read('exercises.json', { exercises: [] }));
  checkLinks(workouts, library);
  Object.assign(state, {
    head,
    workouts,
    library,
    classes: cleanClasses(await read('classes.json', {})),
    settings: cleanSettings(await read('settings.json', {})),
  });
}

// Apply a change to copies of the data, check it, and save it all as one commit.
async function save(message, change) {
  const next = { workouts: clone(state.workouts), classes: clone(state.classes), settings: clone(state.settings), library: clone(state.library) };
  change(next);
  const workouts = cleanWorkouts(next.workouts);
  const library = cleanLibrary(next.library);
  checkLinks(workouts, library);
  const classes = cleanClasses(next.classes);
  const settings = cleanSettings(next.settings);

  const used = usedImages(workouts, library);
  const stored = (await state.gh.listFiles(`${SITE.root}/images`, state.head)).map((p) => p.slice(SITE.root.length + 1));
  for (const p of used) if (!stored.includes(p) && !state.pending.has(p)) throw new DataError(`A picture is missing (${p}). Upload it again.`);
  const json = (x) => `${JSON.stringify(x, null, 2)}\n`;
  const files = [
    { path: DATA('workouts.json'), text: json(workouts) },
    { path: DATA('classes.json'), text: json(classes) },
    { path: DATA('settings.json'), text: json(settings) },
    { path: DATA('exercises.json'), text: json(library) },
    ...[...state.pending].filter(([p]) => used.has(p)).map(([p, b64]) => ({ path: `${SITE.root}/${p}`, base64: b64 })),
  ];
  const deletes = stored.filter((p) => IMAGE_PATH.test(p) && !used.has(p)).map((p) => `${SITE.root}/${p}`);

  const sha = await state.gh.commit({ message: `Coach: ${message}`, files, deletes, expectedHead: state.head });
  Object.assign(state, { head: sha, workouts, classes, settings, library });
  for (const [p] of [...state.pending]) if (used.has(p)) state.pending.delete(p);
}

// Runs a save and reports the result in `status`. Returns true if it worked.
let lastSaved = '';
async function trySave(status, message, change, okText) {
  say(status, 'Saving to GitHub…');
  try {
    await save(message, change);
    lastSaved = okText || 'Saved. Members see it in about a minute, once GitHub Pages has updated.';
    say(status, lastSaved);
    return true;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 409) {
      fill(status, e.message, ' ', h('button', { class: 'btn small', onclick: () => location.reload() }, 'Reload'));
      status.className = 'err';
    } else say(status, e.message || 'Could not save.', true);
    return false;
  }
}

// ---------- connect ----------
function connectView(message) {
  tabs.hidden = true;
  const msg = h('p', { class: 'err', role: 'alert' }, message || '');
  const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', required: true, placeholder: 'github_pat_…' });
  // in the installed Apex Training Admin app on your own phone, stay signed in by default
  const remember = h('input', { type: 'checkbox', id: 'remember', checked: matchMedia('(display-mode: standalone)').matches || !!navigator.standalone });
  const tokenUrl = 'https://github.com/settings/personal-access-tokens/new';
  show(h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    say(msg, 'Checking with GitHub…');
    try {
      const gh = createGitHub({ token: key.value.trim(), repo: SITE.repo, branch: SITE.branch });
      const c = await gh.check();
      if (!c.canSave) { say(msg, `That key cannot save to ${SITE.repo}. Give it "Contents: Read and write" for this repository.`, true); return; }
      keySet(key.value.trim(), remember.checked);
      await start();
    } catch (err) { say(msg, err.message, true); }
  } },
  h('h1', {}, 'Coach sign in'),
  h('p', {}, 'The coach page saves straight to your GitHub repository, so it signs in with a GitHub key that only you have.'),
  h('ol', { class: 'steps' },
    h('li', {}, 'Open ', h('a', { href: tokenUrl, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub → new fine-grained token'), ' (signed in as the repository owner).'),
    h('li', {}, 'Name it "Apex Training coach". Pick an expiry date (for example 1 year).'),
    h('li', {}, 'Repository access: ', h('b', {}, 'Only select repositories'), ' → ', h('code', {}, SITE.repo), '.'),
    h('li', {}, 'Permissions → Repository: ', h('b', {}, 'Contents: Read and write'), ' and ', h('b', {}, 'Discussions: Read'), '.'),
    h('li', {}, 'Generate, copy the key and paste it here.')),
  field('GitHub key', key),
  h('p', {}, remember, ' ', h('label', { for: 'remember' }, 'Remember on this device (only on your own phone or computer)')),
  h('div', { class: 'toolrow' }, h('button', { class: 'btn', type: 'submit' }, 'Sign in')), msg));
  key.focus();
}

// ---------- workouts ----------
const niceDay = (iso) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`));
// "Friday 05:30 Grid": different for each class, even with three Grid classes on one day
const autoTitle = (c) => [c.date && DAY_NAMES[new Date(`${c.date}T00:00:00Z`).getUTCDay()], c.time, c.type || c.category].filter(Boolean).join(' ');
let presetClass = null; // the class chosen with "+ Add workout", used by the next new workout

function workoutsView(saved = '') {
  const status = h('p', { role: 'status', class: 'muted' }, saved);
  const now = nowIn(SITE.timezone);
  const all = state.workouts.workouts;
  const list = [...all].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.time || '').localeCompare(b.time || '') || b.id - a.id);
  // today's and yesterday's classes from the schedule, each with its workout or an "Add workout" button
  const recent = [now.date, addDays(now.date, -1)].flatMap((d) => classesOn(state.classes, d).map((c) => ({ ...c, d })));
  const days = new Map();
  for (const w of list) { const k = w.date || ''; if (!days.has(k)) days.set(k, []); days.get(k).push(w); }
  show(
    h('div', { class: 'list-item' }, h('h1', {}, 'Workout Library'), h('a', { class: 'btn', href: '#/workouts/new' }, '+ New workout')),
    h('p', { class: 'muted' }, 'After a class, tap “+ Add workout” on it below.'),
    recent.length ? h('div', { class: 'panel' }, h('h2', {}, 'Your classes'),
      recent.map((c) => {
        const w = all.find((x) => sameClass(x, c));
        return h('div', { class: 'list-item' },
          h('div', {}, h('strong', {}, `${c.d === now.date ? 'Today' : 'Yesterday'} ${c.time} · ${c.type}`), h('div', { class: 'muted' }, c.club, c.adhoc ? ' · ad hoc' : '')),
          w ? h('a', { class: 'btn ghost small', href: `#/workouts/${w.id}` }, `✓ ${w.title}`)
            : h('button', { class: 'btn small', onclick: () => { presetClass = c; location.hash = '#/workouts/new'; } }, '+ Add workout'));
      }),
      h('p', { class: 'muted note' }, 'From your ', h('a', { href: '#/classes' }, 'class schedule'), '.')) : null,
    status,
    list.length ? [...days].map(([day, ws]) => h('div', { class: 'panel' },
      h('h2', {}, day ? niceDay(day) : 'No date', ws.length > 1 ? h('span', { class: 'muted' }, ` · ${ws.length} classes`) : null),
      ws.map((w) => h('div', { class: 'list-item' },
        h('div', {}, h('strong', {}, w.title), ' ', h('span', { class: `tag${w.published ? '' : ' draft'}` }, w.published ? 'Published' : 'Hidden'),
          h('div', { class: 'muted' }, [w.time, w.category, w.club, `${w.exercises.length} exercises`, w.timer?.type ? '⏱ timer' : ''].filter(Boolean).join(' · '))),
        h('div', { class: 'toolrow' },
          h('a', { class: 'btn ghost small', href: `#/workouts/${w.id}` }, 'Edit'),
          confirmButton('Delete', `Delete “${w.title}”?`, async () => {
            if (await trySave(status, `delete workout ${w.title}`, (d) => { d.workouts.workouts = d.workouts.workouts.filter((x) => x.id !== w.id); })) workoutsView(lastSaved);
          }))))))
      : h('p', { class: 'panel muted' }, 'No workouts yet. Tap “New workout” to add your first class.'));
}

// A delete button that asks "Are you sure?" inside the page (no pop-ups).
function confirmButton(label, question, onYes) {
  const wrap = h('span', { class: 'toolrow' });
  const ask = () => fill(wrap, h('span', { class: 'err' }, question), ' ',
    h('button', { class: 'btn danger small', onclick: onYes }, `Yes, ${label.toLowerCase()}`),
    h('button', { class: 'btn ghost small', onclick: reset }, 'Cancel'));
  const reset = () => fill(wrap, h('button', { class: 'btn danger small', onclick: ask }, label));
  reset();
  return wrap;
}

function editView(id) {
  const existing = id ? state.workouts.workouts.find((w) => w.id === id) : null;
  if (id && !existing) { show(h('p', { class: 'pad' }, 'Workout not found.'), h('a', { href: '#/workouts' }, '← All workouts')); return; }
  const now = nowIn(SITE.timezone);
  const today = now.date;
  // a new workout starts from your class schedule: the class you picked, or the latest class without a workout yet
  const pre = existing ? null : presetClass || suggestClass(state.classes, state.workouts.workouts, now);
  presetClass = null;
  const wk = existing ? clone(existing) : {
    id: 0, title: pre ? autoTitle(pre) : '', description: '', category: pre?.type || '', level: '', duration_min: '',
    date: pre?.date || today, time: pre?.time || '', club: pre?.club || '', playlist: [], published: true, exercises: [], timer: { type: '' } };
  wk.playlist = wk.playlist || [];
  wk.timer = wk.timer || { type: '' };
  wk.photos = wk.photos || [];
  const clubs = clubsOf(state.classes, state.workouts.workouts);
  const types = state.classes.types.map((t) => t.name);
  const status = h('p', { role: 'status', class: 'muted' });
  const bodyBox = h('div');
  const questionsBox = h('div');
  const exBox = h('div');
  const bind = (obj, key, el) => { el.addEventListener('input', () => { obj[key] = el.value; }); return el; };
  const text = (obj, key, attrs = {}) => bind(obj, key, h('input', { type: 'text', value: obj[key] ?? '', ...attrs }));
  const clubList = () => [h('datalist', { id: 'club-list' }, clubs.map((c) => h('option', { value: c }))),
    h('datalist', { id: 'type-list' }, types.map((c) => h('option', { value: c })))];
  const exNames = () => { const lib = libraryIndex(state.library); return wk.exercises.map((e) => (e.library_id ? lib.get(e.library_id)?.name : e.name) || 'Exercise'); };

  // ---- 0. which class: pre-filled from the class schedule ----
  const classBox = h('div');
  function pickClass(c) {
    const wasAuto = !wk.title || wk.title === autoTitle(wk);
    Object.assign(wk, { date: c.date, time: c.time, club: c.club, category: c.type });
    if (wasAuto) wk.title = autoTitle(c);
    drawClasses();
    drawBody();
  }
  function drawClasses() {
    const list = classesOn(state.classes, wk.date);
    fill(classBox, h('div', { class: 'panel' },
      h('h2', {}, '📅 Which class?'),
      pre && !existing ? h('p', { class: 'muted' }, `Pre-filled from your class schedule: ${niceDay(pre.date)}, ${pre.time} ${pre.type} at ${pre.club}. Wrong class? Pick another.`) : null,
      h('div', { class: 'row' }, field('Class date', h('input', { type: 'date', value: wk.date || '', onchange: (e) => { wk.date = e.target.value; drawClasses(); drawBody(); } }))),
      list.length ? h('div', { class: 'chips class-pick', role: 'group', 'aria-label': 'Classes on this day' }, list.map((c) => {
        const on = sameClass(wk, c);
        const logged = state.workouts.workouts.some((w) => w.id !== wk.id && sameClass(w, c));
        return h('button', { type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => pickClass(c) },
          `${c.time} ${c.type} · ${c.club}${c.adhoc ? ' (ad hoc)' : ''}${logged ? ' ✓' : ''}`);
      })) : h('p', { class: 'muted' }, 'No classes on your schedule for this day.'),
      h('p', { class: 'muted note' }, '✓ = already in the Workout Library. An extra class? Type its time, club and class type under “The class” below, or add it to ',
        h('a', { href: '#/classes' }, 'Class schedule → Ad hoc classes'), '.')));
  }

  // ---- 1. the class timer: set it first, then explain the workout ----
  const timerBox = h('div');
  function drawTimer() {
    const t = wk.timer;
    const sum = h('p', { class: 'facts' });
    const refresh = () => {
      const segs = buildSegments(t, exNames());
      const total = totalSeconds(segs);
      sum.textContent = t.type ? `${timerSummary(t) || 'Fill in the timer settings.'}${total ? ` · about ${secLabel(total)} with ${wk.exercises.length || 'no'} exercise${wk.exercises.length === 1 ? '' : 's'}` : ''}` : '';
    };
    const num = (key, label, placeholder) => field(label, h('input', { type: 'number', min: 0, inputmode: 'numeric', value: t[key] ?? '', placeholder,
      oninput: (e) => { t[key] = e.target.value; refresh(); } }));
    const type = h('select', { 'aria-label': 'Timer type', onchange: (e) => { t.type = e.target.value; drawTimer(); } },
      Object.entries(TIMER_TYPES).map(([k, v]) => h('option', { value: k }, v)));
    type.value = t.type || '';
    const tab = t.type === 'tabata';
    const order = h('select', { onchange: (e) => { t.order = e.target.value; refresh(); } },
      h('option', { value: 'circuit' }, 'Circuit: every exercise, then the next round'), h('option', { value: 'station' }, 'Station: all rounds of one exercise, then the next'));
    order.value = t.order || 'circuit';
    const upStatus = h('p', { role: 'status', class: 'muted' });
    fill(timerBox, h('details', { class: 'panel', open: !!t.type },
      h('summary', {}, '⏱ Class timer', t.type ? ` · ${TIMER_TYPES[t.type]}` : ' (optional)'),
      h('p', { class: 'muted' }, 'Members get a timer that runs it, calling out each exercise.'),
      field('Timer', type),
      t.type === 'intervals' || tab ? [
        h('div', { class: 'row' }, num('work_sec', 'Work (seconds)', tab ? '20' : '40'), num('rest_sec', 'Rest (seconds)', tab ? '10' : '20'), num('rounds', 'Rounds', tab ? '8' : '4')),
        h('div', { class: 'row' }, num('round_rest_sec', 'Longer rest between rounds (seconds, optional)', '60'), field('Order', order))] : null,
      t.type === 'emom' ? h('div', { class: 'row' }, num('minutes', 'Minutes', '12'), num('work_sec', 'Interval (seconds)', '60')) : null,
      t.type === 'amrap' ? h('div', { class: 'row' }, num('minutes', 'Minutes', '20')) : null,
      t.type === 'fortime' ? h('div', { class: 'row' }, num('minutes', 'Time cap (minutes, optional)', '25')) : null,
      sum,
      field('Timer notes (optional)', bind(t, 'notes', h('input', { type: 'text', maxlength: 300, value: t.notes || '', placeholder: 'e.g. Interval Timer app, preset “Friday Grid”' }))),
      pictureEditor(t, 'Screenshot of your timer (optional)', upStatus, drawTimer),
      upStatus));
    refresh();
  }
  const drawExercises = () => fill(exBox, wk.exercises.map((ex, i) => exerciseCard(ex, i)));

  // ---- 1. talk it through: speech (where the browser supports it) or typing, then draft ----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const talkStatus = h('p', { role: 'status', class: 'muted' });
  const talk = h('textarea', { rows: 6, 'aria-label': 'Describe the class',
    placeholder: 'e.g. “Today at Virgin Active Sandton, 6am class. 4 rounds, 40 seconds on 20 off: kettlebell swings, goblet squats, mountain climbers. Then 3 sets of 10 push-ups, rest 60 seconds.”' });
  let rec = null;
  let listening = false;
  const micBtn = SR ? h('button', { class: 'btn mic', type: 'button' }, '🎤 Start talking') : null;
  const stopUI = () => { listening = false; if (micBtn) { micBtn.textContent = '🎤 Start talking'; micBtn.classList.remove('live'); } };
  micBtn?.addEventListener('click', () => {
    if (listening) { listening = false; rec?.stop(); say(talkStatus, 'Stopped. Check the text, then tap “Draft my workout”.'); return; }
    const base = talk.value.trim() ? `${talk.value.trim()} ` : '';
    let finals = '';
    rec = new SR();
    rec.lang = 'en-ZA';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += `${r[0].transcript.trim()}. `; else interim += r[0].transcript;
      }
      talk.value = base + finals + interim;
    };
    rec.onerror = (e) => {
      listening = false;
      say(talkStatus, e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'The microphone is blocked for this site. Allow it in your browser settings, or type (your keyboard’s microphone key works too).'
        : `Listening stopped (${e.error}). Tap “Start talking” to carry on.`, true);
    };
    rec.onend = () => { if (listening) { try { rec.start(); } catch { stopUI(); } } else stopUI(); }; // keep going until you tap Stop
    try { rec.start(); } catch { say(talkStatus, 'Could not start the microphone. Type instead.', true); return; }
    listening = true;
    micBtn.textContent = '⏹ Stop';
    micBtn.classList.add('live');
    say(talkStatus, 'Listening… talk through the class: where and when, then each exercise with its reps, time or rest. Tap Stop when you are done.');
  });
  const draftBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
    if (listening) { listening = false; rec?.stop(); }
    const { draft, questions: asked } = draftWorkout(talk.value, { library: state.library, clubs, types, today });
    const spokenTitle = !asked.some((q) => q.key === 'title');
    const auto = autoTitle(wk);
    const dateChanged = draft.date && draft.date !== wk.date;
    // a general word like "AMRAP" (HIIT) never replaces the class type from your schedule (Grid)
    if (draft.category && !types.includes(draft.category) && types.includes(wk.category)) draft.category = '';
    for (const k of ['date', 'time', 'club', 'category', 'level', 'duration_min', 'description']) if (draft[k] !== '' && draft[k] !== undefined) wk[k] = draft[k];
    if (spokenTitle) wk.title = draft.title;
    if (draft.exercises.length) wk.exercises = draft.exercises;
    if (draft.timer) wk.timer = { ...wk.timer, ...draft.timer };
    // with an interval timer the timer sets the work time, so exercises need no rep count
    const tm = effective(wk.timer);
    const timed = tm && ['intervals', 'tabata', 'emom'].includes(tm.type) && tm.work;
    if (timed && tm.type !== 'emom') for (const e of wk.exercises) if (!e.reps && !e.sets) { e.reps = `${tm.work} sec`; e.sets = String(tm.rounds); }
    // fill the gaps from the class schedule, e.g. "Grid this morning" -> 06:30 at Virgin Active Rosebank
    const said = { time: draft.time, club: draft.club, type: types.includes(draft.category) ? draft.category : '' };
    const fits = classesOn(state.classes, wk.date).filter((c) => (!said.time || c.time === said.time) && (!said.club || c.club === said.club) && (!said.type || c.type === said.type));
    if (fits.length === 1) Object.assign(wk, { time: fits[0].time, club: fits[0].club, category: fits[0].type });
    else if (dateChanged || (!fits.length && (said.time || said.club || said.type))) {
      // what was pre-filled no longer fits what you said: ask instead of guessing
      if (!said.time) wk.time = '';
      if (!said.club) wk.club = '';
      if (!said.type && types.includes(wk.category)) wk.category = '';
    }
    if (!spokenTitle) wk.title = (!wk.title || wk.title === auto) && wk.category && wk.time ? autoTitle(wk) : wk.title || draft.title;
    const questions = asked.filter((q) => !(['date', 'time', 'club'].includes(q.key) && wk[q.key]) && !(q.key === 'title' && wk.title !== draft.title)
      && !(q.key === 'reps' && timed));
    drawClasses();
    drawTimer();
    drawBody();
    drawQuestions(questions);
    say(talkStatus, draft.exercises.length
      ? `Drafted ${draft.exercises.length} exercise${draft.exercises.length === 1 ? '' : 's'}. ${questions.length ? 'Answer the questions below, then check everything and save.' : 'Check everything below, then save.'}`
      : 'No exercises found yet. See the tip below.');
    questionsBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } }, '✍️ Draft my workout');
  const notesFile = h('input', { type: 'file', accept: '.txt,.md,.text,.csv,text/plain,text/markdown', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 200000) { say(talkStatus, 'That file is too big for notes (up to 200 KB of text).', true); return; }
    const txt = (await f.text()).replace(/\r\n?/g, '\n').trim();
    talk.value = talk.value.trim() ? `${talk.value.trim()}\n${txt}` : txt;
    e.target.value = '';
    say(talkStatus, `Added your notes from “${f.name}”. Check them, then tap “Draft my workout”.`);
  } });
  const talkPanel = h(existing ? 'details' : 'div', { class: 'panel talk' },
    existing ? h('summary', {}, '🎤 Talk it through or paste notes (redraft this workout)') : h('h2', {}, '🎤 Talk it through, or paste your notes'),
    h('p', { class: 'muted' }, SR
      ? 'Say or type each exercise with its sets, reps, time or rest, then tap “Draft my workout”.'
      : 'Type each exercise with its sets, reps, time or rest (your keyboard’s microphone key lets you talk), then tap “Draft my workout”.'),
    talk,
    h('div', { class: 'toolrow' }, micBtn, draftBtn),
    field('📄 Or upload notes (a text file from your notes app)', notesFile),
    h('details', { class: 'about' }, h('summary', {}, 'Tips'),
      h('p', { class: 'muted note' }, 'Notes work best one exercise per line, e.g. “Timer: 40/20 x 4”, then “10 kettlebell swings”, “12 goblet squats”. ',
        'From a phone notes app you can also Share → Copy and paste here. Handwritten notes or a screenshot: use your phone’s “copy text from photo” (Google Lens, or Live Text on iPhone) and paste.')),
    talkStatus);

  // ---- 2. questions about anything the draft could not work out ----
  function drawQuestions(questions) {
    if (!questions.length) { fill(questionsBox); return; }
    const lib = libraryIndex(state.library);
    const row = (q, input) => h('div', { class: 'question' }, h('label', {}, q.text), input);
    fill(questionsBox, h('div', { class: 'panel questions' }, h('h2', {}, 'A few questions'),
      questions.map((q) => {
        const ex = q.index !== undefined ? wk.exercises[q.index] : null;
        const exName = ex ? (ex.library_id ? lib.get(ex.library_id)?.name : ex.name) : '';
        if (q.key === 'date') return row(q, h('input', { type: 'date', value: wk.date, onchange: (e) => { wk.date = e.target.value; drawBody(); } }));
        if (q.key === 'time') return row(q, h('input', { type: 'time', value: wk.time, onchange: (e) => { wk.time = e.target.value; drawBody(); } }));
        if (q.key === 'club') return row(q, h('input', { type: 'text', value: wk.club, list: 'club-list', placeholder: 'e.g. Virgin Active Sandton', onchange: (e) => { wk.club = e.target.value; drawBody(); } }));
        if (q.key === 'title') return row(q, h('input', { type: 'text', value: wk.title, onchange: (e) => { wk.title = e.target.value; drawBody(); } }));
        if (q.key === 'reps' && ex) return row({ text: `Exercise ${q.index + 1} (${exName}): how many reps, or how long?` },
          h('input', { type: 'text', value: ex.reps, placeholder: '10, 40 sec, 8 each side…', onchange: (e) => { ex.reps = e.target.value; drawBody(); } }));
        if (q.key === 'match' && ex) {
          const own = ex.name;
          return row(q, h('select', { onchange: (e) => {
            const v = e.target.value;
            const keep = { sets: ex.sets, reps: ex.reps, rest_sec: ex.rest_sec, cues: ex.cues };
            wk.exercises[q.index] = v === 'own' ? { name: own, muscles: '', equipment: '', image: '', ...keep } : { library_id: Number(v), ...keep };
            drawBody();
          } }, h('option', { value: 'own' }, `Keep “${own}” as my own exercise`),
          q.options.map((o) => h('option', { value: o.id }, `Library: ${o.name}`)),
          state.library.exercises.filter((x) => !q.options.some((o) => o.id === x.id)).map((x) => h('option', { value: x.id }, `Library: ${x.name}`))));
        }
        return h('p', { class: 'muted' }, q.text);
      })));
  }

  // ---- 3. the workout itself (everything editable) ----
  function exerciseCard(ex, i) {
    const upStatus = h('p', { role: 'status', class: 'muted' });
    const move = (d) => () => {
      const j = i + d;
      if (j < 0 || j >= wk.exercises.length) return;
      [wk.exercises[i], wk.exercises[j]] = [wk.exercises[j], wk.exercises[i]];
      drawExercises();
    };
    const lib = ex.library_id ? libraryIndex(state.library).get(ex.library_id) : null;
    // dropdown: pick or change the exercise from the library, or make it your own
    const choose = libSelect(lib ? String(lib.id) : 'own', `Exercise ${i + 1}`);
    choose.addEventListener('change', () => {
      const keep = { sets: ex.sets, reps: ex.reps, rest_sec: ex.rest_sec, cues: ex.cues };
      wk.exercises[i] = choose.value === 'own'
        ? { name: lib ? lib.name : ex.name || '', muscles: '', equipment: lib ? lib.equipment : '', image: '', ...keep }
        : { library_id: Number(choose.value), ...keep };
      drawExercises();
    });
    const head = h('div', { class: 'list-item' }, h('div', { class: 'ex-choose' }, h('strong', {}, `Exercise ${i + 1}`), choose),
      h('div', { class: 'toolrow' },
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Move up', onclick: move(-1) }, '↑'),
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Move down', onclick: move(1) }, '↓'),
        h('button', { class: 'btn danger small', type: 'button', onclick: () => { wk.exercises.splice(i, 1); drawExercises(); } }, 'Remove')));
    const setsRow = h('div', { class: 'row' },
      field('Sets / rounds', text(ex, 'sets', { placeholder: '3', maxlength: 20 })),
      field('Reps or time', text(ex, 'reps', { placeholder: '10-12 or 40 sec', maxlength: 40 })),
      field('Rest (seconds)', text(ex, 'rest_sec', { inputmode: 'numeric', placeholder: '60' })));
    if (lib) {
      return h('div', { class: 'panel' }, head,
        h('p', { class: 'muted' }, lib.equipment || 'Library exercise', ' · ', h('a', { href: `#/library/${lib.id}` }, 'see in the library'),
          lib.image ? '' : h('span', { class: 'muted' }, ' · no picture yet')),
        lib.image ? h('img', { class: 'thumb', src: picSrc(lib.image), alt: `${lib.name} picture` }) : null,
        setsRow,
        field('Notes for this workout (optional)', bind(ex, 'cues', h('textarea', { maxlength: 1500, value: ex.cues || '', placeholder: 'e.g. Warm-up, or go light this week' }))));
    }
    return h('div', { class: 'panel' }, head,
      h('div', { class: 'row' },
        field('Exercise name', text(ex, 'name', { required: true, maxlength: 120 })),
        field('Muscles worked', text(ex, 'muscles', { placeholder: 'Quads, glutes' })),
        field('Equipment', text(ex, 'equipment', { placeholder: 'Dumbbell, or none' }))),
      setsRow,
      field('Notes / how to do it', bind(ex, 'cues', h('textarea', { maxlength: 1500, value: ex.cues || '' }))),
      h('p', { class: 'muted note' }, 'Not in your library, so members see a “Look it up on Google” link.'),
      pictureEditor(ex, 'Picture (optional)', upStatus, drawExercises),
      upStatus);
  }

  const pickLib = h('select', { 'aria-label': 'Exercise from the library' },
    h('option', { value: '' }, 'Choose an exercise from the library…'),
    [...new Set(state.library.exercises.map((x) => x.equipment || 'Other'))].map((g) => h('optgroup', { label: g },
      state.library.exercises.filter((x) => (x.equipment || 'Other') === g).map((x) => h('option', { value: x.id }, x.name)))));
  function libSelect(value, label) {
    const sel = h('select', { 'aria-label': `${label}: choose the exercise` },
      h('option', { value: 'own' }, 'My own exercise (not in the library)'),
      [...new Set(state.library.exercises.map((x) => x.equipment || 'Other'))].map((g) => h('optgroup', { label: g },
        state.library.exercises.filter((x) => (x.equipment || 'Other') === g).map((x) => h('option', { value: x.id }, x.name)))));
    sel.value = value;
    return sel;
  }

  // ---- pictures and screenshots for the class: choose several at once ----
  function photoEditor() {
    const box = h('div');
    const photoStatus = h('p', { role: 'status', class: 'muted' });
    const input = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp,image/gif', 'aria-label': 'Add pictures or screenshots', onchange: async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      const room = 20 - wk.photos.length;
      if (room <= 0) { say(photoStatus, 'A workout can have up to 20 pictures.', true); return; }
      say(photoStatus, `Adding ${Math.min(files.length, room)} picture${files.length === 1 ? '' : 's'}…`);
      const problems = [];
      for (const f of files.slice(0, room)) {
        try { wk.photos.push({ image: await addPicture(f), caption: '' }); } catch (err) { problems.push(err.message); }
      }
      draw();
      if (files.length > room) problems.push(`Only the first ${room} were added: a workout can have up to 20 pictures.`);
      say(photoStatus, problems.length ? problems.join(' ') : 'Added. Write a caption if it helps, then save the workout.', problems.length > 0);
    } });
    const move = (i, d) => () => { const j = i + d; if (j < 0 || j >= wk.photos.length) return; [wk.photos[i], wk.photos[j]] = [wk.photos[j], wk.photos[i]]; draw(); };
    const draw = () => fill(box, wk.photos.map((p, i) => h('div', { class: 'photo-row' },
      h('img', { class: 'thumb', src: picSrc(p.image), alt: `Picture ${i + 1}` }),
      h('div', {},
        field(`Caption for picture ${i + 1} (optional)`, bind(p, 'caption', h('input', { type: 'text', maxlength: 200, value: p.caption || '', placeholder: 'e.g. Whiteboard, or timer settings' }))),
        h('div', { class: 'toolrow' },
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Move up', onclick: move(i, -1) }, '↑'),
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Move down', onclick: move(i, 1) }, '↓'),
          h('button', { class: 'btn danger small', type: 'button', onclick: () => { wk.photos.splice(i, 1); draw(); } }, 'Remove'))))));
    draw();
    return h('div', { class: 'panel' }, h('h2', {}, '📷 Pictures & screenshots'),
      h('p', { class: 'muted' }, 'Add as many as you need (up to 20): the whiteboard, your timer, your notes, the class. Choose several at once. Members see them on the workout and in downloads. Big photos are made smaller automatically.'),
      field('Add pictures or screenshots', input), photoStatus, box);
  }

  function playlistEditor() {
    const box = h('div');
    const draw = () => fill(box,
      wk.playlist.map((p, i) => h('div', { class: 'row playlist-row' },
        field(`YouTube link ${i + 1}`, bind(p, 'url', h('input', { type: 'url', value: p.url, placeholder: 'https://youtube.com/playlist?list=…' }))),
        field('Name (optional)', bind(p, 'title', h('input', { type: 'text', value: p.title || '', maxlength: 80, placeholder: 'e.g. Friday HIIT mix' }))),
        h('div', {}, h('button', { class: 'btn danger small', type: 'button', onclick: () => { wk.playlist.splice(i, 1); draw(); } }, 'Remove')))),
      wk.playlist.length < 10 ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => { wk.playlist.push({ url: '', title: '' }); draw(); } }, '+ Add a YouTube link') : null);
    draw();
    return h('div', { class: 'panel' }, h('h2', {}, '🎵 Class playlist'),
      h('p', { class: 'muted' }, 'Paste the YouTube link (playlist or video) of the music you played, so members can train to it too.'), box);
  }

  function drawBody() {
    const published = h('input', { type: 'checkbox', id: 'pub', checked: !!wk.published, onchange: (e) => { wk.published = e.target.checked; } });
    drawExercises();
    fill(bodyBox,
      h('div', { class: 'panel' },
        h('h2', {}, 'The class'),
        h('div', { class: 'row' },
          field('Workout name', text(wk, 'title', { required: true, maxlength: 120 })),
          field('Date of the class', bind(wk, 'date', h('input', { type: 'date', value: wk.date || '', onchange: () => drawClasses() }))),
          field('Start time', bind(wk, 'time', h('input', { type: 'time', value: wk.time || '' }))),
          field('Club', text(wk, 'club', { list: 'club-list', maxlength: 80, placeholder: 'e.g. Virgin Active Sandton' }))),
        clubList(),
        h('div', { class: 'row' },
          field('Class type', text(wk, 'category', { list: 'type-list', placeholder: types.slice(0, 3).join(', ') || 'Grid, Hyrox, HIIT…', maxlength: 40 })),
          field('Level', text(wk, 'level', { placeholder: 'Beginner', maxlength: 40 })),
          field('Duration (minutes)', text(wk, 'duration_min', { inputmode: 'numeric', placeholder: '45' }))),
        typeInfo(state.classes, wk.category)?.description ? h('p', { class: 'muted note' }, `Members also see your description of ${wk.category}: “${typeInfo(state.classes, wk.category).description}”`) : null,
        field('Description', bind(wk, 'description', h('textarea', { maxlength: 2000, value: wk.description || '', placeholder: 'e.g. 4 rounds, 40 seconds on and 20 off.' }))),
        h('p', {}, published, ' ', h('label', { for: 'pub' }, 'Published (shown in the Workout Library)'))),
      photoEditor(),
      h('h2', {}, 'Exercises'),
      exBox,
      h('div', { class: 'panel' },
        h('div', { class: 'row' }, pickLib),
        h('div', { class: 'toolrow' },
          h('button', { class: 'btn', type: 'button', onclick: () => {
            if (!pickLib.value) return;
            wk.exercises.push({ library_id: Number(pickLib.value), sets: '', reps: '', rest_sec: '', cues: '' });
            pickLib.value = '';
            drawExercises();
          } }, '+ Add from library'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { wk.exercises.push({ name: '', muscles: '', equipment: '', sets: '', reps: '', rest_sec: '', cues: '', image: '' }); drawExercises(); } }, '+ Exercise not in the library'))),
      playlistEditor());
  }

  const saveBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    saveBtn.disabled = true;
    const isNew = !wk.id;
    const ok = await trySave(status, `${isNew ? 'add' : 'update'} workout ${wk.title || ''}`.trim(), (d) => {
      const item = { ...wk, updated_at: new Date().toISOString(), playlist: wk.playlist.filter((p) => p.url.trim()),
        exercises: wk.exercises.map((e) => ({ ...e, rest_sec: e.rest_sec === '' ? null : e.rest_sec })) };
      if (isNew) { item.id = Math.max(0, ...d.workouts.workouts.map((x) => x.id)) + 1; d.workouts.workouts.push(item); wk.id = item.id; }
      else d.workouts.workouts = d.workouts.workouts.map((x) => (x.id === wk.id ? item : x));
    }, wk.published ? 'Saved. It appears in the Workout Library in about a minute.' : 'Saved as hidden: members do not see it.');
    if (!ok && isNew) wk.id = 0;
    saveBtn.disabled = false;
    if (ok && isNew) history.replaceState(null, '', `#/workouts/${wk.id}`);
  } }, 'Save workout');

  drawClasses();
  drawTimer();
  drawBody();
  show(
    h('a', { class: 'back', href: '#/workouts' }, '← All workouts'),
    h('h1', {}, existing ? `Edit: ${existing.title}` : 'New workout'),
    classBox,
    timerBox,
    talkPanel,
    questionsBox,
    bodyBox,
    h('div', { class: 'toolrow' }, saveBtn),
    status);
}

// ---------- exercise library ----------
function libraryView(saved = '') {
  const status = h('p', { role: 'status', class: 'muted' }, saved);
  const lib = state.library.exercises;
  const done = lib.filter((x) => x.image).length;
  let filter = '';
  const listBox = h('div');
  const groups = [...new Set(lib.map((x) => x.equipment || 'Other'))];
  const chips = h('div', { class: 'chips' });
  const draw = () => {
    fill(chips, ['', 'missing', ...groups].map((g) => h('button', { class: `chip${g === filter ? ' on' : ''}`, onclick: () => { filter = g; draw(); } },
      g === '' ? 'All' : g === 'missing' ? `No picture (${lib.length - done})` : g)));
    const shown = lib.filter((x) => !filter || (filter === 'missing' ? !x.image : (x.equipment || 'Other') === filter));
    fill(listBox, h('div', { class: 'panel' }, shown.length ? shown.map((x) => h('div', { class: 'list-item' },
      h('div', {}, h('strong', {}, `${x.id}. ${x.name}`), ' ', x.image ? h('span', { class: 'tag' }, 'Picture ✓') : h('span', { class: 'tag draft' }, 'No picture'),
        h('div', { class: 'muted' }, x.equipment || '—')),
      h('a', { class: 'btn ghost small', href: `#/library/${x.id}` }, 'Edit'))) : h('p', { class: 'muted' }, 'Nothing here.')));
  };
  draw();
  show(
    h('div', { class: 'list-item' }, h('h1', {}, 'Exercise library'), h('a', { class: 'btn', href: '#/library/new' }, '+ New exercise')),
    h('p', {}, `${lib.length} exercises · pictures added for ${done} of ${lib.length}.`),
    h('p', { class: 'muted' }, 'Upload each exercise’s picture once here; every workout that uses the exercise shows it.'),
    status, chips, listBox);
}

function libraryEditView(id) {
  const found = id ? state.library.exercises.find((x) => x.id === id) : null;
  if (id && !found) { show(h('p', { class: 'pad' }, 'Exercise not found.'), h('a', { href: '#/library' }, '← Exercise library')); return; }
  const x = found ? clone(found) : { id: 0, name: '', equipment: '', summary: '', key_points: [], movement: '', image_cue: '', image: '', sources: [] };
  const kp = h('textarea', { rows: 4, maxlength: 800, value: (x.key_points || []).join('\n'), placeholder: 'One per line, e.g.\nHinge: push the hips back\nKeep the back flat' });
  kp.addEventListener('input', () => { x.key_points = kp.value.split('\n').map((s) => s.trim()).filter(Boolean); });
  const status = h('p', { role: 'status', class: 'muted' });
  const upStatus = h('p', { role: 'status', class: 'muted' });
  const picBox = h('div');
  const drawPic = () => fill(picBox, pictureEditor(x, 'Picture (from your image tool)', upStatus, drawPic));
  drawPic();
  const bind = (key, el) => { el.addEventListener('input', () => { x[key] = el.value; }); return el; };
  const kit = h('datalist', { id: 'kit-list' }, [...new Set(state.library.exercises.map((e) => e.equipment).filter(Boolean))].map((q) => h('option', { value: q })));
  const usedIn = id ? state.workouts.workouts.filter((w) => w.exercises.some((e) => e.library_id === id)) : [];
  const saveBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    saveBtn.disabled = true;
    const isNew = !x.id;
    const ok = await trySave(status, `${isNew ? 'add' : 'update'} library exercise ${x.name}`, (d) => {
      const item = clone(x);
      if (isNew) { item.id = Math.max(0, ...d.library.exercises.map((e) => e.id)) + 1; d.library.exercises.push(item); x.id = item.id; }
      else d.library.exercises = d.library.exercises.map((e) => (e.id === x.id ? item : e));
    });
    if (!ok && isNew) x.id = 0;
    saveBtn.disabled = false;
    if (ok && isNew) history.replaceState(null, '', `#/library/${x.id}`);
  } }, 'Save exercise');
  show(
    h('a', { class: 'back', href: '#/library' }, '← Exercise library'),
    h('div', { class: 'panel' },
      h('div', { class: 'row' },
        field('Exercise name', bind('name', h('input', { type: 'text', value: x.name, maxlength: 120, required: true }))),
        field('Equipment', bind('equipment', h('input', { type: 'text', value: x.equipment, maxlength: 40, list: 'kit-list', placeholder: 'Kettlebell, Dumbbell, Mat and bodyweight…' })))),
      kit,
      field('Short description (one line: what it is and what it works)', bind('summary', h('input', { type: 'text', maxlength: 200, value: x.summary || '', placeholder: 'e.g. A squat holding the kettlebell at the chest. Builds the legs and glutes.' }))),
      field('Key points (up to 5 short cues, one per line, shown to members first)', kp),
      field('Movement (how to do it, shown to members)', bind('movement', h('textarea', { rows: 6, maxlength: 2000, value: x.movement }))),
      field('Image cue (what the picture should show)', bind('image_cue', h('textarea', { rows: 3, maxlength: 1000, value: x.image_cue }))),
      x.sources?.length ? h('p', { class: 'muted note' }, 'Guidance: ', x.sources.map((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title)])) : null),
    h('div', { class: 'panel' },
      h('h2', {}, 'Picture'),
      promptEditor(() => libraryPrompt(x, getStyle()), upStatus),
      picBox, upStatus),
    styleEditor(),
    h('div', { class: 'toolrow' }, saveBtn,
      x.id ? (usedIn.length
        ? h('span', { class: 'muted' }, `Used in ${usedIn.map((w) => `“${w.title}”`).join(', ')}: remove it from ${usedIn.length > 1 ? 'those workouts' : 'that workout'} before deleting.`)
        : confirmButton('Delete', `Delete “${x.name}” from the library?`, async () => {
          if (await trySave(status, `delete library exercise ${x.name}`, (d) => { d.library.exercises = d.library.exercises.filter((e) => e.id !== x.id); })) { location.hash = '#/library'; }
        })) : null),
    status);
}

// ---------- class schedule ----------
function classesView(saved = '') {
  const c = clone(state.classes);
  const status = h('p', { role: 'status', class: 'muted' }, saved);
  const today = todayIn(SITE.timezone);
  const from = addDays(today, -30);
  const typesBox = h('div');
  const weeklyBox = h('div');
  const extraBox = h('div');
  const clubs = clubsOf(c, state.workouts.workouts);
  const inp = (obj, key, attrs) => { const el = h('input', { value: obj[key] ?? '', ...attrs }); el.addEventListener('input', () => { obj[key] = el.value; }); return el; };
  const remove = (list, i, redraw) => h('div', {}, h('button', { class: 'btn danger small', type: 'button', onclick: () => { list.splice(i, 1); redraw(); } }, 'Remove'));
  const slot = (x) => [
    field('Time', inp(x, 'time', { type: 'time', required: true })),
    field('Class type', inp(x, 'type', { type: 'text', list: 'sched-types', maxlength: 40, placeholder: 'Grid' })),
    field('Club', inp(x, 'club', { type: 'text', list: 'sched-clubs', maxlength: 80, placeholder: 'Virgin Active Rosebank' }))];
  const lists = () => [h('datalist', { id: 'sched-types' }, c.types.map((t) => h('option', { value: t.name }))), h('datalist', { id: 'sched-clubs' }, clubs.map((x) => h('option', { value: x })))];

  const drawWeekly = () => fill(weeklyBox, c.weekly.map((x, i) => {
    const day = h('select', { onchange: (e) => { x.day = Number(e.target.value); } }, WEEK_ORDER.map((d) => h('option', { value: d }, DAY_NAMES[d])));
    day.value = String(x.day);
    return h('div', { class: 'row sched-row' }, field('Day', day), slot(x), remove(c.weekly, i, drawWeekly));
  }), h('button', { class: 'btn ghost small', type: 'button', onclick: () => { c.weekly.push({ day: 1, time: '', type: '', club: '' }); drawWeekly(); } }, '+ Add a weekly class'));

  const drawExtra = () => {
    const shown = c.extra.map((x, i) => [x, i]).filter(([x]) => !x.date || x.date >= from);
    const hidden = c.extra.length - shown.length;
    fill(extraBox,
      shown.length ? shown.map(([x, i]) => h('div', { class: 'row sched-row' }, field('Date', inp(x, 'date', { type: 'date', required: true })), slot(x), remove(c.extra, i, drawExtra)))
        : h('p', { class: 'muted' }, 'No ad hoc classes.'),
      hidden ? h('p', { class: 'muted note' }, `${hidden} older ad hoc class${hidden === 1 ? ' is' : 'es are'} kept but not shown.`) : null,
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { c.extra.push({ date: today, time: '', type: '', club: '' }); drawExtra(); } }, '+ Add an ad hoc class'));
  };

  const drawTypes = () => fill(typesBox, c.types.map((t, i) => h('div', { class: 'panel' },
    h('div', { class: 'row' }, field('Class type', inp(t, 'name', { type: 'text', maxlength: 40, required: true, placeholder: 'Grid' })),
      field('Length (minutes)', inp(t, 'minutes', { type: 'number', min: 1, max: 300, inputmode: 'numeric', placeholder: '45' })), remove(c.types, i, drawTypes)),
    field('Link for members (optional, e.g. the Virgin Active class page)', inp(t, 'link', { type: 'url', maxlength: 500, placeholder: 'https://…' })),
    field('Short description (members see it on every workout of this type)', (() => {
      const el = h('textarea', { maxlength: 500, rows: 3, value: t.description || '', placeholder: 'What the class is and who it suits, in a sentence or two.' });
      el.addEventListener('input', () => { t.description = el.value; });
      return el;
    })()))),
  h('button', { class: 'btn ghost small', type: 'button', onclick: () => { c.types.push({ name: '', description: '' }); drawTypes(); } }, '+ Add a class type'));

  const saveBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    saveBtn.disabled = true;
    if (await trySave(status, 'class schedule', (d) => { d.classes = c; }, 'Saved. New workouts are pre-filled from this schedule.')) classesView(lastSaved);
    else saveBtn.disabled = false;
  } }, 'Save class schedule');

  drawWeekly(); drawExtra(); drawTypes();
  show(
    h('h1', {}, 'Class schedule'),
    h('p', { class: 'muted' }, 'Your classes: when you add a workout, the date, time, club and class type are filled in from here, so you only explain the workout. Several classes on one day is fine.'),
    lists(),
    h('div', { class: 'panel' }, h('h2', {}, 'Weekly timetable'), h('p', { class: 'muted' }, 'The classes you teach every week.'), weeklyBox),
    h('div', { class: 'panel' }, h('h2', {}, 'Ad hoc classes'), h('p', { class: 'muted' }, 'One-off classes: a cover, an extra session or a special event. Same details, with the date instead of the day.'), extraBox),
    h('h2', {}, 'Class types'),
    h('p', { class: 'muted' }, 'A short description of each type of class. Members see it on the workouts, so they know what the class is about.'),
    typesBox,
    h('div', { class: 'toolrow' }, saveBtn),
    status,
    h('p', { class: 'muted note' }, 'The schedule is saved in your public repository, like the workouts.'));
}

// ---------- comments ----------
function commentsView() {
  const c = clone(state.settings.comments);
  const status = h('p', { role: 'status', class: 'muted' });
  const repoId = h('input', { type: 'text', value: c.repo_id, placeholder: 'R_kgDO…' });
  const category = h('input', { type: 'text', value: c.category, placeholder: 'Workout comments' });
  const categoryId = h('input', { type: 'text', value: c.category_id, placeholder: 'DIC_kwDO…' });
  const enabled = h('input', { type: 'checkbox', id: 'cmt-on', checked: c.enabled });
  const found = h('div');
  const repoUrl = `https://github.com/${SITE.repo}`;
  show(
    h('h1', {}, 'Comments & reviews'),
    h('p', {}, 'Members comment under each workout. Comments are stored in your repository’s GitHub Discussions and shown with a free tool called giscus. Reading is open to everyone; posting needs a free GitHub account.'),
    h('div', { class: 'panel' },
      h('h2', {}, 'Set up once'),
      h('ol', { class: 'steps' },
        h('li', {}, 'In ', h('a', { href: `${repoUrl}/settings`, target: '_blank', rel: 'noopener noreferrer' }, 'repository settings'), ' → General → Features, tick ', h('b', {}, 'Discussions'), '.'),
        h('li', {}, 'In ', h('a', { href: `${repoUrl}/discussions/categories`, target: '_blank', rel: 'noopener noreferrer' }, 'Discussions → categories'), ', add a category called ', h('b', {}, 'Workout comments'), ' with the format ', h('b', {}, 'Announcement'), ' (only you and giscus can start threads; members reply).'),
        h('li', {}, 'Install the ', h('a', { href: 'https://github.com/apps/giscus', target: '_blank', rel: 'noopener noreferrer' }, 'giscus app'), ' and give it access to ', h('code', {}, SITE.repo), ' only.'),
        h('li', {}, 'Tap ', h('b', {}, 'Find my settings'), ', pick the category, tick “Show comments” and save.')),
      h('div', { class: 'toolrow' }, h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
        say(status, 'Asking GitHub…');
        try {
          const r = await state.gh.discussionCategories();
          repoId.value = r.repoId;
          if (!r.categories.length) { say(status, 'Discussions has no categories yet. Do steps 1 and 2 first.', true); return; }
          fill(found, h('p', {}, 'Pick the category for comments:'), h('div', { class: 'toolrow' }, r.categories.map((cat) =>
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => { category.value = cat.name; categoryId.value = cat.id; say(status, `Using “${cat.name}”. Tick “Show comments” and save.`); } }, cat.name))));
          say(status, 'Found your repository.');
        } catch (e) { say(status, `${e.message} You can also copy the values from giscus.app instead.`, true); }
      } }, 'Find my settings')),
      found),
    h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      await trySave(status, 'comment settings', (d) => {
        d.settings.comments = { enabled: enabled.checked, repo_id: repoId.value, category: category.value, category_id: categoryId.value };
      }, enabled.checked ? 'Saved. Comments appear under every workout once GitHub Pages has updated.' : 'Saved. Comments are switched off.');
    } },
    field('Repository ID', repoId), field('Category name', category), field('Category ID', categoryId),
    h('p', {}, enabled, ' ', h('label', { for: 'cmt-on' }, 'Show comments under workouts')),
    h('div', { class: 'toolrow' }, h('button', { class: 'btn', type: 'submit' }, 'Save'))),
    status,
    h('div', { class: 'panel' },
      h('h2', {}, 'Moderating'),
      h('p', {}, 'Delete, hide or lock comments, and block people, directly on GitHub: ', h('a', { href: `${repoUrl}/discussions`, target: '_blank', rel: 'noopener noreferrer' }, 'open Discussions'), '. The members’ Comments page is the thread named “member-comments”, and each workout has its own thread named “workout-<number>”.')));
}

// ---------- music: the day's YouTube playlist ----------
function musicView() {
  const m = state.settings.music || { url: '', title: '' };
  const status = h('p', { role: 'status', class: 'muted' });
  const url = h('input', { type: 'url', value: m.url, placeholder: 'https://youtube.com/playlist?list=…', maxlength: 500 });
  const title = h('input', { type: 'text', value: m.title, placeholder: 'e.g. Friday Grid mix', maxlength: 80 });
  const test = h('a', { class: 'btn ghost', href: m.url || '#', target: '_blank', rel: 'noopener noreferrer', hidden: !m.url }, 'Test the link');
  show(
    h('h1', {}, '🎵 Music'),
    h('p', {}, 'Paste the YouTube playlist for the day. Members get a big “Today’s playlist” button on the home screen and a 🎵 Music button at the top of every page. Change it whenever you like.'),
    h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      let music;
      try { music = cleanMusic({ url: url.value.trim(), title: title.value.trim() }); } catch (err) { say(status, err.message, true); return; }
      if (await trySave(status, music.url ? 'music for the day' : 'music switched off', (d) => { d.settings.music = music; },
        music.url ? 'Saved. Members see the new playlist in about a minute.' : 'Saved. The music button is hidden until you add a link.')) {
        test.href = music.url || '#'; test.hidden = !music.url;
      }
    } },
    field('YouTube playlist (or video) link', url),
    field('Name (optional)', title),
    h('div', { class: 'toolrow' }, h('button', { class: 'btn', type: 'submit' }, 'Save'), test,
      h('button', { class: 'btn danger', type: 'button', onclick: () => { url.value = ''; title.value = ''; } }, 'Clear')),
    status),
    h('p', { class: 'muted note' }, 'Each workout can also keep the playlist you played in that class (under the workout’s “Class playlist”).'));
}

// ---------- donations ----------
function donationsView() {
  const d = state.settings.donate;
  const status = h('p', { role: 'status', class: 'muted' });
  const url = h('input', { type: 'url', value: d.url, placeholder: 'https://… (your payment link)', maxlength: 500 });
  const amountUrl = h('input', { type: 'url', value: d.amount_url, placeholder: 'https://…?amount={amount}  (optional)', maxlength: 500 });
  const amounts = h('input', { type: 'text', value: d.amounts.join(', '), placeholder: '20, 50, 100, 200', inputmode: 'numeric' });
  const message = h('textarea', { maxlength: 400, value: d.message, placeholder: 'Apex Training is free. If it helps you, chip in so I can keep adding workouts.' });
  show(
    h('h1', {}, 'Donations'),
    h('p', {}, 'Apex Training is free for everyone. Donations are optional and never unlock anything. Create a payment link with your payment provider (money goes straight to your bank account) and paste it here. Members pay on the provider’s own page.'),
    h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      const list = amounts.value.split(/[\s,]+/).filter(Boolean).map(Number);
      try { cleanDonate({ url: url.value, amount_url: amountUrl.value, message: message.value, amounts: list }); }
      catch (err) { say(status, err.message, true); return; }
      await trySave(status, 'donation settings', (x) => { x.settings.donate = { url: url.value, amount_url: amountUrl.value, message: message.value, amounts: list }; },
        url.value ? 'Saved. The “Support the coach” link shows once GitHub Pages has updated.' : 'Saved. With no link, donations are switched off.');
    } },
    field('Donation link (the donor chooses the amount on that page)', url),
    field('Link with an amount (optional): write {amount} where the rand amount goes', amountUrl),
    field('Suggested amounts in rand (only used with the link above)', amounts),
    field('Message to members (optional)', message),
    h('div', { class: 'toolrow' }, h('button', { class: 'btn', type: 'submit' }, 'Save'),
      d.url ? h('a', { class: 'btn ghost', href: d.url, target: '_blank', rel: 'noopener noreferrer' }, 'Test my link') : null),
    status),
    h('p', { class: 'muted' }, 'Leave the donation link empty to switch donations off.'));
}

// ---------- routing ----------
function route() {
  if (!state.gh) return;
  tabs.hidden = false;
  const path = (location.hash || '#/workouts').slice(1);
  const tab = ['library', 'classes', 'music', 'comments', 'donations', 'more'].find((t) => path.startsWith(`/${t}`)) || 'workouts';
  const navTab = ['comments', 'donations'].includes(tab) ? 'more' : tab; // these live under More
  tabs.querySelectorAll('[data-tab]').forEach((a) => {
    a.classList.toggle('on', a.dataset.tab === navTab);
    if (a.dataset.tab === navTab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  let m;
  if (path === '/workouts/new') editView(0);
  else if ((m = path.match(/^\/workouts\/(\d+)$/))) editView(Number(m[1]));
  else if (path === '/library/new') libraryEditView(0);
  else if ((m = path.match(/^\/library\/(\d+)$/))) libraryEditView(Number(m[1]));
  else if (tab === 'library') libraryView();
  else if (tab === 'classes') classesView();
  else if (tab === 'music') musicView();
  else if (tab === 'more') moreView();
  else if (tab === 'comments') commentsView();
  else if (tab === 'donations') donationsView();
  else workoutsView();
}

async function start() {
  const key = keyGet();
  if (!key) return connectView();
  show(h('p', { class: 'muted pad' }, 'Loading your workouts from GitHub…'));
  try {
    state.gh = createGitHub({ token: key, repo: SITE.repo, branch: SITE.branch });
    await loadAll();
  } catch (e) {
    state.gh = null;
    if (e instanceof GitHubError && e.status === 401) keyClear();
    return connectView(e.message);
  }
  route();
}

function signOut() {
  keyClear();
  state.gh = null;
  location.hash = '#/workouts';
  connectView('Signed out. The key is removed from this device.');
}

// ---------- More: everything that is not used every day ----------
function moreView() {
  const item = (href, icon, title, sub, attrs = {}) => h('a', { class: 'more-item', href, ...attrs },
    h('span', { class: 'more-icon', 'aria-hidden': 'true' }, icon), h('span', {}, h('strong', {}, title), h('span', { class: 'sub muted' }, sub)));
  show(
    h('h1', {}, 'More'),
    h('div', { class: 'more-list' },
      item('#/comments', '💬', 'Comments & reviews', 'Switch comments on and moderate them'),
      item('#/donations', '♥', 'Donations', 'Your payment link for optional donations'),
      item('./', '📱', 'Open the members’ app', 'See Apex Training as your members do'),
      h('button', { class: 'more-item', type: 'button', onclick: signOut },
        h('span', { class: 'more-icon', 'aria-hidden': 'true' }, '🚪'), h('span', {}, h('strong', {}, 'Sign out'), h('span', { class: 'sub muted' }, 'Removes your key from this phone')))));
}

// ---------- refresh (the installed app has no browser refresh button) ----------
const foot = document.getElementById('foot');
function refreshButton() {
  const btn = h('button', { id: 'refresh', class: 'btn ghost small', type: 'button' }, '↻ Refresh');
  btn.addEventListener('click', () => {
    if (/^#\/(workouts|library)\/(new|\d+)$/.test(location.hash) || location.hash === '#/classes') {
      fill(foot, h('span', { class: 'err' }, 'Anything not saved on this page will be lost. '),
        h('button', { class: 'btn danger small', type: 'button', onclick: hardRefresh }, 'Refresh anyway'), ' ',
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => fill(foot, refreshButton()) }, 'Cancel'));
    } else hardRefresh();
  });
  return btn;
}
async function hardRefresh() {
  try { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); } catch { /* ignore */ }
  location.reload();
}
fill(foot, refreshButton());
addEventListener('hashchange', route);
start();

// ---------- Apex Training Admin as a phone app ----------
const installBtn = document.getElementById('install');
let deferredInstall;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; installBtn.hidden = false; });
addEventListener('appinstalled', () => { installBtn.hidden = true; });
const iosDevice = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (iosDevice && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone)) installBtn.hidden = false;
installBtn.addEventListener('click', async () => {
  if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; installBtn.hidden = true; }
  else if (!document.getElementById('ios-hint')) {
    const hint = h('p', { id: 'ios-hint', class: 'banner' }, 'To install on iPhone or iPad: tap the Share button, then “Add to Home Screen”.');
    document.querySelector('header').after(hint);
  }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
