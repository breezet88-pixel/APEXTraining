// Builds the downloadable workout of the day: one self-contained web page with the pictures
// embedded, so it opens offline on any device and can be printed to PDF.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rest = (sec) => (sec === null || sec === undefined ? '' : sec >= 60 && sec % 60 === 0 ? `${sec / 60} min rest` : `${sec}s rest`);

export const fileName = (title, day) => `${String(title).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'workout'}-${day}.html`;

// pictureAsDataUrl(path) -> 'data:image/...' or null. Supplied by the caller (browser fetch, or a test).
export async function buildWorkoutPage(w, day, siteName, pictureAsDataUrl) {
  const meta = [w.category, w.level, w.duration_min ? `${w.duration_min} min` : ''].filter(Boolean).join(' · ');
  const rows = [];
  for (const [i, e] of w.exercises.entries()) {
    const facts = [e.sets && e.reps ? `${e.sets} × ${e.reps}` : e.sets || e.reps, rest(e.rest_sec)].filter(Boolean).join(' · ');
    const pic = e.image ? await pictureAsDataUrl(e.image).catch(() => null) : null;
    rows.push(`<section><h2>${i + 1}. ${esc(e.name)}</h2>` +
      (facts ? `<p class="facts">${esc(facts)}</p>` : '') +
      (pic && /^data:image\/(png|jpeg|webp|gif);base64,/.test(pic) ? `<img src="${pic}" alt="How to do ${esc(e.name)}">` : '') +
      (e.muscles ? `<p><b>Muscles:</b> ${esc(e.muscles)}</p>` : '') +
      (e.equipment ? `<p><b>Equipment:</b> ${esc(e.equipment)}</p>` : '') +
      (e.movement ? `<p>${esc(e.movement)}</p>` : '') +
      (e.cues ? `<p>${e.movement ? '<b>Coach’s notes:</b> ' : ''}${esc(e.cues)}</p>` : '') + '</section>');
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(w.title)} · ${esc(siteName)}</title>` +
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#111}h1{margin:0 0 4px}.meta{color:#555;margin:0 0 12px}' +
    'section{border-top:1px solid #ddd;padding:14px 0;break-inside:avoid}h2{margin:0 0 4px;font-size:1.15rem}.facts{font-weight:600;color:#0f766e;margin:0 0 8px}' +
    'img{max-width:100%;height:auto;border-radius:8px;border:1px solid #eee}p{margin:6px 0}</style></head><body>' +
    `<p class="meta">${esc(siteName)} · Workout of the day · ${esc(day)}</p><h1>${esc(w.title)}</h1><p class="meta">${esc(meta)}</p>` +
    `${w.description ? `<p>${esc(w.description)}</p>` : ''}${rows.join('')}</body></html>`;
}
