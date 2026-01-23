// Packery Masonry for Projects Page
let projectsPackeryInstance = null;
let projectsResizeTimeout = null;

function calculateProjectsColumnWidth(container) {
  // Get actual available width (accounting for padding)
  const containerWidth = container.offsetWidth;
  const gutter = 4;
  const baseItemWidth = 200; // Base unit for sizing
  
  // Calculate how many base columns can fit
  const columns = Math.max(1, Math.floor((containerWidth + gutter) / (baseItemWidth + gutter)));
  
  // Calculate actual columnWidth to fill container exactly
  const columnWidth = Math.floor((containerWidth - (gutter * (columns - 1))) / columns);
  
  // Ensure minimum size
  const minColumnWidth = 150;
  const finalColumnWidth = Math.max(minColumnWidth, columnWidth);
  
  return { columnWidth: finalColumnWidth, rowHeight: finalColumnWidth, columns };
}

function waitForImages(items, callback) {
  let loadedCount = 0;
  const totalImages = items.length;
  
  if (totalImages === 0) {
    callback();
    return;
  }
  
  items.forEach((item) => {
    const img = item.querySelector('.project-thumbnail');
    if (!img) {
      loadedCount++;
      if (loadedCount === totalImages) callback();
      return;
    }
    
    if (img.complete && img.naturalWidth > 0) {
      loadedCount++;
      if (loadedCount === totalImages) callback();
    } else {
      img.addEventListener('load', () => {
        loadedCount++;
        if (loadedCount === totalImages) callback();
      }, { once: true });
      img.addEventListener('error', () => {
        loadedCount++;
        if (loadedCount === totalImages) callback();
      }, { once: true });
    }
  });
  
  // Timeout after 3 seconds
  setTimeout(() => {
    if (loadedCount < totalImages) {
      callback();
    }
  }, 3000);
}

function initProjectsMasonry() {
  // Check if Packery is loaded
  if (typeof Packery === 'undefined') {
    console.warn('Packery not loaded for projects page');
    return;
  }

  const container = document.getElementById('projects-masonry-container');
  if (!container) {
    return;
  }

  // Destroy existing instance if any
  if (projectsPackeryInstance) {
    projectsPackeryInstance.destroy();
    projectsPackeryInstance = null;
  }

  // Wait for Alpine to render and images to load
  setTimeout(() => {
    const grid = document.getElementById('projects-grid');
    if (!grid) {
      return;
    }

    const items = grid.querySelectorAll('.project-item');
    if (items.length === 0) {
      return;
    }

    // Wait for images to load before initializing Packery
    waitForImages(items, () => {
      // Calculate dynamic column width
      const { columnWidth, rowHeight } = calculateProjectsColumnWidth(container);
      const gutter = 4;

      // Map home_size to Packery item sizes BEFORE initializing Packery
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

      // Initialize Packery with calculated columnWidth
      projectsPackeryInstance = new Packery(grid, {
        itemSelector: '.project-item',
        gutter: gutter,
        columnWidth: columnWidth,
        rowHeight: rowHeight,
        percentPosition: false
      });

    // Layout complete callback
    projectsPackeryInstance.on('layoutComplete', () => {
      // Animate items in with GSAP
      if (typeof gsap !== 'undefined') {
        const itemsArray = Array.from(items);
        gsap.fromTo(itemsArray, 
          { 
            opacity: 0, 
            scale: 0.8, 
            y: 20 
          },
          { 
            opacity: 1, 
            scale: 1, 
            y: 0, 
            stagger: 0.03, 
            duration: 0.5,
            ease: 'power2.out'
          }
        );
      }
    });

      // Trigger initial layout
      projectsPackeryInstance.layout();
      
      // Handle window resize - recalculate columnWidth
      window.removeEventListener('resize', handleProjectsResize);
      window.addEventListener('resize', handleProjectsResize);
    });
  }, 100);
}

function handleProjectsResize() {
  clearTimeout(projectsResizeTimeout);
  projectsResizeTimeout = setTimeout(() => {
    if (!projectsPackeryInstance) return;
    
    const container = document.getElementById('projects-masonry-container');
    if (!container) return;
    
    const grid = document.getElementById('projects-grid');
    if (!grid) return;
    
    // Recalculate column width
    const { columnWidth, rowHeight } = calculateProjectsColumnWidth(container);
    const gutter = 4;
    
    // Update Packery options
    projectsPackeryInstance.options.columnWidth = columnWidth;
    projectsPackeryInstance.options.rowHeight = rowHeight;
    
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
    projectsPackeryInstance.layout();
  }, 250);
}

// Watch for Alpine.js updates
document.addEventListener('alpine:init', () => {
  // This will be called when Alpine initializes
});

// Use MutationObserver to detect when Alpine updates the DOM
const observer = new MutationObserver(() => {
  const grid = document.getElementById('projects-grid');
  if (grid && grid.querySelectorAll('.project-item').length > 0) {
    // Debounce
    clearTimeout(window.projectsMasonryTimeout);
    window.projectsMasonryTimeout = setTimeout(() => {
      initProjectsMasonry();
    }, 200);
  }
});

// Start observing when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('projects-masonry-container');
    if (container) {
      observer.observe(container, { childList: true, subtree: true });
    }
  });
} else {
  const container = document.getElementById('projects-masonry-container');
  if (container) {
    observer.observe(container, { childList: true, subtree: true });
  }
}

// Resize handling is now in handleProjectsResize function
