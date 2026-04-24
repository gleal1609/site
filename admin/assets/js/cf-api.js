/**
 * Cloudflare Worker API — credentials: 'include', CSRF em mutações.
 */
class CfAPI {
  constructor(baseUrl) {
    this.base = baseUrl.replace(/\/$/, '');
  }

  async _req(path, opts = {}) {
    const url = `${this.base}${path}`;
    const method = opts.method || 'GET';
    const headers = {
      Accept: 'application/json',
      ...opts.headers,
    };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      headers['X-Requested-With'] = 'fetch';
    }

    if (opts.body && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      ...opts,
      method,
      headers,
      credentials: 'include',
      body: opts.body instanceof FormData ? opts.body :
            opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (res.ok) {
      try {
        sessionStorage.removeItem('_reverso_oauth_redirect');
      } catch { /* ignore */ }
    }

    if (res.status === 401) {
      if (window.location.href.includes('error=')) {
        throw new Error('Unauthorized');
      }
      let alreadyRedirecting = false;
      try {
        alreadyRedirecting = !!sessionStorage.getItem('_reverso_oauth_redirect');
      } catch { /* storage unavailable */ }
      if (alreadyRedirecting) {
        throw new Error('Session expired');
      }
      try {
        sessionStorage.setItem('_reverso_oauth_redirect', '1');
      } catch { /* ignore */ }
      window.location.href = `${this.base}/api/auth/github`;
      throw new Error('Session expired — redirecting to login');
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `API ${res.status}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  getMe() {
    return this._req('/api/auth/me');
  }

  listProjects() {
    return this._req('/api/projects');
  }

  getProject(slug) {
    return this._req(`/api/projects/${slug}`);
  }

  createProject(data) {
    return this._req('/api/projects', { method: 'POST', body: data });
  }

  updateProject(slug, data) {
    return this._req(`/api/projects/${slug}`, { method: 'PATCH', body: data });
  }

  deleteProject(slug) {
    return this._req(`/api/projects/${slug}`, { method: 'DELETE' });
  }

  /**
   * Upload do vídeo da Hero (R2 `site/…`); sem slug.
   * @param {'hero_video'} type
   */
  uploadSiteMedia(type, file) {
    const form = new FormData();
    form.append('type', type);
    form.append('file', file);
    return this._req('/api/upload', { method: 'POST', body: form });
  }

  uploadMedia(slug, type, file) {
    const form = new FormData();
    if (slug) form.append('slug', slug);
    form.append('type', type);
    form.append('file', file);
    return this._req('/api/upload', { method: 'POST', body: form });
  }

  getSettings() {
    return this._req('/api/site-settings');
  }

  /**
   * @param {string} key
   * @param {string|null} value R2 key (site/...) ou URL
   */
  updateSetting(key, value) {
    return this._req(`/api/site-settings/${key}`, { method: 'PATCH', body: { value } });
  }

  triggerDeploy() {
    return this._req('/api/deploy', { method: 'POST' });
  }

  /**
   * Dispara o workflow do GitHub Actions que (re)gera capa e prévia de hover
   * a partir do YouTube. 202 devolve `{ actions_url, message }`.
   * @param {string} slug
   */
  ingestYoutube(slug) {
    return this._req(`/api/projects/${encodeURIComponent(slug)}/ingest-youtube`, {
      method: 'POST',
    });
  }

  /**
   * Resolve URLs de capa e primeiras imagens a partir de uma galeria Pixieset pública.
   * @param {string} galleryUrl
   * @param {string} [cid] opcional, se a extracção do HTML falhar
   */
  pixiesetResolve(galleryUrl, cid) {
    const p = new URLSearchParams();
    p.set('url', galleryUrl);
    if (cid != null && String(cid).trim() !== '') {
      p.set('cid', String(cid).trim());
    }
    return this._req(`/api/pixieset/resolve?${p.toString()}`);
  }

  logout() {
    return this._req('/api/auth/logout', { method: 'POST' });
  }
}
