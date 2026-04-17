import { error } from '../utils/response.js';

/**
 * GET público para objetos R2 — permite MEDIA_BASE_URL = https://<worker>/media
 * sem domínio customizado na zona Cloudflare (demo, fork pessoal, etc.).
 * Só aceita chaves sob prefixo projects/.
 */
export async function handlePublicMedia(env, pathname) {
  const prefix = '/media/';
  if (!pathname.startsWith(prefix)) return error('Not found', 404);

  let key = decodeURIComponent(pathname.slice(prefix.length));
  if (!key || key.includes('..') || key.startsWith('/')) return error('Bad request', 400);
  if (!key.startsWith('projects/')) return error('Not found', 404);

  const obj = await env.MEDIA.get(key);
  if (!obj) return error('Not found', 404);

  const ct = obj.httpMetadata?.contentType || 'application/octet-stream';
  const cache = obj.httpMetadata?.cacheControl || 'public, max-age=31536000';

  return new Response(obj.body, {
    headers: {
      'Content-Type': ct,
      'Cache-Control': cache,
    },
  });
}
