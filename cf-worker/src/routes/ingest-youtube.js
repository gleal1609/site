import { json, error } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { SLUG_PATH_RE } from '../utils/slug.js';

/**
 * POST /api/projects/:slug/ingest-youtube
 *
 * Dispara o workflow «Ingest YouTube media» no GitHub Actions, que corre
 * `scripts/ingest-youtube-media.mjs --slug <slug>` num runner com
 * `ffmpeg` + `yt-dlp`. O runner lê URL e instantes do manifesto do Worker
 * e grava capa/preview em R2, actualizando o D1 via `/api/projects/media-keys`.
 *
 * Requer no Worker (wrangler secret put):
 *   GITHUB_REPO  — ex.: "reverso/site"
 *   GITHUB_DISPATCH_TOKEN  — PAT fine-grained (Contents:RW deste repo) OU
 *                            PAT classic (scope `repo`). Usado só para
 *                            `POST /repos/.../dispatches`.
 */
export async function handleIngestYoutube(slug, env, ctx) {
  if (!slug || !SLUG_PATH_RE.test(slug)) return error('Invalid slug', 400);

  const repo = (env.GITHUB_REPO || '').trim();
  const token = (env.GITHUB_DISPATCH_TOKEN || '').trim();
  if (!repo || !token) {
    return error(
      'Servidor sem GITHUB_REPO ou GITHUB_DISPATCH_TOKEN. Configure-os como secrets do Worker.',
      500,
    );
  }
  if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) {
    return error('GITHUB_REPO inválido (esperado "owner/repo")', 500);
  }

  const row = await env.DB.prepare(
    'SELECT slug, youtube_url FROM projects WHERE slug = ?',
  ).bind(slug).first();
  if (!row) return error('Project not found', 404);
  if (!row.youtube_url || !String(row.youtube_url).trim()) {
    return error('Projeto sem youtube_url; preencha e publique antes de gerar a capa/prévia.', 400);
  }

  const dispatchUrl = `https://api.github.com/repos/${repo}/dispatches`;
  const body = {
    event_type: 'ingest-youtube',
    client_payload: { slug },
  };

  const res = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'reverso-cms-worker',
    },
    body: JSON.stringify(body),
  });

  if (res.status !== 204) {
    const text = await res.text().catch(() => '');
    console.warn('[ingest-youtube] dispatch failed', res.status, text);
    if (res.status === 401 || res.status === 403) {
      return error('GitHub recusou o token de dispatch (permissões insuficientes).', 502);
    }
    if (res.status === 404) {
      return error('GitHub devolveu 404 (repo errado ou sem acesso do token).', 502);
    }
    if (res.status === 422) {
      return error('GitHub 422: o workflow existe no branch por defeito do repo? Mensagem: ' + text, 502);
    }
    return error(`GitHub dispatch ${res.status}: ${text}`.slice(0, 500), 502);
  }

  logAudit(ctx, env.DB, {
    action: 'ingest_youtube_dispatch',
    targetType: 'project',
    targetId: slug,
    diff: { repo },
  });

  const actionsUrl = `https://github.com/${repo}/actions/workflows/ingest-youtube.yml`;
  return json(
    {
      ok: true,
      slug,
      message: 'Processamento iniciado no GitHub Actions. Demora 2–5 min. Reabra o projeto para ver os ficheiros novos.',
      actions_url: actionsUrl,
    },
    202,
  );
}
