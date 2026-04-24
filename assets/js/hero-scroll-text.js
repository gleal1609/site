/**
 * "Role para ver" — inversão progressiva do texto com o scroll.
 */
(function () {
  'use strict';

  const TEXT = 'Role para ver';
  const root = document.getElementById('scroll-hint');
  if (!root) return;

  const el = root.querySelector('[data-scroll-hint]');
  if (!el) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  el.textContent = '';
  const spanList = [];
  for (let i = 0; i < TEXT.length; i += 1) {
    if (TEXT[i] === ' ') {
      const sp = document.createElement('span');
      sp.className = 'home-hero__scroll-ch home-hero__scroll-ch--sp';
      sp.textContent = ' ';
      el.appendChild(sp);
      spanList.push({ el: sp, space: true });
    } else {
      const c = document.createElement('span');
      c.className = 'home-hero__scroll-ch';
      c.textContent = TEXT[i];
      c.style.display = 'inline-block';
      el.appendChild(c);
      spanList.push({ el: c, space: false, idx: spanList.filter((s) => !s.space).length });
    }
  }
  const letters = spanList.filter((s) => !s.space);

  function onScroll() {
    const h = window.innerHeight || 1;
    const p = Math.min(1, window.scrollY / (h * 0.8));
    const n = letters.length;
    letters.forEach((item, j) => {
      const t = p * n - (n - 1 - j);
      if (t <= 0) {
        item.el.style.transform = 'rotateY(0deg)';
      } else if (t >= 1) {
        item.el.style.transform = 'rotateY(180deg)';
      } else {
        const deg = t * 180;
        item.el.style.transform = 'rotateY(' + deg + 'deg)';
      }
    });
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      onScroll();
      ticking = false;
    });
  });
  onScroll();
})();
