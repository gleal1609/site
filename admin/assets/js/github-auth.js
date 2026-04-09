/**
 * GitHub Authentication — Netlify OAuth proxy + PAT fallback.
 * Token lives ONLY in memory (never persisted to localStorage/sessionStorage).
 * Closing or reloading the tab destroys the token — login is required every time.
 */
class GitHubAuth {
  constructor() {
    this._token = null;
  }

  /** Always returns false — no persisted token to restore. */
  init() {
    this._clearLegacy();
    return false;
  }

  get token() { return this._token; }
  get isAuthenticated() { return !!this._token; }

  loginWithOAuth() {
    const siteId = window.location.hostname;
    const url = `https://api.netlify.com/auth?provider=github&site_id=${siteId}&scope=repo`;

    return new Promise((resolve, reject) => {
      const popup = window.open(url, 'github-auth', 'width=600,height=700,scrollbars=yes');
      if (!popup) return reject(new Error('Popup bloqueado. Habilite popups para este site.'));

      let settled = false;

      const onMessage = (e) => {
        if (!e.data || typeof e.data !== 'string') return;

        if (e.data === 'authorizing:github') {
          e.source.postMessage(e.data, e.origin);
          return;
        }

        const match = e.data.match(
          /^authorization:github:(success|error):(.+)$/,
        );
        if (!match) return;
        cleanup();

        if (match[1] === 'success') {
          try {
            const { token } = JSON.parse(match[2]);
            this._token = token;
            resolve(token);
          } catch { reject(new Error('Resposta de auth inválida')); }
        } else {
          reject(new Error(match[2]));
        }
      };

      const cleanup = () => {
        settled = true;
        window.removeEventListener('message', onMessage);
        clearTimeout(timeout);
        clearInterval(poll);
      };

      window.addEventListener('message', onMessage);

      const timeout = setTimeout(() => {
        if (settled) return;
        cleanup();
        if (!popup.closed) popup.close();
        reject(new Error('Timeout na autenticação (5 min)'));
      }, 300_000);

      const poll = setInterval(() => {
        if (popup.closed && !settled) {
          cleanup();
          reject(new Error('Janela fechada antes de autenticar'));
        }
      }, 500);
    });
  }

  loginWithPAT(token) {
    const t = (token || '').trim();
    if (!t) throw new Error('Token vazio');
    this._token = t;
    return t;
  }

  logout() {
    this._token = null;
    this._clearLegacy();
  }

  /** Remove tokens left by previous versions that used localStorage. */
  _clearLegacy() {
    try {
      localStorage.removeItem('reverso_admin_token');
      localStorage.removeItem('reverso_admin_auth_type');
    } catch { /* ignore in contexts where localStorage is blocked */ }
  }
}
