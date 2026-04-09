/**
 * GitHub Authentication — Netlify OAuth proxy + PAT fallback
 */
class GitHubAuth {
  constructor() {
    this.TOKEN_KEY = 'reverso_admin_token';
    this.TYPE_KEY = 'reverso_admin_auth_type';
    this._token = null;
    this._type = null;
  }

  init() {
    this._token = localStorage.getItem(this.TOKEN_KEY);
    this._type = localStorage.getItem(this.TYPE_KEY);
    return !!this._token;
  }

  get token() { return this._token; }
  get isAuthenticated() { return !!this._token; }
  get isLocal() {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.');
  }

  loginWithOAuth() {
    const siteId = window.location.hostname;
    const url = `https://api.netlify.com/auth?provider=github&site_id=${siteId}`;

    return new Promise((resolve, reject) => {
      const popup = window.open(url, 'github-auth', 'width=600,height=700,scrollbars=yes');
      if (!popup) return reject(new Error('Popup bloqueado. Habilite popups para este site.'));

      let settled = false;

      const onMessage = (e) => {
        if (!e.data || typeof e.data !== 'string') return;

        // Step 1 of handshake: popup announces it's authorizing.
        // We must reply so it proceeds to send the token.
        if (e.data === 'authorizing:github') {
          e.source.postMessage(e.data, e.origin);
          return;
        }

        // Step 2: popup sends the actual token (or error).
        const match = e.data.match(
          /^authorization:github:(success|error):(.+)$/,
        );
        if (!match) return;
        cleanup();

        if (match[1] === 'success') {
          try {
            const { token } = JSON.parse(match[2]);
            this._save(token, 'oauth');
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
    this._save(t, 'pat');
    return t;
  }

  logout() {
    this._token = null;
    this._type = null;
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.TYPE_KEY);
  }

  _save(token, type) {
    this._token = token;
    this._type = type;
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.TYPE_KEY, type);
  }
}
