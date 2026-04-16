import { corsMiddleware } from './middleware/cors.js';
import { authMiddleware, checkRevocation, checkAllowlist, buildTokenAuth } from './middleware/auth.js';
import { csrfMiddleware } from './middleware/csrf.js';
import { handleHealth } from './routes/health.js';
import { handleGitHubLogin, handleGitHubCallback, handleLogout, handleMe } from './routes/auth.js';
import {
  handleExport,
  handleList,
  handleGet,
  handleCreate,
  handleUpdate,
  handleDelete,
  handleReorder,
  handleBackfillYoutubeThumbnails,
} from './routes/projects.js';
import { handleUpload } from './routes/upload.js';
import { handleDeploy } from './routes/deploy.js';
import { weeklyBackup } from './cron/backup.js';
import { dailyCleanup } from './cron/cleanup.js';
import { json, error } from './utils/response.js';
import { matchApiProjectSlug } from './utils/slug.js';

function matchRoute(method, path) {
  const slug = matchApiProjectSlug(path);
  return { method, path, slug };
}

export default {
  async fetch(request, env, cfCtx) {
    const ctx = { waitUntil: cfCtx.waitUntil.bind(cfCtx), user: null };
    const url = new URL(request.url);
    const path = url.pathname;

    const corsResult = corsMiddleware(request, env);
    if (corsResult instanceof Response) return corsResult;
    const { corsHeaders } = corsResult;

    const withCors = (res) => {
      const r = new Response(res.body, res);
      for (const [k, v] of Object.entries(corsHeaders)) r.headers.set(k, v);
      return r;
    };

    try {
      const res = await route(request, env, ctx, path);
      return withCors(res);
    } catch (e) {
      console.error('Unhandled error:', e);
      return withCors(error('Internal server error', 500));
    }
  },

  async scheduled(event, env) {
    const hour = new Date(event.scheduledTime).getUTCHours();
    const day = new Date(event.scheduledTime).getUTCDay();

    if (day === 0 && hour === 3) {
      await weeklyBackup(env);
    }
    if (hour === 4) {
      await dailyCleanup(env);
    }
  },
};

async function route(request, env, ctx, path) {
  const { method } = request;

  if (path === '/health' && method === 'GET') {
    return handleHealth(env);
  }
  // Raiz: sem auth (evita 401 ao abrir :8787 no browser). O site estático é o Jekyll (ex. :4000).
  if (path === '/' && method === 'GET') {
    return json({
      service: 'reverso-cms-api',
      health: '/health',
      auth: '/api/auth/github',
    });
  }
  if (path === '/api/auth/github' && method === 'GET') {
    return handleGitHubLogin(request, env);
  }
  if (path === '/api/auth/github/callback' && method === 'GET') {
    return handleGitHubCallback(request, env, ctx);
  }

  if (path === '/api/projects/export' && method === 'GET') {
    const authErr = await buildTokenAuth(request, env);
    if (authErr) return authErr;
    return handleExport(env);
  }

  if (path === '/api/projects/backfill-youtube-thumbnails' && method === 'POST') {
    const authErr = await buildTokenAuth(request, env);
    if (authErr) return authErr;
    return handleBackfillYoutubeThumbnails(env);
  }

  const authErr = await authMiddleware(request, env, ctx);
  if (authErr) return authErr;

  const revErr = await checkRevocation(env, ctx);
  if (revErr) return revErr;

  const allowErr = await checkAllowlist(env, ctx);
  if (allowErr) return allowErr;

  if (path === '/api/auth/me' && method === 'GET') {
    return handleMe(env, ctx);
  }
  if (path === '/api/projects' && method === 'GET') {
    return handleList(env);
  }
  if (method === 'GET') {
    const { slug } = matchRoute(method, path);
    if (slug && path.startsWith('/api/projects/')) {
      return handleGet(slug, env);
    }
  }

  const csrfErr = csrfMiddleware(request);
  if (csrfErr) return csrfErr;

  if (path === '/api/auth/logout' && method === 'POST') {
    return handleLogout(request, env, ctx);
  }
  if (path === '/api/projects' && method === 'POST') {
    return handleCreate(request, env, ctx);
  }
  if (path === '/api/projects/reorder' && method === 'POST') {
    return handleReorder(request, env, ctx);
  }
  if (path === '/api/upload' && method === 'POST') {
    return handleUpload(request, env, ctx);
  }
  if (path === '/api/deploy' && method === 'POST') {
    return handleDeploy(env, ctx);
  }

  const { slug } = matchRoute(method, path);
  if (slug && path.startsWith('/api/projects/')) {
    if (method === 'PATCH') return handleUpdate(slug, request, env, ctx);
    if (method === 'DELETE') return handleDelete(slug, env, ctx);
  }

  return error('Not found', 404);
}
