/**
 * Servidor local de mídia para o painel admin do Reverso CMS.
 *
 * Roda em http://localhost:7847 e processa requests do admin panel (HTTPS).
 * Usa yt-dlp + ffmpeg localmente (IP residencial — sem bloqueios do YouTube).
 *
 * Iniciar:  node scripts/local-server.mjs
 * Porta:    PORT=7847 (default) ou variável de ambiente PORT
 * Se 7847 estiver ocupada, o processo antigo na mesma porta é encerrado automaticamente
 * (desative com REVERSO_RELEASE_PORT=0 se precisar de outro serviço nesta porta).
 */

import { createServer } from 'http';
import { createReadStream } from 'fs';
import { mkdtemp, rm, readFile, readdir, writeFile, access, mkdir, stat as fsStat } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT) || 7847;

// ---------------------------------------------------------------------------
// Binary paths (auto-managed via npm packages)
// ---------------------------------------------------------------------------

function ffmpegPath() {
  try {
    return require('ffmpeg-static');
  } catch {
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  }
}

const YT_DLP_BIN_DIR = join(__dirname, '.bin');
const YT_DLP_BIN = join(YT_DLP_BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

async function ensureYtDlp() {
  try {
    await access(YT_DLP_BIN);
    return YT_DLP_BIN;
  } catch { /* not found, download */ }

  console.log('[setup] Baixando yt-dlp...');
  const { mkdir } = await import('fs/promises');
  await mkdir(YT_DLP_BIN_DIR, { recursive: true });

  const mod = await import('yt-dlp-wrap');
  const YTDlpWrap = mod.default?.downloadFromGithub ? mod.default : mod.default?.default || mod;
  await YTDlpWrap.downloadFromGithub(YT_DLP_BIN);
  console.log('[setup] yt-dlp instalado em', YT_DLP_BIN);
  return YT_DLP_BIN;
}

// ---------------------------------------------------------------------------
// YouTube: download + ffmpeg
// ---------------------------------------------------------------------------

async function downloadVideo(dir, url, ytDlp) {
  const out = join(dir, 'source.%(ext)s');
  const commonArgs = [
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '-o', out,
    '--no-playlist',
    '--no-warnings',
    '--retries', '3',
    '--fragment-retries', '3',
  ];

  const attempts = [
    ['--extractor-args', 'youtube:player_client=web_embedded'],
    ['--extractor-args', 'youtube:player_client=mweb,tv_embedded'],
    ['--extractor-args', 'youtube:player_client=web_safari,mweb'],
    ['--extractor-args', 'youtube:player_client=android,web'],
    [],
  ];

  for (const extra of attempts) {
    try {
      await execFileAsync(ytDlp, [...commonArgs, ...extra, url], { maxBuffer: 10 * 1024 * 1024 });
      const files = await readdir(dir);
      const vid = files.find((f) => f.startsWith('source.') && f !== 'source.%(ext)s');
      if (vid) return join(dir, vid);
    } catch (e) {
      const msg = (e && (e.stderr || e.message)) || String(e);
      console.warn('[yt-dlp] tentativa falhou:', extra.join(' ') || '(default)');
      console.warn('         ', String(msg).split('\n').slice(-2).join(' | '));
    }
  }
  return null;
}

async function extractPoster(ffmpeg, videoPath, outPath, timeSec = 0) {
  const t = Math.max(0, Number(timeSec) || 0);
  const args = ['-y', '-i', videoPath];
  if (t > 0) args.push('-ss', String(t));
  args.push('-vframes', '1', '-q:v', '2', outPath);
  await execFileAsync(ffmpeg, args, { maxBuffer: 8 * 1024 * 1024 });
}

async function extractHover(ffmpeg, videoPath, outPath, startSec = 0, durationSec = 5) {
  const s = Math.max(0, Number(startSec) || 0);
  const d = Math.max(0.1, Math.min(120, Number(durationSec) || 5));
  await execFileAsync(ffmpeg, [
    '-y', '-i', videoPath,
    '-ss', String(s), '-t', String(d),
    '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-movflags', '+faststart',
    outPath,
  ], { maxBuffer: 16 * 1024 * 1024 });
}

// ---------------------------------------------------------------------------
// YouTube preview: download 480p, cache by video ID, serve via /cache/*
// ---------------------------------------------------------------------------

const CACHE_DIR = join(__dirname, '.cache');

function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  let m = u.match(/youtube\.com\/shorts\/([^?&/]+)/i);
  if (m) return m[1];
  m = u.match(/[?&]v=([^&]+)/i);
  if (m) return m[1];
  m = u.match(/youtu\.be\/([^?&/]+)/i);
  if (m) return m[1];
  m = u.match(/youtube\.com\/embed\/([^?&/]+)/i);
  if (m) return m[1];
  return null;
}

async function downloadPreviewVideo(videoId, youtubeUrl, ytDlp) {
  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = join(CACHE_DIR, `${videoId}.mp4`);

  try {
    await access(outPath);
    const s = await fsStat(outPath);
    if (s.size > 1000) return outPath;
  } catch { /* not cached */ }

  const outTemplate = join(CACHE_DIR, `${videoId}.%(ext)s`);
  const commonArgs = [
    '-f', 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/bv*[height<=480]+ba/b[height<=480]/b',
    '--merge-output-format', 'mp4',
    '-o', outTemplate,
    '--no-playlist', '--no-warnings',
    '--retries', '3',
  ];

  const attempts = [
    ['--extractor-args', 'youtube:player_client=web_embedded'],
    ['--extractor-args', 'youtube:player_client=mweb,tv_embedded'],
    ['--extractor-args', 'youtube:player_client=web_safari,mweb'],
    ['--extractor-args', 'youtube:player_client=android,web'],
    [],
  ];

  for (const extra of attempts) {
    try {
      await execFileAsync(ytDlp, [...commonArgs, ...extra, youtubeUrl], { maxBuffer: 10 * 1024 * 1024 });
      try {
        await access(outPath);
        return outPath;
      } catch { /* file not created with expected name */ }
      const files = await readdir(CACHE_DIR);
      const match = files.find((f) => f.startsWith(`${videoId}.`) && f !== `${videoId}.%(ext)s`);
      if (match) {
        const actual = join(CACHE_DIR, match);
        if (match !== `${videoId}.mp4`) {
          const { rename } = await import('fs/promises');
          await rename(actual, outPath);
        }
        return outPath;
      }
    } catch (e) {
      const msg = (e && (e.stderr || e.message)) || String(e);
      console.warn('[preview] tentativa falhou:', extra.join(' ') || '(default)');
      console.warn('          ', String(msg).split('\n').slice(-2).join(' | '));
    }
  }
  return null;
}

async function handleYoutubePreview(req, res) {
  const body = await readBody(req);
  const { youtube_url } = body;
  if (!youtube_url) return jsonResponse(res, 400, { error: 'youtube_url obrigatório' });

  const videoId = extractVideoId(youtube_url);
  if (!videoId) return jsonResponse(res, 400, { error: 'URL do YouTube inválida' });

  const cachedPath = join(CACHE_DIR, `${videoId}.mp4`);
  try {
    await access(cachedPath);
    const s = await fsStat(cachedPath);
    if (s.size > 1000) {
      console.log(`[preview] Cache hit: ${videoId}.mp4`);
      return jsonResponse(res, 200, { preview_url: `http://localhost:${PORT}/cache/${videoId}.mp4` });
    }
  } catch { /* not cached */ }

  console.log(`[preview] Baixando preview 480p de ${videoId}...`);
  const ytDlp = await ensureYtDlp();
  const result = await downloadPreviewVideo(videoId, youtube_url, ytDlp);

  if (!result) {
    return jsonResponse(res, 422, { error: 'Não foi possível baixar o vídeo para preview.' });
  }
  console.log(`[preview] Preview pronto: ${videoId}.mp4`);
  jsonResponse(res, 200, { preview_url: `http://localhost:${PORT}/cache/${videoId}.mp4` });
}

async function handleCacheFile(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const filename = basename(url.pathname.replace('/cache/', ''));

  if (!filename || filename.includes('..') || !/^[\w-]+\.mp4$/i.test(filename)) {
    return jsonResponse(res, 400, { error: 'Nome de arquivo inválido' });
  }

  const filePath = join(CACHE_DIR, filename);
  let fileStat;
  try {
    fileStat = await fsStat(filePath);
  } catch {
    return jsonResponse(res, 404, { error: 'Arquivo não encontrado' });
  }

  const total = fileStat.size;
  const range = req.headers.range;
  const heads = { ...corsHeaders(), 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      ...heads,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': chunkSize,
    });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...heads, 'Content-Length': total });
    createReadStream(filePath).pipe(res);
  }
}

// ---------------------------------------------------------------------------
// Pixieset resolve (ported from cf-worker/src/routes/pixieset.js)
// ---------------------------------------------------------------------------

const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function browserHeaders(ua) {
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1',
  };
}

function isPixiesetPageUrl(href) {
  try {
    const u = new URL(href.trim());
    if (!/\.pixieset\.com$/i.test(u.hostname)) return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 1) return null;
    return u;
  } catch { return null; }
}

function cukFromUrl(u) {
  const segs = u.pathname.split('/').filter(Boolean);
  return segs[segs.length - 1] || null;
}

function extractCid(html) {
  const patterns = [
    /"cid"\s*:\s*(\d+)/, /"cid"\s*:\s*"(\d+)"/,
    /"collectionId"\s*:\s*(\d+)/i, /"collectionId"\s*:\s*"(\d+)"/i,
    /collection_id["']?\s*:\s*["']?(\d+)/i, /[?&]cid=(\d+)/i,
    /data-collection-id=["'](\d+)["']/i, /%22cid%22%3A%22(\d+)%22/i,
  ];
  for (const p of patterns) { const m = html.match(p); if (m) return m[1]; }
  return null;
}

function extractGsFromHtml(html) {
  const m = html.match(/"gs"\s*:\s*"([^"\\]+)"/i);
  return m ? m[1] : null;
}

function isLikelyCloudflareBlock(html) {
  return (
    (html.length < 12000 && /just a moment|cf-mitigation|challenges\.cloudflare/i.test(html)) ||
    html.includes('__cf_chl')
  );
}

function toHttpsUrl(maybe) {
  if (!maybe || typeof maybe !== 'string') return null;
  const s = maybe.trim();
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return `https://${s.replace(/^\/+/, '')}`;
}

function pickPathFromPhoto(photo) {
  for (const k of ['pathXxlarge', 'pathXlarge', 'pathLarge', 'pathMedium', 'pathSmall', 'pathThumb']) {
    if (photo[k] && typeof photo[k] === 'string' && photo[k].length > 2) return toHttpsUrl(photo[k]);
  }
  return null;
}

function buildGsAttempts(gs) {
  const a = [];
  for (const g of [gs, 'highlights', 'all', 'default']) { if (g && !a.includes(g)) a.push(g); }
  return a;
}

function buildLoadPhotosUrl(domain, cuk, cid, gs, page) {
  const base = new URL(`https://${domain}/client/loadphotos/`);
  base.searchParams.set('cuk', cuk);
  base.searchParams.set('cid', String(cid));
  base.searchParams.set('gs', gs || 'highlights');
  base.searchParams.set('fk', '');
  base.searchParams.set('clientDownloads', 'false');
  base.searchParams.set('page', String(page));
  return base.toString();
}

async function mergeLoadPhotosPages(domain, cuk, cid, cookie, referer, attempts) {
  for (const g of attempts) {
    const merged = [];
    for (let page = 1; page <= 8; page++) {
      const loadUrl = buildLoadPhotosUrl(domain, cuk, cid, g, page);
      const headers = {
        'User-Agent': UA_CHROME,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        Referer: referer,
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      };
      if (cookie) headers.Cookie = cookie;
      try {
        const r = await fetch(loadUrl, { headers, redirect: 'follow' });
        if (!r.ok) break;
        const j = await r.json().catch(() => null);
        if (!j || j.status === 'error') break;
        let content;
        try { content = JSON.parse(j.content || '[]'); } catch { break; }
        if (Array.isArray(content) && content.length) {
          merged.push(...content);
          if (j.isLastPage === true || j.islastpage === true) break;
          if (merged.length >= 24) break;
          continue;
        }
      } catch { /* network error */ }
      break;
    }
    if (merged.length) return { photos: merged, usedGs: g };
  }
  return null;
}

function buildCoverAndSlides(photos) {
  const out = { cover: null, slides: [] };
  const used = new Set();
  if (!Array.isArray(photos) || !photos.length) return out;
  for (const p of photos) {
    if (/cover/i.test(JSON.stringify(p))) {
      const uu = pickPathFromPhoto(p);
      if (uu) { out.cover = uu; break; }
    }
  }
  for (const p of photos) {
    const u = pickPathFromPhoto(p);
    if (u && !used.has(u)) {
      used.add(u);
      if (!out.cover) out.cover = u;
      if (out.slides.length < 5) out.slides.push(u);
    }
  }
  return out;
}

function parseCidAndGsFromField(raw) {
  if (raw == null) return { cid: null, gs: null };
  const t = String(raw).trim();
  if (!t) return { cid: null, gs: null };
  if (/^\d{1,20}$/.test(t)) return { cid: t, gs: null };
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      const c = u.searchParams.get('cid');
      const gs = u.searchParams.get('gs');
      return {
        cid: c && /^\d+$/.test(c) ? c : null,
        gs: gs && String(gs).length ? String(gs) : null,
      };
    } catch { return { cid: null, gs: null }; }
  }
  return { cid: null, gs: null };
}

function setCookieHeader(res) {
  const raw = res.headers.raw?.()?.['set-cookie'];
  if (Array.isArray(raw) && raw.length) {
    return raw.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  }
  const c = res.headers.get('set-cookie');
  return c ? c.split(';')[0].trim() : '';
}

async function resolvePixieset(galleryUrl, cidOverride) {
  const u = isPixiesetPageUrl(galleryUrl);
  if (!u) throw new Error('URL Pixieset inválida');

  const domain = u.hostname;
  const cuk = cukFromUrl(u);
  if (!cuk) throw new Error('Falta o caminho da coleção no URL');

  const ref = u.toString();
  const parsedCid = parseCidAndGsFromField(cidOverride);

  if (parsedCid.cid) {
    const attempts0 = buildGsAttempts(parsedCid.gs);
    const got = await mergeLoadPhotosPages(domain, cuk, parsedCid.cid, '', ref, attempts0);
    if (got) return buildCoverAndSlides(got.photos);
    throw new Error('loadphotos não retornou fotos com o cid fornecido');
  }

  const strategies = [
    browserHeaders(UA_CHROME),
    browserHeaders(UA_FIREFOX),
    { 'User-Agent': UA_FIREFOX, Accept: 'text/html,*/*' },
  ];

  let lastHtml = '';
  let lastCookie = '';
  let blocked = false;

  for (const headers of strategies) {
    try {
      const res = await fetch(ref, { headers, redirect: 'follow' });
      if (!res.ok) continue;
      const html = await res.text();
      if (isLikelyCloudflareBlock(html)) { blocked = true; continue; }
      lastHtml = html;
      lastCookie = setCookieHeader(res);
      break;
    } catch { continue; }
  }

  if (!lastHtml && blocked) {
    throw new Error('Cloudflare bloqueou o acesso. Cole o cid/URL loadphotos no campo manual.');
  }
  if (!lastHtml) throw new Error('Falha ao abrir a galeria');

  const cid = extractCid(lastHtml);
  if (!cid) throw new Error('Não foi possível extrair o cid da página');

  const gs = extractGsFromHtml(lastHtml);
  const attempts = buildGsAttempts(gs);
  const got = await mergeLoadPhotosPages(domain, cuk, cid, lastCookie, ref, attempts);
  if (got) return buildCoverAndSlides(got.photos);
  throw new Error('API de fotos não retornou imagens');
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { ...corsHeaders(), 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function handleIngestYoutube(req, res) {
  const body = await readBody(req);
  const { youtube_url, thumb_time_sec, preview_start_sec } = body;
  if (!youtube_url) return jsonResponse(res, 400, { error: 'youtube_url obrigatório' });

  const ytDlp = await ensureYtDlp();
  const ffmpeg = ffmpegPath();
  const dir = await mkdtemp(join(tmpdir(), 'reverso-local-yt-'));

  try {
    console.log('[ingest-youtube] Baixando vídeo...');
    const videoPath = await downloadVideo(dir, youtube_url, ytDlp);
    if (!videoPath) {
      return jsonResponse(res, 422, { error: 'yt-dlp não conseguiu baixar o vídeo. Verifique a URL.' });
    }

    const posterPath = join(dir, 'poster.jpg');
    const hoverPath = join(dir, 'hover.mp4');
    const thumbT = Math.max(0, Number(thumb_time_sec) || 0);
    const prevS = Math.max(0, Number(preview_start_sec) || 0);

    console.log(`[ingest-youtube] Extraindo poster @${thumbT}s...`);
    await extractPoster(ffmpeg, videoPath, posterPath, thumbT);
    console.log(`[ingest-youtube] Extraindo hover clip @${prevS}s (5s)...`);
    await extractHover(ffmpeg, videoPath, hoverPath, prevS, 5);

    const posterBuf = await readFile(posterPath);
    const hoverBuf = await readFile(hoverPath);

    console.log('[ingest-youtube] Concluído.');
    jsonResponse(res, 200, {
      poster: posterBuf.toString('base64'),
      poster_content_type: 'image/jpeg',
      hover: hoverBuf.toString('base64'),
      hover_content_type: 'video/mp4',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function handleResolvePixieset(req, res) {
  const body = await readBody(req);
  const { gallery_url, cid_override } = body;
  if (!gallery_url) return jsonResponse(res, 400, { error: 'gallery_url obrigatório' });

  try {
    console.log('[pixieset] Resolvendo galeria...');
    const result = await resolvePixieset(gallery_url, cid_override || null);
    console.log('[pixieset] Concluído —', result.slides?.length || 0, 'slides');
    jsonResponse(res, 200, result);
  } catch (e) {
    jsonResponse(res, 422, { error: e.message || 'Falha ao resolver galeria' });
  }
}

async function handleProxyPixieset(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const target = url.searchParams.get('u');
  if (!target) return jsonResponse(res, 400, { error: 'Parâmetro u obrigatório' });

  try {
    const parsed = new URL(target.trim());
    const h = parsed.hostname.toLowerCase();
    if (!h.includes('pixieset.com')) {
      return jsonResponse(res, 403, { error: 'Apenas CDNs Pixieset permitidos' });
    }
    const r = await fetch(parsed.toString(), {
      headers: { 'User-Agent': UA_FIREFOX, Accept: 'image/*,*/*', Referer: 'https://www.pixieset.com/' },
      redirect: 'follow',
    });
    if (!r.ok) return jsonResponse(res, 502, { error: `Pixieset retornou ${r.status}` });
    const ct = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(200, { ...corsHeaders(), 'Content-Type': ct, 'Cache-Control': 'public, max-age=3600' });
    res.end(buf);
  } catch (e) {
    jsonResponse(res, 500, { error: e.message });
  }
}

const sseClients = new Set();

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/health' && req.method === 'GET') {
      return jsonResponse(res, 200, { ok: true, version: '1.0.0' });
    }
    if (path === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        ...corsHeaders(),
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"type":"connected"}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (path === '/ingest-youtube' && req.method === 'POST') {
      return await handleIngestYoutube(req, res);
    }
    if (path === '/resolve-pixieset' && req.method === 'POST') {
      return await handleResolvePixieset(req, res);
    }
    if (path === '/proxy-pixieset' && req.method === 'GET') {
      return await handleProxyPixieset(req, res);
    }
    if (path === '/youtube-preview' && req.method === 'POST') {
      return await handleYoutubePreview(req, res);
    }
    if (path.startsWith('/cache/') && req.method === 'GET') {
      return await handleCacheFile(req, res);
    }
    jsonResponse(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('Erro não tratado:', e);
    jsonResponse(res, 500, { error: e.message || 'Erro interno' });
  }
});

/**
 * Encerra outros processos a escuta nesta porta (ex.: servidor não fechado na janela anterior).
 * Desative com REVERSO_RELEASE_PORT=0 se precisar de duas instâncias (raro).
 */
function killStaleListenersOnPort(port) {
  if (process.env.REVERSO_RELEASE_PORT === '0') return false;
  const myPid = process.pid;
  const killed = [];
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      });
      for (const line of out.split(/\r?\n/)) {
        const t = line.trim();
        if (!/LISTENING/i.test(t)) continue;
        if (!t.includes(`:${port}`)) continue;
        const parts = t.split(/\s+/).filter(Boolean);
        const last = parts[parts.length - 1];
        const pid = parseInt(last, 10);
        if (!Number.isFinite(pid) || pid === myPid) continue;
        try {
          execSync(`taskkill /PID ${pid} /F`, {
            windowsHide: true,
            stdio: 'ignore',
          });
          killed.push(pid);
        } catch {
          /* processo já terminou ou permissão negada */
        }
      }
    } else {
      let out = '';
      try {
        out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true`, {
          encoding: 'utf8',
          shell: '/bin/sh',
          maxBuffer: 1024 * 1024,
        });
      } catch {
        return false;
      }
      for (const s of out.split(/\s+/).map((x) => x.trim()).filter(Boolean)) {
        const pid = parseInt(s, 10);
        if (!Number.isFinite(pid) || pid === myPid) continue;
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          killed.push(pid);
        } catch {
          /* */
        }
      }
    }
  } catch {
    /* netstat/lsof indisponível */
  }
  if (killed.length) {
    console.warn(
      `\n  [porta] Porta ${port} ocupada — encerrei PID(s): ${killed.join(', ')}\n  (provável instância anterior do Reverso Media).\n`,
    );
    return true;
  }
  return false;
}

function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

function logServerReadyBanner() {
  console.log(`\n  Reverso Media Server rodando em http://localhost:${PORT}`);
  console.log('  Endpoints:');
  console.log('    GET  /health              — status do servidor');
  console.log('    GET  /events              — SSE (notifica browser)');
  console.log('    POST /youtube-preview     — baixar preview 480p (cache)');
  console.log('    POST /ingest-youtube      — gerar capa + clip 5s');
  console.log('    POST /resolve-pixieset    — resolver galeria Pixieset');
  console.log('    GET  /cache/<id>.mp4      — servir vídeo em cache');
  console.log('    GET  /proxy-pixieset?u=   — proxy de imagem Pixieset');
  console.log('\n  Ctrl+C para encerrar.\n');
  broadcastSSE({ type: 'ready' });
}

function startListening() {
  killStaleListenersOnPort(PORT);

  server.once('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('Erro no servidor:', err);
      process.exit(1);
    }
    console.warn('\n  [porta] EADDRINUSE — tentando liberar a porta e subir de novo…\n');
    if (!killStaleListenersOnPort(PORT)) {
      console.error(
        `\n  [ERRO] A porta ${PORT} já está em uso.\n`,
        '  Encerre manualmente ou defina PORT=7848 antes de iniciar.\n',
        `  Windows (PowerShell): Get-NetTCPConnection -LocalPort ${PORT} -State Listen\n`,
      );
      process.exit(1);
    }
    setTimeout(() => {
      server.once('error', (e2) => {
        console.error('Erro ao subir servidor após libertar a porta:', e2);
        process.exit(1);
      });
      server.listen(PORT, '127.0.0.1', logServerReadyBanner);
    }, 300);
  });

  server.listen(PORT, '127.0.0.1', logServerReadyBanner);
}

startListening();

// ---------------------------------------------------------------------------
// Encerramento: liberar a porta ao fechar janela / Ctrl+C / kill
// ---------------------------------------------------------------------------

function gracefulShutdown(signal) {
  console.log(`\n  Encerrando servidor (${signal})…`);
  server.close(() => {
    console.log('  Porta liberada. Até mais.\n');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

if (process.platform === 'win32') {
  process.on('message', (msg) => {
    if (msg === 'shutdown') gracefulShutdown('message:shutdown');
  });
}
