/**
 * GitHub REST / Git Data API wrapper
 */
class GitHubAPI {
  constructor(token, repo, branch) {
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    this.base = 'https://api.github.com';
    this._sha = {};
  }

  async _req(path, opts = {}) {
    const url = path.startsWith('http') ? path : `${this.base}${path}`;
    const method = opts.method || 'GET';
    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body.message || `GitHub ${res.status}`;
      console.error(`[GitHubAPI] ${method} ${path} → ${res.status}: ${msg}`);
      if (res.status === 404 && method !== 'GET') {
        throw new Error(
          `${msg} — verifique se o token tem permissão de escrita (scope "repo"). ` +
          `Faça logout e login novamente.`,
        );
      }
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async getUser() { return this._req('/user'); }

  async listDir(dir) {
    const items = await this._req(
      `/repos/${this.repo}/contents/${dir}?ref=${this.branch}`,
    );
    items.forEach((f) => { this._sha[f.path] = f.sha; });
    return items;
  }

  async getFile(path) {
    const d = await this._req(
      `/repos/${this.repo}/contents/${path}?ref=${this.branch}`,
    );
    this._sha[path] = d.sha;
    const bin = atob(d.content.replace(/\n/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return {
      content: new TextDecoder().decode(bytes),
      sha: d.sha,
      path: d.path,
    };
  }

  async putFile(path, content, message) {
    const encoded = btoa(unescape(encodeURIComponent(content)));
    const body = { message, content: encoded, branch: this.branch };
    const sha = this._sha[path];
    if (sha) body.sha = sha;
    const r = await this._req(`/repos/${this.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    this._sha[path] = r.content.sha;
    return r;
  }

  async deleteFile(path, message) {
    const sha = this._sha[path];
    if (!sha) throw new Error(`SHA desconhecido: ${path}`);
    await this._req(`/repos/${this.repo}/contents/${path}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, branch: this.branch }),
    });
    delete this._sha[path];
  }

  /**
   * Atomic multi-file commit via Git Data API.
   * @param {Array<{path:string, content:string}>} changes
   */
  async atomicCommit(changes, message) {
    const ref = await this._req(
      `/repos/${this.repo}/git/ref/heads/${this.branch}`,
    );
    const commitSha = ref.object.sha;
    const commit = await this._req(
      `/repos/${this.repo}/git/commits/${commitSha}`,
    );

    const tree = [];
    for (const c of changes) {
      const blob = await this._req(`/repos/${this.repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: c.content, encoding: 'utf-8' }),
      });
      tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await this._req(`/repos/${this.repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: commit.tree.sha, tree }),
    });

    const newCommit = await this._req(`/repos/${this.repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        parents: [commitSha],
      }),
    });

    await this._req(`/repos/${this.repo}/git/refs/heads/${this.branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    });

    tree.forEach((t) => { this._sha[t.path] = t.sha; });
    return newCommit;
  }

  uploadMedia(path, file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const b64 = reader.result.split(',')[1];
          const body = {
            message: `Upload ${file.name}`,
            content: b64,
            branch: this.branch,
          };
          const sha = this._sha[path];
          if (sha) body.sha = sha;
          const r = await this._req(`/repos/${this.repo}/contents/${path}`, {
            method: 'PUT',
            body: JSON.stringify(body),
          });
          this._sha[path] = r.content.sha;
          resolve(r);
        } catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  sha(path) { return this._sha[path]; }
}

/* ---- YAML front-matter helpers (depends on global jsyaml) ---- */

const FrontMatter = {
  parse(raw) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { data: {}, body: raw };
    return { data: jsyaml.load(m[1]) || {}, body: m[2] || '' };
  },

  serialize(data, body) {
    const yml = jsyaml.dump(data, {
      lineWidth: -1,
      forceQuotes: false,
      noRefs: true,
      sortKeys: false,
    });
    return `---\n${yml}---\n${body ?? ''}`;
  },
};
