/**
 * Marquee do rodapé: anima exatamente uma largura de ".site-footer__marquee-group"
 * em px (--marquee-shift). Evita falha do loop com translateX(-50%) quando a fonte
 * carrega ou o layout muda (buracos / texto cortado).
 */
(function () {
  const row = document.querySelector('.site-footer__marquee-row');
  const first = row && row.querySelector('.site-footer__marquee-group');
  if (!row || !first) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function syncShift() {
    const w = first.offsetWidth;
    if (w < 1) return;
    row.style.setProperty('--marquee-shift', `-${w}px`);
  }

  function restartMarquee() {
    syncShift();
    row.style.animation = 'none';
    void row.offsetWidth;
    row.style.animation = '';
  }

  function startSynced() {
    restartMarquee();
    row.classList.add('is-marquee-synced');
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
      { once: true }
    );
  }

  setTimeout(function () {
    if (!row.classList.contains('is-marquee-synced')) {
      startSynced();
    }
  }, 2000);

  let roId;
  const ro = new ResizeObserver(function () {
    cancelAnimationFrame(roId);
    roId = requestAnimationFrame(function () {
      if (!row.classList.contains('is-marquee-synced')) return;
      restartMarquee();
    });
  });
  ro.observe(first);
})();
