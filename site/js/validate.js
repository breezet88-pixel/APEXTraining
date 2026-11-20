// The rules every data file must follow. Used by the coach page before saving, and by the automatic
// check that runs on every change in the repository (tools/check-data.mjs), so a broken file never goes live.
export const IMAGE_PATH = /^images\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/;
export const DEFAULT_AMOUNTS = [20, 50, 100, 200];

export class DataError extends Error {}
const fail = (msg) => { throw new DataError(msg); };

function text(v, max, label, required = false) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') fail(`${label} must be text.`);
  const s = String(v).trim();
  if (required && !s) fail(`${label} is required.`);
  if (s.length > max) fail(`${label} is too long (max ${max} characters).`);
  return s;
}

function intOrNull(v, min, max, label) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

export function validDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// YouTube playlist links for the music played in the class
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
export function cleanPlaylist(list) {
  if (list === undefined || list === null || list === '') return [];
  if (!Array.isArray(list) || list.length > 10) fail('A workout can have up to 10 playlist links.');
  return list.map((p, i) => {
    const item = typeof p === 'string' ? { url: p } : p || {};
    const url = text(item.url, 500, `Playlist link ${i + 1}`, true);
    let u;
    try { u = new URL(url); } catch { fail(`Playlist link ${i + 1} is not a valid web address.`); }
    if (u.protocol !== 'https:' || !YOUTUBE_HOSTS.includes(u.hostname)) fail(`Playlist link ${i + 1} must be a YouTube link (https://youtube.com/… or https://youtu.be/…).`);
    return { url, title: text(item.title, 80, `Playlist link ${i + 1} name`) };
  });
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIMER_TYPES = ['', 'intervals', 'tabata', 'emom', 'amrap', 'fortime'];
// The class timer (see timer.js). Empty type = no timer.
export function cleanTimer(t) {
  if (t === undefined || t === null || t === '') return { type: '' };
  if (typeof t !== 'object' || Array.isArray(t)) fail('The timer is not valid.');
  const type = String(t.type || '');
  if (!TIMER_TYPES.includes(type)) fail('Choose a timer type from the list.');
  const image = text(t.image, 80, 'Timer picture');
  if (image && !IMAGE_PATH.test(image)) fail('The timer picture is not a valid picture file.');
  const notes = text(t.notes, 300, 'Timer notes');
  if (!type) return { type: '', ...(notes ? { notes } : {}), ...(image ? { image } : {}) };
  const out = {
    type,
    work_sec: intOrNull(t.work_sec, 0, 3600, 'Timer work time (seconds)'),
    rest_sec: intOrNull(t.rest_sec, 0, 3600, 'Timer rest time (seconds)'),
    rounds: intOrNull(t.rounds, 0, 100, 'Timer rounds'),
    round_rest_sec: intOrNull(t.round_rest_sec, 0, 3600, 'Timer rest between rounds (seconds)'),
    minutes: intOrNull(t.minutes, 0, 300, 'Timer minutes'),
    order: t.order === 'station' ? 'station' : 'circuit',
    notes,
    image,
  };
  if ((type === 'intervals') && !out.work_sec) fail('Timer: how many seconds of work per interval?');
  if (type === 'amrap' && !out.minutes) fail('Timer: how many minutes is the AMRAP?');
  if (type === 'emom' && !out.minutes && !out.rounds) fail('Timer: how many minutes is the EMOM?');
  return out;
}

// Pictures and screenshots for the whole class (whiteboard, timer, notes…), shown in order with a caption.
export function cleanPhotos(list) {
  if (list === undefined || list === null || list === '') return [];
  if (!Array.isArray(list) || list.length > 20) fail('A workout can have up to 20 pictures.');
  return list.map((p, i) => {
    const image = text(p?.image, 80, `Picture ${i + 1}`, true);
    if (!IMAGE_PATH.test(image)) fail(`Picture ${i + 1} is not a valid picture file.`);
    return { image, caption: text(p?.caption, 200, `Picture ${i + 1} caption`) };
  });
}

export function cleanWorkout(w, label = 'Workout') {
  if (!w || typeof w !== 'object') fail(`${label} is not valid.`);
  const date = text(w.date, 10, 'Date');
  if (date && !validDay(date)) fail('The class date is not a real date.');
  const time = text(w.time, 5, 'Start time');
  if (time && !TIME.test(time)) fail('The start time must look like 06:00.');
  const exercises = w.exercises ?? [];
  if (!Array.isArray(exercises) || exercises.length > 100) fail(`${label}: a workout can have up to 100 exercises.`);
  return {
    id: intOrNull(w.id, 1, 1e9, `${label} id`) ?? fail(`${label} has no id.`),
    title: text(w.title, 120, 'Title', true),
    description: text(w.description, 2000, 'Description'),
    category: text(w.category, 40, 'Class type'),
    level: text(w.level, 40, 'Level'),
    date,
    time,
    club: text(w.club, 80, 'Club'),
    playlist: cleanPlaylist(w.playlist),
    timer: cleanTimer(w.timer),
    photos: cleanPhotos(w.photos),
    duration_min: intOrNull(w.duration_min, 1, 600, 'Minutes'),
    published: !!w.published,
    updated_at: text(w.updated_at, 40, 'Updated date'),
    exercises: exercises.map((e, i) => {
      const n = `Exercise ${i + 1}`;
      if (!e || typeof e !== 'object') fail(`${n} is not valid.`);
      const libraryId = intOrNull(e.library_id, 1, 1e9, `${n} library link`);
      const image = text(e.image, 80, `${n} picture`);
      if (image && !IMAGE_PATH.test(image)) fail(`${n} picture is not a valid picture file.`);
      return {
        ...(libraryId ? { library_id: libraryId } : {}),
        name: text(e.name, 120, `${n} name`, !libraryId), // a library exercise takes its name from the library
        muscles: text(e.muscles, 120, `${n} muscles`),
        equipment: text(e.equipment, 120, `${n} equipment`),
        sets: text(e.sets, 20, `${n} sets`),
        reps: text(e.reps, 40, `${n} reps`),
        rest_sec: intOrNull(e.rest_sec, 0, 3600, `${n} rest`),
        cues: text(e.cues, 1500, `${n} form cues`),
        image,
      };
    }),
  };
}

export function cleanWorkouts(data) {
  if (!data || !Array.isArray(data.workouts)) fail('workouts.json must contain a "workouts" list.');
  const out = data.workouts.map((w, i) => cleanWorkout(w, `Workout ${i + 1}`));
  const ids = new Set();
  for (const w of out) { if (ids.has(w.id)) fail(`Two workouts share id ${w.id}.`); ids.add(w.id); }
  return { version: 1, workouts: out };
}

// ---- exercise library (site/data/exercises.json) ----
function sources(list, label) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > 5) fail(`${label}: up to 5 sources.`);
  return list.map((s, i) => ({
    title: text(s?.title, 160, `${label} source ${i + 1} title`, true),
    url: httpsUrl(s?.url, `${label} source ${i + 1} link`) || fail(`${label} source ${i + 1} needs a link.`),
  }));
}

export function cleanLibrary(data) {
  if (!data || !Array.isArray(data.exercises)) fail('exercises.json must contain an "exercises" list.');
  if (data.exercises.length > 1000) fail('The library can hold up to 1000 exercises.');
  const g = data.guide || {};
  const exercises = data.exercises.map((e, i) => {
    const label = `Library exercise ${i + 1}`;
    if (!e || typeof e !== 'object') fail(`${label} is not valid.`);
    const image = text(e.image, 80, `${label} picture`);
    if (image && !IMAGE_PATH.test(image)) fail(`${label} picture is not a valid picture file.`);
    return {
      id: intOrNull(e.id, 1, 1e9, `${label} id`) ?? fail(`${label} has no id.`),
      name: text(e.name, 120, `${label} name`, true),
      equipment: text(e.equipment, 40, `${label} equipment`),
      movement: text(e.movement, 2000, `${label} movement description`),
      image_cue: text(e.image_cue, 1000, `${label} image cue`),
      image,
      sources: sources(e.sources, label),
    };
  });
  const ids = new Set();
  for (const e of exercises) { if (ids.has(e.id)) fail(`Two library exercises share id ${e.id}.`); ids.add(e.id); }
  return {
    version: 1,
    guide: { intro: text(g.intro, 1500, 'Library introduction'), intro_sources: sources(g.intro_sources, 'Library introduction'), image_rules: text(g.image_rules, 1000, 'Picture rules') },
    equipment: (data.equipment || []).map((q, i) => ({
      name: text(q?.name, 40, `Equipment ${i + 1} name`, true),
      note: text(q?.note, 600, `Equipment ${i + 1} note`),
      sources: sources(q?.sources, `Equipment ${i + 1}`),
    })),
    exercises,
  };
}

// Every workout exercise that links to the library must point at an exercise that exists.
export function checkLinks(workouts, library) {
  const ids = new Set(library.exercises.map((e) => e.id));
  for (const w of workouts.workouts) {
    w.exercises.forEach((e, i) => {
      if (e.library_id && !ids.has(e.library_id)) fail(`Workout "${w.title}": exercise ${i + 1} links to a library exercise that no longer exists.`);
    });
  }
}

// The class schedule (site/data/classes.json, see classes.js)
export function cleanClasses(data) {
  if (data === undefined || data === null) data = {};
  if (typeof data !== 'object' || Array.isArray(data)) fail('classes.json is not valid.');
  const list = (v, max, label) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > max) fail(`${label}: up to ${max}.`);
    return v;
  };
  const types = list(data.types, 50, 'Class types').map((t, i) => ({
    name: text(t?.name, 40, `Class type ${i + 1} name`, true),
    description: text(t?.description, 500, `Class type ${i + 1} description`),
  }));
  const names = new Set();
  for (const t of types) { const k = t.name.toLowerCase(); if (names.has(k)) fail(`The class type "${t.name}" is listed twice.`); names.add(k); }
  const slot = (c, label) => {
    const time = text(c?.time, 5, `${label} time`, true);
    if (!TIME.test(time)) fail(`${label}: the time must look like 06:00.`);
    return { time, type: text(c?.type, 40, `${label} class type`, true), club: text(c?.club, 80, `${label} club`, true) };
  };
  const weekly = list(data.weekly, 100, 'Weekly timetable').map((c, i) => {
    const day = Number(c?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) fail(`Weekly class ${i + 1}: choose a day of the week.`);
    return { day, ...slot(c, `Weekly class ${i + 1}`) };
  }).sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7) || a.time.localeCompare(b.time));
  const extra = list(data.extra, 1000, 'Ad hoc classes').map((c, i) => {
    const date = text(c?.date, 10, `Ad hoc class ${i + 1} date`, true);
    if (!validDay(date)) fail(`Ad hoc class ${i + 1}: the date is not a real date.`);
    return { date, ...slot(c, `Ad hoc class ${i + 1}`) };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return { version: 1, types, weekly, extra };
}

function httpsUrl(v, label, placeholder) {
  const raw = text(v, 500, label);
  if (!raw) return '';
  let u;
  try { u = new URL(placeholder ? raw.split('{amount}').join('50') : raw); } catch { fail(`${label} is not a valid web address.`); }
  if (u.protocol !== 'https:') fail(`${label} must start with https://`);
  if (u.username || u.password) fail(`${label} must not contain a username or password.`);
  return raw;
}

export function cleanDonate(d = {}) {
  const url = httpsUrl(d.url, 'Donation link');
  const amount_url = httpsUrl(d.amount_url, 'Amount link', true);
  if (amount_url && !amount_url.includes('{amount}')) fail('The amount link must contain {amount} where the rand amount goes.');
  let amounts = DEFAULT_AMOUNTS;
  if (d.amounts !== undefined) {
    if (!Array.isArray(d.amounts) || d.amounts.length > 6) fail('Give up to 6 suggested amounts.');
    amounts = [...new Set(d.amounts.map((n) => {
      const v = Number(n);
      if (!Number.isInteger(v) || v < 1 || v > 100000) fail('Suggested amounts must be whole rand from 1 to 100000.');
      return v;
    }))].sort((a, b) => a - b);
  }
  return { url, amount_url, message: text(d.message, 400, 'Message'), amounts };
}

export function cleanComments(c = {}) {
  const id = (v, label) => { const s = text(v, 100, label); if (s && !/^[A-Za-z0-9_=-]+$/.test(s)) fail(`${label} looks wrong. Copy it again.`); return s; };
  const out = { enabled: !!c.enabled, repo_id: id(c.repo_id, 'Repository ID'), category: text(c.category, 100, 'Category name'), category_id: id(c.category_id, 'Category ID') };
  if (out.enabled && (!out.repo_id || !out.category || !out.category_id)) fail('To switch comments on, fill in the repository ID, category name and category ID.');
  return out;
}

export function cleanSettings(s) {
  if (!s || typeof s !== 'object') fail('settings.json is not valid.');
  return { version: 1, donate: cleanDonate(s.donate || {}), comments: cleanComments(s.comments || {}) };
}

// Every picture the data uses (exercise pictures, timer pictures, library pictures). Anything else in
// site/images is unused and is removed when the coach saves.
export const usedImages = (workouts, library) => new Set([
  ...workouts.workouts.flatMap((w) => [...w.exercises.map((e) => e.image), w.timer?.image, ...(w.photos || []).map((p) => p.image)]),
  ...library.exercises.map((x) => x.image),
].filter(Boolean));
