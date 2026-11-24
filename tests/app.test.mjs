import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanWorkouts, cleanClasses, cleanTimer, usedImages, cleanSettings, cleanDonate, cleanComments, cleanLibrary, checkLinks, validDay, DataError } from '../site/js/validate.js';
import { libraryIndex, resolveWorkout } from '../site/js/common.js';
import { createGitHub, bytesToBase64 } from '../site/js/github.js';
import { buildWorkoutPage, fileName } from '../site/js/download.js';
import { classesOn, suggestClass, typeInfo, clubsOf, weekdayOf } from '../site/js/classes.js';
import { buildSegments, timerSummary, totalSeconds } from '../site/js/timer.js';
import { checkData } from '../tools/check-data.mjs';
import { fakeGitHub } from './fake-github.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const workout = (over = {}) => ({ id: 1, title: 'Legs', published: true, exercises: [{ name: 'Squat' }], ...over });

// ---------------------------------------------------------------- data rules
test('workouts: valid data passes and is tidied', () => {
  const out = cleanWorkouts({ workouts: [workout({ title: '  Legs  ', duration_min: '30', exercises: [{ name: 'Squat', rest_sec: '60', image: 'images/' + 'a'.repeat(32) + '.png' }] })] });
  assert.equal(out.workouts[0].title, 'Legs');
  assert.equal(out.workouts[0].duration_min, 30);
  assert.equal(out.workouts[0].exercises[0].rest_sec, 60);
});

test('workouts: bad data is refused with a clear message', () => {
  const bad = [
    [{ workouts: [workout({ title: '' })] }, /Title is required/],
    [{ workouts: [workout({ id: 0 })] }, /id/],
    [{ workouts: [workout(), workout()] }, /share id 1/],
    [{ workouts: [workout({ exercises: [{ name: '' }] })] }, /Exercise 1 name is required/],
    [{ workouts: [workout({ exercises: [{ name: 'A', image: '../secret.png' }] })] }, /not a valid picture/],
    [{ workouts: [workout({ exercises: [{ name: 'A', image: 'https://evil.example/x.png' }] })] }, /not a valid picture/],
    [{ workouts: [workout({ duration_min: 'abc' })] }, /Minutes/],
    [{ nope: [] }, /"workouts" list/],
  ];
  for (const [data, msg] of bad) assert.throws(() => cleanWorkouts(data), (e) => e instanceof DataError && msg.test(e.message), JSON.stringify(data));
});

test('class schedule: the coach\'s timetable loads, bad entries are refused', () => {
  const cls = cleanClasses(JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/classes.json'), 'utf8')));
  assert.ok(cls.weekly.length >= 9, 'weekly timetable pre-filled');
  assert.ok(cls.types.every((t) => t.description), 'every class type has a short description');
  assert.ok(cls.weekly.every((c) => typeInfo(cls, c.type)), 'every timetable class has a known class type');
  assert.equal(cls.weekly[0].day, 1, 'Monday first');
  assert.deepEqual(clubsOf(cls), ['Virgin Active Melrose Arch', 'Virgin Active Rosebank']);
  const bad = [
    [{ weekly: [{ day: 7, time: '06:00', type: 'Grid', club: 'X' }] }, /day of the week/],
    [{ weekly: [{ day: 1, time: '6am', type: 'Grid', club: 'X' }] }, /06:00/],
    [{ extra: [{ date: '2026-02-30', time: '06:00', type: 'Grid', club: 'X' }] }, /real date/],
    [{ extra: [{ date: '2026-11-21', time: '06:00', type: '', club: 'X' }] }, /class type is required/],
    [{ types: [{ name: 'Grid' }, { name: 'grid' }] }, /twice/],
  ];
  for (const [data, msg] of bad) assert.throws(() => cleanClasses(data), msg, JSON.stringify(data));
  assert.deepEqual(cleanClasses(undefined), { version: 1, types: [], weekly: [], extra: [] });
  assert.equal(validDay('2026-11-20'), true);
  assert.equal(validDay('2026-13-01'), false);
});

test('class schedule: several classes a day, ad hoc classes, and pre-filling the next workout', () => {
  const cls = cleanClasses({
    types: [{ name: 'Grid', description: 'HIIT' }],
    weekly: [{ day: 5, time: '05:30', type: 'Grid', club: 'Rosebank' }, { day: 5, time: '17:30', type: 'Grid', club: 'Rosebank' }, { day: 5, time: '06:30', type: 'Grid', club: 'Rosebank' }],
    extra: [{ date: '2026-11-20', time: '12:00', type: 'Hyrox', club: 'Melrose' }, { date: '2026-11-21', time: '08:00', type: 'Rumble', club: 'Melrose' }],
  });
  assert.equal(weekdayOf('2026-11-20'), 5, '20 Nov 2026 is a Friday');
  assert.deepEqual(classesOn(cls, '2026-11-20').map((c) => `${c.time} ${c.type}${c.adhoc ? ' (ad hoc)' : ''}`), ['05:30 Grid', '06:30 Grid', '12:00 Hyrox (ad hoc)', '17:30 Grid']);
  assert.deepEqual(classesOn(cls, '2026-11-21').map((c) => c.type), ['Rumble']);
  // 13:00 on Friday: the 12:00 class is the latest one that has started
  const now = { date: '2026-11-20', time: '13:00' };
  assert.equal(suggestClass(cls, [], now).time, '12:00');
  // once it is in the library, the one before it is suggested, and so on
  const done = [{ id: 1, date: '2026-11-20', time: '12:00', club: 'Melrose' }];
  assert.equal(suggestClass(cls, done, now).time, '06:30');
  assert.equal(suggestClass(cls, done, now, 1).time, '12:00', 'editing workout 1 itself does not count');
  // early morning before any class: falls back to the previous days, then to today's first class
  assert.equal(suggestClass(cls, [], { date: '2026-11-20', time: '05:00' }).time, '05:30', 'nothing started yet: today\'s first class');
  assert.equal(suggestClass(cls, [], { date: '2026-11-25', time: '09:00' }), null, 'no classes nearby: nothing pre-filled');
  assert.equal(suggestClass(cls, [], { date: '2026-11-21', time: '05:00' }).time, '17:30');
});

test('class timer: settings are checked, and the sequence members run is right', () => {
  assert.deepEqual(cleanTimer(undefined), { type: '' });
  assert.throws(() => cleanTimer({ type: 'intervals' }), /seconds of work/);
  assert.throws(() => cleanTimer({ type: 'amrap' }), /minutes/);
  assert.throws(() => cleanTimer({ type: 'boom' }), /timer type/);
  assert.throws(() => cleanTimer({ type: 'tabata', image: '../x.png' }), /picture/);
  const t = cleanTimer({ type: 'intervals', work_sec: '40', rest_sec: '20', rounds: '2', round_rest_sec: '60' });
  const segs = buildSegments(t, ['Swing', 'Squat']);
  assert.deepEqual(segs.map((x) => `${x.phase}:${x.sec}:${x.label}`), [
    'prep:10:Get ready', 'work:40:Swing', 'rest:20:Rest', 'work:40:Squat', 'rest:60:Rest between rounds', 'work:40:Swing', 'rest:20:Rest', 'work:40:Squat']);
  assert.equal(segs[0].next, 'Swing');
  assert.equal(totalSeconds(segs), 260);
  assert.match(timerSummary(t), /2 rounds · 40 sec on \/ 20 sec off · 1 min rest between rounds/);
  const station = buildSegments({ ...t, order: 'station', round_rest_sec: null }, ['A', 'B']).filter((x) => x.phase === 'work').map((x) => x.label);
  assert.deepEqual(station, ['A', 'A', 'B', 'B'], 'station by station');
  assert.equal(buildSegments({ type: 'tabata' }, ['Burpee']).filter((x) => x.phase === 'work').length, 8, 'Tabata is 8 rounds by default');
  assert.deepEqual(buildSegments({ type: 'emom', minutes: 3 }, ['A', 'B']).filter((x) => x.phase === 'work').map((x) => `${x.sec}${x.label}`), ['60A', '60B', '60A']);
  assert.equal(totalSeconds(buildSegments({ type: 'amrap', minutes: 20 }, ['A'])), 1200);
  assert.equal(buildSegments({ type: 'fortime' }, ['A'])[1].countUp, true);
  assert.deepEqual(buildSegments({ type: '' }, ['A']), []);
  // pictures for the class: several allowed, real picture files only, up to 20
  const pic = (c) => `images/${c.repeat(32)}.png`;
  const withPhotos = cleanWorkouts({ workouts: [workout({ photos: [{ image: pic('e'), caption: ' Whiteboard ' }, { image: pic('f') }] })] });
  assert.deepEqual(withPhotos.workouts[0].photos, [{ image: pic('e'), caption: 'Whiteboard' }, { image: pic('f'), caption: '' }]);
  assert.ok(usedImages(withPhotos, { exercises: [] }).has(pic('f')), 'class pictures are never deleted by a save');
  assert.throws(() => cleanWorkouts({ workouts: [workout({ photos: [{ image: 'https://evil.example/x.png' }] })] }), /not a valid picture/);
  assert.throws(() => cleanWorkouts({ workouts: [workout({ photos: Array(21).fill({ image: pic('e') }) })] }), /up to 20/);
  // a timer picture counts as used, so saving never deletes it
  const ws = cleanWorkouts({ workouts: [workout({ timer: { type: '', image: `images/${'d'.repeat(32)}.png` } })] });
  assert.ok(usedImages(ws, { exercises: [] }).has(`images/${'d'.repeat(32)}.png`));
});

test('donations and comments settings', () => {
  assert.deepEqual(cleanDonate({ url: 'https://pay.example.com/me', amounts: [100, 20, 20] }).amounts, [20, 100]);
  assert.throws(() => cleanDonate({ url: 'http://pay.example.com' }), /https/);
  assert.throws(() => cleanDonate({ url: 'javascript:alert(1)' }), /https|valid/);
  assert.throws(() => cleanDonate({ url: 'https://a:b@pay.example.com' }), /username/);
  assert.throws(() => cleanDonate({ url: 'https://x.example', amount_url: 'https://x.example?a=5' }), /\{amount\}/);
  assert.throws(() => cleanComments({ enabled: true }), /fill in/);
  assert.throws(() => cleanComments({ repo_id: 'R_x" onload="x' }), /looks wrong/);
  assert.equal(cleanSettings({}).comments.enabled, false);
});

test('exercise library: the coach\'s 85 exercises load, with equipment groups and sources', () => {
  const lib = cleanLibrary(JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/exercises.json'), 'utf8')));
  assert.equal(lib.exercises.length, 85);
  assert.equal(new Set(lib.exercises.map((e) => e.id)).size, 85);
  for (let id = 51; id <= 85; id++) {
    const x = lib.exercises.find((e) => e.id === id);
    assert.ok(x.image && x.movement && x.image_cue, `exercise ${id} has a picture, movement and image cue`);
  }
  const count = (q) => lib.exercises.filter((x) => x.equipment === q).length;
  assert.deepEqual(['Kettlebell', 'Dumbbell', 'Light barbell', 'Skillmill', 'SkiErg', 'Mat and bodyweight'].map(count), [15,  22,  10,  5,  3,  30]);
  assert.equal(lib.exercises[0].name, 'Two-handed kettlebell swing');
  assert.equal(lib.exercises.at(-1).name, 'Side plank hip dip with reach');
  assert.ok(lib.exercises.every((x) => x.movement && x.image_cue), 'every exercise has a movement and an image cue');
  assert.ok(lib.exercises.every((x) => x.key_points.length >= 2 && x.key_points.every((k) => k.length <= 150)), 'every exercise has short key points');
  assert.deepEqual(cleanLibrary({ exercises: [{ id: 1, name: 'A', key_points: 'Hips back\n\nChest up ' }] }).exercises[0].key_points, ['Hips back', 'Chest up']);
  assert.throws(() => cleanLibrary({ exercises: [{ id: 1, name: 'A', key_points: ['a', 'b', 'c', 'd', 'e', 'f'] }] }), /up to 5 key points/);
  assert.match(lib.guide.image_rules, /same adult athlete/);
  assert.ok(lib.equipment.find((q) => q.name === 'Skillmill').note.includes('Stop the belt'));
});

test('exercise library: bad entries are refused', () => {
  const ok = { id: 1, name: 'Swing', equipment: 'Kettlebell', movement: 'm', image_cue: 'c' };
  assert.throws(() => cleanLibrary({ exercises: [{ ...ok, name: '' }] }), /name is required/);
  assert.throws(() => cleanLibrary({ exercises: [ok, ok] }), /share id 1/);
  assert.throws(() => cleanLibrary({ exercises: [{ ...ok, image: '../x.png' }] }), /not a valid picture/);
  assert.throws(() => cleanLibrary({ exercises: [{ ...ok, sources: [{ title: 'x', url: 'http://insecure.example' }] }] }), /https/);
  assert.throws(() => cleanLibrary({ exercises: [{ ...ok, movement: 'x'.repeat(2001) }] }), /too long/);
});

test('workouts link to library exercises; broken links are refused', () => {
  const lib = cleanLibrary({ exercises: [{ id: 7, name: 'Bird-dog', equipment: 'Mat and bodyweight', movement: 'Begin on hands and knees.', image_cue: 'c', image: 'images/' + 'c'.repeat(32) + '.png' }] });
  const ws = cleanWorkouts({ workouts: [workout({ exercises: [{ library_id: 7, sets: '3', reps: '8', cues: 'Slow' }] })] });
  assert.equal(ws.workouts[0].exercises[0].name, '', 'name comes from the library');
  checkLinks(ws, lib);
  const shown = resolveWorkout(ws.workouts[0], libraryIndex(lib)).exercises[0];
  assert.equal(shown.name, 'Bird-dog');
  assert.equal(shown.image, 'images/' + 'c'.repeat(32) + '.png');
  assert.equal(shown.movement, 'Begin on hands and knees.');
  assert.equal(shown.cues, 'Slow', 'workout notes kept');
  const broken = cleanWorkouts({ workouts: [workout({ exercises: [{ library_id: 99 }] })] });
  assert.throws(() => checkLinks(broken, lib), /no longer exists/);
  assert.throws(() => cleanWorkouts({ workouts: [workout({ exercises: [{ sets: '3' }] })] }), /name is required/, 'a one-off exercise still needs a name');
});

// ---------------------------------------------------------------- saving to GitHub
const seed = () => ({
  'site/data/workouts.json': JSON.stringify({ version: 1, workouts: [workout()] }),
  'site/images/.gitkeep': '',
  [`site/images/${'a'.repeat(32)}.png`]: 'x',
});

test('GitHub: one commit adds, changes and deletes files together', async () => {
  const gh0 = await fakeGitHub({ files: seed() });
  try {
    const gh = createGitHub({ token: gh0.token, repo: gh0.repo, apiUrl: gh0.url });
    assert.deepEqual(await gh.check(), { canSave: true, isPublic: true, nodeId: 'R_fake', hasDiscussions: true });
    const head = await gh.headSha();
    assert.match(await gh.readText('site/data/workouts.json', head), /Legs/);
    assert.equal(await gh.readText('site/data/nope.json', head), null);
    const pics = await gh.listFiles('site/images', head);
    assert.equal(pics.length, 2);
    const newPic = `site/images/${'b'.repeat(32)}.png`;
    await gh.commit({
      message: 'Coach: test', expectedHead: head,
      files: [{ path: 'site/data/workouts.json', text: '{"changed":"é ✓"}' }, { path: newPic, base64: bytesToBase64(new Uint8Array(PNG)) }],
      deletes: [pics.find((p) => p.endsWith('.png'))],
    });
    assert.equal(gh0.file('site/data/workouts.json').toString(), '{"changed":"é ✓"}', 'text saved as UTF-8');
    assert.ok(gh0.file(newPic).equals(PNG), 'picture saved byte for byte');
    assert.ok(!gh0.paths().includes(pics.find((p) => p.endsWith('.png'))), 'old picture deleted');
    assert.deepEqual(gh0.log().slice(0, 2), ['Coach: test', 'initial']);
  } finally { await gh0.close(); }
});

test('GitHub: never overwrites changes made on another device', async () => {
  const gh0 = await fakeGitHub({ files: seed() });
  try {
    const gh = createGitHub({ token: gh0.token, repo: gh0.repo, apiUrl: gh0.url });
    const head = await gh.headSha();
    gh0.pushFromElsewhere('site/data/workouts.json', '{"from":"phone"}');
    await assert.rejects(gh.commit({ message: 'x', files: [{ path: 'site/data/workouts.json', text: '{}' }], expectedHead: head }), (e) => e.status === 409);
    assert.equal(gh0.file('site/data/workouts.json').toString(), '{"from":"phone"}');
  } finally { await gh0.close(); }
});

test('GitHub: wrong, expired or read-only keys cannot save', async () => {
  const gh0 = await fakeGitHub({ files: seed() });
  try {
    const bad = createGitHub({ token: 'nope', repo: gh0.repo, apiUrl: gh0.url });
    await assert.rejects(bad.check(), (e) => e.status === 401 && /expired/.test(e.message));
    const ro = createGitHub({ token: gh0.readOnlyToken, repo: gh0.repo, apiUrl: gh0.url });
    assert.equal((await ro.check()).canSave, false);
    await assert.rejects(ro.commit({ message: 'x', files: [{ path: 'a', text: 'b' }] }), (e) => e.status === 403);
    assert.throws(() => createGitHub({ token: 'x', repo: 'not a repo' }), /not valid/);
  } finally { await gh0.close(); }
});

test('GitHub: finds the comment settings for giscus', async () => {
  const gh0 = await fakeGitHub({ files: seed() });
  try {
    const gh = createGitHub({ token: gh0.token, repo: gh0.repo, apiUrl: gh0.url });
    const r = await gh.discussionCategories();
    assert.equal(r.repoId, 'R_fake');
    assert.ok(r.categories.some((c) => c.name === 'Workout comments'));
  } finally { await gh0.close(); }
});

// ---------------------------------------------------------------- download
test('download: one self-contained page, text escaped, only real pictures embedded', async () => {
  const w = { photos: [{ image: 'images/a.png', caption: 'Whiteboard' }, { image: 'images/b.png', caption: 'Bad' }], title: 'Legs <b>day</b>', category: 'Grid', about: 'Short, hard intervals.', date: '2026-11-20', time: '06:30', timer: { type: 'intervals', work_sec: 40, rest_sec: 20, rounds: 4, notes: 'Use the gym clock' }, exercises: [{ name: 'Squat', sets: '3', reps: '10', rest_sec: 60, image: 'images/a.png' }, { name: 'Hack', image: 'images/b.png' }] };
  const html = await buildWorkoutPage(w, 'Apex Training', async (p) => (p === 'images/a.png' ? `data:image/png;base64,${PNG.toString('base64')}` : 'javascript:alert(1)'));
  assert.match(html, /Legs &lt;b&gt;day&lt;\/b&gt;/);
  assert.equal((html.match(/<img /g) || []).length, 2, 'non-image data is never embedded (1 class picture + 1 exercise picture)');
  assert.match(html, /<figcaption>Whiteboard<\/figcaption>/);
  assert.match(html, /3 × 10 · 1 min rest/);
  assert.match(html, /About Grid:<\/b> Short, hard intervals\./);
  assert.match(html, /Timer:<\/b> 4 rounds · 40 sec on \/ 20 sec off · Use the gym clock/);
  assert.doesNotMatch(html, /Workout of the day/);
  assert.equal(fileName(w), 'legs-b-day-b-2026-11-20-0630.html');
  assert.equal(fileName({ title: '' }), 'workout.html');
});

// ---------------------------------------------------------------- the site itself
const siteFiles = (dir = path.join(ROOT, 'site')) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? siteFiles(p) : [p];
});

test('site works under a sub-path (GitHub Pages): no absolute links', () => {
  for (const f of siteFiles().filter((x) => /\.(html|js|webmanifest|css)$/.test(x))) {
    const s = fs.readFileSync(f, 'utf8');
    const abs = [...s.matchAll(/(?:href|src)=["'](\/[^/"'][^"']*)["']/g), ...s.matchAll(/"(?:start_url|scope|src)":\s*"(\/[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(abs, [], `${path.relative(ROOT, f)} has absolute paths`);
  }
});

test('pages carry a security policy', () => {
  for (const page of ['index.html', 'admin.html']) {
    const s = fs.readFileSync(path.join(ROOT, 'site', page), 'utf8');
    assert.match(s, /http-equiv="Content-Security-Policy"/, page);
    assert.match(s, /object-src 'none'/, page);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'site', 'admin.html'), 'utf8'), /connect-src 'self' https:\/\/api\.github\.com;/);
});

test('published data passes the same check the deploy runs', () => {
  const r = checkData();
  assert.ok(r.workouts >= 0);
});

test('Apex Training stands alone: no file mentions betting', () => {
  const all = [...siteFiles(), ...['README.md', 'package.json'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
    ...fs.readdirSync(path.join(ROOT, 'docs')).map((f) => path.join(ROOT, 'docs', f))];
  const banned = /\b(bets?|betting|bettor|sportsbook|wager\w*|odds|breezy\s?bets|apex\s?bets|casino|gambl\w*)\b/i;
  for (const f of all.filter((x) => /\.(html|js|css|json|md|webmanifest)$/.test(x))) {
    const m = fs.readFileSync(f, 'utf8').match(banned);
    assert.equal(m, null, `${path.relative(ROOT, f)} mentions "${m?.[0]}"`);
  }
});
