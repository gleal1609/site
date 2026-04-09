// Homepage Intro Text Animation
document.addEventListener("DOMContentLoaded", () => {
  // Check if GSAP is loaded
  if (typeof gsap === 'undefined') {
    console.error('GSAP not loaded, intro animation cannot run');
    return;
  }

  const introContainer = document.getElementById('intro-text');
  const projectsGridEarly = document.querySelector('.projects-grid');
  const masonryContainerEarly = document.getElementById('masonry-container');

  // Skip heavy intro + stagger when user prefers reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (introContainer) {
      introContainer.classList.add('hidden');
      introContainer.style.display = 'none';
    }
    if (projectsGridEarly) {
      projectsGridEarly.classList.add('visible');
      gsap.set(projectsGridEarly, { opacity: 1 });
    }
    if (masonryContainerEarly) {
      masonryContainerEarly.classList.add('grid-enabled');
    }
    if (typeof initMasonry === 'function') {
      initMasonry();
    }
    return;
  }

  const introText = introContainer?.querySelector('.intro-text');
  const projectsGrid = projectsGridEarly;
  const masonryContainer = masonryContainerEarly;

  if (!introContainer || !introText) {
    console.warn('Intro text elements not found');
    // If intro not found, show grid immediately and enable pointer events
    if (projectsGrid) {
      projectsGrid.classList.add('visible');
    }
    if (masonryContainer) {
      masonryContainer.classList.add('grid-enabled');
    }
    return;
  }

  // Get individual elements
  const line1 = introText.querySelector('.intro-line-1'); // O PODER
  const line2 = introText.querySelector('.intro-line-2'); // DE VER O
  const line3 = introText.querySelector('.intro-line-3.intro-mundo'); // MUNDO
  const line4a = introText.querySelector('.intro-line-4a'); // AO
  const line4b = introText.querySelector('.intro-line-4b'); // CONTRÁRIO

  if (!line1 || !line2 || !line3 || !line4a || !line4b) {
    console.warn('Intro line elements not found');
    if (projectsGrid) {
      projectsGrid.classList.add('visible');
    }
    if (masonryContainer) {
      masonryContainer.classList.add('grid-enabled');
    }
    return;
  }

  // Split CONTRÁRIO into individual letters for letter-by-letter animation
  const contrarioText = line4b.textContent;
  line4b.innerHTML = '';
  const letters = [];
  for (let i = 0; i < contrarioText.length; i++) {
    const letterSpan = document.createElement('span');
    letterSpan.className = 'letter';
    letterSpan.textContent = contrarioText[i];
    line4b.appendChild(letterSpan);
    letters.push(letterSpan);
  }

  // Set initial state for all lines
  gsap.set([line1, line2, line3, line4a, line4b], { 
    opacity: 0, 
    y: -50,
    scale: 0.9
  });

  // Set initial state for container
  gsap.set(introText, { opacity: 1 });
  
  // Set initial state for letters
  gsap.set(letters, {
    opacity: 1,
    rotationX: 0
  });

  // Set initial state for projects grid (hidden, will fade in)
  if (projectsGrid) {
    gsap.set(projectsGrid, { opacity: 0 });
  }

  // Calculate width: MUNDO should match AO (rotated) + CONTRÁRIO combined width
  // Also ensure AO height matches CONTRÁRIO height
  // We need to wait for fonts to load and elements to render
  const calculateWidths = () => {
    // Temporarily show elements for measurement (but keep opacity 0 for animation)
    const originalDisplay = {
      line4a: line4a.style.display,
      line4b: line4b.style.display,
      line3: line3.style.display
    };
    
    // Ensure elements are in the DOM and visible for measurement
    line4a.style.display = 'inline-block';
    line4b.style.display = 'inline-block';
    line3.style.display = 'block';
    
    // Force layout recalculation
    void line4a.offsetWidth;
    void line4b.offsetWidth;
    void line3.offsetWidth;
    
    // Get the bounding boxes
    const rect4a = line4a.getBoundingClientRect();
    const rect4b = line4b.getBoundingClientRect();
    
    // When AO is rotated -90deg (counter-clockwise):
    // - Its rendered width = original height (before rotation)
    // - Its rendered height = original width (before rotation)
    // We want: AO's rendered height = CONTRÁRIO's height
    // We want: MUNDO's width = AO's rendered width + CONTRÁRIO's width
    
    const contrarioHeight = rect4b.height;
    const contrarioWidth = rect4b.width;
    const aoRenderedHeight = rect4a.height; // This is AO's original width
    const aoRenderedWidth = rect4a.width; // This is AO's original height
    
    // Adjust AO so its rendered height matches CONTRÁRIO height
    // Since AO's rendered height = AO's original width, we need to adjust AO's width
    // We do this by adjusting font-size
    if (Math.abs(aoRenderedHeight - contrarioHeight) > 1) {
      const scaleFactor = contrarioHeight / aoRenderedHeight;
      const currentFontSize = parseFloat(getComputedStyle(line4a).fontSize);
      const newFontSize = currentFontSize * scaleFactor;
      line4a.style.fontSize = newFontSize + 'px';
      
      // Re-measure after font-size change
      void line4a.offsetWidth;
      const rect4aNew = line4a.getBoundingClientRect();
      const combinedWidth = rect4aNew.width + contrarioWidth;
      gsap.set(line3, { width: combinedWidth });
    } else {
      // Heights already match, calculate combined width
      const combinedWidth = aoRenderedWidth + contrarioWidth;
      gsap.set(line3, { width: combinedWidth });
    }
    
    // Restore original display states
    line4a.style.display = originalDisplay.line4a || '';
    line4b.style.display = originalDisplay.line4b || '';
    line3.style.display = originalDisplay.line3 || '';
  };

  // Wait for fonts to load before calculating widths
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      setTimeout(calculateWidths, 100);
    });
  } else {
    setTimeout(calculateWidths, 500);
  }

  // Also recalculate on window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(calculateWidths, 250);
  });

  // Calculate widths once more right before animation starts
  // This ensures measurements are accurate even if fonts loaded slowly
  setTimeout(() => {
    calculateWidths();
  }, 200);

  // Animation timeline (total duration: ~3.5 seconds)
  const tl = gsap.timeline({
    onComplete: () => {
      // Hide intro container after fade completes
      setTimeout(() => {
        introContainer.classList.add('hidden');
        introContainer.style.display = 'none';
        
        // Initialize masonry after intro completes (Packery is bundled in home.html)
        if (typeof initMasonry === 'function') {
          initMasonry();
        }
      }, 100);
    }
  });

  // Word-by-word reveal - faster timing to dictate reading
  // 0.0-0.2s: "O PODER" appears
  tl.to(line1, {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: 0.15,
    ease: 'power3.out'
  })
  // 0.2-0.4s: "DE VER O" appears
  .to(line2, {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: 0.15,
    ease: 'power3.out'
  }, 0.2)
  // 0.4-0.7s: "MUNDO" appears
  .to(line3, {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: 0.2,
    ease: 'power3.out'
  }, 0.4)
  // 0.7s: "AO" and "CONTRÁRIO" appear together
  .to([line4a, line4b], {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: 0.2,
    ease: 'power3.out'
  }, 0.7)
  // 1.0-1.2s: Blink 2 times
  .to(line4b, {
    opacity: 0,
    duration: 0.06,
    ease: 'power2.inOut'
  }, 1.0)
  .to(line4b, {
    opacity: 1,
    duration: 0.06,
    ease: 'power2.inOut'
  }, 1.12)
  .to(line4b, {
    opacity: 0,
    duration: 0.06,
    ease: 'power2.inOut'
  }, 1.18)
  .to(line4b, {
    opacity: 1,
    duration: 0.06,
    ease: 'power2.inOut'
  }, 1.24)
  // 1.3-1.5s: Convert to outline
  .to(line4b, {
    duration: 0.15,
    ease: 'power2.inOut',
    onStart: () => {
      line4b.classList.add('intro-line-4b-outline');
    }
  }, 1.3)
  // 1.5-2.5s: Letter-by-letter flip (10 letters, ~0.1s per letter)
  // Use rotationX for vertical flip (upside down)
  .to(letters, {
    rotationX: 180,
    duration: 0.14,
    ease: 'power2.inOut',
    stagger: 0.1
  }, 1.5)
  // 2.5-2.7s: Return to normal (filled white, right-side up)
  .to(line4b, {
    duration: 0.25,
    ease: 'power2.inOut',
    onStart: () => {
      line4b.classList.remove('intro-line-4b-outline');
    }
  }, 2.5)
  .to(letters, {
    rotationX: 0,
    duration: 0.15,
    ease: 'power2.inOut',
    stagger: 0.015
  }, 2.5)
  // 2.7-3.5s: Fade out all words + fade in projects grid simultaneously (blended)
  .to([line1, line2, line3, line4a, line4b], {
    opacity: 0,
    y: -30,
    scale: 0.95,
    duration: 0.8,
    ease: 'power2.in',
    stagger: 0.03
  }, 2.7)
  .to(introContainer, {
    backgroundColor: 'transparent',
    duration: 0.8,
    ease: 'power2.in'
  }, 2.7)
  // Fade in projects grid at the same time as word fadeout for smooth blend
  .to(projectsGrid, {
    opacity: 1,
    duration: 0.8,
    ease: 'power2.out',
    onStart: () => {
      if (projectsGrid) {
        projectsGrid.classList.add('visible');
      }
      if (masonryContainer) {
        masonryContainer.classList.add('grid-enabled');
      }
    }
  }, 2.7);
});
