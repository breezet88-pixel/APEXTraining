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

export function cleanWorkout(w, label = 'Workout') {
  if (!w || typeof w !== 'object') fail(`${label} is not valid.`);
  const exercises = w.exercises ?? [];
  if (!Array.isArray(exercises) || exercises.length > 100) fail(`${label}: a workout can have up to 100 exercises.`);
  return {
    id: intOrNull(w.id, 1, 1e9, `${label} id`) ?? fail(`${label} has no id.`),
    title: text(w.title, 120, 'Title', true),
    description: text(w.description, 2000, 'Description'),
    category: text(w.category, 40, 'Category'),
    level: text(w.level, 40, 'Level'),
    duration_min: intOrNull(w.duration_min, 1, 600, 'Minutes'),
    published: !!w.published,
    updated_at: text(w.updated_at, 40, 'Updated date'),
    exercises: exercises.map((e, i) => {
      const n = `Exercise ${i + 1}`;
      if (!e || typeof e !== 'object') fail(`${n} is not valid.`);
      const image = text(e.image, 80, `${n} picture`);
      if (image && !IMAGE_PATH.test(image)) fail(`${n} picture is not a valid picture file.`);
      return {
        name: text(e.name, 120, `${n} name`, true),
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

export function cleanSchedule(data, workouts) {
  if (!data || typeof data.days !== 'object' || Array.isArray(data.days)) fail('schedule.json must contain a "days" object.');
  const ids = new Set(workouts.workouts.map((w) => w.id));
  const days = {};
  for (const day of Object.keys(data.days).sort()) {
    if (!validDay(day)) fail(`Schedule: "${day}" is not a valid date.`);
    const id = Number(data.days[day]);
    if (!ids.has(id)) fail(`Schedule: ${day} points to a workout that does not exist.`);
    days[day] = id;
  }
  return { version: 1, days };
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
