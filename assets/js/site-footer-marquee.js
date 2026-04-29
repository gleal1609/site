/**
 * Marquee do rodapé: loop contínuo sem “buracos” na margem.
 * - Largura do período com Math.ceil + getBoundingClientRect (evita subpixel a menos).
 * - Clones extra de .site-footer__marquee-group até scrollWidth ≥ viewport + 1 período
 *   (evita vazio à direita em ecrãs largos com só 2 cópias).
 * - Atualiza no resize com debounce (sem ResizeObserver — reduz reinícios espúrios).
 */
(function () {
  const row = document.querySelector('.site-footer__marquee-row');
  const marquee = document.querySelector('.site-footer__marquee');
  const first = row && row.querySelector('.site-footer__marquee-group');
  if (!row || !first || !marquee) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let resizeTimer = null;
  let lastShiftPx = 0;

  function segmentWidthPx() {
    return Math.ceil(first.getBoundingClientRect().width);
  }

  /** Garante conteúdo suficiente para nunca mostrar “fim” do strip durante a animação. */
  function ensureEnoughClones() {
    const w = segmentWidthPx();
    if (w < 1) return;
    const minScroll = Math.ceil(marquee.clientWidth + w);
    let guard = 0;
    while (row.scrollWidth < minScroll && guard < 8) {
      row.appendChild(first.cloneNode(true));
      guard += 1;
    }
  }

  function applyShift() {
    ensureEnoughClones();
    const w = segmentWidthPx();
    if (w < 1) return;
    row.style.setProperty('--marquee-shift', '-' + w + 'px');
    lastShiftPx = w;
  }

  function hardRestartAnimation() {
    row.style.animation = 'none';
    void row.offsetWidth;
    row.style.animation = '';
  }

  function startSynced() {
    applyShift();
    row.classList.add('is-marquee-synced');
    hardRestartAnimation();
  }

  function onResizeDebounced() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!row.classList.contains('is-marquee-synced')) return;
      const before = lastShiftPx;
      applyShift();
      const after = segmentWidthPx();
      if (after < 1) return;
      if (before < 1 || Math.abs(after - before) >= 1) {
        hardRestartAnimation();
      }
    }, 400);
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(startSynced);
      });
    });
  } else {
    window.addEventListener(
      'load',
      function () {
        requestAnimationFrame(startSynced);
      },
      { once: true },
    );
  }

  setTimeout(function () {
    if (!row.classList.contains('is-marquee-synced')) {
      startSynced();
    }
  }, 2000);

  window.addEventListener('resize', onResizeDebounced, { passive: true });
})();
