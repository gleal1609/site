import { verifyJWT } from '../utils/jwt.js';
import { parseCookies } from '../utils/cookies.js';
import { error } from '../utils/response.js';

export async function authMiddleware(request, env, ctx) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  let token = cookies['__session'];

  if (!token) {
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) return error('Unauthorized', 401);

  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    ctx.user = payload;
    return null;
  } catch {
    return error('Invalid or expired session', 401);
  }
}

export async function checkRevocation(env, ctx) {
  if (!ctx.user?.jti) return error('Invalid session', 401);

  const row = await env.DB.prepare(
    'SELECT 1 FROM revoked_sessions WHERE jti = ?',
  ).bind(ctx.user.jti).first();

  if (row) return error('Session revoked', 401);
  return null;
}

export async function checkAllowlist(env, ctx) {
  if (!ctx.user?.sub) return error('Invalid session', 401);

  const row = await env.DB.prepare(
    'SELECT 1 FROM admin_allowlist WHERE github_id = ?',
  ).bind(String(ctx.user.sub)).first();

  if (!row) return error('User not authorized', 403);
  return null;
}

/**
 * GET /api/projects/export — Netlify / scripts de build.
 *
 * Formatos aceites (recomendado: um só em produção):
 * 1) JWT HS256 assinado com JWT_SECRET, claims incl. scope === "read:export"
 *    (gerado por scripts/generate-build-token.mjs → secret BUILD_TOKEN no Worker).
 * 2) Fallback legado: corpo do Bearer igual ao valor literal de env.BUILD_TOKEN
 *    (ex. token opaco curto), útil durante migração.
 *
 * verifyJWT corre primeiro; se falhar (assinatura inválida / exp), tenta-se
 * comparação literal com env.BUILD_TOKEN para não quebrar deploys antigos.
 */
export async function buildTokenAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return error('Missing token', 401);

  const token = authHeader.slice(7);

  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (payload.scope !== 'read:export') return error('Invalid scope', 403);
    return null;
  } catch {
    if (token === env.BUILD_TOKEN) return null;
    return error('Invalid build token', 401);
  }
}
