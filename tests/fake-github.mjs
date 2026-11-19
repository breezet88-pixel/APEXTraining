// A small stand-in for the parts of the GitHub REST/GraphQL API the coach page uses.
// It keeps real commits and trees in memory, refuses non-fast-forward updates (like GitHub),
// and checks the key. Used by the tests and by the browser end-to-end check.
import http from 'node:http';

export async function fakeGitHub({ repo = 'coach/apex-training', branch = 'main', token = 'good-key', readOnlyToken = 'read-only-key', files = {} } = {}) {
  let n = 0;
  const id = (p) => `${p}${(++n).toString(16).padStart(8, '0')}`;
  const blobs = new Map();   // sha -> Buffer
  const trees = new Map();   // sha -> Map(path -> blobSha)
  const commits = new Map(); // sha -> { tree, parents, message }
  const refs = new Map();

  const rootTree = new Map();
  for (const [p, content] of Object.entries(files)) { const b = id('b'); blobs.set(b, Buffer.from(content)); rootTree.set(p, b); }
  const t0 = id('t'); trees.set(t0, rootTree);
  const c0 = id('c'); commits.set(c0, { tree: t0, parents: [], message: 'initial' });
  refs.set(branch, c0);

  const fileAt = (commitSha, p) => { const c = commits.get(commitSha); const b = c && trees.get(c.tree).get(p); return b ? blobs.get(b) : null; };
  const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });
  const base = `/repos/${repo}`;

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${token}` && auth !== `Bearer ${readOnlyToken}`) return send(401, { message: 'Bad credentials' });
    const canWrite = auth === `Bearer ${token}`;
    const body = req.method === 'GET' ? null : JSON.parse((await readBody(req)) || '{}');
    const p = u.pathname;
    let m;
    if (req.method === 'GET' && p === base) return send(200, { private: false, node_id: 'R_fake', has_discussions: true, permissions: { push: canWrite, admin: canWrite, pull: true } });
    if (req.method === 'GET' && p === `${base}/git/ref/heads/${branch}`) return send(200, { object: { sha: refs.get(branch) } });
    if (req.method === 'GET' && (m = p.match(new RegExp(`^${base}/contents/(.+)$`)))) {
      const buf = fileAt(u.searchParams.get('ref') === branch ? refs.get(branch) : u.searchParams.get('ref'), decodeURIComponent(m[1]));
      return buf ? send(200, buf.toString(), 'text/plain') : send(404, { message: 'Not Found' });
    }
    if (req.method === 'GET' && (m = p.match(new RegExp(`^${base}/git/commits/(\\w+)$`)))) {
      const c = commits.get(m[1]); return c ? send(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((s) => ({ sha: s })) }) : send(404, { message: 'Not Found' });
    }
    if (req.method === 'GET' && (m = p.match(new RegExp(`^${base}/git/trees/(\\w+)$`)))) {
      const t = trees.get(m[1]); return t ? send(200, { tree: [...t.keys()].map((path) => ({ path, type: 'blob', sha: t.get(path) })) }) : send(404, { message: 'Not Found' });
    }
    if (!canWrite && req.method !== 'GET' && p !== '/graphql') return send(403, { message: 'Resource not accessible by personal access token' });
    if (req.method === 'POST' && p === `${base}/git/blobs`) {
      const b = id('b'); blobs.set(b, Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8')); return send(201, { sha: b });
    }
    if (req.method === 'POST' && p === `${base}/git/trees`) {
      const t = new Map(trees.get(body.base_tree));
      for (const e of body.tree) { if (e.sha === null) t.delete(e.path); else t.set(e.path, e.sha); }
      const s = id('t'); trees.set(s, t); return send(201, { sha: s });
    }
    if (req.method === 'POST' && p === `${base}/git/commits`) {
      const s = id('c'); commits.set(s, { tree: body.tree, parents: body.parents, message: body.message }); return send(201, { sha: s });
    }
    if (req.method === 'PATCH' && p === `${base}/git/refs/heads/${branch}`) {
      const c = commits.get(body.sha);
      if (!c || (!body.force && c.parents[0] !== refs.get(branch))) return send(422, { message: 'Update is not a fast forward' });
      refs.set(branch, body.sha); return send(200, { object: { sha: body.sha } });
    }
    if (req.method === 'POST' && p === '/graphql') {
      return send(200, { data: { repository: { id: 'R_fake', discussionCategories: { nodes: [{ id: 'DIC_general', name: 'General' }, { id: 'DIC_workouts', name: 'Workout comments' }] } } } });
    }
    return send(404, { message: 'Not Found' });
  });
  await new Promise((r) => server.listen(0, r));
  return {
    url: `http://localhost:${server.address().port}`,
    repo, branch, token, readOnlyToken,
    head: () => refs.get(branch),
    file: (path) => fileAt(refs.get(branch), path),
    paths: () => [...trees.get(commits.get(refs.get(branch)).tree).keys()].sort(),
    log: () => { const out = []; let s = refs.get(branch); while (s) { const c = commits.get(s); out.push(c.message); s = c.parents[0]; } return out; },
    // simulate a change made from another device
    pushFromElsewhere(path, content) {
      const t = new Map(trees.get(commits.get(refs.get(branch)).tree));
      const b = id('b'); blobs.set(b, Buffer.from(content)); t.set(path, b);
      const ts = id('t'); trees.set(ts, t);
      const cs = id('c'); commits.set(cs, { tree: ts, parents: [refs.get(branch)], message: 'elsewhere' }); refs.set(branch, cs);
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
