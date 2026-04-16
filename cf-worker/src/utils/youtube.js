/**
 * IDs de vídeo YouTube (incl. Shorts) e ingestão de miniatura → R2.
 * img.youtube.com/vi/ID/maxresdefault.jpg para Shorts costuma vir como composição 16:9
 * (faixa central nítida + laterais borradas). Por isso tentamos formatos menores primeiro.
 */

export function youtubeVideoId(url) {
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

export function isYoutubeHostedThumbnail(s) {
  if (s == null || s === '') return false;
  const t = String(s);
  return t.includes('img.youtube.com') || t.includes('ytimg.com');
}

/** Chave R2 (sem esquema) — upload manual pelo admin. */
export function isR2MediaKey(s) {
  if (s == null || s === '') return false;
  const t = String(s);
  return !t.includes('://') && t.startsWith('projects/');
}

async function fetchYoutubeThumbnailBytes(videoId) {
  const urls = [
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
  ];
  for (const url of urls) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ReversoCMS/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) continue;
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) continue;
    const buf = await res.arrayBuffer();
    // Miniatura “erro” / placeholder costuma ser minúscula
    if (buf.byteLength < 2500) continue;
    return buf;
  }
  return null;
}

/**
 * Baixa miniatura do YouTube e grava no bucket MEDIA. Retorna a chave R2 ou null.
 */
export async function ingestYoutubeThumbnailToR2(env, slug, youtubeUrl) {
  const id = youtubeVideoId(youtubeUrl);
  if (!id || !env.MEDIA) return null;

  try {
    const bytes = await fetchYoutubeThumbnailBytes(id);
    if (!bytes) return null;

    const key = `projects/${slug}/thumb-yt-${id}.jpg`;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000',
      },
    });
    return key;
  } catch (e) {
    console.error('[youtube] ingest thumbnail failed:', e.message);
    return null;
  }
}
