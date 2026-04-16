import { json, redirect, error } from '../utils/response.js';
import { signJWT, generateJTI } from '../utils/jwt.js';
import { parseCookies, sessionCookie, clearSessionCookie, oauthStateCookie, clearOauthStateCookie } from '../utils/cookies.js';
import { rateLimitAuth, recordLoginAttempt } from '../middleware/rate-limit.js';
import { logAudit } from '../utils/audit.js';

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export async function handleGitHubLogin(request, env) {
  const rateErr = await rateLimitAuth(request, env);
  if (rateErr) return rateErr;

  const state = randomHex(32);
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${new URL(request.url).origin}/api/auth/github/callback`,
    scope: 'read:user user:email',
    state,
  });

  return redirect(
    `https://github.com/login/oauth/authorize?${params}`,
    [oauthStateCookie(state)],
  );
}

export async function handleGitHubCallback(request, env, ctx) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return error('Missing code or state', 400);
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const savedState = cookies['__cf_oauth_state'];
  if (!savedState || savedState !== state) {
    return error('Invalid OAuth state', 403);
  }

  await recordLoginAttempt(env, request);

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    return redirect(`${env.ADMIN_ORIGIN}?error=oauth_failed`, [clearOauthStateCookie()]);
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Reverso-CMS',
    },
  });
  const ghUser = await userRes.json();

  const allowed = await env.DB.prepare(
    'SELECT 1 FROM admin_allowlist WHERE github_id = ?',
  ).bind(String(ghUser.id)).first();

  if (!allowed) {
    return redirect(`${env.ADMIN_ORIGIN}?error=not_authorized`, [clearOauthStateCookie()]);
  }

  const ttl = parseInt(env.JWT_TTL_SECONDS) || 28800;
  const jti = generateJTI();
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJWT({
    sub: String(ghUser.id),
    login: ghUser.login,
    name: ghUser.name || ghUser.login,
    avatar: ghUser.avatar_url,
    jti,
    iat: now,
    exp: now + ttl,
  }, env.JWT_SECRET);

  logAudit(ctx, env.DB, {
    action: 'login',
    targetType: 'session',
    targetId: jti,
    diff: { login: ghUser.login },
  });

  return redirect(env.ADMIN_ORIGIN, [
    sessionCookie(jwt, env),
    clearOauthStateCookie(),
  ]);
}

export async function handleLogout(request, env, ctx) {
  if (ctx.user?.jti) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO revoked_sessions (jti) VALUES (?)',
    ).bind(ctx.user.jti).run();

    logAudit(ctx, env.DB, {
      action: 'logout',
      targetType: 'session',
      targetId: ctx.user.jti,
    });
  }

  return json({ ok: true }, 200, {
    'Set-Cookie': clearSessionCookie(env),
  });
}

export async function handleMe(env, ctx) {
  return json({
    github_id: ctx.user.sub,
    login: ctx.user.login,
    name: ctx.user.name,
    avatar_url: ctx.user.avatar,
  });
}
