/**
 * Menu flip + painel lateral direito (apenas Home).
 */
(function () {
  'use strict';

  function init() {
    const nav = document.getElementById('home-nav');
    const trigger = document.getElementById('home-nav-trigger');
    const panel = document.getElementById('home-nav-panel');
    const backdrop = document.getElementById('home-nav-backdrop');
    if (!nav || !trigger || !panel || !backdrop) return;

    function open() {
      nav.classList.add('home-nav--open');
      trigger.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add('home-nav-open');
    }

    function close() {
      nav.classList.remove('home-nav--open');
      trigger.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
      backdrop.hidden = true;
      document.body.classList.remove('home-nav-open');
    }

    function toggle() {
      if (nav.classList.contains('home-nav--open')) close();
      else open();
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      toggle();
    });

    backdrop.addEventListener('click', () => close());

    panel.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link) close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('home-nav--open')) {
        close();
        trigger.focus();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
