// Packery Masonry Initialization
let packeryInstance = null;
let resizeTimeout = null;

function calculateColumnWidth(container) {
  // Get actual available width (accounting for padding)
  const containerWidth = container.offsetWidth;
  const gutter = 4;
  const baseItemWidth = 200; // Base unit for sizing
  
  // Calculate how many base columns can fit
  // Formula: (containerWidth + gutter) / (baseItemWidth + gutter)
  const columns = Math.max(1, Math.floor((containerWidth + gutter) / (baseItemWidth + gutter)));
  
  // Calculate actual columnWidth to fill container exactly
  // Formula: (containerWidth - (gutter * (columns - 1))) / columns
  const columnWidth = Math.floor((containerWidth - (gutter * (columns - 1))) / columns);
  
  // Ensure minimum size
  const minColumnWidth = 150;
  const finalColumnWidth = Math.max(minColumnWidth, columnWidth);
  
  return { columnWidth: finalColumnWidth, rowHeight: finalColumnWidth, columns };
}

function initMasonry() {
  // Check if Packery is loaded
  if (typeof Packery === 'undefined') {
    console.warn('Packery not loaded, loading from CDN...');
    loadPackery();
    return;
  }

  const container = document.getElementById('masonry-container');
  if (!container) {
    console.warn('Masonry container not found');
    return;
  }

  // Destroy existing instance if any
  if (packeryInstance) {
    packeryInstance.destroy();
    packeryInstance = null;
  }

  // Wait a bit for DOM to be ready
  setTimeout(() => {
    const grid = container.querySelector('.projects-grid');
    if (!grid) {
      console.warn('Projects grid not found');
      return;
    }

    // Calculate dynamic column width
    const { columnWidth, rowHeight } = calculateColumnWidth(container);
    const gutter = 4;

    // Map home_size to Packery item sizes BEFORE initializing Packery
    const items = grid.querySelectorAll('.project-item');
    items.forEach((item) => {
      const size = item.getAttribute('data-size') || '1x1';
      const [width, height] = size.split('x').map(Number);
      
      // Set item size based on home_size
      if (width === 2 && height === 2) {
        // 2x2: Large square
        item.style.width = (columnWidth * 2 + gutter) + 'px';
        item.style.height = (rowHeight * 2) + 'px';
      } else if (width === 2 && height === 1) {
        // 2x1: Wide
        item.style.width = (columnWidth * 2 + gutter) + 'px';
        item.style.height = rowHeight + 'px';
      } else if (width === 1 && height === 2) {
        // 1x2: Tall
        item.style.width = columnWidth + 'px';
        item.style.height = (rowHeight * 2) + 'px';
      } else {
        // 1x1: Default
        item.style.width = columnWidth + 'px';
        item.style.height = rowHeight + 'px';
      }
    });

    // Initialize Packery with calculated columnWidth
    packeryInstance = new Packery(grid, {
      itemSelector: '.project-item',
      gutter: gutter,
      columnWidth: columnWidth,
      rowHeight: rowHeight,
      percentPosition: false
    });

    // Layout complete callback
    packeryInstance.on('layoutComplete', () => {
      // Animate items in with GSAP
      if (typeof gsap !== 'undefined') {
        const items = Array.from(grid.querySelectorAll('.project-item'));
        // Sort by data-home-order to animate in order
        items.sort((a, b) => {
          const orderA = parseInt(a.getAttribute('data-home-order')) || 999;
          const orderB = parseInt(b.getAttribute('data-home-order')) || 999;
          return orderA - orderB;
        });
        
        gsap.fromTo(items, 
          { 
            opacity: 0, 
            scale: 1, 
            y: 0 
          },
          { 
            opacity: 1, 
            scale: 1, 
            y: 0, 
            stagger: 0.05, 
            duration: 0.6,
            staggerEase: 'power2.out'
          }
        );
      } else {
        // Fallback: just show items
        const items = grid.querySelectorAll('.project-item');
        items.forEach((item, index) => {
          setTimeout(() => {
            item.style.opacity = '1';
          }, index * 50);
        });
      }
    });

    // Trigger initial layout
    packeryInstance.layout();

    // Handle window resize - recalculate columnWidth
    window.removeEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize);
  }, 100);
}

function handleResize() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (!packeryInstance) return;
    
    const container = document.getElementById('masonry-container');
    if (!container) return;
    
    const grid = container.querySelector('.projects-grid');
    if (!grid) return;
    
    // Recalculate column width
    const { columnWidth, rowHeight } = calculateColumnWidth(container);
    const gutter = 4;
    
    // Update Packery options
    packeryInstance.options.columnWidth = columnWidth;
    packeryInstance.options.rowHeight = rowHeight;
    
    // Update all item sizes
    const items = grid.querySelectorAll('.project-item');
    items.forEach((item) => {
      const size = item.getAttribute('data-size') || '1x1';
      const [width, height] = size.split('x').map(Number);
      
      if (width === 2 && height === 2) {
        item.style.width = (columnWidth * 2 + gutter) + 'px';
        item.style.height = (rowHeight * 2) + 'px';
      } else if (width === 2 && height === 1) {
        item.style.width = (columnWidth * 2 + gutter) + 'px';
        item.style.height = rowHeight + 'px';
      } else if (width === 1 && height === 2) {
        item.style.width = columnWidth + 'px';
        item.style.height = (rowHeight * 2) + 'px';
      } else {
        item.style.width = columnWidth + 'px';
        item.style.height = rowHeight + 'px';
      }
    });
    
    // Relayout
    packeryInstance.layout();
  }, 250);
}

function loadPackery() {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/packery@2/dist/packery.pkgd.min.js';
  script.onload = () => {
    console.log('Packery loaded, initializing...');
    initMasonry();
  };
  script.onerror = () => {
    console.error('Failed to load Packery');
  };
  document.head.appendChild(script);
}

// Auto-initialize if DOM is ready, otherwise wait
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Don't auto-init, wait for intro animation to complete
  });
} else {
  // DOM already ready, but wait for intro animation
}
