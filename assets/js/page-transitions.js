/**
 * Page Transition System with GSAP
 * Handles smooth fade-in/fade-out animations between pages
 * Keeps bottom nav visible during transitions
 * Prevents flicker by hiding content immediately
 */

(function() {
  'use strict';

  // Main content wrapper selector - exclude bottom nav and meta tags
  const CONTENT_SELECTOR = 'body > *:not(.bottom-nav):not(script):not(link):not(style):not(meta):not(.intro-text-container)';
  const BOTTOM_NAV_SELECTOR = '.bottom-nav';
  
  // Transition duration
  const TRANSITION_DURATION = 0.5;
  
  // Track if transition is in progress
  let isTransitioning = false;

  // Hide content immediately to prevent flicker (runs synchronously)
  function hideContentImmediately() {
    const contentElements = Array.from(document.querySelectorAll(CONTENT_SELECTOR));
    contentElements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('transform', 'translateY(20px) scale(0.98)', 'important');
        el.style.setProperty('will-change', 'opacity, transform', 'important');
      }
    });
  }

  // Ensure bottom nav is always visible
  function ensureBottomNavVisible() {
    const bottomNav = document.querySelector(BOTTOM_NAV_SELECTOR);
    if (bottomNav) {
      bottomNav.style.setProperty('opacity', '1', 'important');
      bottomNav.style.setProperty('visibility', 'visible', 'important');
      bottomNav.style.setProperty('z-index', '2000', 'important');
      bottomNav.style.setProperty('pointer-events', 'auto', 'important');
    }
  }

  /**
   * Fade out current page content with GSAP
   */
  function fadeOut() {
    return new Promise((resolve) => {
      const contentElements = Array.from(document.querySelectorAll(CONTENT_SELECTOR)).filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
      });

      if (contentElements.length === 0) {
        resolve();
        return;
      }

      if (typeof gsap !== 'undefined') {
        // Use GSAP timeline for smooth animation
        const tl = gsap.timeline({
          onComplete: resolve
        });

        // Fade out with slight scale and y movement for fluid effect
        tl.to(contentElements, {
          opacity: 0,
          y: -20,
          scale: 0.98,
          duration: TRANSITION_DURATION / 2,
          ease: 'power2.in',
          stagger: 0.02
        });
      } else {
        // Fallback to CSS transitions
        contentElements.forEach(el => {
          el.style.transition = `opacity ${TRANSITION_DURATION / 2}s ease-out, transform ${TRANSITION_DURATION / 2}s ease-out, visibility ${TRANSITION_DURATION / 2}s ease-out`;
          el.style.opacity = '0';
          el.style.visibility = 'hidden';
          el.style.transform = 'translateY(-20px) scale(0.98)';
        });
        setTimeout(resolve, (TRANSITION_DURATION / 2) * 1000);
      }
    });
  }

  /**
   * Fade in new page content with GSAP
   */
  function fadeIn() {
    return new Promise((resolve) => {
      const contentElements = Array.from(document.querySelectorAll(CONTENT_SELECTOR)).filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && el.offsetHeight > 0;
      });

      if (contentElements.length === 0) {
        resolve();
        return;
      }

      // Ensure initial state is set (remove important flags for animation)
      contentElements.forEach(el => {
        el.style.removeProperty('opacity');
        el.style.removeProperty('visibility');
        el.style.removeProperty('transform');
        el.style.opacity = '0';
        el.style.visibility = 'visible';
        el.style.transform = 'translateY(20px) scale(0.98)';
        el.style.willChange = 'opacity, transform';
      });

      // Mark body as loaded to allow CSS transitions
      document.body.classList.add('page-loaded');

      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (typeof gsap !== 'undefined') {
            // Use GSAP timeline for smooth animation
            const tl = gsap.timeline({
              onComplete: () => {
                contentElements.forEach(el => {
                  el.style.willChange = 'auto';
                });
                resolve();
              }
            });

            // Fade in with slight scale and y movement for fluid effect
            tl.fromTo(contentElements, 
              {
                opacity: 0,
                y: 20,
                scale: 0.98
              },
              {
                opacity: 1,
                y: 0,
                scale: 1,
                duration: TRANSITION_DURATION / 2,
                ease: 'power2.out',
                stagger: 0.03
              }
            );
          } else {
            // Fallback to CSS transitions
            contentElements.forEach(el => {
              el.style.transition = `opacity ${TRANSITION_DURATION / 2}s ease-in, transform ${TRANSITION_DURATION / 2}s ease-in`;
              el.style.opacity = '1';
              el.style.transform = 'translateY(0) scale(1)';
            });
            setTimeout(() => {
              contentElements.forEach(el => {
                el.style.willChange = 'auto';
              });
              resolve();
            }, (TRANSITION_DURATION / 2) * 1000);
          }
        });
      });
    });
  }

  /**
   * Handle link clicks
   */
  function handleLinkClick(e) {
    const link = e.target.closest('a');
    if (!link) return;

    // Skip if:
    // - External links
    // - Links with target="_blank"
    // - Links with download attribute
    // - Links with hash only (same page anchors)
    // - Mailto/tel links
    if (
      link.target === '_blank' ||
      link.hasAttribute('download') ||
      link.href.startsWith('mailto:') ||
      link.href.startsWith('tel:') ||
      link.href.startsWith('javascript:')
    ) {
      return;
    }

    // Check if it's an internal link
    try {
      const url = new URL(link.href, window.location.origin);
      if (url.origin !== window.location.origin) {
        return; // External link
      }

      // Check if it's a hash-only link (same page anchor)
      if (url.pathname === window.location.pathname && 
          url.search === window.location.search && 
          url.hash && url.hash.length > 1) {
        return; // Same page anchor link
      }
    } catch (e) {
      // Invalid URL, skip
      return;
    }

    // Don't start new transition if one is already in progress
    if (isTransitioning) {
      e.preventDefault();
      return;
    }

    isTransitioning = true;
    e.preventDefault();

    // Fade out before navigation
    fadeOut()
      .then(() => {
        // Navigate to new page
        window.location.href = link.href;
      })
      .catch(err => {
        console.error('Transition error:', err);
        isTransitioning = false;
        // Fallback to normal navigation
        window.location.href = link.href;
      });
  }

  /**
   * Initialize page transitions
   */
  function init() {
    // Hide content immediately to prevent flicker
    hideContentImmediately();
    
    // Ensure bottom nav is always visible
    ensureBottomNavVisible();

    // Fade in on page load
    const doFadeIn = () => {
      // Wait for GSAP if needed, but don't delay too long
      if (typeof gsap === 'undefined') {
        // Check if GSAP is loading
        let attempts = 0;
        const maxAttempts = 30; // 1.5 seconds max wait
        const checkGSAP = setInterval(() => {
          attempts++;
          if (typeof gsap !== 'undefined') {
            clearInterval(checkGSAP);
            fadeIn().then(() => {
              isTransitioning = false;
            });
          } else if (attempts >= maxAttempts) {
            clearInterval(checkGSAP);
            // Proceed without GSAP
            fadeIn().then(() => {
              isTransitioning = false;
            });
          }
        }, 50);
      } else {
        fadeIn().then(() => {
          isTransitioning = false;
        });
      }
    };

    // Start fade in as soon as possible
    if (document.readyState === 'complete') {
      // Page already loaded
      setTimeout(doFadeIn, 50);
    } else if (document.readyState === 'interactive') {
      // DOM ready but resources still loading
      setTimeout(doFadeIn, 100);
    } else {
      // Wait for DOM
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(doFadeIn, 100);
      });
      // Also try on load event
      window.addEventListener('load', () => {
        setTimeout(doFadeIn, 50);
      });
    }

    // Listen for link clicks (use capture phase to catch early)
    document.addEventListener('click', handleLinkClick, true);
  }

  // Hide content immediately (before DOM is ready) - runs synchronously
  hideContentImmediately();
  ensureBottomNavVisible();

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
