import { json, error } from '../utils/response.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';

function isPixiesetPageUrl(href) {
  let u;
  try {
    u = new URL(href.trim());
  } catch {
    return null;
  }
  if (!/\.pixieset\.com$/i.test(u.hostname)) return null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 1) return null;
  return u;
}

function cukFromUrl(u) {
  const segs = u.pathname.split('/').filter(Boolean);
  return segs[segs.length - 1] || null;
}

function setCookieHeader(res) {
  const a = res.headers.getSetCookie?.() || [];
  if (a.length) {
    return a
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }
  const c = res.headers.get('Set-Cookie');
  return c || '';
}

function extractCid(html) {
  const patterns = [
    /"cid"\s*:\s*(\d+)/,
    /"cid"\s*:\s*"(\d+)"/,
    /"collectionId"\s*:\s*(\d+)/i,
    /"collectionId"\s*:\s*"(\d+)"/i,
    /collection_id["']?\s*:\s*["']?(\d+)/i,
    /[?&]cid=(\d+)/i,
    /data-collection-id=["'](\d+)["']/i,
    /%22cid%22%3A%22(\d+)%22/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Campo do admin: só dígitos, ou URL completa de um pedido (ex. loadphotos → copiar ligação).
 * Extrai `gs` (secção, ex. highlights / evento1) se existir — o Worker tenta essa galeria primeiro.
 * @param {string | null | undefined} raw
 * @returns {{ cid: string | null, gs: string | null }}
 */
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
    } catch {
      return { cid: null, gs: null };
    }
  }
  return { cid: null, gs: null };
}

function extractGsFromHtml(html) {
  const m = html.match(/"gs"\s*:\s*"([^"\\]+)"/i);
  if (m) return m[1];
  return null;
}

function toHttpsUrl(maybe) {
  if (!maybe || typeof maybe !== 'string') return null;
  const s = maybe.trim();
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return `https://${s.replace(/^\/+/, '')}`;
}

function pickPathFromPhoto(photo) {
  const keys = [
    'pathXxlarge',
    'pathXlarge',
    'pathLarge',
    'pathMedium',
    'pathSmall',
    'pathThumb',
  ];
  for (const k of keys) {
    if (photo[k] && typeof photo[k] === 'string' && photo[k].length > 2) {
      return toHttpsUrl(photo[k]);
    }
  }
  return null;
}

function isLikelyCloudflareBlock(html) {
  return (
    (html.length < 12000 && /just a moment|cf-mitigation|challenges\.cloudflare/i.test(html)) ||
    html.includes('__cf_chl')
  );
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

function errMsg(e) {
  return e instanceof Error ? e.message : String(e);
}

/** Hosts de ficheiros de imagem Pixieset (path* da API loadphotos). Não incluir subdomínios de galerias HTML. */
function isAllowedPixiesetCdnHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'cdn.pixieset.com' || h === 'images.pixieset.com' || h === 'media.pixieset.com') {
    return true;
  }
  if (h.endsWith('.cdn.pixieset.com')) return true;
  return false;
}

/**
 * @param {string | null} gsFromHtml
 * @returns {string[]}
 */
function buildGsAttempts(gsFromHtml) {
  const attempts = [];
  for (const g of [gsFromHtml, 'highlights', 'all', 'default']) {
    if (g && !attempts.includes(g)) attempts.push(g);
  }
  for (const g of ['highlights', 'all', 'default']) {
    if (!attempts.includes(g)) attempts.push(g);
  }
  return attempts;
}

/**
 * @param {string} domain
 * @param {string} cuk
 * @param {string} cid
 * @param {string} cookie
 * @param {string} referer
 * @param {string[]} attempts
 * @returns {Promise<{ photos: any[], usedGs: string } | null>}
 */
async function mergeLoadPhotosPages(domain, cuk, cid, cookie, referer, attempts) {
  for (const g of attempts) {
    const merged = [];
    let usedGsName = g || 'highlights';
    for (let page = 1; page <= 8; page += 1) {
      const loadUrl = buildLoadPhotosUrl(domain, cuk, cid, g || 'highlights', page);
      const headers = {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Referer: referer,
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (cookie) headers.Cookie = cookie;
      const r = await fetch(loadUrl, { headers, redirect: 'follow' });
      if (!r.ok) break;
      const j = await r.json().catch(() => null);
      if (!j || j.status === 'error') break;
      let content;
      try {
        content = JSON.parse(j.content || '[]');
      } catch {
        break;
      }
      if (Array.isArray(content) && content.length) {
        merged.push(...content);
        usedGsName = g || 'highlights';
        if (j.isLastPage === true || j.islastpage === true) break;
        if (merged.length >= 24) break;
        continue;
      }
      break;
    }
    if (merged.length) {
      return { photos: merged, usedGs: usedGsName };
    }
  }
  return null;
}

/**
 * @param {any[]} photos
 * @param {{ maxSlides?: number }} o
 */
function buildCoverAndSlides(photos, o) {
  const maxSlides = o.maxSlides != null ? o.maxSlides : 5;
  const out = { cover: null, slides: [] };
  const used = new Set();
  if (!Array.isArray(photos) || !photos.length) return out;

  for (const p of photos) {
    if (/cover/i.test(JSON.stringify(p))) {
      const uu = pickPathFromPhoto(p);
      if (uu) {
        out.cover = uu;
        break;
      }
    }
  }
  for (const p of photos) {
    const u = pickPathFromPhoto(p);
    if (u && !used.has(u)) {
      used.add(u);
      if (!out.cover) out.cover = u;
      if (out.slides.length < maxSlides) out.slides.push(u);
    }
  }
  return out;
}

/**
 * @param {string} pageUrl
 * @param {string} [overrideCid]
 * @param {string | null} [gsFromPaste] de URL colada (parâmetro gs=…)
 */
async function loadPhotosForGalleryPage(pageUrl, overrideCid, gsFromPaste) {
  const u = isPixiesetPageUrl(pageUrl);
  if (!u) throw new Error('URL Pixieset inválida (esperado *.pixieset.com com segmento de coleção)');

  const domain = u.hostname;
  const cuk = cukFromUrl(u);
  if (!cuk) throw new Error('Falta o caminho da coleção (slug) no URL.');

  const ref = u.toString();

  /** 1) Com «cid» manual: ir directo a loadphotos (não depender do HTML; contorna o bloqueio Cloudflare do GET da página) */
  if (overrideCid) {
    const cid = String(overrideCid).trim();
    if (!/^\d+$/.test(cid)) {
      throw new Error('O «cid» opcional tem de ser um número (como no pedido loadphotos).');
    }
    const attempts0 = buildGsAttempts(gsFromPaste || null);
    let got = await mergeLoadPhotosPages(domain, cuk, cid, '', ref, attempts0);
    if (got) {
      return { photos: got.photos, cid, cuk, usedGs: got.usedGs };
    }
    const first = await fetch(ref, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (first.ok) {
      const html = await first.text();
      const cookie = setCookieHeader(first);
      const gs = !isLikelyCloudflareBlock(html) ? extractGsFromHtml(html) : null;
      const attempts1 = buildGsAttempts(gsFromPaste || gs);
      got = await mergeLoadPhotosPages(domain, cuk, cid, cookie, ref, attempts1);
      if (got) {
        return { photos: got.photos, cid, cuk, usedGs: got.usedGs };
      }
    }
    throw new Error(
      'Com o «cid» indicado, loadphotos ainda não devolveu fotos. Confirme o cid (Rede do browser) e se a galeria é pública; às vezes a galeria correcta repete outro gs= no URL.',
    );
  }

  const first = await fetch(ref, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!first.ok) throw new Error(`Falha ao abrir a galeria (${first.status})`);

  const html = await first.text();
  if (isLikelyCloudflareBlock(html)) {
    throw new Error(
      'A origem bloqueou o acesso automático (Cloudflare). No campo abaixo, cole o «cid» do pedido loadphotos (separador Rede) e tente de novo; sem o cid não é possível listar as fotos a partir do servidor.',
    );
  }

  const cookie = setCookieHeader(first);
  const cid = extractCid(html);
  if (!cid) {
    throw new Error(
      'Não foi possível obter o ID da coleção (cid) da página. No separador Rede, localize o pedido «loadphotos» e copie o parâmetro «cid» para o campo opcional abaixo do URL Pixieset no admin.',
    );
  }

  const gs = extractGsFromHtml(html);
  const attempts = buildGsAttempts(gsFromPaste || gs);
  const got = await mergeLoadPhotosPages(domain, cuk, cid, cookie, ref, attempts);
  if (got) {
    return { photos: got.photos, cid, cuk, usedGs: got.usedGs };
  }
  throw new Error(
    'A API de fotos não devolveu imagens. Verifique se a galeria é pública, ou tente o «cid» de outro pedido loadphotos.',
  );
}

/**
 * @param {Request} request
 * @param {any} _env
 */
export async function handlePixiesetResolve(request, _env) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('url');
  if (!raw || !raw.trim()) {
    return error('Parâmetro url é obrigatório', 400);
  }
  const rawCid = searchParams.get('cid') || null;
  const parsedCid = parseCidAndGsFromField(rawCid);
  const overrideCid = parsedCid.cid;
  const gsFromPaste = parsedCid.gs;
  if (rawCid && String(rawCid).trim() && !overrideCid) {
    return error(
      'Não encontrei o parâmetro «cid» nesse texto. Indique só o número do cid, ou uma URL de pedido que o contenha (ex. …/client/loadphotos/?...&cid=123&…).',
      400,
    );
  }

  try {
    const { photos, cid, cuk, usedGs } = await loadPhotosForGalleryPage(
      raw.trim(),
      overrideCid || undefined,
      gsFromPaste,
    );
    const { cover, slides } = buildCoverAndSlides(photos, { maxSlides: 5 });
    return json({
      cover,
      slides,
      cuk,
      cid,
      usedGs,
      count: Array.isArray(photos) ? photos.length : 0,
    });
  } catch (e) {
    return error(errMsg(e), 422);
  }
}

/**
 * Só cdn/hosts oficiais Pixieset (evita SSRF).
 * @param {Request} request
 */
export async function handlePixiesetProxy(request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('u');
  if (!target || !target.trim()) {
    return error('Parâmetro u é obrigatório', 400);
  }
  let parsed;
  try {
    parsed = new URL(target.trim());
  } catch {
    return error('URL inválida', 400);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return error('Protocolo inválido', 400);
  }
  const h = parsed.hostname.toLowerCase();
  if (!isAllowedPixiesetCdnHost(h)) {
    return error('Apenas imagens alojadas nos CDNs oficiais Pixieset (cdn / images) são permitidas', 403);
  }

  const r = await fetch(parsed.toString(), {
    headers: {
      'User-Agent': UA,
      Accept: 'image/*,*/*',
      // Alguns ficheiros em images.pixieset.com rejeitam pedidos sem Referer
      Referer: 'https://www.pixieset.com/',
    },
    redirect: 'follow',
  });
  if (!r.ok) {
    return error(`Falha ao obter a imagem (${r.status})`, 502);
  }
  const ct = r.headers.get('Content-Type') || 'image/jpeg';
  return new Response(r.body, {
    status: 200,
    headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=3600' },
  });
}
