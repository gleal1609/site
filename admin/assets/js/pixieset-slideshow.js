/**
 * Vídeo curto a partir de URLs de imagens (via proxy autenticado) — WebM (VP8/9).
 * globalThis.ReversoPixiesetSlideshow
 */
(function () {
  function pickRecorderMime() {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (const t of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return '';
  }

  function baseMime(m) {
    return m.split(';')[0].trim() || 'video/webm';
  }

  function drawContain(ctx, img, w, h) {
    const sw = img.width || img.naturalWidth;
    const sh = img.height || img.naturalHeight;
    if (!sw || !sh) return;
    const scale = Math.min(w / sw, h / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const x = (w - dw) * 0.5;
    const y = (h - dh) * 0.5;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, sw, sh, x, y, dw, dh);
  }

  /**
   * @param {string[]} imageUrls
   * @param {(url: string) => string | Promise<string>} buildProxy - função (u) => url completo do GET proxy
   * @param {{ width?: number, height?: number, secondsPerSlide?: number, totalSeconds?: number }} [opt]
   * @returns {Promise<Blob>}
   */
  async function buildWebmFromImages(imageUrls, buildProxy, opt) {
    const w = (opt && opt.width) || 1280;
    const h = (opt && opt.height) || 720;
    const totalSec = (opt && opt.totalSeconds) != null ? opt.totalSeconds : 5;
    const per = (opt && opt.secondsPerSlide) != null ? opt.secondsPerSlide : 1;
    if (!Array.isArray(imageUrls) || !imageUrls.length) {
      throw new Error('Faltam imagens para o slideshow.');
    }

    const src = imageUrls.filter(Boolean);
    if (!src.length) throw new Error('Faltam imagens para o slideshow.');
    let list = src.slice(0, 5);
    const pad = list[list.length - 1];
    while (list.length < 5) list.push(pad);

    const mime = pickRecorderMime();
    if (!mime) {
      throw new Error('Este browser não consegue gravar WebM (MediaRecorder).');
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D indisponível.');

    const images = await Promise.all(
      list.map(async (u) => {
        const pUrl = await Promise.resolve(buildProxy(u));
        const res = await fetch(pUrl);
        if (!res.ok) throw new Error(`Falha ao carregar imagem (${res.status})`);
        const blob = await res.blob();
        return createImageBitmap(blob);
      }),
    );

    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise((resolve) => {
      rec.onstop = () => {
        const out = new Blob(chunks, { type: baseMime(mime) });
        for (const im of images) {
          try {
            im.close();
          } catch {
            /* */
          }
        }
        resolve(out);
      };
    });

    rec.start(200);

    const t0 = performance.now();
    const lastT = t0 + totalSec * 1000;

    function step(now) {
      const elapsed = (now - t0) / 1000;
      const idx = Math.min(4, Math.floor(elapsed / per));
      if (images[idx]) drawContain(ctx, images[idx], w, h);
      if (now < lastT) {
        requestAnimationFrame(step);
      } else {
        if (images[4]) drawContain(ctx, images[4], w, h);
        rec.stop();
      }
    }
    requestAnimationFrame(step);
    return stopped;
  }

  globalThis.ReversoPixiesetSlideshow = {
    buildWebmFromImages,
  };
})();
