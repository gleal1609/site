// Homepage Intro Text Animation
document.addEventListener("DOMContentLoaded", () => {
  const INTRO_DONE_KEY = "reverso_home_intro_done";

  const introContainer = document.getElementById("intro-text");
  const projectsGrid = document.querySelector(".projects-grid");
  const masonryContainer = document.getElementById("masonry-container");

  function revealHomeContent() {
    if (introContainer) {
      introContainer.classList.add("hidden");
      introContainer.style.display = "none";
    }
    if (projectsGrid) {
      projectsGrid.classList.add("visible");
      projectsGrid.style.opacity = "1";
      if (typeof gsap !== "undefined") {
        gsap.set(projectsGrid, { opacity: 1 });
      }
    }
    if (masonryContainer) {
      masonryContainer.classList.add("grid-enabled");
    }
    if (typeof initMasonry === "function") {
      initMasonry();
    }
  }

  function markIntroDone() {
    try {
      sessionStorage.setItem(INTRO_DONE_KEY, "1");
    } catch (_) {}
  }

  try {
    if (sessionStorage.getItem(INTRO_DONE_KEY) === "1") {
      revealHomeContent();
      return;
    }
  } catch (_) {}

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
    if (projectsGrid) projectsGrid.classList.add("visible");
    if (masonryContainer) masonryContainer.classList.add("grid-enabled");
    return;
  }

  const line1 = introText.querySelector(".intro-line-1");
  const line2 = introText.querySelector(".intro-line-2");
  const line3 = introText.querySelector(".intro-line-3.intro-mundo");
  const line4a = introText.querySelector(".intro-line-4a");
  const line4b = introText.querySelector(".intro-line-4b");

  if (!line1 || !line2 || !line3 || !line4a || !line4b) {
    console.warn("Intro line elements not found");
    if (projectsGrid) projectsGrid.classList.add("visible");
    if (masonryContainer) masonryContainer.classList.add("grid-enabled");
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

  if (projectsGrid) {
    gsap.set(projectsGrid, { opacity: 0 });
  }

  /* ── Width alignment: MUNDO ↔ AO + CONTRÁRIO ─────────────────── */

  const calculateWidths = () => {
    const origDisplay4a = line4a.style.display;
    const origDisplay4b = line4b.style.display;
    const origDisplay3 = line3.style.display;

    line4a.style.display = "inline-block";
    line4b.style.display = "inline-block";
    line3.style.display = "block";

    // single forced reflow for all three measurements
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

  /* ── Animation timeline (~3.5 s) ─────────────────────────────── */

  const tl = gsap.timeline({
    onComplete: () => {
      introContainer.classList.add("hidden");
      introContainer.style.display = "none";
      markIntroDone();
    },
  });

  // 0.0-0.2s: "O PODER"
  tl.to(line1, {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: 0.15,
    ease: "power3.out",
  })
    // 0.2-0.4s: "DE VER O"
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
    // 0.4-0.7s: "MUNDO"
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
    // 0.7s: "AO" + "CONTRÁRIO"
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
    // 1.0-1.24s: blinks
    .to(line4b, { opacity: 0, duration: 0.06, ease: "power2.inOut" }, 1.0)
    .to(line4b, { opacity: 1, duration: 0.06, ease: "power2.inOut" }, 1.12)
    .to(line4b, { opacity: 0, duration: 0.06, ease: "power2.inOut" }, 1.18)
    .to(line4b, { opacity: 1, duration: 0.06, ease: "power2.inOut" }, 1.24)
    // 1.3s: outline conversion
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
    // 1.5-2.5s: letter flip
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
    // 2.5-2.7s: return to filled
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

    // ── 2.7 s: start masonry init NOW (behind the fading intro overlay) ──
    .call(
      () => {
        if (masonryContainer) masonryContainer.classList.add("grid-enabled");
        if (typeof initMasonry === "function") initMasonry();
      },
      null,
      2.7,
    )

    // 2.7-3.5s: fade out words + fade in grid
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
    )
    .to(
      introContainer,
      {
        backgroundColor: "transparent",
        duration: 0.8,
        ease: "power2.in",
      },
      2.7,
    )
    .to(
      projectsGrid,
      {
        opacity: 1,
        duration: 0.8,
        ease: "power2.out",
        onStart: () => {
          if (projectsGrid) projectsGrid.classList.add("visible");
        },
      },
      2.7,
    );
});
