/**
 * Home — 5 colunas com empilhamento vertical + redistribuição dinâmica ao filtrar.
 *
 * Modo "__all__" (sem filtro): itens nas colunas originais definidas por home_col/order.
 * Modo filtrado: itens que casam são redistribuídos com greedy shortest-column-first
 *   (ordenados por data desc) para eliminar buracos e garantir boa ocupação visual.
 */
var resizeTimeout = null;
var homeEntranceAnimationDone = false;

var GUTTER = 14;
var HOME_GRID_COLUMNS = 5;
var INITIAL_VISIBLE = 25;
var LOAD_STEP = 8;
var HIDDEN = 'is-pack-hidden';

var state = {
  filter: '__all__',
  visibleLimit: INITIAL_VISIBLE,
  columns: HOME_GRID_COLUMNS,
};

var gridEl = null;
var allItems = [];
var originalColumnItems = [];
var stabilizeTimerA = null;
var stabilizeTimerB = null;

/* ─── helpers ─── */

function clearStabilizeTimers() {
  if (stabilizeTimerA) clearTimeout(stabilizeTimerA);
  if (stabilizeTimerB) clearTimeout(stabilizeTimerB);
  stabilizeTimerA = null;
  stabilizeTimerB = null;
}

function stabilizeLayoutAfterInit() {
  clearStabilizeTimers();
  stabilizeTimerA = setTimeout(function () { relayoutKeepingState(); }, 220);
  stabilizeTimerB = setTimeout(function () { relayoutKeepingState(); }, 620);
}

function getContainerWidth(el) {
  var rect = el.getBoundingClientRect();
  return Math.max(rect.width || 0, el.clientWidth || 0);
}

function getGridTrackWidth(sizingEl) {
  if (!sizingEl) return 0;
  var wGrid = getContainerWidth(sizingEl);
  var parent = sizingEl.parentElement;
  if (parent && (parent.id === 'masonry-container' || (parent.classList && parent.classList.contains('masonry-container')))) {
    var st = getComputedStyle(parent);
    var pl = parseFloat(st.paddingLeft) || 0;
    var pr = parseFloat(st.paddingRight) || 0;
    var wInner = parent.getBoundingClientRect().width - pl - pr;
    return Math.max(0, Math.min(wGrid, wInner));
  }
  return wGrid;
}

function calculateColumnWidth(sizingEl) {
  var W = getGridTrackWidth(sizingEl);
  var col = (W - 4 * GUTTER) / HOME_GRID_COLUMNS;
  var columnWidth = Math.max(1, Math.floor(col * 1000) / 1000);
  return { columnWidth: columnWidth, rowHeight: columnWidth, columns: HOME_GRID_COLUMNS };
}

/* ─── tamanho de itens ─── */

function parseSizeFromAttr(raw) {
  var s = String(raw || '1x1').toLowerCase().replace(/\s/g, '');
  var m = s.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
  if (!m) return { w: 1, h: 1 };
  var w = parseFloat(m[1]);
  var h = parseFloat(m[2]);
  if (!Number.isFinite(w) || w <= 0) w = 1;
  if (!Number.isFinite(h) || h <= 0) h = 1;
  if (w === 2 && h === 1) { w = 1; h = 1; }
  if (w === 2 && h === 2) { w = 1; h = 2; }
  w = 1;
  if (h === 3) h = 1.5;
  var allowed = [1, 1.5, 2];
  if (allowed.indexOf(h) === -1) {
    if (h < 1.25) h = 1;
    else if (h < 1.75) h = 1.5;
    else h = 2;
  }
  return { w: w, h: h };
}

function parseSize(item) {
  return parseSizeFromAttr(item.getAttribute('data-size') || '1x1');
}

function getOrderValue(item) {
  var o = item.getAttribute('data-order');
  if (o == null || o === '') return 999999;
  var n = parseInt(String(o), 10);
  return Number.isFinite(n) ? n : 999999;
}

function sizeItem(item, columnWidth, rowHeight, columns) {
  var s = parseSize(item);
  var cw = s.w > columns ? columns : s.w;
  item.style.width = (cw * columnWidth + (cw - 1) * GUTTER) + 'px';
  item.style.maxWidth = '100%';
  item.style.height = (s.h * rowHeight + (s.h - 1) * GUTTER) + 'px';
}

/* ─── serviços / filtro ─── */

function getServicesFromItem(item) {
  var raw = item.getAttribute('data-services');
  if (!raw || !raw.trim()) return [];
  try {
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(function (s) { return String(s).trim(); }) : [];
  } catch (e) {
    return [];
  }
}

function isFilterActive() {
  return state.filter !== '__all__';
}

function itemMatchesFilter(item) {
  if (!isFilterActive()) return true;
  var filters = state.filter;
  var services = getServicesFromItem(item);
  for (var i = 0; i < filters.length; i++) {
    if (services.indexOf(filters[i]) !== -1) return true;
  }
  return false;
}

/* ─── data (MMDDYYYY) ─── */

function getDateValue(item) {
  var raw = item.getAttribute('data-date') || '';
  if (raw.length !== 8) return 0;
  var yyyy = raw.substring(4, 8);
  var mm = raw.substring(0, 2);
  var dd = raw.substring(2, 4);
  return parseInt(yyyy + mm + dd, 10) || 0;
}

/* ─── posições originais ─── */

function saveOriginalPositions() {
  var container = document.getElementById('masonry-container');
  if (!container) return;
  var cols = Array.from(container.querySelectorAll('.projects-col'));
  originalColumnItems = cols.map(function (col) {
    return Array.from(col.querySelectorAll('.project-item'));
  });
}

function restoreOriginalPositions() {
  var container = document.getElementById('masonry-container');
  if (!container) return;
  var cols = Array.from(container.querySelectorAll('.projects-col'));
  if (cols.length !== originalColumnItems.length) return;
  originalColumnItems.forEach(function (items, colIdx) {
    items.forEach(function (item) { cols[colIdx].appendChild(item); });
  });
}

/* ─── redistribuição (greedy shortest-column-first) ─── */

function redistributeItems() {
  var container = document.getElementById('masonry-container');
  if (!container) return;
  var cols = Array.from(container.querySelectorAll('.projects-col'));
  if (cols.length < HOME_GRID_COLUMNS) return;

  var matching = allItems.filter(itemMatchesFilter);

  matching.sort(function (a, b) {
    var da = getDateValue(a);
    var db = getDateValue(b);
    if (db !== da) return db - da;
    return getOrderValue(a) - getOrderValue(b);
  });

  var colHeights = [];
  for (var i = 0; i < HOME_GRID_COLUMNS; i++) colHeights.push(0);

  matching.forEach(function (item) {
    var minIdx = 0;
    for (var i = 1; i < HOME_GRID_COLUMNS; i++) {
      if (colHeights[i] < colHeights[minIdx]) minIdx = i;
    }
    cols[minIdx].appendChild(item);
    var s = parseSize(item);
    colHeights[minIdx] += s.h;
  });
}

/* ─── raster order (linha por linha) ─── */

function getRasterOrderItems() {
  var cont = document.getElementById('masonry-container');
  if (!cont) return [];
  var cols = Array.from(cont.querySelectorAll('.projects-col'));
  if (cols.length < HOME_GRID_COLUMNS) {
    return Array.from(cont.querySelectorAll('.project-item'));
  }
  var buckets = cols.map(function (cel) {
    return Array.from(cel.querySelectorAll('.project-item'));
  });
  var maxH = 0;
  buckets.forEach(function (b) { if (b.length > maxH) maxH = b.length; });
  var out = [];
  for (var r = 0; r < maxH; r++) {
    for (var c = 0; c < HOME_GRID_COLUMNS; c++) {
      if (buckets[c] && buckets[c][r]) out.push(buckets[c][r]);
    }
  }
  return out;
}

/* ─── visibilidade (paginação) ─── */

function applyVisibilityClasses() {
  var loadMoreWrap = document.getElementById('load-more-wrap');
  var raster = getRasterOrderItems().filter(itemMatchesFilter);
  var visibleSet = new Set(raster.slice(0, state.visibleLimit));
  allItems.forEach(function (item) {
    if (visibleSet.has(item)) {
      item.classList.remove(HIDDEN);
    } else {
      item.classList.add(HIDDEN);
    }
  });
  if (loadMoreWrap) {
    loadMoreWrap.hidden = state.visibleLimit >= raster.length;
  }
}

function sizeVisibleItems() {
  var container = document.getElementById('masonry-container');
  if (!container) return;
  var grid = container.querySelector('.projects-grid');
  if (!grid) return;
  var dims = calculateColumnWidth(grid);
  state.columns = dims.columns;
  allItems.forEach(function (item) {
    if (!item.classList.contains(HIDDEN)) {
      sizeItem(item, dims.columnWidth, dims.rowHeight, dims.columns);
    }
  });
}

/* ─── animações ─── */

function killRunningTweens() {
  if (typeof gsap !== 'undefined' && allItems.length) {
    try { gsap.killTweensOf(allItems); } catch (_) {}
  }
}

function animateEntrance() {
  var visible = allItems.filter(function (el) { return !el.classList.contains(HIDDEN); });
  if (typeof gsap !== 'undefined') {
    gsap.fromTo(visible,
      { opacity: 0 },
      { opacity: 1, duration: 0.35, stagger: 0.035, ease: 'power2.out' }
    );
  } else {
    visible.forEach(function (item, i) {
      setTimeout(function () { item.style.opacity = '1'; }, i * 40);
    });
  }
}

function animateFilterTransition() {
  var visible = allItems.filter(function (el) { return !el.classList.contains(HIDDEN); });
  if (visible.length === 0) return;
  if (typeof gsap !== 'undefined') {
    gsap.fromTo(visible,
      { opacity: 0 },
      { opacity: 1, duration: 0.25, stagger: 0.02, ease: 'power2.out' }
    );
  } else {
    visible.forEach(function (item) { item.style.opacity = '1'; });
  }
}

/* ─── init / rebuild / resize ─── */

function runGridInit() {
  var container = document.getElementById('masonry-container');
  if (!container) return;
  var grid = container.querySelector('.projects-grid');
  if (!grid) return;
  container.classList.add('grid-enabled');
  grid.classList.add('visible');
  gridEl = grid;
  allItems = Array.from(container.querySelectorAll('.project-item'));

  saveOriginalPositions();
  applyVisibilityClasses();
  if (allItems.length === 0) return;

  sizeVisibleItems();

  var visible = allItems.filter(function (el) { return !el.classList.contains(HIDDEN); });
  if (visible.length === 0) {
    container.style.minHeight = '0';
    return;
  }
  setTimeout(function () {
    if (!homeEntranceAnimationDone) {
      homeEntranceAnimationDone = true;
      animateEntrance();
    }
  }, 0);
}

function relayoutKeepingState() {
  sizeVisibleItems();
}

function handleResize() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(function () { relayoutKeepingState(); }, 200);
}

function rebuildForFilter() {
  var container = document.getElementById('masonry-container');
  if (!container) return;
  if (!gridEl) { runGridInit(); return; }

  killRunningTweens();

  restoreOriginalPositions();

  if (isFilterActive()) {
    redistributeItems();
  }

  applyVisibilityClasses();
  sizeVisibleItems();
  animateFilterTransition();
}

function initMasonry() {
  state.visibleLimit = INITIAL_VISIBLE;
  state.filter = '__all__';
  allItems = [];
  originalColumnItems = [];
  homeEntranceAnimationDone = false;
  clearStabilizeTimers();
  var container = document.getElementById('masonry-container');
  if (!container) return;
  window.removeEventListener('resize', handleResize);
  requestAnimationFrame(function () {
    runGridInit();
    window.addEventListener('resize', handleResize);
    stabilizeLayoutAfterInit();
  });
}

/* ─── API pública ─── */

function setFilter(svc) {
  clearStabilizeTimers();
  state.filter = svc || '__all__';
  state.visibleLimit = INITIAL_VISIBLE;
  rebuildForFilter();
}

function loadMore() {
  clearStabilizeTimers();
  var container = document.getElementById('masonry-container');
  if (!container) return;

  state.visibleLimit += LOAD_STEP;

  if (!gridEl) { rebuildForFilter(); return; }

  var matching = getRasterOrderItems().filter(itemMatchesFilter);
  var newlyVisible = [];
  matching.forEach(function (item, idx) {
    var shouldShow = idx < state.visibleLimit;
    var wasHidden = item.classList.contains(HIDDEN);
    if (shouldShow && wasHidden) {
      item.classList.remove(HIDDEN);
      newlyVisible.push(item);
    }
  });

  var loadMoreWrap = document.getElementById('load-more-wrap');
  if (loadMoreWrap) {
    loadMoreWrap.hidden = state.visibleLimit >= matching.length;
  }

  if (newlyVisible.length === 0) return;

  var grid = container.querySelector('.projects-grid');
  if (!grid) return;
  var dims = calculateColumnWidth(grid);
  state.columns = dims.columns;

  newlyVisible.forEach(function (item) {
    sizeItem(item, dims.columnWidth, dims.rowHeight, dims.columns);
    item.style.opacity = '0';
  });

  if (typeof gsap !== 'undefined') {
    gsap.to(newlyVisible, {
      opacity: 1, duration: 0.35, stagger: 0.04, ease: 'power2.out',
    });
  } else {
    newlyVisible.forEach(function (item, i) {
      setTimeout(function () { item.style.opacity = '1'; }, i * 40);
    });
  }
}

window.HomeMasonry = { init: initMasonry, setFilter: setFilter, loadMore: loadMore };
window.initMasonry = initMasonry;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {});
}

window.addEventListener('load', function () {
  if (document.body.classList.contains('is-home')) {
    stabilizeLayoutAfterInit();
  }
}, { once: true });
