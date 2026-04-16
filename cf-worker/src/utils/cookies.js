export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  }
  return cookies;
}

function sessionSameSite(env) {
  const domain = (env.COOKIE_DOMAIN || '').trim();
  // Produção: admin + API no mesmo registrável (ex. .reversofilmes.com.br) → Lax.
  // Staging: Netlify (*.netlify.app) + Worker (*.workers.dev) → credenciais cross-site precisam None + Secure.
  return domain ? 'Lax' : 'None';
}

/** Max-Age em segundos, ou null = cookie de sessão do browser (sem Max-Age). */
function sessionCookieMaxAge(env) {
  const raw = (env.PERSIST_SESSION_COOKIE ?? 'true').toString().trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return null;
  const ttl = parseInt(env.JWT_TTL_SECONDS, 10);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 28800;
}

export function sessionCookie(token, env) {
  const domain = (env.COOKIE_DOMAIN || '').trim();
  const sameSite = sessionSameSite(env);
  const maxAge = sessionCookieMaxAge(env);
  let cookie = `__session=${token}; HttpOnly; Secure; SameSite=${sameSite}; Path=/`;
  if (maxAge != null) cookie += `; Max-Age=${maxAge}`;
  if (domain) cookie += `; Domain=${domain}`;
  return cookie;
}

export function clearSessionCookie(env) {
  const domain = (env.COOKIE_DOMAIN || '').trim();
  const sameSite = sessionSameSite(env);
  let cookie = `__session=; HttpOnly; Secure; SameSite=${sameSite}; Path=/; Max-Age=0`;
  if (domain) cookie += `; Domain=${domain}`;
  return cookie;
}

export function oauthStateCookie(state) {
  return `__cf_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
}

export function clearOauthStateCookie() {
  return '__cf_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}
