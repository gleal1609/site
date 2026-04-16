import { json, error } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { SLUG_RE, SLUG_PATH_RE } from '../utils/slug.js';

const MAX_TITLE = 200;
const MAX_BODY = 102400;
const MAX_DESCRIPTION = 32000;
const MAX_REORDER_ITEMS = 500;

/** URL absoluta (http/https) ou chave R2 sob MEDIA_BASE_URL. */
function mediaPublicUrl(base, keyOrUrl) {
  if (keyOrUrl == null || keyOrUrl === '') return null;
  const s = String(keyOrUrl);
  if (s.includes('://')) return s;
  const b = (base || '').replace(/\/$/, '');
  return b ? `${b}/${s}` : s;
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
  if (data.order !== undefined && data.order !== null && !Number.isInteger(data.order)) errs.push('order must be integer');
  if (data.service_types !== undefined && data.service_types !== null && !Array.isArray(data.service_types)) {
    errs.push('service_types must be an array');
  }
  return errs;
}

export async function handleExport(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, title, body_md, description, thumbnail, hover_preview, service_types,
            client, date_mmddyyyy, year, show_on_home, "order", home_size,
            youtube_url, pixieset_url
     FROM projects WHERE published = 1
     ORDER BY "order" ASC, date_mmddyyyy DESC`,
  ).all();

  const base = env.MEDIA_BASE_URL || '';
  const projects = results.map(r => ({
    ...r,
    service_types: parseServiceTypes(r.service_types),
    show_on_home: !!r.show_on_home,
    thumbnail: mediaPublicUrl(base, r.thumbnail),
    hover_preview: mediaPublicUrl(base, r.hover_preview),
    url: `/projects/${r.slug}/`,
  }));

  return json(projects);
}

export async function handleList(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, thumbnail, hover_preview, service_types,
            client, date_mmddyyyy, year, show_on_home, "order", home_size,
            youtube_url, pixieset_url, published, version, body_md, description,
            created_at, updated_at
     FROM projects ORDER BY "order" ASC`,
  ).all();

  const base = env.MEDIA_BASE_URL || '';
  const projects = results.map(r => ({
    ...r,
    service_types: parseServiceTypes(r.service_types),
    show_on_home: !!r.show_on_home,
    published: !!r.published,
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
    show_on_home: !!row.show_on_home,
    published: !!row.published,
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

  const svcJson = Array.isArray(data.service_types)
    ? JSON.stringify(data.service_types)
    : '[]';

  await env.DB.prepare(
    `INSERT INTO projects (slug, title, body_md, description, thumbnail, hover_preview,
      service_types, client, date_mmddyyyy, year, show_on_home, "order",
      home_size, youtube_url, pixieset_url, published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    data.slug, data.title, data.body_md || null,
    data.description != null ? String(data.description) : null,
    data.thumbnail || null, data.hover_preview || null,
    svcJson, data.client || null, data.date_mmddyyyy || null,
    data.year || null, data.show_on_home ? 1 : 0,
    data.order || 0, data.home_size || '1x1',
    data.youtube_url || null, data.pixieset_url || null,
    data.published ? 1 : 0,
  ).run();

  logAudit(ctx, env.DB, {
    action: 'create', targetType: 'project', targetId: data.slug,
    diff: { title: data.title },
  });

  return json({ slug: data.slug, created: true }, 201);
}

export async function handleUpdate(slug, request, env, ctx) {
  const data = await request.json();
  const errs = validate(data, false);
  if (errs.length) return error(errs.join('; '), 400);

  if (data.version === undefined) return error('version field required for updates', 400);

  const existing = await env.DB.prepare(
    'SELECT version, published FROM projects WHERE slug = ?',
  ).bind(slug).first();
  if (!existing) return error('Project not found', 404);

  if (existing.version !== data.version) {
    return error('Conflict: project was modified by another user. Reload and try again.', 409);
  }

  const fields = [];
  const values = [];
  const updatable = [
    'title', 'body_md', 'description', 'thumbnail', 'hover_preview', 'client',
    'date_mmddyyyy', 'year', 'show_on_home', 'order', 'home_size',
    'youtube_url', 'pixieset_url', 'published',
  ];

  for (const key of updatable) {
    if (data[key] !== undefined) {
      let val = data[key];
      if (key === 'show_on_home' || key === 'published') val = val ? 1 : 0;
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

  const wasPublished = !!existing.published;
  const isPublished = data.published !== undefined ? !!data.published : wasPublished;
  const shouldTriggerDeploy = isPublished || (wasPublished && !isPublished);

  logAudit(ctx, env.DB, {
    action: 'update', targetType: 'project', targetId: slug,
    diff: { fields: Object.keys(data).filter(k => k !== 'version') },
  });

  return json({ slug, updated: true, triggerDeploy: shouldTriggerDeploy });
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

  return json({ slug, deleted: true });
}

export async function handleReorder(request, env, ctx) {
  const { items } = await request.json();
  if (!Array.isArray(items)) return error('items array required', 400);
  if (items.length === 0) return error('items must not be empty', 400);
  if (items.length > MAX_REORDER_ITEMS) {
    return error(`items max ${MAX_REORDER_ITEMS} entries`, 400);
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') return error(`items[${i}] must be an object`, 400);
    if (typeof it.slug !== 'string' || !SLUG_PATH_RE.test(it.slug)) {
      return error(`items[${i}].slug invalid`, 400);
    }
    if (!Number.isInteger(it.order)) {
      return error(`items[${i}].order must be integer`, 400);
    }
  }

  const stmts = items.map(({ slug, order }) =>
    env.DB.prepare('UPDATE projects SET "order" = ?, updated_at = datetime(\'now\') WHERE slug = ?')
      .bind(order, slug),
  );
  await env.DB.batch(stmts);

  logAudit(ctx, env.DB, {
    action: 'reorder', targetType: 'project', targetId: 'bulk',
    diff: { count: items.length },
  });

  return json({ reordered: items.length });
}
