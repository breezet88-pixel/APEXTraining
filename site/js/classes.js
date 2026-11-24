// The coach's class schedule (site/data/classes.json): class types with a short description, the
// repeating weekly timetable, and ad hoc (one-off) classes. A new workout is pre-filled from it.
//
//   { version: 1,
//     types:  [{ name, description }],
//     weekly: [{ day: 0-6 (0 = Sunday), time: 'HH:MM', type, club }],
//     extra:  [{ date: 'YYYY-MM-DD', time: 'HH:MM', type, club }] }   <- ad hoc classes

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
export const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Every class on a date: the weekly timetable for that weekday plus ad hoc classes, in time order.
export function classesOn(classes, day) {
  if (!classes || !day) return [];
  const wd = weekdayOf(day);
  const list = [
    ...(classes.extra || []).filter((c) => c.date === day).map((c) => ({ date: day, time: c.time, type: c.type, club: c.club, place: c.place || '', adhoc: true })),
    ...(classes.weekly || []).filter((c) => c.day === wd).map((c) => ({ date: day, time: c.time, type: c.type, club: c.club, place: c.place || '', adhoc: false })),
  ];
  const seen = new Set();
  return list.filter((c) => { const k = `${c.time}|${c.club.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.time.localeCompare(b.time));
}

export const sameClass = (w, c) => w.date === c.date && w.time === c.time && (w.club || '').toLowerCase() === (c.club || '').toLowerCase();

// The class a new workout is most likely for: the latest class that has already started (today, or up
// to 3 days back) and has no workout in the library yet. Falls back to today's next class.
export function suggestClass(classes, workouts, now, exceptId = 0) {
  const logged = (c) => workouts.some((w) => w.id !== exceptId && sameClass(w, c));
  for (let i = 0; i <= 3; i++) {
    const day = addDays(now.date, -i);
    const started = classesOn(classes, day).filter((c) => i > 0 || c.time <= now.time).reverse();
    const c = started.find((x) => !logged(x));
    if (c) return c;
  }
  return classesOn(classes, now.date).find((c) => !logged(c)) || null;
}

export function typeInfo(classes, name) {
  const key = String(name || '').trim().toLowerCase();
  return key ? (classes?.types || []).find((t) => t.name.toLowerCase() === key) || null : null;
}

// All clubs the coach uses, from the timetable, ad hoc classes and past workouts.
export function clubsOf(classes, workouts = []) {
  return [...new Set([...(classes?.weekly || []), ...(classes?.extra || []), ...workouts].map((x) => x.club).filter(Boolean))].sort();
}
