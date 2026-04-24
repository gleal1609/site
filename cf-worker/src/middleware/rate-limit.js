import { error } from '../utils/response.js';

const MAX_LOGIN_ATTEMPTS = 10;
const WINDOW_HOURS = 1;

export async function rateLimitAuth(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (ip === 'unknown' && env.SKIP_AUTH_RATE_LIMIT === '1') {
    return null;
  }

  const { results } = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM login_attempts
     WHERE ip = ? AND attempted_at > datetime('now', ?)`,
  ).bind(ip, `-${WINDOW_HOURS} hours`).all();

  if (results[0]?.cnt >= MAX_LOGIN_ATTEMPTS) {
    return error('Too many login attempts. Try again later.', 429);
  }

  return null;
}

export async function recordLoginAttempt(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  await env.DB.prepare(
    'INSERT INTO login_attempts (ip) VALUES (?)',
  ).bind(ip).run();
}
