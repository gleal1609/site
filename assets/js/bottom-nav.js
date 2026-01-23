// Bottom Navigation GSAP Animations
document.addEventListener("DOMContentLoaded", () => {
  // Check if GSAP is loaded
  if (typeof gsap === 'undefined') {
    console.warn('GSAP not loaded, bottom nav animations will use CSS only');
    return;
  }

  // Check if mobile - handle tap-to-reveal labels on mobile
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    // On mobile, labels are hidden by default and appear briefly on tap
    const navItems = document.querySelectorAll('.bottom-nav-item');
    const labelFadeDelay = 1500; // Show label for 1.5 seconds
    
    navItems.forEach((item) => {
      const label = item.querySelector('.bottom-nav-label');
      let fadeTimeout = null;
      
      if (!label) return;
      
      // Ensure labels are hidden initially
      label.style.opacity = '0';
      
      // Handle tap/click to show label temporarily
      item.addEventListener('click', (e) => {
        // Clear any existing timeout
        if (fadeTimeout) {
          clearTimeout(fadeTimeout);
        }
        
        // Remove active class from all items
        navItems.forEach(navItem => navItem.classList.remove('active'));
        
        // Add active class to clicked item
        item.classList.add('active');
        
        // Show label
        if (typeof gsap !== 'undefined') {
          gsap.to(label, {
            opacity: 1,
            duration: 0.2,
            ease: 'power2.out'
          });
        } else {
          label.style.opacity = '1';
        }
        
        // Fade out after delay
        fadeTimeout = setTimeout(() => {
          if (typeof gsap !== 'undefined') {
            gsap.to(label, {
              opacity: 0,
              duration: 0.3,
              ease: 'power2.in',
              onComplete: () => {
                item.classList.remove('active');
              }
            });
          } else {
            label.style.opacity = '0';
            item.classList.remove('active');
          }
        }, labelFadeDelay);
      });
    });
    
    return;
  }

  const navItems = document.querySelectorAll('.bottom-nav-item');
  
  navItems.forEach((item) => {
    const label = item.querySelector('.bottom-nav-label');
    const icon = item.querySelector('.bottom-nav-icon');
    
    if (!label) return;
    
    // Set initial state (labels are above icons now)
    // Only on desktop where labels should be hidden initially
    gsap.set(label, { opacity: 0, y: 10 });
    
    // Hover in animation
    item.addEventListener('mouseenter', () => {
      gsap.to(label, {
        opacity: 1,
        y: 0,
        duration: 0.3,
        ease: 'power2.out'
      });
      
      if (icon) {
        gsap.to(icon, {
          scale: 1.1,
          duration: 0.3,
          ease: 'power2.out'
        });
      }
    });
    
    // Hover out animation
    item.addEventListener('mouseleave', () => {
      gsap.to(label, {
        opacity: 0,
        y: 10,
        duration: 0.3,
        ease: 'power2.in'
      });
      
      if (icon) {
        gsap.to(icon, {
          scale: 1,
          duration: 0.3,
          ease: 'power2.in'
        });
      }
    });
  });
});
