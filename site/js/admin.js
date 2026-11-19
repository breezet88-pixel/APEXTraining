// Apex Training coach page. The only place anything is added, changed or removed.
// Each save is a commit to the GitHub repository (see github.js); GitHub Pages republishes the site.
import { SITE } from './config.js';
import { h, fill, todayIn } from './common.js';
import { cleanWorkouts, cleanSchedule, cleanSettings, cleanDonate, IMAGE_PATH, DataError } from './validate.js';
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
  workouts: null, schedule: null, settings: null,
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
  'Clean flat vector illustration in a consistent style: one gender-neutral athlete with a plain face, dark grey fitted sportswear, ' +
  'solid white background, soft ground shadow, teal (#0f766e) used only to highlight the working muscles. ' +
  'The same character, same line weight and same colours in every image of this series.';
const getStyle = () => { try { return localStorage.getItem(STYLE_KEY) || DEFAULT_STYLE; } catch { return DEFAULT_STYLE; } };
const setStyle = (v) => { try { localStorage.setItem(STYLE_KEY, v); } catch { /* ignore */ } };
function buildPrompt(ex, style) {
  return [
    `Instructional fitness illustration showing ONE athlete performing "${ex.name || 'the exercise'}"${ex.equipment ? ` using ${ex.equipment}` : ''}.`,
    'Two panels side by side, same athlete and same camera angle in both: LEFT = starting position, RIGHT = finishing position (peak of the movement). ' +
      'Use a side view unless the movement is clearer from the front. Full body in frame, 4:3 landscape.',
    ex.muscles ? `Softly highlight the working muscles: ${ex.muscles}.` : '',
    ex.cues ? `Correct form to show: ${ex.cues}` : '',
    'Anatomically correct proportions, natural joint angles, neutral spine, exactly two arms and two legs, correct number of fingers. ' +
      'No text, no labels, no arrows, no watermark, no extra equipment or people.',
    `Style: ${style}`,
  ].filter(Boolean).join('\n');
}

// ---------- loading and saving ----------
async function loadAll() {
  const head = await state.gh.headSha();
  const read = async (f, fallback) => { const t = await state.gh.readText(DATA(f), head); return t ? JSON.parse(t) : fallback; };
  const workouts = cleanWorkouts(await read('workouts.json', { workouts: [] }));
  Object.assign(state, {
    head,
    workouts,
    schedule: cleanSchedule(await read('schedule.json', { days: {} }), workouts),
    settings: cleanSettings(await read('settings.json', {})),
  });
}

// Apply a change to copies of the data, check it, and save it all as one commit.
async function save(message, change) {
  const next = { workouts: clone(state.workouts), schedule: clone(state.schedule), settings: clone(state.settings) };
  change(next);
  const workouts = cleanWorkouts(next.workouts);
  const schedule = cleanSchedule(next.schedule, workouts);
  const settings = cleanSettings(next.settings);

  const used = new Set(workouts.workouts.flatMap((w) => w.exercises.map((e) => e.image).filter(Boolean)));
  const stored = (await state.gh.listFiles(`${SITE.root}/images`, state.head)).map((p) => p.slice(SITE.root.length + 1));
  for (const p of used) if (!stored.includes(p) && !state.pending.has(p)) throw new DataError(`A picture is missing (${p}). Upload it again.`);
  const json = (x) => `${JSON.stringify(x, null, 2)}\n`;
  const files = [
    { path: DATA('workouts.json'), text: json(workouts) },
    { path: DATA('schedule.json'), text: json(schedule) },
    { path: DATA('settings.json'), text: json(settings) },
    ...[...state.pending].filter(([p]) => used.has(p)).map(([p, b64]) => ({ path: `${SITE.root}/${p}`, base64: b64 })),
  ];
  const deletes = stored.filter((p) => IMAGE_PATH.test(p) && !used.has(p)).map((p) => `${SITE.root}/${p}`);

  const sha = await state.gh.commit({ message: `Coach: ${message}`, files, deletes, expectedHead: state.head });
  Object.assign(state, { head: sha, workouts, schedule, settings });
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
    const preview = h('img', { class: 'thumb', alt: `${ex.name} picture`, hidden: !ex.image, src: ex.image ? picSrc(ex.image) : undefined });
    const upStatus = h('p', { role: 'status', class: 'muted' });
    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const kind = sniff(bytes);
      if (!kind || bytes.length > MAX_PICTURE) { say(upStatus, 'Use a PNG, JPG, WebP or GIF picture up to 5 MB.', true); return; }
      const name = `images/${[...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')}.${kind}`;
      state.pending.set(name, bytesToBase64(bytes));
      state.previews.set(name, URL.createObjectURL(f));
      ex.image = name;
      preview.src = picSrc(name);
      preview.hidden = false;
      say(upStatus, 'Picture added. It goes online when you save the workout.');
    } });
    const promptBox = h('textarea', { readonly: true, rows: 9, 'aria-label': 'Image prompt' });
    const promptWrap = h('div', { hidden: true }, promptBox,
      h('div', { class: 'toolrow' }, h('button', { class: 'btn small', type: 'button', onclick: async () => {
        promptBox.select();
        try { await navigator.clipboard.writeText(promptBox.value); say(upStatus, 'Prompt copied. Paste it into your image tool.'); }
        catch { say(upStatus, 'Select the text and copy it.'); }
      } }, 'Copy prompt')));
    const move = (d) => () => {
      const j = i + d;
      if (j < 0 || j >= wk.exercises.length) return;
      [wk.exercises[i], wk.exercises[j]] = [wk.exercises[j], wk.exercises[i]];
      drawExercises();
    };
    return h('div', { class: 'panel' },
      h('div', { class: 'list-item' }, h('strong', {}, `Exercise ${i + 1}`),
        h('div', { class: 'toolrow' },
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Move up', onclick: move(-1) }, '↑'),
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Move down', onclick: move(1) }, '↓'),
          h('button', { class: 'btn danger small', type: 'button', onclick: () => { wk.exercises.splice(i, 1); drawExercises(); } }, 'Remove'))),
      h('div', { class: 'row' },
        field('Exercise name', text(ex, 'name', { required: true, maxlength: 120 })),
        field('Muscles worked', text(ex, 'muscles', { placeholder: 'Quads, glutes' })),
        field('Equipment', text(ex, 'equipment', { placeholder: 'Dumbbell, or none' }))),
      h('div', { class: 'row' },
        field('Sets', text(ex, 'sets', { placeholder: '3', maxlength: 20 })),
        field('Reps or time', text(ex, 'reps', { placeholder: '10-12 or 30 sec', maxlength: 40 })),
        field('Rest (seconds)', text(ex, 'rest_sec', { inputmode: 'numeric', placeholder: '60' }))),
      field('Form cues / instructions', bind(ex, 'cues', h('textarea', { maxlength: 1500, value: ex.cues || '' }))),
      h('div', { class: 'toolrow' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { promptBox.value = buildPrompt(ex, getStyle()); promptWrap.hidden = false; } }, '✨ Create image prompt')),
      promptWrap,
      field('Exercise picture (from your image tool)', fileInput),
      preview,
      ex.image ? h('button', { class: 'btn danger small', type: 'button', onclick: () => { ex.image = ''; drawExercises(); } }, 'Remove picture') : null,
      upStatus);
  }

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
    h('details', { class: 'panel' }, h('summary', {}, 'Image style used in every prompt'),
      h('p', { class: 'muted' }, 'Keep this the same for every exercise so all your pictures look like one set.'),
      h('textarea', { rows: 4, value: getStyle(), 'aria-label': 'Image style', oninput: (e) => setStyle(e.target.value) })),
    exBox,
    h('div', { class: 'toolrow' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { wk.exercises.push({ name: '', muscles: '', equipment: '', sets: '', reps: '', rest_sec: '', cues: '', image: '' }); drawExercises(); } }, '+ Add exercise'),
      saveBtn),
    status);
}

function sniff(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  const ascii = (s, e) => String.fromCharCode(...b.subarray(s, e));
  if (b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (b.length > 6 && ascii(0, 4) === 'GIF8') return 'gif';
  return null;
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
      h('p', {}, 'Delete, hide or lock comments, and block people, directly on GitHub: ', h('a', { href: `${repoUrl}/discussions`, target: '_blank', rel: 'noopener noreferrer' }, 'open Discussions'), '. Each workout has its own thread named “workout-<number>”.')));
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
  const tab = ['wod', 'comments', 'donations'].find((t) => path.startsWith(`/${t}`)) || 'workouts';
  tabs.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  let m;
  if (path === '/workouts/new') editView(0);
  else if ((m = path.match(/^\/workouts\/(\d+)$/))) editView(Number(m[1]));
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
