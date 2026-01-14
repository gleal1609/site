/**
 * Home Variant C: Video hover functionality
 */
document.addEventListener('DOMContentLoaded', () => {
  const projectItems = document.querySelectorAll('.home-project-item-c');
  
  projectItems.forEach((item) => {
    const video = item.querySelector('.home-project-hover-video');
    const thumbnail = item.querySelector('.home-project-thumbnail img');
    
    if (!video) return;
    
    let isPlaying = false;
    let isLoaded = false;
    
    const loadVideo = () => {
      if (isLoaded) return;
      video.load();
      isLoaded = true;
    };
    
    const playVideo = () => {
      if (!isLoaded) {
        loadVideo();
        video.addEventListener('canplay', () => {
          video.play().catch(err => console.error('Video play error:', err));
        }, { once: true });
      } else {
        video.play().catch(err => console.error('Video play error:', err));
      }
      isPlaying = true;
    };
    
    const pauseVideo = () => {
      video.pause();
      video.currentTime = 0;
      isPlaying = false;
    };
    
    // Preload when item comes into view
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          loadVideo();
          observer.unobserve(item);
        }
      });
    }, { rootMargin: '200px' });
    
    observer.observe(item);
    
    // Hover handlers
    item.addEventListener('mouseenter', playVideo);
    item.addEventListener('mouseleave', pauseVideo);
    
    // Touch handlers for mobile
    item.addEventListener('touchstart', () => {
      if (!isPlaying) {
        playVideo();
      } else {
        pauseVideo();
      }
    }, { passive: true });
  });
});