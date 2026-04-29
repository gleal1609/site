import { json, error } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { SLUG_RE, SLUG_PATH_RE } from '../utils/slug.js';
import {
  ingestYoutubeThumbnailToR2,
  isR2MediaKey,
  isYoutubeHostedThumbnail,
  youtubeVideoId,
} from '../utils/youtube.js';

const MAX_TITLE = 200;
const MAX_BODY = 102400;
const MAX_DESCRIPTION = 32000;
/** URL absoluta (http/https) ou chave R2 sob MEDIA_BASE_URL. */
function mediaPublicUrl(base, keyOrUrl) {
  if (keyOrUrl == null || keyOrUrl === '') return null;
  const s = String(keyOrUrl);
  if (s.includes('://')) return s;
  const b = (base || '').replace(/\/$/, '');
  return b ? `${b}/${s}` : s;
}

/** Converte URL absoluta do CDN de mídia na chave guardada no D1. */
function stripMediaBaseToKey(value, base) {
  if (value == null || value === '' || !base) return value;
  const s = String(value);
  const b = String(base).replace(/\/$/, '');
  if (s.startsWith(`${b}/`)) return s.slice(b.length + 1);
  return value;
}

/** DB column → array; invalid JSON → [] + log (admin/export stay usable). */
function parseServiceTypes(value) {
  if (value == null || value === '') return [];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[projects] invalid service_types JSON:', e.message);
    return [];
  }
}

const ALLOWED_HOME_SIZES = new Set(['1x1', '1x1.5', '1x2']);

/** Largura×altura (células); grelha 5 col: 1x1, 1x1.5, 1x2; 1x3 legado → 1x1.5. */
function normalizeHomeSize(s) {
  if (s == null || s === '') return '1x1';
  const t = String(s).toLowerCase().replace(/\s/g, '');
  if (t === '1x3') return '1x1.5';
  if (ALLOWED_HOME_SIZES.has(t)) return t;
  if (t === '2x1') return '1x1';
  if (t === '2x2') return '1x2';
  return '1x1';
}

function normalizeShowOnHomeDb(v) {
  if (v === true || v === 1 || v === '1') return 1;
  return 0;
}

/** Posição dentro da coluna na Home (1 = primeiro); nunca 0. */
function normalizeHomeOrder(val) {
  if (val === undefined || val === null || val === '') return 1;
  const n = typeof val === 'number' ? val : parseInt(String(val), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 1;
  return n;
}

function validate(data, isCreate) {
  const errs = [];
  if (isCreate && !data.title) errs.push('title is required');
  if (isCreate && !data.slug) errs.push('slug is required');
  if (data.slug && !SLUG_RE.test(data.slug)) errs.push('invalid slug format (use lowercase letters, digits, hyphens)');
  if (data.title && data.title.length > MAX_TITLE) errs.push(`title max ${MAX_TITLE} chars`);
  if (data.body_md && data.body_md.length > MAX_BODY) errs.push(`body_md max ${MAX_BODY / 1024}KB`);
  if (data.description != null && String(data.description).length > MAX_DESCRIPTION) {
    errs.push(`description max ${MAX_DESCRIPTION} chars`);
  }
  if (data.year !== undefined && data.year !== null && !Number.isInteger(data.year)) errs.push('year must be integer');
  if (data.order !== undefined && data.order !== null && data.order !== '') {
    const o = typeof data.order === 'number' ? data.order : parseInt(String(data.order), 10);
    if (!Number.isFinite(o) || !Number.isInteger(o) || o < 1) errs.push('order must be a positive integer');
  }
  if (data.service_types !== undefined && data.service_types !== null && !Array.isArray(data.service_types)) {
    errs.push('service_types must be an array');
  }
  for (const [key, val] of [
    ['youtube_thumb_time_sec', data.youtube_thumb_time_sec],
    ['youtube_preview_start_sec', data.youtube_preview_start_sec],
  ]) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string' && val.trim() === '') continue;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || n > 6 * 3600) {
      errs.push(`${key} must be a number between 0 and 6 hours`);
    }
  }
  if (data.show_on_home !== undefined && data.show_on_home !== null) {
    const t = data.show_on_home;
    if (t !== 0 && t !== 1 && t !== true && t !== false && t !== '0' && t !== '1') {
      errs.push('show_on_home must be boolean or 0/1');
    }
  }
  if (data.home_col !== undefined && data.home_col !== null && data.home_col !== '') {
    const hc = Number(data.home_col);
    if (!Number.isInteger(hc) || hc < 1 || hc > 5) {
      errs.push('home_col must be an integer 1–5');
    }
  }
  return errs;
}

export async function handleExport(env) {
  // Build Jekyll: inclui `show_on_home` para a Home filtrar e ordenar.
  const { results } = await env.DB.prepare(
    `SELECT slug, title, body_md, description, thumbnail, hover_preview, service_types,
            client, date_mmddyyyy, year, "order", home_size, show_on_home,
            home_col, home_row,
            youtube_url, pixieset_url,
            youtube_thumb_time_sec, youtube_preview_start_sec
     FROM projects
     ORDER BY date_mmddyyyy DESC, year DESC, slug ASC`,
  ).all();

  const base = env.MEDIA_BASE_URL || '';
  const projects = results.map(r => ({
    ...r,
    service_types: parseServiceTypes(r.service_types),
    thumbnail: mediaPublicUrl(base, r.thumbnail),
    hover_preview: mediaPublicUrl(base, r.hover_preview),
    url: `/projects/${r.slug}/`,
  }));

  return json(projects);
}

export async function handleList(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, thumbnail, hover_preview, service_types,
            client, date_mmddyyyy, year, "order", home_size, show_on_home,
            home_col, home_row,
            youtube_url, pixieset_url, youtube_thumb_time_sec, youtube_preview_start_sec,
            version, body_md, description,
            created_at, updated_at
     FROM projects ORDER BY date_mmddyyyy DESC, year DESC, slug ASC`,
  ).all();

  const base = env.MEDIA_BASE_URL || '';
  const projects = results.map(r => ({
    ...r,
    service_types: parseServiceTypes(r.service_types),
    thumbnail: mediaPublicUrl(base, r.thumbnail),
    hover_preview: mediaPublicUrl(base, r.hover_preview),
    url: `/projects/${r.slug}/`,
  }));

  return json(projects);
}

export async function handleGet(slug, env) {
  if (!SLUG_PATH_RE.test(slug)) return error('Project not found', 404);

  const row = await env.DB.prepare(
    'SELECT * FROM projects WHERE slug = ?',
  ).bind(slug).first();
  if (!row) return error('Project not found', 404);

  const base = env.MEDIA_BASE_URL || '';
  return json({
    ...row,
    service_types: parseServiceTypes(row.service_types),
    thumbnail: mediaPublicUrl(base, row.thumbnail),
    hover_preview: mediaPublicUrl(base, row.hover_preview),
  });
}

export async function handleCreate(request, env, ctx) {
  const data = await request.json();
  const errs = validate(data, true);
  if (errs.length) return error(errs.join('; '), 400);

  const existing = await env.DB.prepare(
    'SELECT 1 FROM projects WHERE slug = ?',
  ).bind(data.slug).first();
  if (existing) return error('Slug already exists', 409);

  let thumbnailVal = data.thumbnail || null;
  if (!thumbnailVal && data.youtube_url) {
    thumbnailVal = await ingestYoutubeThumbnailToR2(env, data.slug, data.youtube_url);
  }
  thumbnailVal = stripMediaBaseToKey(thumbnailVal, env.MEDIA_BASE_URL || '');
  let hoverVal = data.hover_preview || null;
  hoverVal = stripMediaBaseToKey(hoverVal, env.MEDIA_BASE_URL || '');

  const svcJson = Array.isArray(data.service_types)
    ? JSON.stringify(data.service_types)
    : '[]';

  const thumbT =
    data.youtube_thumb_time_sec != null && data.youtube_thumb_time_sec !== ''
      ? Number(data.youtube_thumb_time_sec)
      : null;
  const prevT =
    data.youtube_preview_start_sec != null && data.youtube_preview_start_sec !== ''
      ? Number(data.youtube_preview_start_sec)
      : null;
  const thumbSec = Number.isFinite(thumbT) ? thumbT : null;
  const prevSec = Number.isFinite(prevT) ? prevT : null;
  const homeSize = normalizeHomeSize(data.home_size);
  const showHome = data.show_on_home !== undefined
    ? normalizeShowOnHomeDb(data.show_on_home)
    : 0;

  await env.DB.prepare(
    `INSERT INTO projects (slug, title, body_md, description, thumbnail, hover_preview,
      service_types, client, date_mmddyyyy, year, "order",
      home_size, show_on_home, home_col, home_row, youtube_url, pixieset_url,
      youtube_thumb_time_sec, youtube_preview_start_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    data.slug, data.title, data.body_md || null,
    data.description != null ? String(data.description) : null,
    thumbnailVal, hoverVal,
    svcJson, data.client || null, data.date_mmddyyyy || null,
    data.year || null,
    normalizeHomeOrder(data.order), homeSize, showHome,
    Number.isInteger(data.home_col) && data.home_col >= 1 && data.home_col <= 5
      ? data.home_col
      : 1,
    Number.isInteger(data.home_row) ? data.home_row : null,
    data.youtube_url || null, data.pixieset_url || null,
    thumbSec, prevSec,
  ).run();

  logAudit(ctx, env.DB, {
    action: 'create', targetType: 'project', targetId: data.slug,
    diff: { title: data.title },
  });

  return json(
    { slug: data.slug, created: true, triggerDeploy: true },
    201,
  );
}

export async function handleUpdate(slug, request, env, ctx) {
  const data = await request.json();
  const errs = validate(data, false);
  if (errs.length) return error(errs.join('; '), 400);

  if (data.version === undefined) return error('version field required for updates', 400);

  const existing = await env.DB.prepare(
    'SELECT version, youtube_url, thumbnail FROM projects WHERE slug = ?',
  ).bind(slug).first();
  if (!existing) return error('Project not found', 404);

  if (existing.version !== data.version) {
    return error('Conflict: project was modified by another user. Reload and try again.', 409);
  }

  const nextYoutube =
    data.youtube_url !== undefined ? data.youtube_url : existing.youtube_url;
  const nextThumbInput =
    data.thumbnail !== undefined ? data.thumbnail : existing.thumbnail;
  const ytChanged =
    data.youtube_url !== undefined &&
    String(data.youtube_url || '') !== String(existing.youtube_url || '');

  if (nextYoutube && youtubeVideoId(nextYoutube)) {
    const vid = youtubeVideoId(nextYoutube);
    const alreadyHasThisIngest =
      typeof nextThumbInput === 'string' &&
      nextThumbInput.includes(`thumb-yt-${vid}.jpg`);

    let shouldIngest = false;
    if (!nextThumbInput || isYoutubeHostedThumbnail(nextThumbInput)) {
      shouldIngest = true;
    } else if (ytChanged && !isR2MediaKey(nextThumbInput)) {
      shouldIngest = true;
    } else if (ytChanged && isR2MediaKey(nextThumbInput) && !alreadyHasThisIngest) {
      shouldIngest = true;
    }

    if (shouldIngest && !alreadyHasThisIngest) {
      const key = await ingestYoutubeThumbnailToR2(env, slug, nextYoutube);
      if (key) data.thumbnail = key;
    }
  }

  const mediaBase = env.MEDIA_BASE_URL || '';
  if (data.thumbnail !== undefined) {
    data.thumbnail = stripMediaBaseToKey(data.thumbnail, mediaBase);
  }
  if (data.hover_preview !== undefined) {
    data.hover_preview = stripMediaBaseToKey(data.hover_preview, mediaBase);
  }

  for (const yk of ['youtube_thumb_time_sec', 'youtube_preview_start_sec']) {
    if (data[yk] === undefined) continue;
    if (data[yk] === null || data[yk] === '') {
      data[yk] = null;
      continue;
    }
    const n = Number(data[yk]);
    data[yk] = Number.isFinite(n) ? n : null;
  }

  if (data.home_size !== undefined) {
    data.home_size = normalizeHomeSize(data.home_size);
  }
  if (data.show_on_home !== undefined) {
    data.show_on_home = normalizeShowOnHomeDb(data.show_on_home);
  }
  if (data.order !== undefined) {
    data.order = normalizeHomeOrder(data.order);
  }

  const fields = [];
  const values = [];
  const updatable = [
    'title', 'body_md', 'description', 'thumbnail', 'hover_preview', 'client',
    'date_mmddyyyy', 'year', 'order', 'home_size', 'show_on_home',
    'home_col', 'home_row',
    'youtube_url', 'pixieset_url', 'youtube_thumb_time_sec', 'youtube_preview_start_sec',
  ];

  for (const key of updatable) {
    if (data[key] !== undefined) {
      const val = data[key];
      fields.push(key === 'order' ? '"order" = ?' : `${key} = ?`);
      values.push(val);
    }
  }

  if (data.service_types !== undefined) {
    fields.push('service_types = ?');
    values.push(JSON.stringify(Array.isArray(data.service_types) ? data.service_types : []));
  }

  fields.push('version = version + 1');
  fields.push("updated_at = datetime('now')");

  values.push(slug, data.version);

  const result = await env.DB.prepare(
    `UPDATE projects SET ${fields.join(', ')} WHERE slug = ? AND version = ?`,
  ).bind(...values).run();

  if (!result.meta.changes) {
    return error('Conflict: version mismatch', 409);
  }

  // Qualquer save no admin gera novo build (Jekyll aplica `show_on_home` na Home).
  logAudit(ctx, env.DB, {
    action: 'update', targetType: 'project', targetId: slug,
    diff: { fields: Object.keys(data).filter(k => k !== 'version') },
  });

  return json({ slug, updated: true, triggerDeploy: true });
}

export async function handleDelete(slug, env, ctx) {
  const existing = await env.DB.prepare(
    'SELECT 1 FROM projects WHERE slug = ?',
  ).bind(slug).first();
  if (!existing) return error('Project not found', 404);

  await env.DB.prepare('DELETE FROM projects WHERE slug = ?').bind(slug).run();

  try {
    const prefix = `projects/${slug}/`;
    const listed = await env.MEDIA.list({ prefix });
    if (listed.objects.length > 0) {
      await Promise.all(listed.objects.map(obj => env.MEDIA.delete(obj.key)));
    }
  } catch (e) {
    console.error('R2 cleanup error:', e);
  }

  logAudit(ctx, env.DB, {
    action: 'delete', targetType: 'project', targetId: slug,
  });

  return json({ slug, deleted: true, triggerDeploy: true });
}

/**
 * Migração em massa: grava no R2 miniaturas ainda apontando para o CDN do YouTube.
 * Autenticação: mesmo token de build do export (`Authorization: Bearer` + `CF_BUILD_TOKEN`).
 * Não incrementa `version` (evita conflitos no admin). Disparar antes do próximo build Netlify
 * ou após deploy do Worker.
 */
export async function handleBackfillYoutubeThumbnails(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, youtube_url, thumbnail FROM projects
     WHERE TRIM(COALESCE(youtube_url, '')) != ''
       AND (
         TRIM(COALESCE(thumbnail, '')) = ''
         OR INSTR(COALESCE(thumbnail, ''), 'img.youtube.com') > 0
         OR INSTR(COALESCE(thumbnail, ''), 'ytimg.com') > 0
       )`,
  ).all();

  let ingested = 0;
  const failed = [];
  for (const row of results) {
    const key = await ingestYoutubeThumbnailToR2(env, row.slug, row.youtube_url);
    if (!key) {
      failed.push({ slug: row.slug, reason: 'ingest_failed_or_blocked' });
      continue;
    }
    await env.DB.prepare(
      `UPDATE projects SET thumbnail = ?, updated_at = datetime('now') WHERE slug = ?`,
    )
      .bind(key, row.slug)
      .run();
    ingested++;
  }

  return json({
    candidates: results.length,
    ingested,
    failed,
  });
}

/**
 * Atualiza só thumbnail + hover_preview no D1 (chaves R2), após upload feito fora do Worker
 * (script local: yt-dlp + FFmpeg → R2). Auth: mesmo token de build do export.
 */
export async function handleMediaKeysSync(request, env, ctx) {
  const data = await request.json().catch(() => ({}));
  if (!data.slug || typeof data.slug !== 'string') return error('slug required', 400);
  if (!SLUG_PATH_RE.test(data.slug)) return error('invalid slug', 400);

  const hasThumb = typeof data.thumbnail === 'string' && data.thumbnail.startsWith('projects/');
  const hasHover = typeof data.hover_preview === 'string' && data.hover_preview.startsWith('projects/');
  if (!hasThumb && !hasHover) {
    return error('at least one of thumbnail or hover_preview (R2 keys) is required', 400);
  }

  const row = await env.DB.prepare('SELECT slug FROM projects WHERE slug = ?')
    .bind(data.slug)
    .first();
  if (!row) return error('Project not found', 404);

  const sets = [];
  const vals = [];
  if (hasThumb) { sets.push('thumbnail = ?'); vals.push(data.thumbnail); }
  if (hasHover) { sets.push('hover_preview = ?'); vals.push(data.hover_preview); }
  sets.push("updated_at = datetime('now')");
  sets.push('version = version + 1');
  vals.push(data.slug);

  await env.DB.prepare(
    `UPDATE projects SET ${sets.join(', ')} WHERE slug = ?`,
  ).bind(...vals).run();

  const diff = {};
  if (hasThumb) diff.thumbnail = data.thumbnail;
  if (hasHover) diff.hover_preview = data.hover_preview;

  logAudit(ctx, env.DB, {
    action: 'media_keys_sync',
    targetType: 'project',
    targetId: data.slug,
    diff,
  });

  return json({ ok: true, slug: data.slug, updated: Object.keys(diff) });
}

/** Lista slug + youtube_url para scripts locais (ingest em lote). Auth: token de build. */
export async function handleYoutubeManifest(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, youtube_url, youtube_thumb_time_sec, youtube_preview_start_sec
     FROM projects
     WHERE TRIM(COALESCE(youtube_url, '')) != ''
     ORDER BY date_mmddyyyy DESC, year DESC, slug ASC`,
  ).all();

  return json({ projects: results });
}
