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
 * Um projeto (URL lida do manifesto — instante(s) vêm do D1):
 *   node scripts/ingest-youtube-media.mjs --slug <slug>
 *
 * Um projeto (URL explícita, instantes = 0 — compatibilidade com uso antigo):
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

/**
 * Faz download do vídeo do YouTube. Em runners de datacenter (ex.: GitHub Actions)
 * o YouTube exige "Sign in to confirm you're not a bot". Estratégia:
 *   1) Tenta vários clientes e combinações de extractor-args.
 *   2) Se existir um ficheiro de cookies em `YT_DLP_COOKIES_FILE`, tenta com `--cookies`.
 *   3) Se tudo falhar, retorna null (o caller decide o fallback).
 */
async function downloadVideo(dir, url) {
  const out = join(dir, 'source.%(ext)s');
  const commonArgs = [
    '-f',
    'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '-o',
    out,
    '--no-playlist',
    '--no-warnings',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
  ];

  const cookiesFile = (process.env.YT_DLP_COOKIES_FILE || '').trim();
  const attempts = [
    ['--extractor-args', 'youtube:player_client=web_embedded'],
    ['--extractor-args', 'youtube:player_client=mweb,tv_embedded'],
    ['--extractor-args', 'youtube:player_client=web_safari,mweb'],
    ['--extractor-args', 'youtube:player_client=android,web'],
    [],
  ];
  if (cookiesFile) {
    attempts.push(['--cookies', cookiesFile]);
    attempts.push([
      '--cookies',
      cookiesFile,
      '--extractor-args',
      'youtube:player_client=web,mweb',
    ]);
  }

  for (const extra of attempts) {
    try {
      await execFileAsync(
        ytDlpBin(),
        [...commonArgs, ...extra, url],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const { readdir } = await import('fs/promises');
      const files = await readdir(dir);
      const vid = files.find((f) => f.startsWith('source.') && f !== 'source.%(ext)s');
      if (vid) return join(dir, vid);
      throw new Error('yt-dlp não produziu ficheiro source.*');
    } catch (e) {
      const msg = (e && (e.stderr || e.message)) || String(e);
      console.warn('[yt-dlp] tentativa falhou:', extra.join(' ') || '(default)');
      console.warn('         ', String(msg).split('\n').slice(-2).join(' | '));
    }
  }
  return null;
}

function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  let m = u.match(/youtube\.com\/shorts\/([^?&/]+)/i);
  if (m) return m[1];
  m = u.match(/[?&]v=([^&]+)/i);
  if (m) return m[1];
  m = u.match(/youtu\.be\/([^?&/]+)/i);
  if (m) return m[1];
  return null;
}

/**
 * Fallback: baixa thumbnail do CDN do YouTube (sem timestamp personalizado)
 * e grava em R2. Não precisa de yt-dlp — funciona sempre.
 */
async function downloadYoutubeCdnThumbnail(dir, youtubeUrl) {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) return null;
  const variants = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
  ];
  for (const thumbUrl of variants) {
    try {
      const res = await fetch(thumbUrl, {
        headers: { 'User-Agent': 'ReversoCMS/1.0' },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 2500) continue;
      const { writeFile } = await import('fs/promises');
      const outPath = join(dir, 'cdn-thumb.jpg');
      await writeFile(outPath, buf);
      return outPath;
    } catch (e) {
      console.warn('[cdn-thumb] falhou para', thumbUrl, e.message);
    }
  }
  return null;
}

/** -ss antes de -i seria input seek; após -i o FFmpeg procura o instante. Semântica: instante aprox. em segundos. */
async function extractPoster(ffmpeg, videoPath, posterJpg, timeSec = 0) {
  const t = Math.max(0, Number(timeSec) || 0);
  const args = ['-y', '-i', videoPath];
  if (t > 0) {
    args.push('-ss', String(t));
  }
  args.push('-vframes', '1', '-q:v', '85', posterJpg);
  await execFileAsync(ffmpeg, args, { maxBuffer: 8 * 1024 * 1024 });
}

async function extractHover(ffmpeg, videoPath, hoverMp4, startSec = 0, durationSec = 5) {
  const s = Math.max(0, Number(startSec) || 0);
  const d = Math.max(0.1, Math.min(120, Number(durationSec) || 5));
  await execFileAsync(
    ffmpeg,
    [
      '-y',
      '-i', videoPath,
      '-ss', String(s),
      '-t', String(d),
      '-an',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-movflags', '+faststart',
      hoverMp4,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
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

async function notifyWorkerPartial(slug, thumbKey) {
  const url = `${WORKER_BASE}/api/projects/media-keys`;
  const body = { slug, thumbnail: thumbKey };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BUILD_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Worker ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

/**
 * @param {object} [opts] — campos D1: youtube_thumb_time_sec, youtube_preview_start_sec (de preferência
 * escolhidos no admin; omissão = 0, comportamento clássico: capa 0s, prévia 0–5s).
 *
 * Comportamento resiliente:
 *   - Se yt-dlp conseguir baixar o vídeo → gera poster + hover com ffmpeg (resultado completo).
 *   - Se yt-dlp falhar (bot-check do YouTube) → baixa thumbnail do CDN do YouTube como
 *     fallback (sem timestamp personalizado, sem hover). O workflow NÃO falha.
 */
export async function ingestOne(slug, youtubeUrl, opts = {}) {
  const thumbT = Math.max(0, Number(opts.youtube_thumb_time_sec) || 0);
  const prevS = Math.max(0, Number(opts.youtube_preview_start_sec) || 0);
  if (thumbT > 0 || prevS > 0) {
    console.log('Tempos: capa =', thumbT, 's | início prévia 5s =', prevS, 's');
  }
  const thumbKey = `projects/${slug}/yt-poster.jpg`;
  const hoverKey = `projects/${slug}/hover-5s.mp4`;

  const dir = await mkdtemp(join(tmpdir(), 'reverso-yt-'));
  const posterPath = join(dir, 'poster.jpg');
  const hoverPath = join(dir, 'hover.mp4');

  try {
    console.log('[1/5] yt-dlp…');
    const videoPath = await downloadVideo(dir, youtubeUrl);

    if (videoPath) {
      console.log('[2/5] ffmpeg capa (frame @', thumbT, 's)…');
      await extractPoster(ffmpegBin(), videoPath, posterPath, thumbT);
      console.log('[3/5] ffmpeg hover (5s a partir de', prevS, 's)…');
      await extractHover(ffmpegBin(), videoPath, hoverPath, prevS, 5);
      console.log('[4/5] R2 upload (poster + hover)…');
      await putR2(thumbKey, posterPath, 'image/jpeg');
      await putR2(hoverKey, hoverPath, 'video/mp4');
      console.log('[5/5] Worker D1…');
      const out = await notifyWorker(slug, thumbKey, hoverKey);
      console.log('OK (completo):', out);
      console.log('Chaves:', thumbKey, hoverKey);
      return { thumbKey, hoverKey, worker: out, mode: 'full' };
    }

    console.warn('\n⚠  yt-dlp falhou em todas as tentativas. Usando fallback: thumbnail do CDN do YouTube.');
    console.log('[fallback 1/3] Baixando thumbnail do CDN…');
    const cdnThumbPath = await downloadYoutubeCdnThumbnail(dir, youtubeUrl);
    if (!cdnThumbPath) {
      throw new Error('Fallback também falhou: não foi possível baixar thumbnail do CDN do YouTube.');
    }
    console.log('[fallback 2/3] R2 upload (só poster)…');
    await putR2(thumbKey, cdnThumbPath, 'image/jpeg');
    console.log('[fallback 3/3] Worker D1 (só thumbnail, sem hover)…');
    const out = await notifyWorkerPartial(slug, thumbKey);
    console.log('OK (fallback — só thumbnail):', out);
    console.log('Chave:', thumbKey);
    console.warn('⚠  O vídeo de hover (5s) NÃO foi gerado. O YouTube bloqueou o download do vídeo.');
    console.warn('   Para gerar o hover, tente novamente mais tarde ou configure YOUTUBE_COOKIES.');
    return { thumbKey, hoverKey: null, worker: out, mode: 'fallback' };
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
      const result = await ingestOne(slug, youtubeUrl, {
        youtube_thumb_time_sec: row.youtube_thumb_time_sec,
        youtube_preview_start_sec: row.youtube_preview_start_sec,
      });
      if (result.mode === 'fallback') {
        out.ok.push(`${slug} (fallback: só thumbnail)`);
      } else {
        out.ok.push(slug);
      }
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
  node scripts/ingest-youtube-media.mjs --slug <slug>
  node scripts/ingest-youtube-media.mjs <slug> <youtube_url>
  node scripts/ingest-youtube-media.mjs --all

Variáveis: R2_*, WORKER_API_BASE, CF_BUILD_TOKEN
Opcional (só --all): INGEST_DELAY_MS=4000
`);
}

/**
 * Ingest de um único projecto lendo URL e instantes do manifesto do Worker
 * (D1). É o modo usado pelo GitHub Actions disparado a partir do admin.
 */
async function runSingleFromManifest(slug) {
  const projects = await fetchYoutubeManifest();
  const row = projects.find((p) => p && p.slug === slug);
  if (!row) {
    throw new Error(`Projeto «${slug}» não existe no manifesto ou não tem youtube_url.`);
  }
  if (!row.youtube_url) {
    throw new Error(`Projeto «${slug}» não tem youtube_url.`);
  }
  console.log(`[single] slug=${slug} url=${row.youtube_url}`);
  await ingestOne(slug, row.youtube_url, {
    youtube_thumb_time_sec: row.youtube_thumb_time_sec,
    youtube_preview_start_sec: row.youtube_preview_start_sec,
  });
}

async function main() {
  const raw = process.argv.slice(2);
  const all = raw.includes('--all') || raw.includes('-a');
  const slugFlagIdx = raw.findIndex((x) => x === '--slug' || x === '-s');
  const slugArg = slugFlagIdx >= 0 ? raw[slugFlagIdx + 1] : null;
  const positional = raw.filter((x, i) => {
    if (x.startsWith('-')) return false;
    if (slugFlagIdx >= 0 && i === slugFlagIdx + 1) return false;
    return x !== '--all' && x !== '-a';
  });

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

  if (slugArg) {
    await runSingleFromManifest(slugArg);
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
