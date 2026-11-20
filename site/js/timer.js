// The class timer: the coach sets it on a workout, members run it when they redo the class.
// buildSegments() turns the settings plus the exercise names into the sequence the timer plays.
//
//   timer = { type, work_sec, rest_sec, rounds, round_rest_sec, minutes, order, notes, image }
//   type:  '' (no timer) | intervals | tabata | emom | amrap | fortime
//   order: 'circuit' (every exercise, then the next round) | 'station' (all rounds of one exercise, then the next)

export const TIMER_TYPES = {
  '': 'No timer',
  intervals: 'Intervals (work / rest)',
  tabata: 'Tabata (20 sec on / 10 off, 8 rounds)',
  emom: 'EMOM (every minute on the minute)',
  amrap: 'AMRAP (as many rounds as possible)',
  fortime: 'For time (stopwatch)',
};

export const PREP_SEC = 10;
const n = (v) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : 0);

export function secLabel(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} sec`;
  return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} sec` : `${s / 60} min`;
}

// The timer with defaults filled in (Tabata is 20/10 x 8 unless the coach changed it).
export function effective(t) {
  if (!t || !t.type) return null;
  const tabata = t.type === 'tabata';
  return {
    type: t.type,
    work: n(t.work_sec) || (tabata ? 20 : t.type === 'emom' ? 60 : 0),
    rest: t.rest_sec === '' || t.rest_sec === null || t.rest_sec === undefined ? (tabata ? 10 : 0) : n(t.rest_sec),
    rounds: n(t.rounds) || (tabata ? 8 : 1),
    roundRest: n(t.round_rest_sec),
    minutes: n(t.minutes),
    order: t.order === 'station' ? 'station' : 'circuit',
  };
}

// One line for members, e.g. "4 rounds · 40 sec on / 20 sec off · 1 min rest between rounds".
export function timerSummary(t) {
  const e = effective(t);
  if (!e) return '';
  switch (e.type) {
    case 'intervals':
    case 'tabata':
      if (!e.work) return '';
      return [e.type === 'tabata' ? 'Tabata' : '', `${e.rounds} round${e.rounds === 1 ? '' : 's'}`, `${secLabel(e.work)} on / ${secLabel(e.rest)} off`,
        e.roundRest ? `${secLabel(e.roundRest)} rest between ${e.order === 'station' ? 'exercises' : 'rounds'}` : '',
        e.order === 'station' ? 'all rounds of one exercise before the next' : ''].filter(Boolean).join(' · ');
    case 'emom': {
      const count = emomCount(e);
      return count ? `EMOM · ${count} × ${secLabel(e.work)}${e.work === 60 ? '' : ' intervals'} (${secLabel(count * e.work)})` : '';
    }
    case 'amrap': return e.minutes ? `AMRAP · ${e.minutes} min` : '';
    case 'fortime': return `For time${e.minutes ? ` · ${e.minutes} min time cap` : ''}`;
    default: return '';
  }
}

const emomCount = (e) => (e.minutes ? Math.floor((e.minutes * 60) / e.work) : e.rounds);

// The sequence the member's timer plays: [{ phase: 'prep'|'work'|'rest', sec, label, round, rounds, countUp?, next }]
export function buildSegments(t, names = []) {
  const e = effective(t);
  if (!e) return [];
  const ex = names.length ? names : ['Work'];
  const segs = [];
  const work = (sec, label, round, rounds) => segs.push({ phase: 'work', sec, label, round, rounds });
  const rest = (sec, label = 'Rest') => { if (sec > 0) segs.push({ phase: 'rest', sec, label }); };
  if (e.type === 'intervals' || e.type === 'tabata') {
    if (!e.work) return [];
    const order = [];
    if (e.order === 'station') { for (let i = 0; i < ex.length; i++) for (let r = 0; r < e.rounds; r++) order.push([i, r]); }
    else { for (let r = 0; r < e.rounds; r++) for (let i = 0; i < ex.length; i++) order.push([i, r]); }
    order.forEach(([i, r], k) => {
      work(e.work, ex[i], r + 1, e.rounds);
      if (k === order.length - 1) return;
      const endOfBlock = e.order === 'station' ? r === e.rounds - 1 : i === ex.length - 1;
      if (endOfBlock && e.roundRest) rest(e.roundRest, e.order === 'station' ? 'Rest, then the next exercise' : 'Rest between rounds');
      else rest(e.rest);
    });
  } else if (e.type === 'emom') {
    const count = emomCount(e);
    for (let i = 0; i < count; i++) work(e.work, ex[i % ex.length], i + 1, count);
  } else if (e.type === 'amrap') {
    if (!e.minutes) return [];
    work(e.minutes * 60, 'As many rounds as possible', 1, 1);
  } else if (e.type === 'fortime') {
    segs.push({ phase: 'work', sec: e.minutes * 60, label: 'For time: go!', round: 1, rounds: 1, countUp: true });
  }
  if (!segs.length) return [];
  segs.unshift({ phase: 'prep', sec: PREP_SEC, label: 'Get ready' });
  for (let i = 0; i < segs.length; i++) segs[i].next = segs.slice(i + 1).find((s) => s.phase === 'work')?.label || '';
  return segs;
}

// Total length in seconds (a "for time" class with no cap counts as 0).
export const totalSeconds = (segs) => segs.reduce((a, s) => a + (s.phase === 'prep' ? 0 : s.sec), 0);
