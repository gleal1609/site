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

  reorderProjects(items) {
    return this._req('/api/projects/reorder', { method: 'POST', body: { items } });
  }

  uploadMedia(slug, type, file) {
    const form = new FormData();
    form.append('slug', slug);
    form.append('type', type);
    form.append('file', file);
    return this._req('/api/upload', { method: 'POST', body: form });
  }

  triggerDeploy() {
    return this._req('/api/deploy', { method: 'POST' });
  }

  logout() {
    return this._req('/api/auth/logout', { method: 'POST' });
  }
}
