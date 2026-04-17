/**
 * Admin grid with 2D free layout (Home) and sequential list (Todos).
 *
 * Home mode:
 *   - Each card has fixed (home_col, home_row) + size (home_size w×h).
 *   - Dragging: absolute movement, snap-to-grid on drop, swap on collision.
 *   - No auto-packing: cards stay exactly where the user drops them.
 *   - Missing (col, row) → auto-pack from `order` on render (first-fit).
 *
 * Todos mode:
 *   - All cards 1×1 sorted by `order`, simple sequential swap-on-drop reorder.
 */
class GridManager {
  constructor(container) {
    this.el = container;
    this.drags = [];
    this._onGridChange = null;
    this._onOrderChange = null;
    this._onClick = null;
    this.gutter = 6;
    this._mode = 'home';
    this._resizeTimer = null;
    this._boundResize = this._onWindowResize.bind(this);
    this._items = [];
    this._cardBySlug = new Map();
    this._dragStartPos = null;
    this._numColumns = 1;
    this._col = 0;
    this._row = 0;
  }

  /**
   * @param {object[]} projects
   * @param {'home'|'all'} mode
   * @param {{ draftSlugs?: Set<string> }} [opts]
   */
  render(projects, mode, opts = {}) {
    this.destroy();
    this._mode = mode;
    this.el.innerHTML = '';
    const draftSlugs = opts.draftSlugs;

    const { col, row, columns } = this._calcCol();
    this._col = col;
    this._row = row;
    this._numColumns = columns;

    const sorted = [...projects].sort(
      (a, b) => (a.order ?? 999) - (b.order ?? 999),
    );

    const items = sorted.map((p, idx) => this._makeItem(p, idx));
    this._items = items;

    if (mode === 'home') {
      this._assignHomePositions(items);
    } else {
      this._assignSequentialPositions(items);
    }

    items.forEach((it) => {
      const card = this._buildCard(it, draftSlugs);
      this._positionCard(card, it);
      this.el.appendChild(card);
      this._cardBySlug.set(it.slug, card);
    });

    this._updateContainerHeight();
    this._attachDrags();
    window.addEventListener('resize', this._boundResize);
  }

  _makeItem(p, idx) {
    const slug = p._slug || slugFromUrl(p.url);
    const sizeStr = p.home_size || '1x1';
    const [w, h] = sizeStr.split('x').map(Number);
    return {
      slug,
      project: p,
      order: p.order ?? idx + 1,
      w: w || 1,
      h: h || 1,
      col: Number.isInteger(p.home_col) ? p.home_col : null,
      row: Number.isInteger(p.home_row) ? p.home_row : null,
      size: sizeStr,
    };
  }

  /**
   * First-fit packing: keeps any explicit (col,row) from the DB; fills the rest
   * by scanning row by row, left→right. Matches the Packery result for fresh
   * data while letting the user free positions from then on.
   */
  _assignHomePositions(items) {
    const occupancy = [];
    const isOccupied = (c, r, w, h) => {
      for (let rr = r; rr < r + h; rr++) {
        if (!occupancy[rr]) continue;
        for (let cc = c; cc < c + w; cc++) {
          if (occupancy[rr][cc]) return true;
        }
      }
      return false;
    };
    const place = (c, r, w, h, slug) => {
      for (let rr = r; rr < r + h; rr++) {
        if (!occupancy[rr]) occupancy[rr] = [];
        for (let cc = c; cc < c + w; cc++) {
          occupancy[rr][cc] = slug;
        }
      }
    };

    const placedExplicit = [];
    const pending = [];
    for (const it of items) {
      if (
        it.col != null &&
        it.row != null &&
        it.col >= 0 &&
        it.col + it.w <= this._numColumns &&
        !isOccupied(it.col, it.row, it.w, it.h)
      ) {
        place(it.col, it.row, it.w, it.h, it.slug);
        placedExplicit.push(it);
      } else {
        pending.push(it);
      }
    }

    for (const it of pending) {
      const { w, h } = it;
      let placed = false;
      for (let r = 0; !placed; r++) {
        for (let c = 0; c + w <= this._numColumns; c++) {
          if (!isOccupied(c, r, w, h)) {
            it.col = c;
            it.row = r;
            place(c, r, w, h, it.slug);
            placed = true;
            break;
          }
        }
        if (r > 500) break;
      }
      it._autoPlaced = true;
    }
  }

  _assignSequentialPositions(items) {
    for (let i = 0; i < items.length; i++) {
      const col = i % this._numColumns;
      const row = Math.floor(i / this._numColumns);
      items[i].col = col;
      items[i].row = row;
      items[i].w = 1;
      items[i].h = 1;
    }
  }

  _buildCard(it, draftSlugs) {
    const p = it.project;
    const card = document.createElement('div');
    card.className = 'gc';
    card.dataset.slug = it.slug;
    card.dataset.size = p.home_size || '1x1';

    const thumb = p.thumbnail || '';
    const draftBadge = draftSlugs && draftSlugs.has(it.slug)
      ? '<span class="gc-badge draft">RASCUNHO</span>'
      : '';
    card.innerHTML = `
      <img src="${escAttr(thumb)}" alt="" class="gc-img" loading="lazy" />
      <div class="gc-info">
        <span class="gc-title">${esc(p.title)}</span>
        <span class="gc-client">${esc(p.client)}</span>
      </div>
      <div class="gc-badges">
        <span class="gc-badge order">${it.order ?? '–'}</span>
        <span class="gc-badge size">${p.home_size || '1x1'}</span>
        ${p.show_on_home ? '<span class="gc-badge home">HOME</span>' : ''}
        ${draftBadge}
      </div>
      <div class="gc-handle" title="Arrastar para reordenar">⠿</div>`;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.gc-handle')) return;
      if (card.dataset.dragging === '1') return;
      this._onClick?.(p);
    });

    const imgEl = card.querySelector('.gc-img');
    if (imgEl) {
      imgEl.addEventListener('error', () => {
        imgEl.style.display = 'none';
      });
    }

    return card;
  }

  _positionCard(card, it) {
    const step = this._col + this.gutter;
    const stepR = this._row + this.gutter;
    card.style.position = 'absolute';
    card.style.left = it.col * step + 'px';
    card.style.top = it.row * stepR + 'px';
    card.style.width = it.w * this._col + (it.w - 1) * this.gutter + 'px';
    card.style.height = it.h * this._row + (it.h - 1) * this.gutter + 'px';
  }

  _updateContainerHeight() {
    let maxRow = 0;
    for (const it of this._items) {
      maxRow = Math.max(maxRow, it.row + it.h);
    }
    const h = maxRow * (this._row + this.gutter);
    this.el.style.minHeight = h + 'px';
  }

  _attachDrags() {
    if (typeof Draggabilly === 'undefined') return;
    this.drags = [];
    for (const it of this._items) {
      const card = this._cardBySlug.get(it.slug);
      if (!card) continue;
      const d = new Draggabilly(card, { handle: '.gc-handle' });
      d.on('dragStart', () => this._onDragStart(it, card));
      d.on('dragMove', () => { card.dataset.dragging = '1'; });
      d.on('dragEnd', () => this._onDragEnd(it, card));
      this.drags.push(d);
    }
  }

  _onDragStart(it, card) {
    this._dragStartPos = { col: it.col, row: it.row };
    card.classList.add('is-dragging');
  }

  _onDragEnd(it, card) {
    card.classList.remove('is-dragging');
    setTimeout(() => { card.dataset.dragging = '0'; }, 0);

    const stepC = this._col + this.gutter;
    const stepR = this._row + this.gutter;
    const left = parseFloat(card.style.left) || 0;
    const top = parseFloat(card.style.top) || 0;
    let newCol = Math.round(left / stepC);
    let newRow = Math.round(top / stepR);

    newCol = Math.max(0, Math.min(newCol, this._numColumns - it.w));
    newRow = Math.max(0, newRow);

    if (newCol === it.col && newRow === it.row) {
      this._positionCard(card, it);
      return;
    }

    const changed = this._applyDropWithSwap(it, newCol, newRow);
    if (!changed) {
      this._positionCard(card, it);
      this._toast?.('Não foi possível encaixar aí — posição revertida.');
      return;
    }

    for (const { slug } of changed) {
      const c = this._cardBySlug.get(slug);
      const target = this._items.find((x) => x.slug === slug);
      if (c && target) this._positionCard(c, target);
    }

    if (this._mode === 'home') {
      this._onGridChange?.(
        changed.map((c) => ({
          slug: c.slug,
          home_col: c.col,
          home_row: c.row,
        })),
      );
    } else {
      const ordered = this._items
        .slice()
        .sort((a, b) => (a.row - b.row) || (a.col - b.col))
        .map((x, i) => ({ slug: x.slug, order: i + 1 }));
      this._items.forEach((x) => {
        const found = ordered.find((o) => o.slug === x.slug);
        if (found) x.order = found.order;
        const c = this._cardBySlug.get(x.slug);
        const badge = c?.querySelector('.gc-badge.order');
        if (badge && found) badge.textContent = String(found.order);
      });
      this._onOrderChange?.(ordered);
    }

    this._updateContainerHeight();
  }

  /**
   * Try to place `dragged` at (newCol,newRow). If it overlaps exactly one other
   * item and the swap keeps everything inside bounds and non-overlapping,
   * commit the swap. Otherwise return null.
   *
   * @returns {Array<{slug:string,col:number,row:number}> | null}
   */
  _applyDropWithSwap(dragged, newCol, newRow) {
    const newRect = { col: newCol, row: newRow, w: dragged.w, h: dragged.h };

    if (newCol + dragged.w > this._numColumns) return null;
    if (newCol < 0 || newRow < 0) return null;

    const colliders = this._items.filter(
      (x) => x.slug !== dragged.slug && rectsIntersect(newRect, x),
    );

    if (colliders.length === 0) {
      dragged.col = newCol;
      dragged.row = newRow;
      return [{ slug: dragged.slug, col: dragged.col, row: dragged.row }];
    }

    if (colliders.length !== 1) return null;
    const other = colliders[0];

    const oldCol = this._dragStartPos?.col ?? dragged.col;
    const oldRow = this._dragStartPos?.row ?? dragged.row;

    if (oldCol + other.w > this._numColumns) return null;

    const swapRectForOther = { col: oldCol, row: oldRow, w: other.w, h: other.h };
    const overlaps = this._items.some(
      (x) =>
        x.slug !== dragged.slug &&
        x.slug !== other.slug &&
        rectsIntersect(swapRectForOther, x),
    );
    if (overlaps) return null;

    dragged.col = newCol;
    dragged.row = newRow;
    other.col = oldCol;
    other.row = oldRow;

    return [
      { slug: dragged.slug, col: dragged.col, row: dragged.row },
      { slug: other.slug, col: other.col, row: other.row },
    ];
  }

  _calcCol() {
    const w = this.el.clientWidth;
    const n = Math.max(2, Math.round(w / 210));
    const col = Math.floor((w - (n - 1) * this.gutter) / n);
    return { col, row: col, columns: n };
  }

  _onWindowResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this.relayout(), 200);
  }

  relayout() {
    const { col, row, columns } = this._calcCol();
    this._col = col;
    this._row = row;

    if (columns !== this._numColumns) {
      this._numColumns = columns;
      for (const it of this._items) {
        if (it.col + it.w > columns) it.col = Math.max(0, columns - it.w);
      }
    }

    for (const it of this._items) {
      const c = this._cardBySlug.get(it.slug);
      if (c) this._positionCard(c, it);
    }
    this._updateContainerHeight();
  }

  /**
   * Called by admin-app when it wants to expose auto-placed positions as
   * pending draft changes (so `Publicar` persists them to the DB).
   */
  getAutoPlacedPositions() {
    return this._items
      .filter((it) => it._autoPlaced)
      .map((it) => ({ slug: it.slug, home_col: it.col, home_row: it.row }));
  }

  onGridChange(fn) { this._onGridChange = fn; }
  onOrderChange(fn) { this._onOrderChange = fn; }
  onClick(fn) { this._onClick = fn; }
  onWarn(fn) { this._toast = fn; }

  destroy() {
    window.removeEventListener('resize', this._boundResize);
    clearTimeout(this._resizeTimer);
    this.drags.forEach((d) => d.destroy());
    this.drags = [];
    this._items = [];
    this._cardBySlug.clear();
  }
}

function rectsIntersect(a, b) {
  return (
    a.col < b.col + b.w &&
    a.col + a.w > b.col &&
    a.row < b.row + b.h &&
    a.row + a.h > b.row
  );
}

function slugFromUrl(url) {
  if (!url) return '';
  return url.replace(/\/$/, '').split('/').pop();
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Atributo src seguro + CSP-friendly (sem handler inline). */
function escAttr(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
