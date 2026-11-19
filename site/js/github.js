// Talks to the GitHub API for the coach page. Every save is ONE commit to the repository: the data files
// plus any new pictures, with pictures no longer used by any workout deleted in the same commit.
// GitHub Pages then republishes the site (about a minute).
//
// The coach signs in with a fine-grained personal access token that can only change this one repository.
// Only someone with write access to the repository can save, so GitHub itself enforces "only the coach edits".
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// base64 <-> bytes/text without Node or extra libraries (works in browsers and in Node for tests)
export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const textToBase64 = (s) => bytesToBase64(new TextEncoder().encode(s));

export function createGitHub({ token, repo, branch = 'main', fetchImpl = (...a) => fetch(...a), apiUrl = API }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new GitHubError('The repository name in config.js is not valid.');

  async function call(method, path, body, accept = 'application/vnd.github+json') {
    let res;
    try {
      res = await fetchImpl(`${apiUrl}${path}`, {
        method,
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch { throw new GitHubError('Cannot reach GitHub. Check your internet connection.', 0); }
    if (res.status === 401) throw new GitHubError('GitHub did not accept the key. It may have expired: create a new one and connect again.', 401);
    if (res.status === 403 || res.status === 404) {
      throw new GitHubError(`GitHub refused (${res.status}). Check the key has "Contents: Read and write" access to ${repo}.`, res.status);
    }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch { /* no body */ }
      throw new GitHubError(`GitHub error ${res.status}${msg ? `: ${msg}` : ''}`, res.status);
    }
    if (accept.includes('raw')) return res.text();
    return res.status === 204 ? null : res.json();
  }

  const r = `/repos/${repo}`;
  return {
    repo,
    branch,

    // Who is signed in, and may they save to this repository?
    async check() {
      const info = await call('GET', r);
      const canSave = !!(info.permissions && (info.permissions.push || info.permissions.admin));
      return { canSave, isPublic: !info.private, nodeId: info.node_id, hasDiscussions: !!info.has_discussions };
    },

    async headSha() {
      return (await call('GET', `${r}/git/ref/heads/${branch}`)).object.sha;
    },

    // Text of a file at a commit (or the branch tip). Returns null if it does not exist.
    async readText(path, ref = branch) {
      try { return await call('GET', `${r}/contents/${path}?ref=${encodeURIComponent(ref)}`, undefined, 'application/vnd.github.raw'); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },

    // Paths of all files under a folder at a commit.
    async listFiles(folder, commitSha) {
      const commit = await call('GET', `${r}/git/commits/${commitSha}`);
      const tree = await call('GET', `${r}/git/trees/${commit.tree.sha}?recursive=1`);
      return tree.tree.filter((t) => t.type === 'blob' && t.path.startsWith(`${folder}/`)).map((t) => t.path);
    },

    // One commit with every change. files: [{ path, text } | { path, base64 }]; deletes: [path].
    // expectedHead: the commit the coach's data was loaded from. If the branch has moved since,
    // nothing is saved and a 409 error is thrown, so changes made elsewhere are never overwritten.
    async commit({ message, files = [], deletes = [], expectedHead }) {
      const head = await this.headSha();
      if (expectedHead && head !== expectedHead) throw new GitHubError('The data changed on GitHub since this page loaded (another device or tab?). Reload to continue.', 409);
      const base = await call('GET', `${r}/git/commits/${head}`);
      const tree = [];
      for (const f of files) {
        const blob = await call('POST', `${r}/git/blobs`, { content: f.base64 ?? textToBase64(f.text), encoding: 'base64' });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      for (const path of deletes) tree.push({ path, mode: '100644', type: 'blob', sha: null });
      const newTree = await call('POST', `${r}/git/trees`, { base_tree: base.tree.sha, tree });
      const newCommit = await call('POST', `${r}/git/commits`, { message, tree: newTree.sha, parents: [head] });
      try {
        await call('PATCH', `${r}/git/refs/heads/${branch}`, { sha: newCommit.sha, force: false });
      } catch (e) {
        if (e.status === 422) throw new GitHubError('The data changed on GitHub while saving. Reload to continue.', 409);
        throw e;
      }
      return newCommit.sha;
    },

    // Comment settings for giscus: the repository's id and its Discussions categories.
    async discussionCategories() {
      const [owner, name] = repo.split('/');
      const res = await call('POST', '/graphql', {
        query: 'query($o:String!,$n:String!){repository(owner:$o,name:$n){id discussionCategories(first:25){nodes{id name}}}}',
        variables: { o: owner, n: name },
      });
      if (res.errors?.length) throw new GitHubError(res.errors[0].message, 400);
      const repoNode = res.data.repository;
      return { repoId: repoNode.id, categories: repoNode.discussionCategories.nodes };
    },
  };
}
