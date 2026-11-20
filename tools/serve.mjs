// Local preview: serves site/ at http://localhost:8080/ (and at /APEXTraining/, like GitHub Pages).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export function createServer({ dir = SITE_DIR, prefix = '/APEXTraining' } = {}) {
  return http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
    if (rel.startsWith(`${prefix}/`)) rel = rel.slice(prefix.length);
    if (rel === prefix) { res.writeHead(301, { Location: `${prefix}/` }); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(dir, path.normalize(rel));
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  createServer().listen(port, () => console.log(`Apex Training: http://localhost:${port}/   coach page: http://localhost:${port}/admin.html`));
}
