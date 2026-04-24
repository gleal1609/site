// Home — Packery auto-pack, filtro por serviço e carga progressiva.
let packeryInstance = null;
let resizeTimeout = null;
let homeEntranceAnimationDone = false;

const GUTTER = 4;
const MIN_COL = 150;
const BASE_ITEM = 200;
const INITIAL_VISIBLE = 12;
const LOAD_STEP = 8;

const HIDDEN = 'is-pack-hidden';

const state = {
  filter: '__all__',
  visibleLimit: INITIAL_VISIBLE,
  columns: 0,
};

let gridEl = null;
let allItems = [];
let domOrderMap = new Map();
let stabilizeTimerA = null;
let stabilizeTimerB = null;

function clearStabilizeTimers() {
  if (stabilizeTimerA) clearTimeout(stabilizeTimerA);
  if (stabilizeTimerB) clearTimeout(stabilizeTimerB);
  stabilizeTimerA = null;
  stabilizeTimerB = null;
}

function stabilizeLayoutAfterInit() {
  // Some images/videos only decode their natural sizes after the first paint.
  // Re-run the packing once they settle so the first row tiles tightly.
  clearStabilizeTimers();
  stabilizeTimerA = setTimeout(() => {
    relayoutKeepingState();
  }, 220);
  stabilizeTimerB = setTimeout(() => {
    relayoutKeepingState();
  }, 620);
}

function getContainerWidth(container) {
  // Use the actual rendered width. Avoid window.innerWidth (it includes scrollbar
  // on some browsers and overshoots the true grid area, pushing items past the edge).
  const rect = container.getBoundingClientRect();
  return Math.max(
    rect.width || 0,
    container.clientWidth || 0,
  );
}

function calculateColumnWidth(container) {
  const containerWidth = getContainerWidth(container);
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

function sizeItem(item, columnWidth, rowHeight, columns) {
  let { w, h } = parseSize(item);
  // Clamp item width to available columns so wide tiles never break the grid
  // (also guarantees the right edge is filled: a 2x? tile in a 1-col layout
  // becomes 1x?, avoiding an orphan empty column).
  if (columns && w > columns) w = columns;
  item.style.width = w * columnWidth + (w - 1) * GUTTER + 'px';
  item.style.height = h * rowHeight + (h - 1) * GUTTER + 'px';
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

function applyVisibilityClasses() {
  const matching = allItems.filter(itemMatchesFilter);
  const loadMoreWrap = document.getElementById('load-more-wrap');

  const visibleSet = new Set(matching.slice(0, state.visibleLimit));
  allItems.forEach((item) => {
    if (visibleSet.has(item)) {
      item.classList.remove(HIDDEN);
    } else {
      item.classList.add(HIDDEN);
    }
  });

  if (loadMoreWrap) {
    const canMore = state.visibleLimit < matching.length;
    loadMoreWrap.hidden = !canMore;
  }
}

function updateLoadMoreVisibility() {
  const loadMoreWrap = document.getElementById('load-more-wrap');
  if (!loadMoreWrap) return;
  const matching = allItems.filter(itemMatchesFilter);
  const canMore = state.visibleLimit < matching.length;
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

function destroyPackery() {
  if (packeryInstance) {
    try {
      packeryInstance.offAll && packeryInstance.offAll();
    } catch (_) {}
    try {
      packeryInstance.destroy();
    } catch (_) {}
    packeryInstance = null;
  }
}

// Reordena o array interno do Packery (NÃO mexe no DOM) para que os itens
// maiores sejam posicionados primeiro. Isso melhora drasticamente o
// aproveitamento de espaço — pedaços menores ficam disponíveis para preencher
// as brechas criadas pelos maiores, minimizando vãos entre os conteúdos.
// A ordem do DOM permanece cronológica (SEO, acessibilidade, foco).
function reorderPackeryItemsForPacking() {
  if (!packeryInstance || !packeryInstance.items) return;
  packeryInstance.items.sort((a, b) => {
    const sA = parseSize(a.element);
    const sB = parseSize(b.element);
    const areaA = sA.w * sA.h;
    const areaB = sB.w * sB.h;
    if (areaA !== areaB) return areaB - areaA;
    // Mesma "área": preserva ordem de DOM (mais recentes primeiro).
    const iA = domOrderMap.get(a.element);
    const iB = domOrderMap.get(b.element);
    return (iA == null ? 0 : iA) - (iB == null ? 0 : iB);
  });
}

function createPackery(grid, columnWidth, rowHeight) {
  destroyPackery();
  packeryInstance = new Packery(grid, {
    itemSelector: '.project-item:not(.' + HIDDEN + ')',
    gutter: GUTTER,
    columnWidth,
    rowHeight,
    percentPosition: false,
    initLayout: false,
    transitionDuration: '0.25s',
  });
  reorderPackeryItemsForPacking();
  packeryInstance.on('layoutComplete', () => runEntranceAnimation());
  packeryInstance.layout();
}

function runPackeryInit() {
  const container = document.getElementById('masonry-container');
  if (!container) return;
  const grid = container.querySelector('.projects-grid');
  if (!grid) return;
  container.classList.add('grid-enabled');
  grid.classList.add('visible');
  gridEl = grid;
  allItems = Array.from(grid.querySelectorAll('.project-item'));
  domOrderMap = new Map();
  allItems.forEach((el, i) => domOrderMap.set(el, i));

  applyVisibilityClasses();
  if (allItems.length === 0) return;

  if (typeof Packery === 'undefined') {
    loadPackery(() => runPackeryInit());
    return;
  }

  const { columnWidth, rowHeight, columns } = calculateColumnWidth(container);
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

  createPackery(grid, columnWidth, rowHeight);
}

// Re-layout completo preservando a instância quando possível. Usado em resize
// e como "estabilização" após cargas de mídia.
function relayoutKeepingState() {
  const container = document.getElementById('masonry-container');
  if (!container) return;
  if (!packeryInstance) {
    runPackeryInit();
    return;
  }
  const { columnWidth, rowHeight, columns } = calculateColumnWidth(container);
  state.columns = columns;
  allItems
    .filter((el) => !el.classList.contains(HIDDEN))
    .forEach((item) => sizeItem(item, columnWidth, rowHeight, columns));
  try {
    packeryInstance.options.columnWidth = columnWidth;
    packeryInstance.options.rowHeight = rowHeight;
    reorderPackeryItemsForPacking();
    packeryInstance.layout();
  } catch (_) {}
}

function handleResize() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    relayoutKeepingState();
  }, 200);
}

function loadPackery(cb) {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/packery@2.1.2/dist/packery.pkgd.min.js';
  script.onload = () => cb && cb();
  script.onerror = () => console.error('Failed to load Packery');
  document.head.appendChild(script);
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
    runPackeryInit();
    window.addEventListener('resize', handleResize);
    stabilizeLayoutAfterInit();
  });
}

// Troca de filtro: o conjunto de itens visíveis muda, então precisamos de um
// re-layout completo (mas sem flicker, já que toda a grid estava visível).
function rebuildForFilter() {
  const container = document.getElementById('masonry-container');
  if (!container) return;
  if (!gridEl) {
    runPackeryInit();
    return;
  }
  applyVisibilityClasses();
  if (allItems.length === 0) return;
  if (typeof Packery === 'undefined') {
    loadPackery(() => runPackeryInit());
    return;
  }
  const { columnWidth, rowHeight, columns } = calculateColumnWidth(container);
  state.columns = columns;
  allItems.forEach((item) => {
    if (!item.classList.contains(HIDDEN)) {
      sizeItem(item, columnWidth, rowHeight, columns);
    }
  });
  const grid = container.querySelector('.projects-grid');
  const visible = allItems.filter((el) => !el.classList.contains(HIDDEN));
  if (visible.length === 0) {
    destroyPackery();
    return;
  }

  // Destrói e recria para obter uma distribuição ótima para o novo filtro.
  destroyPackery();
  packeryInstance = new Packery(grid, {
    itemSelector: '.project-item:not(.' + HIDDEN + ')',
    gutter: GUTTER,
    columnWidth,
    rowHeight,
    percentPosition: false,
    initLayout: false,
    transitionDuration: '0.25s',
  });
  reorderPackeryItemsForPacking();
  packeryInstance.on('layoutComplete', () => {
    const items = allItems.filter((el) => !el.classList.contains(HIDDEN));
    if (typeof gsap !== 'undefined') {
      gsap.fromTo(
        items,
        { opacity: 0 },
        { opacity: 1, duration: 0.25, stagger: 0.02, ease: 'power2.out' },
      );
    } else {
      items.forEach((i) => {
        i.style.opacity = '1';
      });
    }
  });
  packeryInstance.layout();
}

function setFilter(svc) {
  clearStabilizeTimers();
  state.filter = svc || '__all__';
  state.visibleLimit = INITIAL_VISIBLE;
  rebuildForFilter();
}

// Carregar mais: adiciona somente os novos itens ao Packery existente, sem
// destruir/recriar a instância. Isso mantém todos os itens já visíveis no
// mesmo lugar (sem flicker) e deixa o bin-packer do Packery encaixar os
// novos itens nos vãos disponíveis.
function loadMore() {
  clearStabilizeTimers();
  const container = document.getElementById('masonry-container');
  if (!container) return;

  state.visibleLimit += LOAD_STEP;

  if (!packeryInstance) {
    rebuildForFilter();
    return;
  }

  const matching = allItems.filter(itemMatchesFilter);
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

  const { columnWidth, rowHeight, columns } = calculateColumnWidth(container);
  state.columns = columns;

  newlyVisible.forEach((item) => {
    sizeItem(item, columnWidth, rowHeight, columns);
    item.style.opacity = '0';
  });

  // Entrega os maiores primeiro ao Packery para que ele os encaixe antes dos
  // menores, aproveitando melhor o espaço remanescente.
  const packeryOrdered = newlyVisible.slice().sort((a, b) => {
    const sA = parseSize(a);
    const sB = parseSize(b);
    const areaA = sA.w * sA.h;
    const areaB = sB.w * sB.h;
    if (areaA !== areaB) return areaB - areaA;
    return (domOrderMap.get(a) || 0) - (domOrderMap.get(b) || 0);
  });

  // Posiciona instantaneamente os novos itens (sem slide desde 0,0). Os itens
  // já visíveis não se movem porque appended() preserva suas posições.
  const savedTransition = packeryInstance.options.transitionDuration;
  packeryInstance.options.transitionDuration = 0;
  try {
    packeryInstance.appended(packeryOrdered);
  } catch (e) {
    console.error('Packery appended failed; falling back to full rebuild', e);
    packeryInstance.options.transitionDuration = savedTransition;
    rebuildForFilter();
    return;
  }
  // Restaura a duração para futuros re-layouts (resize, filtro).
  requestAnimationFrame(() => {
    if (packeryInstance) packeryInstance.options.transitionDuration = savedTransition;
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
