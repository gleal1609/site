/**
 * Menu flip + painel lateral direito (apenas Home).
 * Atenção no logo: rAF com disparos discretos (não contínuos).
 */
(function () {
  'use strict';

  var SLING_NAME = 'home-nav-logo-sling';

  /* ── Atenção: constantes ────────────────────────────────────────── */

  /** Intervalo entre disparos de atenção (segundos). */
  var ATTN_INTERVAL = 10;
  /** Duração do movimento de atenção (segundos) — 2 bumps aqui dentro. */
  var ATTN_DURATION = 1.9;
  /** Nº de bumps de escala por disparo. */
  var ATTN_BUMPS = 2;
  /** Pico de escala (+20%). */
  var ATTN_SCALE_PEAK = 0.2;
  /** Meias-oscilações do pêndulo Y durante o disparo. */
  var ATTN_PENDULUMS = 4;
  /** Amplitude rotação Y (graus). */
  var ATTN_AMP_DEG = 46;

  function init() {
    var nav = document.getElementById('home-nav');
    var trigger = document.getElementById('home-nav-trigger');
    var panel = document.getElementById('home-nav-panel');
    var backdrop = document.getElementById('home-nav-backdrop');
    if (!nav || !trigger || !panel || !backdrop) return;
    var stage = trigger.querySelector('.home-nav__logo-stage');
    if (!stage) return;

    var reduceMotion = false;
    try {
      reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {}

    /* ── Atenção: estado ──────────────────────────────────────────── */

    var attnRunning = false;
    var attnStartT = 0;
    var rafId = 0;
    var menuOpen = false;

    function isMenuOpen() {
      return menuOpen;
    }

    function scheduleNextAttn() {
      if (reduceMotion) return;
      setTimeout(function () {
        fireAttn();
      }, ATTN_INTERVAL * 1000);
    }

    function fireAttn() {
      if (reduceMotion) return;
      if (isMenuOpen()) {
        scheduleNextAttn();
        return;
      }
      if (stage.classList.contains('home-nav__logo-stage--sling')) {
        scheduleNextAttn();
        return;
      }
      attnRunning = true;
      attnStartT = performance.now() / 1000;
      if (!rafId) rafId = requestAnimationFrame(tick);
    }

    function attnAngle(elapsed) {
      if (elapsed >= ATTN_DURATION) return 0;
      var p = elapsed / ATTN_DURATION;
      var env = 1 - p;
      return ATTN_AMP_DEG * Math.sin(2 * Math.PI * ATTN_PENDULUMS * p) * env;
    }

    function attnScale(elapsed) {
      if (elapsed >= ATTN_DURATION) return 1;
      var p = elapsed / ATTN_DURATION;
      var bump = 0.5 - 0.5 * Math.cos(2 * Math.PI * ATTN_BUMPS * p);
      var env = 1 - p * p;
      return 1 + ATTN_SCALE_PEAK * bump * env;
    }

    function attnZ(s) {
      return s > 1 ? 38 * (s - 1) : 0;
    }

    function tick() {
      rafId = 0;
      if (!attnRunning) {
        stage.style.setProperty('transform', 'none');
        return;
      }
      var now = performance.now() / 1000;
      var elapsed = now - attnStartT;

      if (elapsed >= ATTN_DURATION) {
        attnRunning = false;
        stage.style.setProperty('transform', 'none');
        scheduleNextAttn();
        return;
      }

      var a = attnAngle(elapsed);
      var s = attnScale(elapsed);
      var z = attnZ(s);

      if (trigger.matches && trigger.matches(':hover')) {
        a += 14 * Math.sin(now * 2.3);
      }

      stage.style.setProperty(
        'transform',
        'translate3d(0,0,' + z.toFixed(1) + 'px) rotateY(' + a.toFixed(1) + 'deg) scale(' + s.toFixed(3) + ')'
      );
      rafId = requestAnimationFrame(tick);
    }

    /* ── Primeiro disparo: espera a intro terminar ────────────────── */

    function waitForIntroThenFire() {
      if (reduceMotion) return;
      var INTRO_KEY = 'reverso_home_intro_done';
      var introText = document.getElementById('intro-text');
      var alreadySeen = false;
      try { alreadySeen = sessionStorage.getItem(INTRO_KEY) === '1'; } catch (_) {}

      if (alreadySeen || !introText) {
        setTimeout(fireAttn, 800);
        return;
      }

      var mo = new MutationObserver(function () {
        var hidden = introText.classList.contains('hidden') ||
                     introText.style.display === 'none';
        if (hidden) {
          mo.disconnect();
          setTimeout(fireAttn, 600);
        }
      });
      mo.observe(introText, { attributes: true, attributeFilter: ['class', 'style'] });

      setTimeout(function () {
        mo.disconnect();
        if (!attnRunning) fireAttn();
      }, 8000);
    }

    waitForIntroThenFire();

    /* ── Clique: estilingue ───────────────────────────────────────── */

    function playSling() {
      if (reduceMotion) return;
      attnRunning = false;
      stage.style.removeProperty('transform');
      stage.classList.remove('home-nav__logo-stage--sling');
      void stage.offsetWidth;
      stage.classList.add('home-nav__logo-stage--sling');
    }

    stage.addEventListener('animationend', function (e) {
      if (e.target !== stage) return;
      var name = (e.animationName && String(e.animationName)) || '';
      if (name.indexOf(SLING_NAME) === -1) return;
      stage.classList.remove('home-nav__logo-stage--sling');
    });

    /* ── Menu ─────────────────────────────────────────────────────── */

    function open() {
      menuOpen = true;
      nav.classList.add('home-nav--open');
      trigger.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add('home-nav-open');
      if (attnRunning) {
        attnRunning = false;
        stage.style.setProperty('transform', 'none');
      }
    }

    function close() {
      menuOpen = false;
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

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      playSling();
      toggle();
    });

    backdrop.addEventListener('click', function () { close(); });

    panel.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (link) close();
    });

    document.addEventListener('keydown', function (e) {
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
