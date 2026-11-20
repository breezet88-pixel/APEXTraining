// Builds a downloadable workout: one self-contained web page with the pictures embedded, so it opens
// offline on any device and can be printed to PDF. Any workout in the library can be downloaded.
import { timerSummary } from './timer.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rest = (sec) => (sec === null || sec === undefined ? '' : sec >= 60 && sec % 60 === 0 ? `${sec / 60} min rest` : `${sec}s rest`);

const slug = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
export const fileName = (w) => `${[slug(w.title) || 'workout', w.date, w.time && w.time.replace(':', '')].filter(Boolean).join('-')}.html`;
const dataPic = (pic) => pic && /^data:image\/(png|jpeg|webp|gif);base64,/.test(pic);

// pictureAsDataUrl(path) -> 'data:image/...' or null. Supplied by the caller (browser fetch, or a test).
// w.about (optional) is the description of the class type.
export async function buildWorkoutPage(w, siteName, pictureAsDataUrl) {
  const meta = [w.category, w.level, w.duration_min ? `${w.duration_min} min` : ''].filter(Boolean).join(' · ');
  const when = [w.date, w.time, w.club].filter(Boolean).join(' · ');
  const music = (w.playlist || []).filter((p) => /^https:\/\//.test(p.url)).map((p, i) => `<li><a href="${esc(p.url)}">${esc(p.title || `Playlist ${i + 1}`)}</a></li>`).join('');
  const timer = timerSummary(w.timer);
  const timerPic = w.timer?.image ? await pictureAsDataUrl(w.timer.image).catch(() => null) : null;
  const timerHtml = timer || w.timer?.notes || dataPic(timerPic)
    ? `<p class="meta"><b>Timer:</b> ${esc([timer, w.timer?.notes].filter(Boolean).join(' · '))}</p>${dataPic(timerPic) ? `<img src="${timerPic}" alt="Timer settings">` : ''}` : '';
  const rows = [];
  for (const [i, e] of w.exercises.entries()) {
    const facts = [e.sets && e.reps ? `${e.sets} × ${e.reps}` : e.sets || e.reps, rest(e.rest_sec)].filter(Boolean).join(' · ');
    const pic = e.image ? await pictureAsDataUrl(e.image).catch(() => null) : null;
    rows.push(`<section><h2>${i + 1}. ${esc(e.name)}</h2>` +
      (facts ? `<p class="facts">${esc(facts)}</p>` : '') +
      (dataPic(pic) ? `<img src="${pic}" alt="How to do ${esc(e.name)}">` : '') +
      (e.muscles ? `<p><b>Muscles:</b> ${esc(e.muscles)}</p>` : '') +
      (e.equipment ? `<p><b>Equipment:</b> ${esc(e.equipment)}</p>` : '') +
      (e.movement ? `<p>${esc(e.movement)}</p>` : '') +
      (e.cues ? `<p>${e.movement ? '<b>Coach’s notes:</b> ' : ''}${esc(e.cues)}</p>` : '') + '</section>');
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(w.title)} · ${esc(siteName)}</title>` +
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#111}h1{margin:0 0 4px}.meta{color:#555;margin:0 0 12px}' +
    'section{border-top:1px solid #ddd;padding:14px 0;break-inside:avoid}h2{margin:0 0 4px;font-size:1.15rem}.facts{font-weight:600;color:#c40500;margin:0 0 8px}' +
    'img{max-width:100%;height:auto;border-radius:8px;border:1px solid #eee}p{margin:6px 0}</style></head><body>' +
    `<p class="meta">${esc(siteName)} · Workout Library</p><h1>${esc(w.title)}</h1>` +
    `${when ? `<p class="meta"><b>Class:</b> ${esc(when)}</p>` : ''}<p class="meta">${esc(meta)}</p>` +
    `${w.about ? `<p><b>About ${esc(w.category)}:</b> ${esc(w.about)}</p>` : ''}${w.description ? `<p>${esc(w.description)}</p>` : ''}${timerHtml}${music ? `<p><b>Class playlist:</b></p><ul>${music}</ul>` : ''}${rows.join('')}</body></html>`;
}
