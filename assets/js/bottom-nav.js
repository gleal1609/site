// Bottom Navigation GSAP Animations
document.addEventListener("DOMContentLoaded", () => {
  // Check if GSAP is loaded
  if (typeof gsap === 'undefined') {
    console.warn('GSAP not loaded, bottom nav animations will use CSS only');
    return;
  }

  // Check if mobile - labels should never appear on mobile
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    // On mobile, labels should never be visible
    const navItems = document.querySelectorAll('.bottom-nav-item');
    
    navItems.forEach((item) => {
      const label = item.querySelector('.bottom-nav-label');
      
      if (!label) return;
      
      // Ensure labels are completely hidden and never shown
      label.style.display = 'none';
      label.style.visibility = 'hidden';
      label.style.opacity = '0';
      
      // Prevent any text selection on the entire item
      item.style.webkitUserSelect = 'none';
      item.style.mozUserSelect = 'none';
      item.style.msUserSelect = 'none';
      item.style.userSelect = 'none';
      item.style.webkitTapHighlightColor = 'transparent';
      item.style.webkitTouchCallout = 'none';
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
