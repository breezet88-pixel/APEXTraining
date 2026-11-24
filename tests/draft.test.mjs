import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftWorkout, wordsToNumbers } from '../site/js/draft.js';
import { cleanWorkout, cleanPlaylist } from '../site/js/validate.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/exercises.json'), 'utf8'));
const nameOf = (e) => (e.library_id ? library.exercises.find((x) => x.id === e.library_id).name : `own: ${e.name}`);
const draft = (text, clubs = []) => draftWorkout(text, { library, clubs, today: '2026-11-20' });

test('spoken numbers become digits', () => {
  assert.equal(wordsToNumbers('three rounds of twenty five'), '3 rounds of 25');
  assert.equal(wordsToNumbers('rest a minute'), 'rest 1 minute');
});

test('a typical class: club, date, time, rounds, interval, library exercises, rest', () => {
  const { draft: d, questions } = draft('Today at Virgin Active Sandton, 6am class. 4 rounds, 40 seconds on 20 off: kettlebell swings, goblet squats, mountain climbers. Then 3 sets of 10 push-ups, rest 60 seconds.');
  assert.equal(d.date, '2026-11-20');
  assert.equal(d.time, '06:00');
  assert.equal(d.club, 'Virgin Active Sandton');
  assert.deepEqual(d.exercises.map(nameOf), ['Kettlebell swing', 'Goblet squat', 'Mountain climber', 'Push-up']);
  assert.deepEqual(d.exercises.slice(0, 3).map((e) => [e.sets, e.reps, e.rest_sec]), [['4', '40 sec', 20], ['4', '40 sec', 20], ['4', '40 sec', 20]]);
  assert.deepEqual([d.exercises[3].sets, d.exercises[3].reps, d.exercises[3].rest_sec], ['3', '10', 60]);
  assert.deepEqual(questions.map((q) => q.key), ['title']);
});

test('warm-up and cool-down, rounds of a list, "and" between exercises, yesterday, pm time', () => {
  const { draft: d } = draft("Yesterday's HIIT class at Planet Fitness Rosebank at 5:30 pm. Warm up 5 minutes skillmill run. Then three rounds of twelve dumbbell thrusters, ten renegade rows each side, twenty squat jumps and 30 seconds bear crawl. Cool down with dead bugs and bird dogs.");
  assert.equal(d.date, '2026-11-19');
  assert.equal(d.time, '17:30');
  assert.equal(d.club, 'Planet Fitness Rosebank');
  assert.equal(d.category, 'HIIT');
  assert.deepEqual(d.exercises.map(nameOf), ['Skillmill run', 'Dumbbell thruster', 'Renegade row', 'Squat jump', 'Bear crawl', 'Dead bug', 'Bird-dog']);
  assert.equal(d.exercises[0].cues, 'Warm-up');
  assert.equal(d.exercises[1].cues, '', 'the warm-up ends with its sentence');
  assert.deepEqual(d.exercises.slice(1, 5).map((e) => [e.sets, e.reps]), [['3', '12'], ['3', '10 each side'], ['3', '20'], ['3', '30 sec']]);
  assert.equal(d.exercises[6].cues, 'Cool-down');
});

test('it asks when it is unsure, and offers the likely library exercises', () => {
  const { draft: d, questions } = draft('Class on 18 November at the Sandton club at 18:00. Burpees, lunges, jumping jacks, plank 45 seconds. Sled push 20 metres.');
  assert.equal(d.date, '2026-11-18');
  assert.equal(d.club, 'Sandton club');
  assert.equal(nameOf(d.exercises[0]), 'Burpee');
  const match = (name) => questions.find((q) => q.key === 'match' && d.exercises[q.index].name === name);
  assert.ok(match('Lunges').options.some((o) => /lunge/i.test(o.name)), 'lunges: offers the library lunges');
  assert.ok(match('Sled Push').options.some((o) => o.name === 'Skillmill high sled push') && match('Sled Push').options.some((o) => o.name === 'Skillmill low sled push'), 'sled push: high or low?');
  assert.equal(nameOf(d.exercises[2]), 'Jumping jack', 'jumping jacks: in the library');
  assert.ok(match('Plank').options.some((o) => o.name === 'High plank hold'), 'plank: offers the high plank hold');
  assert.equal(d.exercises.find((e) => e.name === 'Plank').reps, '45 sec');
  assert.ok(questions.some((q) => q.key === 'reps'), 'asks for missing reps');
});

test('"march 3 x 12" is the glute bridge march, not 3 March; called/beginner/strength', () => {
  const { draft: d, questions } = draft('called Leg Day Burner. beginner strength session. glute bridge march 3 x 12, single leg romanian deadlift 8 each leg, front squat 5 by 5 rest 90 seconds');
  assert.equal(d.title, 'Leg Day Burner');
  assert.equal(d.date, '');
  assert.equal(d.level, 'Beginner');
  assert.deepEqual(d.exercises.map(nameOf), ['Glute bridge march', 'Single-leg Romanian deadlift', 'Front squat']);
  assert.deepEqual(questions.map((q) => q.key).sort(), ['club', 'date', 'time']);
});

test('remembers known club names, and copes with nothing said', () => {
  assert.equal(draft('at apex studio woodmead today, 10 burpees', ['Apex Studio Woodmead']).draft.club, 'Apex Studio Woodmead');
  const { questions } = draft('');
  assert.equal(questions[0].key, 'empty');
  assert.deepEqual(draft('it was a good one').questions.slice(0, 3).map((q) => q.key), ['club', 'time', 'date']);
});

test('class details and playlist rules', () => {
  const base = { id: 1, title: 'X', exercises: [{ name: 'Squat' }] };
  const ok = cleanWorkout({ ...base, date: '2026-11-20', time: '06:00', club: 'Virgin Active Sandton', playlist: ['https://youtube.com/playlist?list=PL1', { url: 'https://youtu.be/abc', title: 'Mix' }] });
  assert.deepEqual([ok.date, ok.time, ok.club], ['2026-11-20', '06:00', 'Virgin Active Sandton']);
  assert.deepEqual(ok.playlist, [{ url: 'https://youtube.com/playlist?list=PL1', title: '' }, { url: 'https://youtu.be/abc', title: 'Mix' }]);
  assert.throws(() => cleanWorkout({ ...base, date: '2026-02-30' }), /not a real date/);
  assert.throws(() => cleanWorkout({ ...base, time: '25:00' }), /06:00/);
  assert.throws(() => cleanPlaylist(['https://evil.example.com/x']), /YouTube/);
  // links as people paste them on a phone are cleaned up
  assert.equal(cleanPlaylist(['http://youtube.com/x'])[0].url, 'https://youtube.com/x');
  assert.equal(cleanPlaylist(['youtube.com/playlist?list=PL2'])[0].url, 'https://youtube.com/playlist?list=PL2');
  assert.equal(cleanPlaylist(['www.youtube.com/watch?v=abc&list=PL3'])[0].url, 'https://www.youtube.com/watch?v=abc&list=PL3');
  assert.equal(cleanPlaylist(['Check out this playlist on YouTube: https://youtube.com/playlist?list=PL4&si=xyz'])[0].url, 'https://youtube.com/playlist?list=PL4&si=xyz');
  assert.equal(cleanPlaylist([' https://youtu.be/abc?si=1 '])[0].url, 'https://youtu.be/abc?si=1');
  assert.equal(cleanPlaylist(['https://music.youtube.com/playlist?list=PL5'])[0].url, 'https://music.youtube.com/playlist?list=PL5');
  assert.equal(cleanPlaylist(['https://M.YouTube.com/watch?v=x'])[0].url, 'https://M.YouTube.com/watch?v=x');
  assert.throws(() => cleanPlaylist(['spotify.com/playlist/1']), /YouTube/);
  assert.throws(() => cleanPlaylist(['javascript:alert(1)']), /valid|YouTube/);
  assert.deepEqual(cleanWorkout(base).playlist, []);
});

test('class types, short club names and the class timer', () => {
  const clubs = ['Virgin Active Rosebank', 'Virgin Active Melrose Arch'];
  const types = ['Grid', 'Lift Club', 'Hyrox'];
  const opts = { library, clubs, types, today: '2026-11-20' };
  let r = draftWorkout('Lift club at Melrose this morning, 6am. 5 sets of 5 barbell back squats.', opts);
  assert.equal(r.draft.category, 'Lift Club');
  assert.equal(r.draft.club, 'Virgin Active Melrose Arch', '"Melrose" is enough');
  assert.equal(r.draft.time, '06:00');
  assert.ok(!r.draft.exercises.some((e) => /club/i.test(e.name || '')), 'the class type is not read as an exercise');
  r = draftWorkout('Grid at Rosebank 5:30am. 4 rounds, 40 on 20 off, rest 1 minute between rounds: kettlebell swings, burpees.', opts);
  assert.equal(r.draft.category, 'Grid');
  assert.equal(r.draft.club, 'Virgin Active Rosebank');
  assert.deepEqual(r.draft.timer, { type: 'intervals', work_sec: 40, rest_sec: 20, rounds: 4, round_rest_sec: 60 });
  assert.deepEqual(draftWorkout('20 minute AMRAP: 10 burpees, 15 air squats', opts).draft.timer, { type: 'amrap', minutes: 20 });
  assert.deepEqual(draftWorkout('EMOM for 12 minutes: 10 kettlebell swings, 8 push-ups', opts).draft.timer, { type: 'emom', minutes: 12 });
  assert.equal(draftWorkout('Tabata burpees', opts).draft.timer.type, 'tabata');
  assert.equal(draftWorkout('10 burpees', opts).draft.timer, null);
});

test('notes: one exercise per line, bullets and numbering, "40/20 x 4" timer', () => {
  const notes = [
    'Hyrox Wednesday 18:30 Melrose',
    'Timer: 40/20 x 4',
    '',
    '1. Kettlebell swings',
    '2. Goblet squats',
    '- 12 push-ups',
    '• Mountain climbers',
  ].join('\n');
  const { draft } = draftWorkout(notes, { library, clubs: ['Virgin Active Rosebank', 'Virgin Active Melrose Arch'], types: ['Hyrox', 'Grid'], today: '2026-11-20' });
  assert.equal(draft.category, 'Hyrox');
  assert.equal(draft.club, 'Virgin Active Melrose Arch');
  assert.equal(draft.time, '18:30');
  assert.equal(draft.date, '2026-11-18', 'last Wednesday');
  assert.deepEqual(draft.timer, { type: 'intervals', work_sec: 40, rest_sec: 20, rounds: 4, round_rest_sec: '' });
  assert.equal(draft.exercises.length, 4, JSON.stringify(draft.exercises));
  assert.equal(draft.exercises[2].reps, '12');
  assert.equal(draft.exercises[0].sets, '4');
});

test('words that only fit one exercise together are matched; ambiguous ones ask', () => {
  const { draft: d, questions } = draft('front squat, lateral raises, kettlebell cleans, hang cleans, dumbbell rows, rows');
  assert.deepEqual(d.exercises.slice(0, 5).map(nameOf), ['Front squat', 'Lateral raise', 'Clean', 'Hang clean', 'Dumbbell bent-over row']);
  const rows = questions.find((q) => q.key === 'match' && d.exercises[q.index].name === 'Rows');
  assert.ok(rows && rows.options.some((o) => o.name === 'Barbell bent-over row') && rows.options.some((o) => o.name === 'Kettlebell single-arm row'), 'rows: asks which row');
});
