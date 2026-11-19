import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanWorkouts, cleanSchedule, cleanSettings, cleanDonate, cleanComments, validDay, DataError } from '../site/js/validate.js';
import { createGitHub, bytesToBase64 } from '../site/js/github.js';
import { buildWorkoutPage, fileName } from '../site/js/download.js';
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

test('schedule: real dates pointing at real workouts only', () => {
  const ws = cleanWorkouts({ workouts: [workout()] });
  assert.deepEqual(cleanSchedule({ days: { '2026-11-20': 1 } }, ws).days, { '2026-11-20': 1 });
  assert.throws(() => cleanSchedule({ days: { '2026-02-30': 1 } }, ws), /not a valid date/);
  assert.throws(() => cleanSchedule({ days: { '2026-11-20': 9 } }, ws), /does not exist/);
  assert.equal(validDay('2026-11-20'), true);
  assert.equal(validDay('2026-13-01'), false);
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

// ---------------------------------------------------------------- saving to GitHub
const seed = () => ({
  'site/data/workouts.json': JSON.stringify({ version: 1, workouts: [workout()] }),
  'site/data/schedule.json': '{"version":1,"days":{}}',
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
  const w = { title: 'Legs <b>day</b>', category: 'Strength', exercises: [{ name: 'Squat', sets: '3', reps: '10', rest_sec: 60, image: 'images/a.png' }, { name: 'Hack', image: 'images/b.png' }] };
  const html = await buildWorkoutPage(w, '2026-11-20', 'Apex Training', async (p) => (p === 'images/a.png' ? `data:image/png;base64,${PNG.toString('base64')}` : 'javascript:alert(1)'));
  assert.match(html, /Legs &lt;b&gt;day&lt;\/b&gt;/);
  assert.equal((html.match(/<img /g) || []).length, 1, 'non-image data is never embedded');
  assert.match(html, /3 × 10 · 1 min rest/);
  assert.equal(fileName('Legs <b>day</b>', '2026-11-20'), 'legs-b-day-b-2026-11-20.html');
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
