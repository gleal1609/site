/**
 * Local: yt-dlp + FFmpeg → R2 → PATCH D1 via Worker (POST /api/projects/media-keys).
 *
 * Pré-requisitos no PATH: `yt-dlp`, `ffmpeg`
 * Uma vez: cd scripts && npm install
 *
 * Variáveis de ambiente (R2 S3 API — Cloudflare Dashboard → R2 → Manage R2 API Tokens):
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET=reverso-media (opcional, default)
 *
 * Worker (mesmo token de build do export):
 *   WORKER_API_BASE=https://<worker>.<subconta>.workers.dev
 *   CF_BUILD_TOKEN=<BUILD_TOKEN ou JWT read:export>
 *
 * Um projeto:
 *   node scripts/ingest-youtube-media.mjs <slug> <youtube_url>
 *
 * Todos os projetos com youtube_url no D1 (lista via GET /api/projects/youtube-manifest):
 *   node scripts/ingest-youtube-media.mjs --all
 *
 * Opcional entre cada projeto (rate limit / estabilidade): INGEST_DELAY_MS=4000 (default 4000)
 */

import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));

const execFileAsync = promisify(execFile);

const R2_BUCKET = process.env.R2_BUCKET || 'reverso-media';
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const WORKER_BASE = (process.env.WORKER_API_BASE || '').replace(/\/$/, '');
const BUILD_TOKEN = process.env.CF_BUILD_TOKEN || '';

function ytDlpBin() {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}
function ffmpegBin() {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadVideo(dir, url) {
  const out = join(dir, 'source.%(ext)s');
  await execFileAsync(ytDlpBin(), [
    '-f',
    'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '-o',
    out,
    '--no-playlist',
    '--no-warnings',
    url,
  ], { maxBuffer: 10 * 1024 * 1024 });
  const { readdir } = await import('fs/promises');
  const files = await readdir(dir);
  const vid = files.find((f) => f.startsWith('source.') && f !== 'source.%(ext)s');
  if (!vid) throw new Error('yt-dlp não produziu ficheiro source.*');
  return join(dir, vid);
}

async function extractPoster(ffmpeg, videoPath, posterJpg) {
  await execFileAsync(ffmpeg, [
    '-y',
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '85',
    posterJpg,
  ], { maxBuffer: 8 * 1024 * 1024 });
}

async function extractHover(ffmpeg, videoPath, hoverMp4) {
  await execFileAsync(ffmpeg, [
    '-y',
    '-i', videoPath,
    '-t', '5',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-movflags', '+faststart',
    hoverMp4,
  ], { maxBuffer: 16 * 1024 * 1024 });
}

async function putR2(key, filePath, contentType) {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    },
  });
  const body = await readFile(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000',
    }),
  );
}

async function notifyWorker(slug, thumbKey, hoverKey) {
  const url = `${WORKER_BASE}/api/projects/media-keys`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BUILD_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      slug,
      thumbnail: thumbKey,
      hover_preview: hoverKey,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Worker ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

/** Um projeto: download → poster + hover → R2 → D1. */
export async function ingestOne(slug, youtubeUrl) {
  const thumbKey = `projects/${slug}/yt-poster.jpg`;
  const hoverKey = `projects/${slug}/hover-5s.mp4`;

  const dir = await mkdtemp(join(tmpdir(), 'reverso-yt-'));
  const posterPath = join(dir, 'poster.jpg');
  const hoverPath = join(dir, 'hover.mp4');

  try {
    console.log('[1/5] yt-dlp…');
    const videoPath = await downloadVideo(dir, youtubeUrl);
    console.log('[2/5] ffmpeg poster (1º frame)…');
    await extractPoster(ffmpegBin(), videoPath, posterPath);
    console.log('[3/5] ffmpeg hover (5s, sem áudio)…');
    await extractHover(ffmpegBin(), videoPath, hoverPath);
    console.log('[4/5] R2 upload…');
    await putR2(thumbKey, posterPath, 'image/jpeg');
    await putR2(hoverKey, hoverPath, 'video/mp4');
    console.log('[5/5] Worker D1…');
    const out = await notifyWorker(slug, thumbKey, hoverKey);
    console.log('OK:', out);
    console.log('Chaves:', thumbKey, hoverKey);
    return { thumbKey, hoverKey, worker: out };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fetchYoutubeManifest() {
  const url = `${WORKER_BASE}/api/projects/youtube-manifest`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BUILD_TOKEN}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`youtube-manifest ${res.status}: ${text}`);
  }
  const data = JSON.parse(text);
  return Array.isArray(data.projects) ? data.projects : [];
}

async function runAll() {
  const projects = await fetchYoutubeManifest();
  console.log(`${projects.length} projeto(s) com youtube_url no D1.\n`);
  const delayMs = Number(process.env.INGEST_DELAY_MS ?? 4000);
  const out = { ok: [], fail: [] };

  for (let i = 0; i < projects.length; i++) {
    const row = projects[i];
    const slug = row.slug;
    const youtubeUrl = row.youtube_url;
    console.log(`\n========== [${i + 1}/${projects.length}] ${slug} ==========`);
    try {
      await ingestOne(slug, youtubeUrl);
      out.ok.push(slug);
    } catch (e) {
      const msg = e.message || String(e);
      console.error('FALHA:', msg);
      out.fail.push({ slug, error: msg });
    }
    if (i < projects.length - 1 && delayMs > 0) {
      console.log(`\nPausa ${delayMs} ms antes do próximo…`);
      await sleep(delayMs);
    }
  }

  console.log('\n--- Resumo ---');
  console.log('OK:', out.ok.length, out.ok);
  console.log('Falhas:', out.fail.length);
  if (out.fail.length) console.log(JSON.stringify(out.fail, null, 2));

  if (out.fail.length && out.ok.length === 0) process.exit(1);
  if (out.fail.length) process.exit(2);
}

function printUsage() {
  console.error(`
Uso:
  node scripts/ingest-youtube-media.mjs <slug> <youtube_url>
  node scripts/ingest-youtube-media.mjs --all

Variáveis: R2_*, WORKER_API_BASE, CF_BUILD_TOKEN
Opcional (só --all): INGEST_DELAY_MS=4000
`);
}

async function main() {
  const raw = process.argv.slice(2);
  const all = raw.includes('--all') || raw.includes('-a');
  const positional = raw.filter((x) => !x.startsWith('-') && x !== '--all' && x !== '-a');

  if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
    console.error('Defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
    process.exit(1);
  }
  if (!WORKER_BASE || !BUILD_TOKEN) {
    console.error('Defina WORKER_API_BASE e CF_BUILD_TOKEN.');
    process.exit(1);
  }

  if (all) {
    await runAll();
    return;
  }

  if (positional.length >= 2) {
    await ingestOne(positional[0], positional[1]);
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
