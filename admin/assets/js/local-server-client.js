/**
 * Client para o servidor local de mídia (http://localhost:7847).
 * Usado pelo admin panel para gerar capa + clip 5s localmente.
 */
(function () {
  'use strict';

  const BASE = 'http://localhost:7847';
  const HEALTH_TIMEOUT_MS = 2000;

  async function checkHealth() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
      const res = await fetch(`${BASE}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return false;
      const data = await res.json();
      return data && data.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * POST /ingest-youtube — gera poster (JPEG) + hover clip (MP4).
   * @param {{ youtube_url: string, thumb_time_sec?: number, preview_start_sec?: number }} params
   * @returns {Promise<{ poster: Blob, hover: Blob }>}
   */
  async function ingestYoutube(params) {
    const res = await fetch(`${BASE}/ingest-youtube`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Servidor local retornou ${res.status}`);
    }
    const data = await res.json();
    const posterBlob = _base64ToBlob(data.poster, data.poster_content_type || 'image/jpeg');
    const hoverBlob = _base64ToBlob(data.hover, data.hover_content_type || 'video/mp4');
    return { poster: posterBlob, hover: hoverBlob };
  }

  /**
   * POST /resolve-pixieset — resolve galeria e retorna URLs da capa + slides.
   * @param {string} galleryUrl
   * @param {string} [cidOverride]
   * @returns {Promise<{ cover: string|null, slides: string[] }>}
   */
  async function resolvePixieset(galleryUrl, cidOverride) {
    const res = await fetch(`${BASE}/resolve-pixieset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gallery_url: galleryUrl, cid_override: cidOverride || undefined }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Servidor local retornou ${res.status}`);
    }
    return await res.json();
  }

  /**
   * Gera URL de proxy do servidor local para imagens Pixieset.
   * @param {string} imageUrl
   * @returns {string}
   */
  function pixiesetProxyUrl(imageUrl) {
    return `${BASE}/proxy-pixieset?u=${encodeURIComponent(imageUrl)}`;
  }

  /**
   * POST /youtube-preview — baixa preview 480p, cacheia, retorna URL local.
   * @param {string} youtubeUrl
   * @returns {Promise<{ preview_url: string }>}
   */
  async function youtubePreview(youtubeUrl) {
    const res = await fetch(`${BASE}/youtube-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtube_url: youtubeUrl }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Servidor local retornou ${res.status}`);
    }
    return await res.json();
  }

  function _base64ToBlob(b64, contentType) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: contentType });
  }

  let _evtSource = null;
  let _reconnectTimer = null;

  function connectSSE() {
    if (_evtSource) return;
    try {
      _evtSource = new EventSource(`${BASE}/events`);
    } catch { return; }

    _evtSource.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (data.type === 'connected' || data.type === 'ready') {
        _dispatchOnline();
      }
    };
    _evtSource.onerror = () => {
      _closeSSE();
      _scheduleReconnect();
    };
  }

  function _closeSSE() {
    if (_evtSource) {
      try { _evtSource.close(); } catch { /* */ }
      _evtSource = null;
    }
  }

  function _scheduleReconnect() {
    if (_reconnectTimer) return;
    _reconnectTimer = setTimeout(() => {
      _reconnectTimer = null;
      connectSSE();
    }, 5000);
  }

  function _dispatchOnline() {
    window.dispatchEvent(new CustomEvent('reverso-local-server:online'));
  }

  if (typeof EventSource !== 'undefined') {
    connectSSE();
  }

  globalThis.ReversoLocalServer = {
    BASE,
    checkHealth,
    ingestYoutube,
    youtubePreview,
    resolvePixieset,
    pixiesetProxyUrl,
    connectSSE,
  };
})();
