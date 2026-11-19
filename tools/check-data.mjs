// Checks the published data before it goes live (runs on every change, and with `npm run check`).
// Fails if a data file is broken or a workout points to a picture that is not in site/images.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanWorkouts, cleanSchedule, cleanSettings, cleanLibrary, checkLinks, IMAGE_PATH } from '../site/js/validate.js';

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');

export function checkData(siteDir = SITE_DIR) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(siteDir, 'data', f), 'utf8'));
  const workouts = cleanWorkouts(read('workouts.json'));
  cleanSchedule(read('schedule.json'), workouts);
  cleanSettings(read('settings.json'));
  const library = cleanLibrary(read('exercises.json'));
  checkLinks(workouts, library);
  const used = new Set([...workouts.workouts.flatMap((w) => w.exercises.map((e) => e.image)), ...library.exercises.map((x) => x.image)].filter(Boolean));
  const stored = fs.readdirSync(path.join(siteDir, 'images')).map((f) => `images/${f}`).filter((p) => IMAGE_PATH.test(p));
  const missing = [...used].filter((p) => !stored.includes(p));
  if (missing.length) throw new Error(`Pictures missing from site/images: ${missing.join(', ')}`);
  return { workouts: workouts.workouts.length, library: library.exercises.length, pictures: stored.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const r = checkData();
    console.log(`Data OK: ${r.workouts} workouts, ${r.library} library exercises, ${r.pictures} pictures.`);
  } catch (e) { console.error(`Data check failed: ${e.message}`); process.exit(1); }
}
