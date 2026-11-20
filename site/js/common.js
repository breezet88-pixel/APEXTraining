// Small helpers shared by the member app and the coach page. No framework, no dependencies.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// Replace a container's content, skipping optional parts that are switched off (null/false).
export const fill = (el, ...nodes) => el.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));

export function restLabel(sec) {
  if (sec === null || sec === undefined || sec === '') return '';
  return sec >= 60 && sec % 60 === 0 ? `${sec / 60} min rest` : `${sec}s rest`;
}

export function todayIn(timezone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function metaLine(w) {
  const n = w.exercises?.length ?? 0;
  return [w.level, w.duration_min ? `${w.duration_min} min` : '', n ? `${n} exercise${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
}

// The exercise library, and workout exercises that link to it: a linked exercise shows the library's
// name, equipment, picture and movement description, plus the workout's own sets, reps, rest and notes.
export const libraryIndex = (lib) => new Map((lib?.exercises || []).map((x) => [x.id, x]));
export function resolveExercise(e, index) {
  const x = e.library_id ? index.get(e.library_id) : null;
  if (!x) return { ...e, movement: '' };
  return { ...e, name: x.name, equipment: x.equipment, image: x.image, movement: x.movement };
}
export const resolveWorkout = (w, index) => ({ ...w, exercises: w.exercises.map((e) => resolveExercise(e, index)) });

export function factsLine(e) {
  return [e.sets && e.reps ? `${e.sets} × ${e.reps}` : e.sets || e.reps, restLabel(e.rest_sec)].filter(Boolean).join(' · ');
}

// The date and time now in a time zone: { date: 'YYYY-MM-DD', time: 'HH:MM' }
export function nowIn(timezone, date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
