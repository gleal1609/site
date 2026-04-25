// Home — 5 colunas com empilhamento vertical (sem buracos) + carga progressiva.
// Cada coluna: flex column; `data-home-col` (índice 0–4) + `data-order` (D1: home_col 1–5 + order).
let resizeTimeout = null;
let homeEntranceAnimationDone = false;

const GUTTER = 14;
const HOME_GRID_COLUMNS = 5;
const INITIAL_VISIBLE = 12;
const LOAD_STEP = 8;

const HIDDEN = 'is-pack-hidden';

const state = {
  filter: '__all__',
  visibleLimit: INITIAL_VISIBLE,
  columns: HOME_GRID_COLUMNS,
};

let gridEl = null;
let allItems = [];
let stabilizeTimerA = null;
let stabilizeTimerB = null;

function clearStabilizeTimers() {
  if (stabilizeTimerA) clearTimeout(stabilizeTimerA);
  if (stabilizeTimerB) clearTimeout(stabilizeTimerB);
  stabilizeTimerA = null;
  stabilizeTimerB = null;
}

function stabilizeLayoutAfterInit() {
  clearStabilizeTimers();
  stabilizeTimerA = setTimeout(() => {
    relayoutKeepingState();
  }, 220);
  stabilizeTimerB = setTimeout(() => {
    relayoutKeepingState();
  }, 620);
}

function getContainerWidth(container) {
  const rect = container.getBoundingClientRect();
  return Math.max(
    rect.width || 0,
    container.clientWidth || 0,
  );
}

/**
 * Largura da faixa de 5 colunas (mín. entre grelha e contentor com padding).
 */
function getGridTrackWidth(sizingEl) {
  if (!sizingEl) return 0;
  const wGrid = getContainerWidth(sizingEl);
  const parent = sizingEl.parentElement;
  if (parent && (parent.id === 'masonry-container' || parent.classList?.contains('masonry-container'))) {
    const st = getComputedStyle(parent);
    const pl = parseFloat(st.paddingLeft) || 0;
    const pr = parseFloat(st.paddingRight) || 0;
    const wInner = parent.getBoundingClientRect().width - pl - pr;
    return Math.max(0, Math.min(wGrid, wInner));
  }
  return wGrid;
}

function calculateColumnWidth(sizingEl) {
  const W = getGridTrackWidth(sizingEl);
  const col = (W - 4 * GUTTER) / HOME_GRID_COLUMNS;
  const columnWidth = Math.max(1, Math.floor(col * 1000) / 1000);
  return { columnWidth, rowHeight: columnWidth, columns: HOME_GRID_COLUMNS };
}

/**
 * Largura×altura (células). Canónicos 1x1, 1x1.5, 1x2; legado 1x3.
 */
function parseSizeFromAttr(raw) {
  const s = String(raw || '1x1').toLowerCase().replace(/\s/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
  if (!m) return { w: 1, h: 1 };
  let w = parseFloat(m[1]);
  let h = parseFloat(m[2]);
  if (!Number.isFinite(w) || w <= 0) w = 1;
  if (!Number.isFinite(h) || h <= 0) h = 1;
  if (w === 2 && h === 1) { w = 1; h = 1; }
  if (w === 2 && h === 2) { w = 1; h = 2; }
  w = 1;
  if (h === 3) h = 1.5;
  const allowed = [1, 1.5, 2];
  if (!allowed.includes(h)) {
    if (h < 1.25) h = 1;
    else if (h < 1.75) h = 1.5;
    else h = 2;
  }
  return { w, h };
}

function parseSize(item) {
  return parseSizeFromAttr(item.getAttribute('data-size') || '1x1');
}

function getOrderValue(item) {
  const o = item.getAttribute('data-order');
  if (o == null || o === '') return 999999;
  const n = parseInt(String(o), 10);
  return Number.isFinite(n) ? n : 999999;
}

function sizeItem(item, columnWidth, rowHeight, columns) {
  const { w, h } = parseSize(item);
  const cw = w > columns ? columns : w;
  item.style.width = `${cw * columnWidth + (cw - 1) * GUTTER}px`;
  item.style.maxWidth = '100%';
  item.style.height = `${h * rowHeight + (h - 1) * GUTTER}px`;
}

function getServicesFromItem(item) {
  const raw = item.getAttribute('data-services');
  if (!raw || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((s) => String(s).trim()) : [];
  } catch (e) {
    return [];
  }
}

function itemMatchesFilter(item) {
  if (state.filter === '__all__') return true;
  const list = getServicesFromItem(item);
  return list.some((s) => s === state.filter);
}

/**
 * Ordem de leitura: linha a linha (1.º de cada coluna, depois 2.º, …).
 * Igual ao "Carregar mais" e evita orifícios: cada coluna é empilhada.
 */
function getRasterOrderItems() {
  const cont = document.getElementById('masonry-container');
  if (!cont) return [];
  const cols = Array.from(cont.querySelectorAll('.projects-col'));
  if (cols.length < HOME_GRID_COLUMNS) {
    return Array.from(cont.querySelectorAll('.project-item'));
  }
  const buckets = cols.map((cel) => Array.from(cel.querySelectorAll('.project-item')));
  const maxH = Math.max(0, ...buckets.map((b) => b.length));
  const out = [];
  for (let r = 0; r < maxH; r += 1) {
    for (let c = 0; c < HOME_GRID_COLUMNS; c += 1) {
      if (buckets[c] && buckets[c][r]) out.push(buckets[c][r]);
    }
  }
  return out;
}

function applyVisibilityClasses() {
  const loadMoreWrap = document.getElementById('load-more-wrap');
  const raster = getRasterOrderItems().filter(itemMatchesFilter);
  const visibleSet = new Set(raster.slice(0, state.visibleLimit));
  allItems.forEach((item) => {
    if (visibleSet.has(item)) {
      item.classList.remove(HIDDEN);
    } else {
      item.classList.add(HIDDEN);
    }
  });

  if (loadMoreWrap) {
    const canMore = state.visibleLimit < raster.length;
    loadMoreWrap.hidden = !canMore;
  }
}

function updateLoadMoreVisibility() {
  const loadMoreWrap = document.getElementById('load-more-wrap');
  if (!loadMoreWrap) return;
  const raster = getRasterOrderItems().filter(itemMatchesFilter);
  const canMore = state.visibleLimit < raster.length;
  loadMoreWrap.hidden = !canMore;
}

function runEntranceAnimation() {
  if (homeEntranceAnimationDone) return;
  homeEntranceAnimationDone = true;
  const items = allItems.filter((el) => !el.classList.contains(HIDDEN));
  if (typeof gsap !== 'undefined') {
    gsap.fromTo(
      items,
      { opacity: 0 },
      { opacity: 1, duration: 0.35, stagger: 0.035, ease: 'power2.out' },
    );
  } else {
    items.forEach((item, index) => {
      setTimeout(() => {
        item.style.opacity = '1';
      }, index * 40);
    });
  }
}

function runGridInit() {
  const container = document.getElementById('masonry-container');
  if (!container) return;
  const grid = container.querySelector('.projects-grid');
  if (!grid) return;
  container.classList.add('grid-enabled');
  grid.classList.add('visible');
  gridEl = grid;
  allItems = Array.from(container.querySelectorAll('.project-item'));

  applyVisibilityClasses();
  if (allItems.length === 0) return;

  const { columnWidth, rowHeight, columns } = calculateColumnWidth(grid);
  state.columns = columns;

  allItems.forEach((item) => {
    if (!item.classList.contains(HIDDEN)) {
      sizeItem(item, columnWidth, rowHeight, columns);
    }
  });

  const visible = allItems.filter((el) => !el.classList.contains(HIDDEN));
  if (visible.length === 0) {
    container.style.minHeight = '0';
    return;
  }
  setTimeout(() => runEntranceAnimation(), 0);
}

function relayoutKeepingState() {
  const container = document.getElementById('masonry-container');
  if (!container) return;
  const grid = container.querySelector('.projects-grid');
  if (!grid) return;
  const { columnWidth, rowHeight, columns } = calculateColumnWidth(grid);
  state.columns = columns;
  allItems
    .filter((el) => !el.classList.contains(HIDDEN))
    .forEach((item) => sizeItem(item, columnWidth, rowHeight, columns));
}

function handleResize() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    relayoutKeepingState();
  }, 200);
}

function initMasonry() {
  state.visibleLimit = INITIAL_VISIBLE;
  allItems = [];
  homeEntranceAnimationDone = false;
  clearStabilizeTimers();
  const container = document.getElementById('masonry-container');
  if (!container) return;
  window.removeEventListener('resize', handleResize);
  requestAnimationFrame(() => {
    runGridInit();
    window.addEventListener('resize', handleResize);
    stabilizeLayoutAfterInit();
  });
}

function rebuildForFilter() {
  const container = document.getElementById('masonry-container');
  if (!container) return;
  if (!gridEl) {
    runGridInit();
    return;
  }
  applyVisibilityClasses();
  if (allItems.length === 0) return;
  const grid = container.querySelector('.projects-grid');
  if (!grid) return;
  const { columnWidth, rowHeight, columns } = calculateColumnWidth(grid);
  state.columns = columns;
  allItems.forEach((item) => {
    if (!item.classList.contains(HIDDEN)) {
      sizeItem(item, columnWidth, rowHeight, columns);
    }
  });
  const visible = allItems.filter((el) => !el.classList.contains(HIDDEN));
  if (visible.length === 0) {
    return;
  }
  if (typeof gsap !== 'undefined') {
    gsap.fromTo(
      visible,
      { opacity: 0 },
      { opacity: 1, duration: 0.25, stagger: 0.02, ease: 'power2.out' },
    );
  } else {
    visible.forEach((i) => {
      i.style.opacity = '1';
    });
  }
}

function setFilter(svc) {
  clearStabilizeTimers();
  state.filter = svc || '__all__';
  state.visibleLimit = INITIAL_VISIBLE;
  rebuildForFilter();
}

function loadMore() {
  clearStabilizeTimers();
  const container = document.getElementById('masonry-container');
  if (!container) return;

  state.visibleLimit += LOAD_STEP;

  if (!gridEl) {
    rebuildForFilter();
    return;
  }

  const matching = getRasterOrderItems().filter(itemMatchesFilter);
  const newlyVisible = [];
  matching.forEach((item, idx) => {
    const shouldShow = idx < state.visibleLimit;
    const wasHidden = item.classList.contains(HIDDEN);
    if (shouldShow && wasHidden) {
      item.classList.remove(HIDDEN);
      newlyVisible.push(item);
    }
  });

  updateLoadMoreVisibility();

  if (newlyVisible.length === 0) return;

  const grid = container.querySelector('.projects-grid');
  if (!grid) return;
  const { columnWidth, rowHeight, columns } = calculateColumnWidth(grid);
  state.columns = columns;

  newlyVisible.forEach((item) => {
    sizeItem(item, columnWidth, rowHeight, columns);
    item.style.opacity = '0';
  });

  if (typeof gsap !== 'undefined') {
    gsap.to(newlyVisible, {
      opacity: 1,
      duration: 0.35,
      stagger: 0.04,
      ease: 'power2.out',
    });
  } else {
    newlyVisible.forEach((item, i) => {
      setTimeout(() => {
        item.style.opacity = '1';
      }, i * 40);
    });
  }
}

window.HomeMasonry = {
  init: initMasonry,
  setFilter,
  loadMore,
};

window.initMasonry = initMasonry;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    // intro chama initMasonry
  });
}

window.addEventListener(
  'load',
  function () {
    if (document.body.classList.contains('is-home')) {
      stabilizeLayoutAfterInit();
    }
  },
  { once: true },
);
