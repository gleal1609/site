// Homepage Intro Text Animation
document.addEventListener("DOMContentLoaded", () => {
  // Check if GSAP is loaded
  if (typeof gsap === 'undefined') {
    console.error('GSAP not loaded, intro animation cannot run');
    return;
  }

  const introContainer = document.getElementById('intro-text');
  const introText = introContainer?.querySelector('.intro-text');
  const introLines = introText?.querySelectorAll('.intro-line');
  const projectsGrid = document.querySelector('.projects-grid');
  const masonryContainer = document.getElementById('masonry-container');

  if (!introContainer || !introText || !introLines || introLines.length === 0) {
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

  // Set initial state for all lines
  gsap.set(introLines, { 
    opacity: 0, 
    y: 50,
    scale: 0.9
  });
  
  // Set initial state for container
  gsap.set(introText, { opacity: 1 });
  
  // Animation timeline
  const tl = gsap.timeline({
    onComplete: () => {
      // Hide intro container
      gsap.to(introContainer, {
        opacity: 0,
        duration: 0.5,
        ease: 'power2.in',
        onComplete: () => {
          introContainer.classList.add('hidden');
          introContainer.style.display = 'none';
          
          // Show projects grid and enable pointer events
          if (projectsGrid) {
            projectsGrid.classList.add('visible');
          }
          
          // Enable pointer events on masonry container
          if (masonryContainer) {
            masonryContainer.classList.add('grid-enabled');
          }
          
          // Initialize masonry after intro completes
          // Load Packery if not already loaded
          if (typeof Packery === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/packery@2/dist/packery.pkgd.min.js';
            script.onload = () => {
              if (typeof initMasonry === 'function') {
                initMasonry();
              }
            };
            document.head.appendChild(script);
          } else {
            if (typeof initMasonry === 'function') {
              initMasonry();
            } else {
              // Wait for masonry script to load
              const checkMasonry = setInterval(() => {
                if (typeof initMasonry === 'function') {
                  clearInterval(checkMasonry);
                  initMasonry();
                }
              }, 100);
              
              // Timeout after 5 seconds
              setTimeout(() => {
                clearInterval(checkMasonry);
              }, 5000);
            }
          }
        }
      });
    }
  });

  // Animate each line with stagger
  tl.to(introLines, {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: 1.2,
    ease: 'power3.out',
    stagger: 0.15
  })
  // Hold for 2.5 seconds
  .to({}, { duration: 2.5 })
  // Fade out all lines
  .to(introLines, {
    opacity: 0,
    y: -30,
    scale: 0.95,
    duration: 0.8,
    ease: 'power2.in',
    stagger: 0.1
  });
});
