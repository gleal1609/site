/**
 * Page Transition System with GSAP
 *
 * CSS rule  body:not(.page-loaded) > *:not(…) { opacity:0!important }
 * hides content until JS adds .page-loaded.
 *
 * On the HOME page the intro animation owns the reveal, so we skip the
 * initial fade-in entirely — just mark the body as loaded.
 *
 * On every OTHER page we do a GSAP fade-in once the window has loaded.
 *
 * Internal-link clicks always get a GSAP fade-out before navigation.
 */

(function () {
  'use strict';

  var CONTENT_SEL =
    'body > *:not(.bottom-nav):not(script):not(link):not(style):not(meta):not(.intro-text-container)';
  var DURATION = 0.5;
  var isTransitioning = false;
  var initialFadeInDone = false;

  /* ── helpers ─────────────────────────────────────────────────────── */

  function contentElements() {
    return Array.from(document.querySelectorAll(CONTENT_SEL)).filter(function (el) {
      return !el.classList.contains('bottom-nav') && !el.closest('.bottom-nav');
    });
  }

  /* ── fade-out (link navigation) ──────────────────────────────────── */

  function fadeOut() {
    return new Promise(function (resolve) {
      var els = contentElements().filter(function (el) {
        return el.offsetHeight > 0;
      });

      if (els.length === 0 || typeof gsap === 'undefined') {
        resolve();
        return;
      }

      gsap.to(els, {
        opacity: 0,
        y: -20,
        scale: 0.98,
        duration: DURATION / 2,
        ease: 'power2.in',
        stagger: 0.02,
        onComplete: resolve,
      });
    });
  }

  /* ── fade-in (page entrance) ─────────────────────────────────────── */

  function fadeIn() {
    return new Promise(function (resolve) {
      var els = contentElements();

      if (typeof gsap !== 'undefined' && els.length > 0) {
        gsap.set(els, { opacity: 0, y: 20, scale: 0.98, visibility: 'visible' });
        document.body.classList.add('page-loaded');

        gsap.to(els, {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: DURATION / 2,
          ease: 'power2.out',
          stagger: 0.03,
          onComplete: resolve,
        });
      } else {
        document.body.classList.add('page-loaded');
        els.forEach(function (el) {
          el.style.opacity = '1';
          el.style.visibility = 'visible';
          el.style.transform = 'none';
        });
        resolve();
      }
    });
  }

  /* ── link-click handler ──────────────────────────────────────────── */

  function handleLinkClick(e) {
    var link = e.target.closest('a');
    if (!link) return;

    if (
      link.target === '_blank' ||
      link.hasAttribute('download') ||
      link.href.startsWith('mailto:') ||
      link.href.startsWith('tel:') ||
      link.href.startsWith('javascript:')
    ) {
      return;
    }

    try {
      var url = new URL(link.href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash &&
        url.hash.length > 1
      ) {
        return;
      }
    } catch (_) {
      return;
    }

    if (isTransitioning) {
      e.preventDefault();
      return;
    }

    isTransitioning = true;
    e.preventDefault();

    fadeOut()
      .then(function () {
        window.location.href = link.href;
      })
      .catch(function () {
        isTransitioning = false;
        window.location.href = link.href;
      });
  }

  /* ── init ─────────────────────────────────────────────────────────── */

  function init() {
    var isHome = !!document.getElementById('intro-text');

    if (isHome) {
      document.body.classList.add('page-loaded');
      document.addEventListener('click', handleLinkClick, true);
      return;
    }

    var doFadeIn = function () {
      if (initialFadeInDone) return;
      initialFadeInDone = true;
      fadeIn().then(function () {
        isTransitioning = false;
      });
    };

    if (document.readyState === 'complete') {
      requestAnimationFrame(doFadeIn);
    } else {
      window.addEventListener('load', function () {
        requestAnimationFrame(doFadeIn);
      }, { once: true });
    }

    document.addEventListener('click', handleLinkClick, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
