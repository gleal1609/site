// Bottom Navigation GSAP Animations — desktop only
document.addEventListener("DOMContentLoaded", () => {
  if (typeof gsap === 'undefined' || window.innerWidth <= 768) return;

  document.querySelectorAll('.bottom-nav-item').forEach((item) => {
    const label = item.querySelector('.bottom-nav-label');
    const icon = item.querySelector('.bottom-nav-icon');
    if (!label) return;

    gsap.set(label, { opacity: 0, y: 10 });

    item.addEventListener('mouseenter', () => {
      gsap.to(label, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
      if (icon) gsap.to(icon, { scale: 1.1, duration: 0.3, ease: 'power2.out' });
    });

    item.addEventListener('mouseleave', () => {
      gsap.to(label, { opacity: 0, y: 10, duration: 0.3, ease: 'power2.in' });
      if (icon) gsap.to(icon, { scale: 1, duration: 0.3, ease: 'power2.in' });
    });
  });
});
