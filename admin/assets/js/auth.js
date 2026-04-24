/**
 * Auth: redirect OAuth Worker; sessão em cookie httpOnly.
 */
class Auth {
  constructor(apiBaseUrl) {
    this._apiBase = apiBaseUrl.replace(/\/$/, '');
    this._user = null;
  }

  get user() { return this._user; }
  get isAuthenticated() { return !!this._user; }

  async checkSession(api) {
    try {
      this._user = await api.getMe();
      return true;
    } catch {
      this._user = null;
      return false;
    }
  }

  login() {
    const u = new URL(`${this._apiBase}/api/auth/github`);
    try {
      u.searchParams.set('return_to', window.location.href);
    } catch { /* ignore */ }
    window.location.href = u.toString();
  }

  async logout(api) {
    try {
      await api.logout();
    } catch { /* best-effort */ }
    this._user = null;
  }

  checkLoginError() {
    const url = new URL(window.location.href);
    const err = url.searchParams.get('error');
    if (err) {
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url);
      return err === 'not_authorized'
        ? 'Sua conta GitHub não está na lista de administradores.'
        : `Falha no login: ${err}`;
    }
    return null;
  }
}
