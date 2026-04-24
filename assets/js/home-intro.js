// Homepage Intro Text Animation (Hero com vídeo + bloco #home-below)
document.addEventListener("DOMContentLoaded", () => {
  const INTRO_DONE_KEY = "reverso_home_intro_done";

  const introContainer = document.getElementById("intro-text");
  const homeBelow = document.getElementById("home-below");
  const scrollHint = document.getElementById("scroll-hint");
  const heroVideo = document.getElementById("home-hero-video");
  const heroContainer = document.getElementById("home-hero");
  const masonryContainer = document.getElementById("masonry-container");
  const masonryGrid = masonryContainer?.querySelector(".projects-grid");

  // ── Hero video resilience ─────────────────────────────────────────
  // O vídeo da Hero precisa reaparecer em cenários distintos:
  //   1. Carga "limpa" da página — `autoplay` cobre.
  //   2. Reload (F5) — o WEBrick do `jekyll serve` pode entregar
  //      respostas parciais quando o usuário recarrega antes do vídeo
  //      terminar de baixar; o Chrome guarda esse trecho incompleto no
  //      cache HTTP e em F5s subsequentes reaproveita a cópia quebrada
  //      (Ctrl+F5 conserta porque bypassa cache). Não há como o
  //      cliente-side "limpar" o cache do browser — mas DÁ para mudar
  //      a chave de cache (query string) e forçar um refetch.
  //   3. Volta pelo bfcache — `autoplay` não re-dispara, o elemento
  //      pode voltar pausado/erro.
  //   4. Resíduo de `opacity: 0` em `.home-hero` deixado pelo fadeOut
  //      do page-transitions no bfcache.
  const HERO_LOG_PREFIX = "[hero-video]";
  const HERO_FAILED_FLAG = "reverso_hero_video_failed";
  const heroSourceEl = heroVideo ? heroVideo.querySelector("source") : null;
  let heroOriginalSrc = null;
  let heroCacheBustSeq = 0;
  let heroPlayAttemptSeq = 0;
  let heroHealthTimer = null;
  let heroProgressTimer = null;
  let heroHasPlayedOnce = false;
  // Monitor de progresso de frames. Quando o vídeo "diz" que está
  // tocando (paused=false) mas currentTime não avança, o decoder está
  // travado — tipicamente por bytes corrompidos entregues pelo WEBrick
  // ou pelo media cache do Chromium reutilizando uma cópia ruim.
  let heroLastCurrentTime = null;
  let heroLastProgressTimestamp = 0;

  // Dev local: `jekyll serve` + WEBrick + arquivo grande tem um padrão
  // conhecido de servir respostas parciais que o Chrome cacheia em um
  // estado quebrado. O próprio Cache-Control `no-store` do WEBrick
  // deveria impedir isso, mas o media cache do Chromium é separado do
  // cache HTTP e às vezes reusa bytes inválidos. Em produção o vídeo
  // virá de R2/D1 com cabeçalhos sãos, então só ativamos o cache-bust
  // preemptivo em desenvolvimento.
  const heroIsLocalDev = (function () {
    try {
      const h = window.location.hostname;
      return (
        h === "localhost" ||
        h === "127.0.0.1" ||
        h === "0.0.0.0" ||
        h.endsWith(".local")
      );
    } catch (_) {
      return false;
    }
  })();

  let heroHadPreviousFailure = false;
  try {
    heroHadPreviousFailure =
      sessionStorage.getItem(HERO_FAILED_FLAG) === "1";
  } catch (_) {}

  function markHeroFailed() {
    try {
      sessionStorage.setItem(HERO_FAILED_FLAG, "1");
    } catch (_) {}
    heroHadPreviousFailure = true;
  }

  function clearHeroFailedFlag() {
    try {
      sessionStorage.removeItem(HERO_FAILED_FLAG);
    } catch (_) {}
    heroHadPreviousFailure = false;
  }

  function heroLog() {
    if (typeof console === "undefined") return;
    try {
      const args = Array.prototype.slice.call(arguments);
      args.unshift(HERO_LOG_PREFIX);
      (console.debug || console.log).apply(console, args);
    } catch (_) {}
  }

  function getHeroBaseSrc() {
    if (!heroSourceEl) return null;
    if (heroOriginalSrc === null) {
      const raw = heroSourceEl.getAttribute("src") || "";
      // Remove qualquer query existente para não concatenar várias
      // vezes caso a função seja chamada múltiplas vezes.
      heroOriginalSrc = raw.split("?")[0];
    }
    return heroOriginalSrc;
  }

  function clearHeroInlineHiders() {
    // Limpa resíduos de opacity/transform deixados pelo fadeOut das
    // transições de página — crítico no bfcache e defesa em profundidade.
    if (heroContainer) {
      heroContainer.style.opacity = "";
      heroContainer.style.visibility = "";
      heroContainer.style.transform = "";
    }
    if (heroVideo) {
      heroVideo.style.opacity = "";
      heroVideo.style.visibility = "";
      heroVideo.style.display = "";
    }
  }

  function heroVideoHasError() {
    if (!heroVideo) return false;
    // MediaError presente OU networkState NO_SOURCE (3).
    return !!heroVideo.error || heroVideo.networkState === 3;
  }

  function heroVideoLooksStuck() {
    if (!heroVideo) return false;
    if (heroVideoHasError()) return true;
    // Pausado + sem dados: algo travou o pipeline de mídia.
    if (heroVideo.paused && heroVideo.readyState < 2) return true;
    return false;
  }

  function heroVideoHasNoProgress() {
    // Detecta o caso sutil: paused=false, readyState alto, mas o
    // decoder não está avançando frames. É o que faz o usuário ver
    // "tela preta" quando o vídeo *tecnicamente* está tocando.
    if (!heroVideo) return false;
    if (heroVideo.paused) return false;
    // Se nenhum timeupdate foi registrado OU o último foi há muito.
    const now = Date.now();
    const timeSinceLastProgress =
      heroLastProgressTimestamp === 0
        ? Infinity
        : now - heroLastProgressTimestamp;
    const stuckAtZero = heroVideo.currentTime < 0.05;
    // 2+ segundos sem avanço de tempo com o elemento dizendo que
    // está tocando é forte indicador de travamento no decoder.
    return stuckAtZero && timeSinceLastProgress > 2000;
  }

  function reloadHeroVideoPlain() {
    if (!heroVideo) return;
    try {
      heroVideo.pause();
    } catch (_) {}
    try {
      // load() reseta o pipeline de mídia e força nova tentativa com a
      // mesma URL. Útil para bfcache, mas NÃO contorna cache HTTP do
      // Chrome com resposta corrompida — veja reloadHeroVideoWithCacheBust.
      heroVideo.load();
      heroLog("load() simples disparado. readyState =", heroVideo.readyState);
    } catch (err) {
      heroLog("load() falhou:", err);
    }
  }

  function reloadHeroVideoWithCacheBust(reason) {
    if (!heroVideo || !heroSourceEl) return;
    const base = getHeroBaseSrc();
    if (!base) return;
    heroCacheBustSeq += 1;
    const bustedSrc =
      base + "?_rv=" + Date.now().toString(36) + "-" + heroCacheBustSeq;
    try {
      heroVideo.pause();
    } catch (_) {}
    // Trocar o src do <source> e chamar load() é o caminho mais
    // confiável no Chrome/Firefox/Safari — o pipeline de mídia é
    // resetado e re-itera pelos <source>.
    heroSourceEl.setAttribute("src", bustedSrc);
    try {
      heroVideo.load();
      heroLog(
        "cache-bust #" + heroCacheBustSeq + " (motivo: " + reason + "). src =",
        bustedSrc,
      );
    } catch (err) {
      heroLog("cache-bust load() falhou:", err);
    }
  }

  function tryPlayHeroVideo() {
    if (!heroVideo) return;
    const p = heroVideo.play?.();
    if (p && typeof p.catch === "function") {
      p.catch((err) => {
        // NotAllowedError → autoplay negado (usuário precisa interagir).
        // AbortError → interrompido por outro play()/load(). Ignorar.
        // Outros → tipicamente estado inválido do elemento.
        if (err && err.name && err.name !== "AbortError") {
          heroLog("play() rejeitado:", err.name, err.message || "");
        }
      });
    }
  }

  function runHealthCheck(attemptSeq) {
    if (attemptSeq !== heroPlayAttemptSeq) return;
    if (!heroVideo) return;

    const stuck = heroVideoLooksStuck();
    const noProgress = heroVideoHasNoProgress();
    if (!stuck && !noProgress) return;

    heroLog(
      "health-check:",
      stuck ? "travado" : "sem progresso",
      "— paused =", heroVideo.paused,
      "readyState =", heroVideo.readyState,
      "networkState =", heroVideo.networkState,
      "currentTime =", heroVideo.currentTime,
      "error =", heroVideo.error && heroVideo.error.code,
      "— aplicando cache-bust.",
    );
    markHeroFailed();
    reloadHeroVideoWithCacheBust(stuck ? "health-check" : "no-progress");
    tryPlayHeroVideo();

    // Agenda um segundo health-check depois do cache-bust. Se ainda
    // assim não rodou, algo mais sério está acontecendo — logamos e
    // tentamos mais uma recuperação (evita loop infinito de cache-busts).
    setTimeout(() => {
      if (attemptSeq !== heroPlayAttemptSeq) return;
      if (!heroVideoLooksStuck() && !heroVideoHasNoProgress()) return;
      heroLog(
        "ainda travado/sem progresso após cache-bust.",
        "readyState =", heroVideo.readyState,
        "currentTime =", heroVideo.currentTime,
        "— tentando mais uma vez.",
      );
      reloadHeroVideoWithCacheBust("health-check-retry");
      tryPlayHeroVideo();
    }, 2500);
  }

  function runProgressCheck(attemptSeq) {
    // Check separado que roda mais tarde, especificamente para o caso
    // "vídeo diz que está tocando mas currentTime não sai do zero".
    // Comum ao voltar de outra página pelo menu.
    if (attemptSeq !== heroPlayAttemptSeq) return;
    if (!heroVideo) return;
    if (!heroVideoHasNoProgress()) return;

    heroLog(
      "progress-check detectou decoder travado (paused=false, currentTime=" +
        heroVideo.currentTime + ") — cache-busting.",
    );
    markHeroFailed();
    reloadHeroVideoWithCacheBust("progress-check");
    tryPlayHeroVideo();
  }

  let heroInitialBootstrapDone = false;

  function ensureHeroVideoPlayback(opts) {
    if (!heroVideo) return;
    const forceReload = !!(opts && opts.forceReload);
    const forceCacheBust = !!(opts && opts.forceCacheBust);

    clearHeroInlineHiders();

    heroVideo.muted = true;
    heroVideo.defaultMuted = true;
    try {
      heroVideo.setAttribute("muted", "");
    } catch (_) {}
    heroVideo.playsInline = true;
    heroVideo.loop = true;

    // Cache-bust preemptivo no PRIMEIRO bootstrap quando:
    //  - estamos em dev local (WEBrick + vídeo grande é flaky), ou
    //  - houve falha registrada em uma carga anterior desta sessão.
    // Isso é crítico porque o `preload="auto"` da tag <video> já
    // começou a baixar a URL original antes do JS rodar; se o cache
    // do Chromium tem uma cópia ruim, só trocar a URL força o
    // refetch. Custa 3.7 MB extra em dev — aceitável.
    if (
      !heroInitialBootstrapDone &&
      !forceCacheBust &&
      !forceReload &&
      (heroIsLocalDev || heroHadPreviousFailure)
    ) {
      heroLog(
        "bootstrap com cache-bust preemptivo.",
        "localDev =", heroIsLocalDev,
        "previousFailure =", heroHadPreviousFailure,
      );
      reloadHeroVideoWithCacheBust(
        heroHadPreviousFailure ? "sticky-failure" : "dev-preemptive",
      );
    } else if (forceCacheBust) {
      reloadHeroVideoWithCacheBust("forceCacheBust");
    } else if (forceReload || heroVideoHasError()) {
      reloadHeroVideoPlain();
    }
    heroInitialBootstrapDone = true;

    const attemptSeq = ++heroPlayAttemptSeq;

    tryPlayHeroVideo();
    requestAnimationFrame(() => {
      if (attemptSeq !== heroPlayAttemptSeq) return;
      tryPlayHeroVideo();
      requestAnimationFrame(() => {
        if (attemptSeq === heroPlayAttemptSeq) tryPlayHeroVideo();
      });
    });
    [80, 250, 600, 1200].forEach((ms) => {
      setTimeout(() => {
        if (attemptSeq === heroPlayAttemptSeq) tryPlayHeroVideo();
      }, ms);
    });

    if (!heroVideo.dataset.reversoNudgeBound) {
      heroVideo.dataset.reversoNudgeBound = "1";
      // Dispara assim que houver dados suficientes para tocar.
      heroVideo.addEventListener("loadeddata", tryPlayHeroVideo);
      heroVideo.addEventListener("canplay", tryPlayHeroVideo);
      // `timeupdate` é o único evento que confirma avanço real de
      // frames. Registrar aqui alimenta heroVideoHasNoProgress().
      heroVideo.addEventListener("timeupdate", () => {
        if (heroVideo.currentTime !== heroLastCurrentTime) {
          heroLastCurrentTime = heroVideo.currentTime;
          heroLastProgressTimestamp = Date.now();
        }
      });
      // `playing` confirma que o vídeo está realmente rodando. Usamos
      // para limpar a flag de "falha anterior" — a partir daqui
      // reloads subsequentes não precisarão de cache-bust preemptivo.
      heroVideo.addEventListener("playing", () => {
        if (!heroHasPlayedOnce) {
          heroHasPlayedOnce = true;
          heroLog("playing — vídeo tocando de verdade. readyState =", heroVideo.readyState);
        }
        // Arma o monitor de progresso. Sem isso, heroVideoHasNoProgress
        // retornaria true por causa de heroLastProgressTimestamp=0.
        heroLastProgressTimestamp = Date.now();
        clearHeroFailedFlag();
      });
      // Auto-recuperação de erro. Ignoramos MEDIA_ERR_ABORTED (code 1)
      // porque isso é disparado quando NÓS mesmos fazemos um cache-bust
      // — se entrássemos em recovery aqui, teríamos loop de aborts.
      heroVideo.addEventListener("error", () => {
        const code = heroVideo.error && heroVideo.error.code;
        if (code === 1) {
          heroLog("error MEDIA_ERR_ABORTED (code 1) — ignorando (provável abort interno).");
          return;
        }
        heroLog("evento error. code =", code, "— cache-busting.");
        markHeroFailed();
        setTimeout(() => {
          reloadHeroVideoWithCacheBust("media-error");
          tryPlayHeroVideo();
        }, 200);
      });
      // Logs diagnósticos dos eventos iniciais — ajudam a entender por
      // que a recuperação às vezes não funciona.
      heroVideo.addEventListener("loadstart", () => {
        heroLog("loadstart — fetch iniciando.");
      });
      heroVideo.addEventListener("loadedmetadata", () => {
        heroLog(
          "loadedmetadata — duration =", heroVideo.duration,
          "readyState =", heroVideo.readyState,
        );
      });
      heroVideo.addEventListener("waiting", () => {
        // Buffering durante playback. Se persistir é sinal de problema.
        heroLog(
          "waiting — bufferando. currentTime =", heroVideo.currentTime,
          "readyState =", heroVideo.readyState,
        );
      });
      // `stalled` = UA parou de buscar dados inesperadamente.
      heroVideo.addEventListener("stalled", () => {
        if (heroVideo.readyState < 2) {
          heroLog("stalled com readyState <2 — cache-busting.");
          markHeroFailed();
          reloadHeroVideoWithCacheBust("stalled");
        }
      });
      // `suspend` com networkState IDLE/NO_SOURCE e sem dados tende a
      // ser cache corrompido no Chromium.
      heroVideo.addEventListener("suspend", () => {
        if (heroVideo.readyState === 0 && heroVideo.networkState !== 1) {
          heroLog(
            "suspend com readyState=0 — suspeita de cache corrompido, cache-busting.",
          );
          markHeroFailed();
          reloadHeroVideoWithCacheBust("suspend-empty");
        }
      });
      // Se algo pausar inadvertidamente (bfcache Safari, visibilidade),
      // tenta retomar.
      heroVideo.addEventListener("pause", () => {
        if (document.hidden) return;
        setTimeout(() => {
          if (!heroVideo.paused) return;
          if (!document.hidden) tryPlayHeroVideo();
        }, 120);
      });
    }

    // Reset dos trackers de progresso para esta tentativa. Sem isso,
    // um timestamp antigo poderia fazer `heroVideoHasNoProgress`
    // retornar false incorretamente logo após um cache-bust.
    heroLastCurrentTime = null;
    heroLastProgressTimestamp = 0;

    // Health-check: detecta travamento "silencioso" (nunca disparou
    // error mas o vídeo nunca tocou) e aplica cache-bust.
    if (heroHealthTimer) clearTimeout(heroHealthTimer);
    heroHealthTimer = setTimeout(() => runHealthCheck(attemptSeq), 1500);
    // Progress-check mais tardio: pega especificamente o caso de
    // "playing mas currentTime parado em 0". Precisa de mais tempo
    // para dar chance do decoder emitir pelo menos um timeupdate.
    if (heroProgressTimer) clearTimeout(heroProgressTimer);
    heroProgressTimer = setTimeout(() => runProgressCheck(attemptSeq), 3000);
  }

  // Devem existir em todos os caminhos (incl. intro já vista no sessionStorage);
  // não podem ficar abaixo de um return antecipado.
  window.addEventListener("pageshow", (ev) => {
    // bfcache: o elemento volta em estado imprevisível. Forçamos load().
    const fromCache = !!(ev && ev.persisted);
    ensureHeroVideoPlayback({ forceReload: fromCache });
    if (fromCache) {
      // Reforço — alguns navegadores precisam de um segundo empurrão.
      setTimeout(() => ensureHeroVideoPlayback({}), 80);
      setTimeout(() => ensureHeroVideoPlayback({}), 400);
    }
  });
  window.addEventListener("load", () => {
    ensureHeroVideoPlayback();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ensureHeroVideoPlayback();
  });

  // Expõe utilitário de recuperação manual no console (só em dev é útil).
  try {
    window.__reversoHeroVideo = {
      ensure: ensureHeroVideoPlayback,
      cacheBust: () => reloadHeroVideoWithCacheBust("manual"),
      status: () => ({
        paused: heroVideo && heroVideo.paused,
        readyState: heroVideo && heroVideo.readyState,
        networkState: heroVideo && heroVideo.networkState,
        error: heroVideo && heroVideo.error && heroVideo.error.code,
        currentSrc: heroVideo && heroVideo.currentSrc,
      }),
    };
  } catch (_) {}

  function revealHomeContent() {
    if (introContainer) {
      introContainer.classList.add("hidden");
      introContainer.style.display = "none";
    }
    if (homeBelow) {
      homeBelow.classList.add("home-below--visible");
      homeBelow.style.opacity = "1";
      if (typeof gsap !== "undefined") {
        gsap.set(homeBelow, { opacity: 1 });
      }
    }
    if (scrollHint) {
      scrollHint.classList.add("home-hero__scroll--visible");
      scrollHint.setAttribute("aria-hidden", "false");
    }
    if (masonryContainer) {
      masonryContainer.classList.add("grid-enabled");
    }
    if (masonryGrid) {
      masonryGrid.classList.add("visible");
    }
    ensureHeroVideoPlayback();
    if (typeof initMasonry === "function") {
      initMasonry();
    }
  }

  function markIntroDone() {
    try {
      sessionStorage.setItem(INTRO_DONE_KEY, "1");
    } catch (_) {}
  }

  let introAlreadySeen = false;
  try {
    introAlreadySeen = sessionStorage.getItem(INTRO_DONE_KEY) === "1";
  } catch (_) {}

  if (introAlreadySeen && introContainer) {
    introContainer.classList.add("hidden");
    introContainer.style.display = "none";
  }

  ensureHeroVideoPlayback();

  if (introAlreadySeen) {
    revealHomeContent();
    return;
  }

  if (typeof gsap === "undefined") {
    console.error("GSAP not loaded, intro animation cannot run");
    revealHomeContent();
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    revealHomeContent();
    markIntroDone();
    return;
  }

  const introText = introContainer?.querySelector(".intro-text");

  if (!introContainer || !introText) {
    console.warn("Intro text elements not found");
    revealHomeContent();
    return;
  }

  const line1 = introText.querySelector(".intro-line-1");
  const line2 = introText.querySelector(".intro-line-2");
  const line3 = introText.querySelector(".intro-line-3.intro-mundo");
  const line4a = introText.querySelector(".intro-line-4a");
  const line4b = introText.querySelector(".intro-line-4b");

  if (!line1 || !line2 || !line3 || !line4a || !line4b) {
    console.warn("Intro line elements not found");
    revealHomeContent();
    return;
  }

  const contrarioText = line4b.textContent;
  line4b.innerHTML = "";
  const letters = [];
  for (let i = 0; i < contrarioText.length; i++) {
    const letterSpan = document.createElement("span");
    letterSpan.className = "letter";
    letterSpan.textContent = contrarioText[i];
    line4b.appendChild(letterSpan);
    letters.push(letterSpan);
  }

  gsap.set([line1, line2, line3, line4a, line4b], {
    opacity: 0,
    y: -50,
    scale: 0.9,
  });
  gsap.set(introText, { opacity: 1 });
  gsap.set(letters, { opacity: 1, rotationX: 0 });

  if (homeBelow) {
    gsap.set(homeBelow, { opacity: 0 });
  }
  if (scrollHint) {
    gsap.set(scrollHint, { opacity: 0 });
  }

  /* ── Width alignment: MUNDO ↔ AO + CONTRÁRIO ─────────────────── */

  const calculateWidths = () => {
    const origDisplay4a = line4a.style.display;
    const origDisplay4b = line4b.style.display;
    const origDisplay3 = line3.style.display;

    line4a.style.display = "inline-block";
    line4b.style.display = "inline-block";
    line3.style.display = "block";

    const rect4a = line4a.getBoundingClientRect();
    const rect4b = line4b.getBoundingClientRect();

    const contrarioHeight = rect4b.height;
    const contrarioWidth = rect4b.width;

    if (Math.abs(rect4a.height - contrarioHeight) > 1) {
      const scaleFactor = contrarioHeight / rect4a.height;
      const currentFontSize = parseFloat(getComputedStyle(line4a).fontSize);
      line4a.style.fontSize = currentFontSize * scaleFactor + "px";

      const rect4aNew = line4a.getBoundingClientRect();
      gsap.set(line3, { width: rect4aNew.width + contrarioWidth });
    } else {
      gsap.set(line3, { width: rect4a.width + contrarioWidth });
    }

    line4a.style.display = origDisplay4a || "";
    line4b.style.display = origDisplay4b || "";
    line3.style.display = origDisplay3 || "";
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(calculateWidths);
  } else {
    setTimeout(calculateWidths, 300);
  }

  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(calculateWidths, 250);
  });

  const tl = gsap.timeline({
    onComplete: () => {
      introContainer.classList.add("hidden");
      introContainer.style.display = "none";
      markIntroDone();
    },
  });

  tl.to(line1, {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: 0.15,
    ease: "power3.out",
  })
    .to(
      line2,
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.15,
        ease: "power3.out",
      },
      0.2,
    )
    .to(
      line3,
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.2,
        ease: "power3.out",
      },
      0.4,
    )
    .to(
      [line4a, line4b],
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.2,
        ease: "power3.out",
      },
      0.7,
    )
    .to(line4b, { opacity: 0, duration: 0.06, ease: "power2.inOut" }, 1.0)
    .to(line4b, { opacity: 1, duration: 0.06, ease: "power2.inOut" }, 1.12)
    .to(line4b, { opacity: 0, duration: 0.06, ease: "power2.inOut" }, 1.18)
    .to(line4b, { opacity: 1, duration: 0.06, ease: "power2.inOut" }, 1.24)
    .to(
      line4b,
      {
        duration: 0.15,
        ease: "power2.inOut",
        onStart: () => {
          line4b.classList.add("intro-line-4b-outline");
        },
      },
      1.3,
    )
    .to(
      letters,
      {
        rotationX: 180,
        duration: 0.14,
        ease: "power2.inOut",
        stagger: 0.1,
      },
      1.5,
    )
    .to(
      line4b,
      {
        duration: 0.25,
        ease: "power2.inOut",
        onStart: () => {
          line4b.classList.remove("intro-line-4b-outline");
        },
      },
      2.5,
    )
    .to(
      letters,
      {
        rotationX: 0,
        duration: 0.15,
        ease: "power2.inOut",
        stagger: 0.015,
      },
      2.5,
    )
    .call(
      () => {
        if (masonryContainer) masonryContainer.classList.add("grid-enabled");
        if (masonryGrid) masonryGrid.classList.add("visible");
        ensureHeroVideoPlayback();
        if (typeof initMasonry === "function") initMasonry();
      },
      null,
      2.7,
    )
    .to(
      [line1, line2, line3, line4a, line4b],
      {
        opacity: 0,
        y: -30,
        scale: 0.95,
        duration: 0.8,
        ease: "power2.in",
        stagger: 0.03,
      },
      2.7,
    );

  if (homeBelow) {
    tl.to(
      homeBelow,
      {
        opacity: 1,
        duration: 0.8,
        ease: "power2.out",
        onStart: () => {
          homeBelow.classList.add("home-below--visible");
        },
      },
      2.7,
    );
  }

  if (scrollHint) {
    tl.to(
      scrollHint,
      {
        opacity: 1,
        duration: 0.6,
        ease: "power2.out",
        onComplete: () => {
          scrollHint.classList.add("home-hero__scroll--visible");
          scrollHint.setAttribute("aria-hidden", "false");
        },
      },
      3.0,
    );
  }
});
