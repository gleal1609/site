import { json, error } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

const ALLOWED_KEYS = new Set(['hero_video']);

/** URL absoluta ou chave R2 relativa a MEDIA_BASE_URL. */
function mediaPublicUrl(base, keyOrUrl) {
  if (keyOrUrl == null || keyOrUrl === '') return null;
  const s = String(keyOrUrl);
  if (s.includes('://')) return s;
  const b = (base || '').replace(/\/$/, '');
  return b ? `${b}/${s}` : s;
}

function stripMediaBaseToKey(value, base) {
  if (value == null || value === '' || !base) return value;
  const s = String(value);
  const b = String(base).replace(/\/$/, '');
  if (s.startsWith(`${b}/`)) return s.slice(b.length + 1);
  return value;
}

export async function handleSiteSettingsList(env) {
  const { results } = await env.DB.prepare(
    "SELECT key, value, updated_at FROM site_settings WHERE key IN ('hero_video') ORDER BY key",
  ).all();

  const base = env.MEDIA_BASE_URL || '';
  const settings = (results || []).map((r) => ({
    key: r.key,
    value: mediaPublicUrl(base, r.value),
    updated_at: r.updated_at,
  }));

  return json({ settings });
}

export async function handleSiteSettingsExport(env) {
  const { results } = await env.DB.prepare(
    "SELECT key, value FROM site_settings WHERE key IN ('hero_video')",
  ).all();

  const base = env.MEDIA_BASE_URL || '';
  const out = {};
  for (const r of results || []) {
    out[r.key] = mediaPublicUrl(base, r.value);
  }

  return json(out);
}

function validateKeyValue(key, rawValue) {
  if (rawValue == null) return { ok: true, value: null };
  if (typeof rawValue !== 'string') return { ok: false, err: 'value must be string or null' };
  const v = String(rawValue).trim();
  if (v === '') return { ok: true, value: null };
  if (v.includes('..')) return { ok: false, err: 'invalid value' };
  if (v.includes('://') && !/^https?:\/\//i.test(v)) return { ok: false, err: 'invalid url' };
  if (!v.includes('://')) {
    if (key === 'hero_video' && !v.startsWith('site/')) {
      return { ok: false, err: 'hero_video key must start with site/' };
    }
  }
  return { ok: true, value: v };
}

export async function handleSiteSettingsPatch(key, request, env, ctx) {
  if (!ALLOWED_KEYS.has(key)) return error('Unknown setting key', 400);

  const data = await request.json().catch(() => ({}));
  const { value } = data;

  const v = validateKeyValue(key, value);
  if (!v.ok) return error(v.err, 400);

  const mediaBase = env.MEDIA_BASE_URL || '';
  let storeVal = v.value;
  if (storeVal != null && storeVal !== '' && !storeVal.includes('://')) {
    storeVal = stripMediaBaseToKey(storeVal, mediaBase);
  }

  await env.DB.prepare(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now')`,
  ).bind(key, storeVal).run();

  logAudit(ctx, env.DB, {
    action: 'site_settings',
    targetType: 'site',
    targetId: key,
    diff: { value: storeVal },
  });

  return json({ key, value: storeVal, updated: true });
}
