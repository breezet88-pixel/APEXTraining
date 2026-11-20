// Apex Training coach page. The only place anything is added, changed or removed.
// Each save is a commit to the GitHub repository (see github.js); GitHub Pages republishes the site.
import { SITE } from './config.js';
import { h, fill, todayIn, libraryIndex } from './common.js';
import { cleanWorkouts, cleanSchedule, cleanSettings, cleanDonate, cleanLibrary, checkLinks, IMAGE_PATH, DataError } from './validate.js';
import { createGitHub, bytesToBase64, GitHubError } from './github.js';

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
  workouts: null, schedule: null, settings: null, library: null,
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

// Picture upload + preview + remove, for any object with an `image` field.
function pictureEditor(obj, label, status, redraw) {
  const preview = h('img', { class: 'thumb', alt: 'Picture', hidden: !obj.image, src: obj.image ? picSrc(obj.image) : undefined });
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind || bytes.length > MAX_PICTURE) { say(status, 'Use a PNG, JPG, WebP or GIF picture up to 5 MB.', true); return; }
    const name = `images/${[...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')}.${kind}`;
    state.pending.set(name, bytesToBase64(bytes));
    state.previews.set(name, URL.createObjectURL(f));
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
    schedule: cleanSchedule(await read('schedule.json', { days: {} }), workouts),
    settings: cleanSettings(await read('settings.json', {})),
  });
}

// Apply a change to copies of the data, check it, and save it all as one commit.
async function save(message, change) {
  const next = { workouts: clone(state.workouts), schedule: clone(state.schedule), settings: clone(state.settings), library: clone(state.library) };
  change(next);
  const workouts = cleanWorkouts(next.workouts);
  const library = cleanLibrary(next.library);
  checkLinks(workouts, library);
  const schedule = cleanSchedule(next.schedule, workouts);
  const settings = cleanSettings(next.settings);

  const used = new Set([...workouts.workouts.flatMap((w) => w.exercises.map((e) => e.image)), ...library.exercises.map((x) => x.image)].filter(Boolean));
  const stored = (await state.gh.listFiles(`${SITE.root}/images`, state.head)).map((p) => p.slice(SITE.root.length + 1));
  for (const p of used) if (!stored.includes(p) && !state.pending.has(p)) throw new DataError(`A picture is missing (${p}). Upload it again.`);
  const json = (x) => `${JSON.stringify(x, null, 2)}\n`;
  const files = [
    { path: DATA('workouts.json'), text: json(workouts) },
    { path: DATA('schedule.json'), text: json(schedule) },
    { path: DATA('settings.json'), text: json(settings) },
    { path: DATA('exercises.json'), text: json(library) },
    ...[...state.pending].filter(([p]) => used.has(p)).map(([p, b64]) => ({ path: `${SITE.root}/${p}`, base64: b64 })),
  ];
  const deletes = stored.filter((p) => IMAGE_PATH.test(p) && !used.has(p)).map((p) => `${SITE.root}/${p}`);

  const sha = await state.gh.commit({ message: `Coach: ${message}`, files, deletes, expectedHead: state.head });
  Object.assign(state, { head: sha, workouts, schedule, settings, library });
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
  const remember = h('input', { type: 'checkbox', id: 'remember' });
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
function workoutsView(saved = '') {
  const status = h('p', { role: 'status', class: 'muted' }, saved);
  const today = todayIn(SITE.timezone);
  const todays = state.workouts.workouts.find((w) => w.id === state.schedule.days[today]);
  const list = [...state.workouts.workouts].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '') || b.id - a.id);
  show(
    h('div', { class: 'list-item' }, h('h1', {}, 'Workouts'), h('a', { class: 'btn', href: '#/workouts/new' }, '+ New workout')),
    h('p', { class: 'muted' }, todays ? `Today’s workout of the day: ${todays.title}${todays.published ? '' : ' (hidden, so members cannot see it)'}` : 'No workout of the day set for today.'),
    status,
    h('div', { class: 'panel' }, list.length ? list.map((w) => h('div', { class: 'list-item' },
      h('div', {}, h('strong', {}, w.title), ' ', h('span', { class: `tag${w.published ? '' : ' draft'}` }, w.published ? 'Published' : 'Hidden'),
        h('div', { class: 'muted' }, `${w.exercises.length} exercises${w.category ? ` · ${w.category}` : ''}`)),
      h('div', { class: 'toolrow' },
        h('button', { class: 'btn ghost small', onclick: async () => { if (await trySave(status, `workout of the day ${today}: ${w.title}`, (d) => { d.schedule.days[today] = w.id; })) workoutsView(lastSaved); } }, 'Make today’s workout'),
        h('a', { class: 'btn ghost small', href: `#/workouts/${w.id}` }, 'Edit'),
        confirmButton('Delete', `Delete “${w.title}”? Its schedule entries are removed too.`, async () => {
          if (await trySave(status, `delete workout ${w.title}`, (d) => {
            d.workouts.workouts = d.workouts.workouts.filter((x) => x.id !== w.id);
            for (const [day, id] of Object.entries(d.schedule.days)) if (id === w.id) delete d.schedule.days[day];
          })) workoutsView(lastSaved);
        }))))
      : h('p', { class: 'muted' }, 'No workouts yet. Tap “New workout”.')));
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
  const wk = existing ? clone(existing) : { id: 0, title: '', description: '', category: '', level: '', duration_min: '', published: false, exercises: [] };
  const status = h('p', { role: 'status', class: 'muted' });
  const exBox = h('div');
  const bind = (obj, key, el) => { el.addEventListener('input', () => { obj[key] = el.value; }); return el; };
  const text = (obj, key, attrs = {}) => bind(obj, key, h('input', { type: 'text', value: obj[key] ?? '', ...attrs }));
  const drawExercises = () => fill(exBox, wk.exercises.map((ex, i) => exerciseCard(ex, i)));

  function exerciseCard(ex, i) {
    const upStatus = h('p', { role: 'status', class: 'muted' });
    const move = (d) => () => {
      const j = i + d;
      if (j < 0 || j >= wk.exercises.length) return;
      [wk.exercises[i], wk.exercises[j]] = [wk.exercises[j], wk.exercises[i]];
      drawExercises();
    };
    const lib = ex.library_id ? libraryIndex(state.library).get(ex.library_id) : null;
    const head = h('div', { class: 'list-item' }, h('strong', {}, `Exercise ${i + 1}${lib ? `: ${lib.name}` : ''}`),
      h('div', { class: 'toolrow' },
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Move up', onclick: move(-1) }, '↑'),
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Move down', onclick: move(1) }, '↓'),
        h('button', { class: 'btn danger small', type: 'button', onclick: () => { wk.exercises.splice(i, 1); drawExercises(); } }, 'Remove')));
    const setsRow = h('div', { class: 'row' },
      field('Sets', text(ex, 'sets', { placeholder: '3', maxlength: 20 })),
      field('Reps or time', text(ex, 'reps', { placeholder: '10-12 or 40 sec', maxlength: 40 })),
      field('Rest (seconds)', text(ex, 'rest_sec', { inputmode: 'numeric', placeholder: '60' })));
    if (lib) {
      return h('div', { class: 'panel' }, head,
        h('p', { class: 'muted' }, lib.equipment || 'Library exercise', ' · ', h('a', { href: `#/library/${lib.id}` }, 'edit in the library'),
          lib.image ? '' : h('span', { class: 'err' }, ' · no picture yet')),
        lib.image ? h('img', { class: 'thumb', src: picSrc(lib.image), alt: `${lib.name} picture` }) : null,
        setsRow,
        field('Coach’s notes for this workout (optional)', bind(ex, 'cues', h('textarea', { maxlength: 1500, value: ex.cues || '', placeholder: 'e.g. Go light this week' }))));
    }
    return h('div', { class: 'panel' }, head,
      h('div', { class: 'row' },
        field('Exercise name', text(ex, 'name', { required: true, maxlength: 120 })),
        field('Muscles worked', text(ex, 'muscles', { placeholder: 'Quads, glutes' })),
        field('Equipment', text(ex, 'equipment', { placeholder: 'Dumbbell, or none' }))),
      setsRow,
      field('Form cues / instructions', bind(ex, 'cues', h('textarea', { maxlength: 1500, value: ex.cues || '' }))),
      promptEditor(() => buildPrompt(ex, getStyle()), upStatus),
      pictureEditor(ex, 'Exercise picture (from your image tool)', upStatus, drawExercises),
      upStatus);
  }

  // "Add from the library": one dropdown grouped by equipment
  const pickLib = h('select', { 'aria-label': 'Exercise from the library' },
    h('option', { value: '' }, 'Choose an exercise from the library…'),
    [...new Set(state.library.exercises.map((x) => x.equipment || 'Other'))].map((g) => h('optgroup', { label: g },
      state.library.exercises.filter((x) => (x.equipment || 'Other') === g).map((x) => h('option', { value: x.id }, x.name)))));

  const published = h('input', { type: 'checkbox', id: 'pub', checked: !!wk.published, onchange: (e) => { wk.published = e.target.checked; } });
  const saveBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    saveBtn.disabled = true;
    const isNew = !wk.id;
    const ok = await trySave(status, `${isNew ? 'add' : 'update'} workout ${wk.title || ''}`.trim(), (d) => {
      const item = { ...wk, updated_at: new Date().toISOString(), exercises: wk.exercises.map((e) => ({ ...e, rest_sec: e.rest_sec === '' ? null : e.rest_sec })) };
      if (isNew) { item.id = Math.max(0, ...d.workouts.workouts.map((x) => x.id)) + 1; d.workouts.workouts.push(item); wk.id = item.id; }
      else d.workouts.workouts = d.workouts.workouts.map((x) => (x.id === wk.id ? item : x));
    }, wk.published ? 'Saved. Members see it in about a minute, once GitHub Pages has updated.' : 'Saved as hidden: members do not see it in the app.');
    if (!ok && isNew) wk.id = 0;
    saveBtn.disabled = false;
    if (ok && isNew) history.replaceState(null, '', `#/workouts/${wk.id}`);
  } }, 'Save workout');

  drawExercises();
  show(
    h('a', { class: 'back', href: '#/workouts' }, '← All workouts'),
    h('div', { class: 'panel' },
      h('div', { class: 'row' },
        field('Workout title', text(wk, 'title', { required: true, maxlength: 120 })),
        field('Category', text(wk, 'category', { placeholder: 'Strength, HIIT, Mobility…', maxlength: 40 })),
        field('Level', text(wk, 'level', { placeholder: 'Beginner', maxlength: 40 })),
        field('Minutes', text(wk, 'duration_min', { inputmode: 'numeric', placeholder: '30' }))),
      field('Description', bind(wk, 'description', h('textarea', { maxlength: 2000, value: wk.description || '' }))),
      h('p', {}, published, ' ', h('label', { for: 'pub' }, 'Published (shown in the app)')),
      h('p', { class: 'muted note' }, 'Hidden workouts are not shown in the app, but the repository is public, so do not put anything private in them.')),
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
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { wk.exercises.push({ name: '', muscles: '', equipment: '', sets: '', reps: '', rest_sec: '', cues: '', image: '' }); drawExercises(); } }, '+ One-off exercise'))),
    styleEditor(),
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
  const x = found ? clone(found) : { id: 0, name: '', equipment: '', movement: '', image_cue: '', image: '', sources: [] };
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

// ---------- workout of the day ----------
function wodView(saved = '') {
  const status = h('p', { role: 'status', class: 'muted' }, saved);
  const today = todayIn(SITE.timezone);
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const day = h('input', { type: 'date', value: today, required: true });
  const pick = h('select', {}, state.workouts.workouts.map((w) => h('option', { value: w.id }, `${w.title}${w.published ? '' : ' (hidden)'}`)));
  const entries = Object.entries(state.schedule.days).filter(([d]) => d >= from).sort(([a], [b]) => a.localeCompare(b));
  const titleOf = (id) => state.workouts.workouts.find((w) => w.id === id);
  show(
    h('h1', {}, 'Workout of the day'),
    h('p', { class: 'muted' }, 'Members can download only the workout set for today’s date. Setting a day that already has one replaces it.'),
    h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      if (!pick.value) { say(status, 'Create a workout first.', true); return; }
      if (await trySave(status, `workout of the day ${day.value}`, (d) => { d.schedule.days[day.value] = Number(pick.value); })) wodView(lastSaved);
    } }, h('div', { class: 'row' }, field('Date', day), field('Workout', pick)),
    h('div', { class: 'toolrow' }, h('button', { class: 'btn', type: 'submit' }, 'Set workout of the day'))),
    status,
    h('div', { class: 'panel' }, entries.length ? entries.map(([d, id]) => {
      const w = titleOf(id);
      return h('div', { class: 'list-item' },
        h('div', {}, h('strong', {}, d), d === today ? ' (today)' : '', ' · ', w?.title || '?', w && !w.published ? h('span', { class: 'err' }, ' · hidden: members cannot see it') : null),
        h('button', { class: 'btn danger small', onclick: async () => { if (await trySave(status, `remove workout of the day ${d}`, (x) => { delete x.schedule.days[d]; })) wodView(lastSaved); } }, 'Remove'));
    }) : h('p', { class: 'muted' }, 'Nothing scheduled.')));
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
  const tab = ['library', 'wod', 'comments', 'donations'].find((t) => path.startsWith(`/${t}`)) || 'workouts';
  tabs.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  let m;
  if (path === '/workouts/new') editView(0);
  else if ((m = path.match(/^\/workouts\/(\d+)$/))) editView(Number(m[1]));
  else if (path === '/library/new') libraryEditView(0);
  else if ((m = path.match(/^\/library\/(\d+)$/))) libraryEditView(Number(m[1]));
  else if (tab === 'library') libraryView();
  else if (tab === 'wod') wodView();
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

document.getElementById('logout').addEventListener('click', (e) => {
  e.preventDefault();
  keyClear();
  state.gh = null;
  connectView('Signed out. The key is removed from this device.');
});
addEventListener('hashchange', route);
start();
