// Home masonry — free 2D layout driven by (data-col, data-row, data-size).
// The admin CMS writes absolute grid coords; Packery is only a fallback if any
// item is rendered without coords (e.g. fresh data before the first publish).
let resizeTimeout = null;
let homeEntranceAnimationDone = false;
let packeryInstance = null;

const BASE_ITEM = 200;
const GUTTER = 4;
const MIN_COL = 150;

function calculateColumnWidth(container) {
  const containerWidth = container.offsetWidth;
  const columns = Math.max(
    1,
    Math.floor((containerWidth + GUTTER) / (BASE_ITEM + GUTTER)),
  );
  const rawCol = Math.floor((containerWidth - GUTTER * (columns - 1)) / columns);
  const columnWidth = Math.max(MIN_COL, rawCol);
  return { columnWidth, rowHeight: columnWidth, columns };
}

function parseSize(item) {
  const [w, h] = (item.getAttribute('data-size') || '1x1').split('x').map(Number);
  return { w: w || 1, h: h || 1 };
}

function parseCoords(item) {
  const c = item.getAttribute('data-col');
  const r = item.getAttribute('data-row');
  if (c === null || r === null) return null;
  const col = parseInt(c, 10);
  const row = parseInt(r, 10);
  if (Number.isNaN(col) || Number.isNaN(row)) return null;
  return { col, row };
}

function allItemsHaveCoords(items) {
  for (const it of items) {
    if (!parseCoords(it)) return false;
  }
  return true;
}

function sizeItem(item, columnWidth, rowHeight) {
  const { w, h } = parseSize(item);
  item.style.width = w * columnWidth + (w - 1) * GUTTER + 'px';
  item.style.height = h * rowHeight + (h - 1) * GUTTER + 'px';
}

function positionItem(item, columnWidth, rowHeight) {
  const { col, row } = parseCoords(item) || { col: 0, row: 0 };
  item.style.position = 'absolute';
  item.style.left = col * (columnWidth + GUTTER) + 'px';
  item.style.top = row * (rowHeight + GUTTER) + 'px';
}

function applyFreeLayout(grid, columnWidth, rowHeight) {
  const items = Array.from(grid.querySelectorAll('.project-item'));
  let maxBottom = 0;
  items.forEach((item) => {
    sizeItem(item, columnWidth, rowHeight);
    positionItem(item, columnWidth, rowHeight);
    const { row } = parseCoords(item) || { row: 0 };
    const { h } = parseSize(item);
    maxBottom = Math.max(maxBottom, (row + h) * (rowHeight + GUTTER) - GUTTER);
  });
  grid.style.position = 'relative';
  grid.style.minHeight = maxBottom + 'px';
}

function runEntranceAnimation(grid) {
  if (homeEntranceAnimationDone) return;
  homeEntranceAnimationDone = true;

  const items = Array.from(grid.querySelectorAll('.project-item'));
  items.sort((a, b) => {
    const orderA = parseInt(a.getAttribute('data-order'), 10) || 999;
    const orderB = parseInt(b.getAttribute('data-order'), 10) || 999;
    return orderA - orderB;
  });

  if (typeof gsap !== 'undefined') {
    gsap.set(items, { opacity: 0 });
    gsap.to(items, {
      opacity: 1,
      duration: 0.35,
      stagger: 0.035,
      ease: 'power2.out',
    });
  } else {
    items.forEach((item, index) => {
      setTimeout(() => { item.style.opacity = '1'; }, index * 40);
    });
  }
}

function initPackeryFallback(grid, columnWidth, rowHeight) {
  if (typeof Packery === 'undefined') {
    loadPackery(() => initPackeryFallback(grid, columnWidth, rowHeight));
    return;
  }
  if (packeryInstance) {
    packeryInstance.destroy();
    packeryInstance = null;
  }
  Array.from(grid.querySelectorAll('.project-item')).forEach((item) =>
    sizeItem(item, columnWidth, rowHeight),
  );
  packeryInstance = new Packery(grid, {
    itemSelector: '.project-item',
    gutter: GUTTER,
    columnWidth,
    rowHeight,
    percentPosition: false,
  });
  packeryInstance.on('layoutComplete', () => runEntranceAnimation(grid));
  packeryInstance.layout();
}

function initMasonry() {
  const container = document.getElementById('masonry-container');
  if (!container) return;

  const runInit = () => {
    const grid = container.querySelector('.projects-grid');
    if (!grid) return;

    const { columnWidth, rowHeight } = calculateColumnWidth(container);
    const items = Array.from(grid.querySelectorAll('.project-item'));

    if (items.length && allItemsHaveCoords(items)) {
      if (packeryInstance) { packeryInstance.destroy(); packeryInstance = null; }
      applyFreeLayout(grid, columnWidth, rowHeight);
      runEntranceAnimation(grid);
    } else {
      initPackeryFallback(grid, columnWidth, rowHeight);
    }

    window.removeEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize);
  };

  requestAnimationFrame(runInit);
}

function handleResize() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const container = document.getElementById('masonry-container');
    if (!container) return;
    const grid = container.querySelector('.projects-grid');
    if (!grid) return;

    const { columnWidth, rowHeight } = calculateColumnWidth(container);
    const items = Array.from(grid.querySelectorAll('.project-item'));

    if (items.length && allItemsHaveCoords(items)) {
      applyFreeLayout(grid, columnWidth, rowHeight);
    } else if (packeryInstance) {
      packeryInstance.options.columnWidth = columnWidth;
      packeryInstance.options.rowHeight = rowHeight;
      items.forEach((item) => sizeItem(item, columnWidth, rowHeight));
      packeryInstance.layout();
    }
  }, 250);
}

function loadPackery(cb) {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/packery@2.1.2/dist/packery.pkgd.min.js';
  script.onload = () => cb && cb();
  script.onerror = () => console.error('Failed to load Packery');
  document.head.appendChild(script);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Intro animation decides when to call initMasonry().
  });
}
