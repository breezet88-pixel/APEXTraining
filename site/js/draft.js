// Turns a spoken (or typed) description of a class into a draft workout, plus questions about
// anything it could not work out. Runs entirely in the browser: no account, no cost.
//
//   draftWorkout(text, { library, clubs, today }) ->
//     { draft: { title, date, club, time, category, level, duration_min, description, exercises },
//       questions: [{ key, text, index?, options? }] }
//
// It understands plain coaching language, e.g.
//   "Today at Virgin Active Sandton, 6am class. 4 rounds, 40 seconds on 20 off: kettlebell swings,
//    goblet squats, mountain climbers. Then 3 sets of 10 push-ups, rest 60 seconds."

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const CATEGORIES = { hiit: 'HIIT', tabata: 'HIIT', emom: 'HIIT', amrap: 'HIIT', circuit: 'Circuit', strength: 'Strength', conditioning: 'Conditioning', mobility: 'Mobility', cardio: 'Cardio', core: 'Core', 'full body': 'Full body' };
const LEVELS = ['beginner', 'intermediate', 'advanced'];
// words that carry no meaning when matching exercise names
const STOP = new Set(['a', 'an', 'the', 'and', 'of', 'to', 'with', 'for', 'on', 'off', 'do', 'did', 'we', 'you', 'then', 'next', 'some', 'my', 'our', 'into', 'in', 'at', 'each', 'per', 'side', 'leg', 'arm', 'round', 'set', 'rep', 'time', 'second', 'sec', 'minute', 'min', 'rest', 'go', 'class', 'workout', 'session', 'it', 'is', 'was', 'were', 'be', 'up', 'down', 'finisher', 'warm', 'cool', 'after', 'that', 'this', 'followed', 'by', 'again', 'also', 'plus', 'just', 'all', 'more', 'lot', 'everyone', 'them', 'they',
  'hiit', 'tabata', 'emom', 'amrap', 'circuit', 'strength', 'conditioning', 'mobility', 'cardio', 'full', 'body', 'beginner', 'intermediate', 'advanced',
  'today', 'yesterday', 'morning', 'afternoon', 'evening', 'tonight', 'club', 'gym', 'studio', 'people', 'member', 'music', 'playlist', 'good', 'great',
  'hard', 'easy', 'tough', 'fun', 'quick', 'main', 'part', 'block', 'stretch', 'stretching', 'start', 'started', 'finish', 'finished', 'with', 'using']);
const SYNONYMS = [[/\bkb\b/g, 'kettlebell'], [/\bdb\b/g, 'dumbbell'], [/\bbb\b/g, 'barbell'], [/\brdls?\b/g, 'romanian deadlift'],
  [/\bpush[\s-]?ups?\b/g, 'pushup'], [/'s\b/g, ''], [/\bski[\s-]?erg\b/g, 'skierg'], [/\bskill[\s-]?mill\b/g, 'skillmill'], [/\bsit[\s-]?ups?\b/g, 'sit up'],
  [/\bbird[\s-]?dogs?\b/g, 'bird dog'], [/\bdead[\s-]?bugs?\b/g, 'dead bug'], [/\bin[\s-]?chworms?\b/g, 'inchworm']];

const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const fromIso = (s) => new Date(`${s}T00:00:00Z`);
const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

// "twenty five" -> "25", "a minute" -> "1 minute", "half a minute" -> "30 seconds"
export function wordsToNumbers(s) {
  let t = ` ${s} `.replace(/half a minute/g, '30 seconds').replace(/\ba (minute|min)\b/g, '1 $1');
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g,
    (_, a, b) => String(NUMBER_WORDS[a] + NUMBER_WORDS[b]));
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,
    (w) => String(NUMBER_WORDS[w]));
  return t.trim();
}

function normalise(s) {
  let t = wordsToNumbers(String(s).toLowerCase());
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  return t;
}

function singular(w) {
  if (w.length <= 3) return w;
  if (/(ss|ches|shes|xes|sses)$/.test(w) && w.endsWith('es')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

const tokens = (s) => normalise(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1).map(singular).filter((w) => !STOP.has(w) && !/^\d+$/.test(w));

// ---------------------------------------------------------------- exercise matching
function buildMatcher(library) {
  const entries = (library?.exercises || []).map((x) => {
    // ignore qualifiers such as " - experienced users" or "without a push-up" when matching
    const core = x.name.replace(/\s+-\s+.*$/, '').replace(/\bwithout\b.*$/i, '');
    return { x, toks: [...new Set(tokens(core))] };
  });
  const df = new Map();
  for (const e of entries) for (const t of e.toks) df.set(t, (df.get(t) || 0) + 1);
  const w = (t) => 1 / (df.get(t) || 1);
  return function match(words) {
    const c = [...new Set(words)];
    if (!c.length) return { best: null, options: [] };
    const scored = entries.map((e) => {
      const hit = e.toks.filter((t) => c.includes(t));
      if (!hit.length) return { e, score: 0 };
      const sumHit = hit.reduce((a, t) => a + w(t), 0);
      const entryCov = hit.length / e.toks.length;
      const known = c.filter((t) => df.has(t));
      const clauseCov = known.length ? sumHit / known.reduce((a, t) => a + w(t), 0) : 0;
      const distinctive = hit.some((t) => (df.get(t) || 0) <= 3);
      return { e, score: 0.5 * entryCov + 0.5 * clauseCov, distinctive };
    }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    const [first, second] = scored;
    const options = scored.slice(0, 4).filter((s) => s.score >= 0.3).map((s) => ({ id: s.e.x.id, name: s.e.x.name }));
    if (first && first.distinctive && first.score >= 0.5 && (!second || first.score - second.score >= 0.08)) return { best: first.e.x, options };
    return { best: null, options };
  };
}

// ---------------------------------------------------------------- whole-class details
function findDate(t, today) {
  const base = fromIso(today);
  const shift = (days) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + days); return isoDay(d); };
  let m;
  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return { value: `${m[1]}-${m[2]}-${m[3]}`, text: m[0] };
  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/))) return { value: `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`, text: m[0] }; // day/month/year
  const mon = MONTHS.join('|');
  const withYear = (day, month, year) => {
    let y = year ? Number(year) : base.getUTCFullYear();
    let v = `${y}-${pad2(MONTHS.indexOf(month) + 1)}-${pad2(day)}`;
    if (!year && v > today) v = `${y - 1}${v.slice(4)}`; // a date later this year means last year
    return v;
  };
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${mon})(?:\\s+(\\d{4}))?\\b`)))) return { value: withYear(m[1], m[2], m[3]), text: m[0] };
  if ((m = t.match(new RegExp(`\\b(${mon})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b(?!\\s*(?:x|by|sets?|reps?|times|each|seconds?|secs?|minutes?|mins?|rounds?|metres?|meters?)\\b)`)))) return { value: withYear(m[2], m[1], m[3]), text: m[0] };
  if ((m = t.match(/\b(today|this morning|this afternoon|this evening|tonight)\b/))) return { value: today, text: m[0] };
  if ((m = t.match(/\byesterday\b/))) return { value: shift(-1), text: m[0] };
  if ((m = t.match(new RegExp(`\\b(?:on|last)\\s+(${DAYS.join('|')})\\b`)))) {
    const back = (base.getUTCDay() - DAYS.indexOf(m[1]) + 7) % 7;
    return { value: shift(-back), text: m[0] };
  }
  return null;
}

function findTime(t) {
  let m;
  if ((m = t.match(/\b(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?=\W|$)/))) {
    let h = Number(m[1]) % 12; if (/p/.test(m[3])) h += 12;
    if (Number(m[1]) <= 12 && (!m[2] || Number(m[2]) < 60)) return { value: `${pad2(h)}:${pad2(m[2] || 0)}`, text: m[0] };
  }
  if ((m = t.match(/\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:o'?clock\s*)?in the (morning|afternoon|evening)\b/))) {
    let h = Number(m[1]) % 12; if (m[3] !== 'morning') h += 12;
    return { value: `${pad2(h)}:${pad2(m[2] || 0)}`, text: m[0] };
  }
  if ((m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) return { value: `${pad2(m[1])}:${m[2]}`, text: m[0] };
  return null;
}

function findClub(raw, t, clubs) {
  for (const c of clubs || []) {
    const i = t.indexOf(c.toLowerCase());
    if (c && i >= 0) return { value: c, text: t.slice(i, i + c.length) };
  }
  const m = t.match(/\b(?:at|in)\s+(?:the\s+)?([a-z][a-z'&\s-]{2,40}?)\s*(?=,|\.|;|\bat\s+\d|\bon\s|\btoday\b|\byesterday\b|\bthis\s|\btonight\b|\bfor\s|\bwith\s|\bclass\b|\bwe\s|\b\d|$)/);
  if (!m) return null;
  const name = m[1].trim().replace(/\s+(at|on|in|for|with|and)$/, '').trim();
  if (!name || /^(the )?(morning|afternoon|evening|end|start|gym|class|beginning|middle)$/.test(name) || name.split(' ').length > 5) return null;
  // keep the speaker's own capitals if the text had them
  const i = raw.toLowerCase().indexOf(name);
  const original = i >= 0 ? raw.slice(i, i + name.length) : name;
  return { value: original === name ? titleCase(name) : original, text: m[0] };
}

// ---------------------------------------------------------------- one exercise clause
const UNIT = '(seconds?|secs?|minutes?|mins?|metres?|meters?|m|calories|cals?|kilometres?|km)';
function amounts(clause) {
  const out = {};
  let t = clause;
  const take = (re, fn) => { const m = t.match(re); if (m) { fn(m); t = t.replace(m[0], ' '); } };
  take(new RegExp(`\\brest(?:ing)?\\s+(?:for\\s+)?(\\d+)\\s*${UNIT}`), (m) => { out.rest_sec = /^m(in)?/.test(m[2]) && !/^m$/.test(m[2]) ? Number(m[1]) * 60 : Number(m[1]); });
  take(new RegExp(`\\b(\\d+)\\s*${UNIT}\\s+(?:of\\s+)?rest\\b`), (m) => { out.rest_sec = /^min/.test(m[2]) ? Number(m[1]) * 60 : Number(m[1]); });
  take(/\b(\d+)\s*(?:sets?|rounds?)\s+(?:of\s+)?(\d+)\b/, (m) => { out.sets = m[1]; out.reps = m[2]; });
  take(/\b(\d+)\s*(?:x|by)\s*(\d+)\b/, (m) => { out.sets = m[1]; out.reps = m[2]; });
  take(/\b(\d+)\s*(?:reps?\s*)?(?:each|per|a)\s*(side|leg|arm)\b/, (m) => { out.reps = `${m[1]} each ${m[2]}`; });
  take(/\b(\d+)\s*(?:sets?|rounds?)\b/, (m) => { out.sets = m[1]; });
  take(new RegExp(`\\b(\\d+)\\s*${UNIT}\\b`), (m) => {
    const u = m[2];
    out.reps = /^s/.test(u) ? `${m[1]} sec` : /^min/.test(u) ? `${m[1]} min` : /^(cal)/.test(u) ? `${m[1]} cal` : /^k/.test(u) ? `${m[1]} km` : `${m[1]} m`;
  });
  take(/\b(\d+)\s*(?:reps?|repetitions|times)\b/, (m) => { out.reps = m[1]; });
  take(/^\s*(\d+)\s+(?=[a-z])/, (m) => { out.reps = m[1]; });
  take(/\b(\d+)\s*$/, (m) => { if (!out.reps) out.reps = m[1]; });
  // "10 renegade rows each side": the side applies to the reps wherever it was said
  take(/\b(?:each|per)\s+(side|leg|arm)\b/, (m) => { if (/^\d+$/.test(out.reps || '')) out.reps += ` each ${m[1]}`; });
  return { out, rest: t };
}

// ---------------------------------------------------------------- the main entry point
export function draftWorkout(text, { library, clubs = [], today }) {
  const raw = String(text || '').trim();
  const questions = [];
  const draft = { title: '', date: '', club: '', time: '', category: '', level: '', duration_min: '', description: '', exercises: [] };
  if (!raw) return { draft, questions: [{ key: 'empty', text: 'Say or type how the class went, then tap “Draft my workout”.' }] };
  let t = normalise(raw);
  const cut = (found) => { if (found?.text) t = t.replace(found.text, ' , '); };

  const title = t.match(/\b(?:called|named|titled|title is|name is)\s+["“]?([a-z0-9][^,.;"”\n]{1,60})/);
  if (title) { const i = raw.toLowerCase().indexOf(title[1].trim()); draft.title = i >= 0 ? raw.slice(i, i + title[1].trim().length) : titleCase(title[1].trim()); cut({ text: title[0] }); }
  const date = findDate(t, today); if (date) { draft.date = date.value; cut(date); }
  const time = findTime(t); if (time) { draft.time = time.value; cut(time); }
  const club = findClub(raw, t, clubs); if (club) { draft.club = club.value; cut(club); }
  for (const [k, v] of Object.entries(CATEGORIES)) if (new RegExp(`\\b${k}\\b`).test(t)) { draft.category = v; break; }
  for (const l of LEVELS) if (new RegExp(`\\b${l}\\b`).test(t)) { draft.level = titleCase(l); t = t.replace(new RegExp(`\\b${l}\\b`), ' '); break; }
  const dur = t.match(/\b(\d+)\s*(?:minute|min)s?\s*(?:long\s*)?(?:class|session|workout)\b/) || t.match(/\b(?:class|session|workout)\s+(?:was\s+|of\s+)?(\d+)\s*(?:minute|min)s?\b/);
  if (dur) { draft.duration_min = Number(dur[1]); cut({ text: dur[0] }); }

  // whole-class patterns: rounds and intervals apply to every exercise that does not say otherwise
  const defaults = {};
  const interval = t.match(/\b(\d+)\s*(?:seconds?|secs?)?\s*on\s*,?\s*(?:and\s+)?(\d+)\s*(?:seconds?|secs?)?\s*(?:off|rest)\b/);
  if (interval) { defaults.reps = `${interval[1]} sec`; defaults.rest_sec = Number(interval[2]); cut({ text: interval[0] }); }
  const rounds = t.match(/\b(\d+)\s*rounds?\b(?!\s+of\s+\d)/);
  if (rounds) { defaults.sets = rounds[1]; draft.description = `${rounds[1]} rounds${interval ? `, ${interval[1]} seconds on and ${interval[2]} off` : ''}.`; cut({ text: rounds[0] }); }
  else if (interval) draft.description = `${interval[1]} seconds on, ${interval[2]} seconds off.`;
  const between = t.match(/\brest\s+(\d+)\s*(seconds?|secs?|minutes?|mins?)\s+between\s+rounds\b/);
  if (between) { draft.description += ` Rest ${between[1]} ${between[2]} between rounds.`; cut({ text: between[0] }); }

  const match = buildMatcher(library);
  const sentences = t.split(/[.;\n]/);
  for (const sentence of sentences) {
    let section = '';
    const local = {};
    const clauses = sentence.split(/:|,|\bthen\b|\bnext\b|\bfollowed by\b|\band after that\b|\bafter that\b|\band\b/);
    for (let clause of clauses) {
      clause = clause.trim();
      if (!clause) continue;
      if (/\bwarm[\s-]?up\b/.test(clause)) section = 'Warm-up';
      else if (/\bcool[\s-]?down\b|\bstretch/.test(clause)) section = 'Cool-down';
      else if (/\bfinisher\b/.test(clause)) section = 'Finisher';
      const roundsOf = clause.match(/\b(\d+)\s*rounds?\s+of\b/);
      if (roundsOf) local.sets = roundsOf[1];
      const { out, rest } = amounts(clause);
      const words = tokens(rest);
      const prev = draft.exercises[draft.exercises.length - 1];
      if (!words.length) { // only numbers, e.g. "rest 60 seconds" after an exercise
        if (prev) for (const [k, v] of Object.entries(out)) if (!prev._set.has(k)) { prev[k] = v; prev._set.add(k); }
        continue;
      }
      const { best, options } = match(words);
      const item = {
        sets: out.sets ?? local.sets ?? defaults.sets ?? '', reps: out.reps ?? defaults.reps ?? '',
        rest_sec: out.rest_sec ?? defaults.rest_sec ?? '', cues: section, _set: new Set(Object.keys(out)),
      };
      if (best) {
        draft.exercises.push({ library_id: best.id, ...item });
      } else {
        const name = titleCase(rest.replace(/[^a-z0-9' -]+/g, ' ').replace(/\b(we did|we do|do|did|some|then|and|the|of|with|for|warm up|cool down|finisher|rounds?)\b/g, ' ').replace(/\s+/g, ' ').trim());
        if (!name || name.length < 3) continue;
        draft.exercises.push({ name, muscles: '', equipment: '', image: '', ...item });
        const index = draft.exercises.length - 1;
        questions.push({ key: 'match', index, options, text: options.length
          ? `“${name}”: which library exercise is it? Or keep it as your own.`
          : `“${name}” isn't in your exercise library. Keep it as your own exercise, or rename it.` });
      }
    }
  }
  for (const e of draft.exercises) delete e._set;

  // questions for anything missing
  if (!draft.exercises.length) questions.unshift({ key: 'none', text: 'I couldn’t pick out any exercises. Try naming them one at a time, e.g. “10 kettlebell swings, then 12 goblet squats”.' });
  draft.exercises.forEach((e, index) => {
    if (!e.reps && !e.sets) questions.push({ key: 'reps', index, text: 'How many reps, or how long, for this exercise?' });
  });
  if (!draft.date) questions.unshift({ key: 'date', text: 'What date was the class?' });
  if (!draft.time) questions.unshift({ key: 'time', text: 'What time did the class start?' });
  if (!draft.club) questions.unshift({ key: 'club', text: 'Which club was it at?' });
  if (!draft.title) {
    draft.title = [draft.category || 'Class', draft.club && `at ${draft.club}`].filter(Boolean).join(' ');
    questions.push({ key: 'title', text: `Workout name: keep “${draft.title}” or change it?` });
  }
  return { draft, questions };
}
