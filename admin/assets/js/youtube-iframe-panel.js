/**
 * YouTube IFrame Player API — carregamento lazy + criação / destruição do player.
 * Não dá acesso a canvas (cross-origin), mas fornece seek e duração para rascunho e timestamps a persistir.
 */
function extractYoutubeVideoId(url) {
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

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }
  return new Promise((resolve) => {
    let settled = false;
    let tick;
    const fin = (YT) => {
      if (settled) return;
      settled = true;
      if (tick) clearInterval(tick);
      resolve(YT);
    };
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function onReady() {
      if (typeof prior === 'function') {
        try {
          prior();
        } catch { /* */ }
      }
      if (window.YT) fin(window.YT);
    };
    if (!document.querySelector('script[data-yt-iframe-api="1"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.setAttribute('data-yt-iframe-api', '1');
      document.head.appendChild(s);
    }
    tick = setInterval(() => {
      if (window.YT && window.YT.Player) {
        fin(window.YT);
      }
    }, 50);
    setTimeout(() => {
      if (tick) clearInterval(tick);
    }, 20000);
  });
}

/**
 * Limpa o nó alvo. O IFrame API por vezes deixa o DOM inutilizável após destroy
 * se não se esvaziar antes de um novo YT.Player.
 */
function clearPlayerHostById(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.replaceChildren();
}

/**
 * @param {string} elementId
 * @param {string} videoId
 * @param {{ width?: number | string, height?: number, timeoutMs?: number, onReady?: (p: object) => void, onError?: (e: Error) => void }} [options]
 */
function createPlayer(elementId, videoId, options) {
  const o = options && typeof options === 'object' ? options : {};
  const width = o.width != null ? o.width : '100%';
  const height = o.height != null ? o.height : 220;
  const timeoutMs = o.timeoutMs || 20000;
  return loadYouTubeApi().then((YT) => {
    clearPlayerHostById(elementId);
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        reject(new Error('Tempo esgotado ao carregar o player do YouTube.'));
      }, timeoutMs);
      const pageOrigin =
        typeof window !== 'undefined' && window.location && window.location.origin
          ? window.location.origin
          : undefined;
      new YT.Player(elementId, {
        videoId,
        width,
        height,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          rel: 0,
          playsinline: 1,
          modestbranding: 1,
          enablejsapi: 1,
          ...(pageOrigin ? { origin: pageOrigin } : {}),
        },
        events: {
          onReady: (ev) => {
            clearTimeout(to);
            if (o.onReady) {
              try {
                o.onReady(ev.target);
              } catch (e) { /* */ }
            }
            resolve(ev.target);
          },
          onError: (ev) => {
            clearTimeout(to);
            const err = new Error(`Player do YouTube: código de erro ${ev.data}`);
            if (o.onError) {
              try {
                o.onError(err);
              } catch (e) { /* */ }
            }
            reject(err);
          },
        },
      });
    });
  });
}

function destroyPlayer(player) {
  if (player && typeof player.destroy === 'function') {
    try {
      player.destroy();
    } catch (e) { /* */ }
  }
}

function isShortsPageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /youtube\.com\/shorts\//i.test(url);
}

globalThis.ReversoYoutubeIframe = {
  extractVideoId: extractYoutubeVideoId,
  loadYouTubeApi,
  createPlayer,
  destroyPlayer,
  clearPlayerHost: clearPlayerHostById,
  isShortsUrl: isShortsPageUrl,
};
