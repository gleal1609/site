// Bottom Navigation GSAP Animations
document.addEventListener("DOMContentLoaded", () => {
  // Check if GSAP is loaded
  if (typeof gsap === 'undefined') {
    console.warn('GSAP not loaded, bottom nav animations will use CSS only');
    return;
  }

  const navItems = document.querySelectorAll('.bottom-nav-item');
  
  navItems.forEach((item) => {
    const label = item.querySelector('.bottom-nav-label');
    const icon = item.querySelector('.bottom-nav-icon');
    
    if (!label) return;
    
    // Set initial state (labels are above icons now)
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
  
  // Mobile: Tap to reveal (if labels are hidden on mobile)
  if (window.innerWidth <= 768) {
    // Labels are always visible on mobile, so no special handling needed
    return;
  }
});
