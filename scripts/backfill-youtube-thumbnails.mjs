/**
 * Chama o Worker para migrar thumbnails ainda no CDN do YouTube → R2 (D1 atualizado).
 * Mesmo token de build do fetch-projects (CF_BUILD_TOKEN).
 *
 * PowerShell:
 *   $env:WORKER_API_BASE = "https://reverso-cms-api.reverso-cms.workers.dev"
 *   $env:CF_BUILD_TOKEN = "<token>"
 *   node scripts/backfill-youtube-thumbnails.mjs
 */
const base = (process.env.WORKER_API_BASE || process.env.WORKER_EXPORT_URL?.replace(/\/api\/projects\/export\/?$/, '') || '').replace(/\/$/, '');
const token = process.env.CF_BUILD_TOKEN || '';

if (!base || !token) {
  console.error('Defina WORKER_API_BASE (ou WORKER_EXPORT_URL) e CF_BUILD_TOKEN.');
  process.exit(1);
}

const url = `${base}/api/projects/backfill-youtube-thumbnails`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  },
});
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}
console.log(res.status, body);
if (!res.ok) process.exit(1);
