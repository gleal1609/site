/**
 * Visual masonry grid with drag-and-drop reordering.
 * Uses Packery for layout and Draggabilly for drag interaction.
 */
class GridManager {
  constructor(container) {
    this.el = container;
    this.pckry = null;
    this.drags = [];
    this._onReorder = null;
    this._onClick = null;
    this.gutter = 6;
    this._mode = 'home';
    this._resizeTimer = null;
    this._boundResize = this._onWindowResize.bind(this);
  }

  render(projects, mode) {
    this.destroy();
    this._mode = mode;
    this.el.innerHTML = '';

    const sorted = [...projects].sort(
      (a, b) => (a.order ?? 999) - (b.order ?? 999),
    );

    sorted.forEach((p) => {
      const slug = p._slug || slugFromUrl(p.url);
      const card = document.createElement('div');
      card.className = 'gc';
      card.dataset.slug = slug;
      card.dataset.size = p.home_size || '1x1';

      const thumb = p.thumbnail || '';
      card.innerHTML = `
        <img src="${escAttr(thumb)}" alt="" class="gc-img" loading="lazy" />
        <div class="gc-info">
          <span class="gc-title">${esc(p.title)}</span>
          <span class="gc-client">${esc(p.client)}</span>
        </div>
        <div class="gc-badges">
          <span class="gc-badge order">${p.order ?? '–'}</span>
          <span class="gc-badge size">${p.home_size || '1x1'}</span>
          ${p.show_on_home ? '<span class="gc-badge home">HOME</span>' : ''}
        </div>
        <div class="gc-handle" title="Arrastar para reordenar">⠿</div>`;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.gc-handle')) return;
        this._onClick?.(p);
      });

      const imgEl = card.querySelector('.gc-img');
      if (imgEl) {
        imgEl.addEventListener('error', () => {
          imgEl.style.display = 'none';
        });
      }

      this.el.appendChild(card);
    });

    this._initPackery();
    window.addEventListener('resize', this._boundResize);
  }

  _initPackery() {
    const { col, row } = this._calcCol();

    this.el.querySelectorAll('.gc').forEach((c) => {
      this._sizeCard(c, col, row);
    });

    this.pckry = new Packery(this.el, {
      itemSelector: '.gc',
      gutter: this.gutter,
      columnWidth: col,
      rowHeight: row,
      percentPosition: false,
      transitionDuration: '0.25s',
    });

    this.drags = [];
    this.el.querySelectorAll('.gc').forEach((c) => {
      const d = new Draggabilly(c, { handle: '.gc-handle' });
      this.pckry.bindDraggabillyEvents(d);
      this.drags.push(d);
    });

    this.pckry.on('dragItemPositioned', () => this._emitOrder());
  }

  _sizeCard(card, col, row) {
    if (this._mode === 'home') {
      const [w, h] = (card.dataset.size || '1x1').split('x').map(Number);
      card.style.width = col * w + this.gutter * (w - 1) + 'px';
      card.style.height = row * h + this.gutter * (h - 1) + 'px';
    } else {
      card.style.width = col + 'px';
      card.style.height = row + 'px';
    }
  }

  _calcCol() {
    const w = this.el.clientWidth;
    const n = Math.max(2, Math.round(w / 210));
    const col = Math.floor((w - (n - 1) * this.gutter) / n);
    return { col, row: col };
  }

  _emitOrder() {
    if (!this.pckry) return;
    const items = this.pckry.getItemElements();
    const order = items.map((el, i) => {
      const badge = el.querySelector('.gc-badge.order');
      if (badge) badge.textContent = i + 1;
      return { slug: el.dataset.slug, order: i + 1 };
    });
    this._onReorder?.(order);
  }

  _onWindowResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this.relayout(), 200);
  }

  relayout() {
    if (!this.pckry) return;
    const { col, row } = this._calcCol();
    this.el.querySelectorAll('.gc').forEach((c) => this._sizeCard(c, col, row));
    this.pckry.options.columnWidth = col;
    this.pckry.options.rowHeight = row;
    this.pckry.layout();
  }

  onReorder(fn) { this._onReorder = fn; }
  onClick(fn) { this._onClick = fn; }

  destroy() {
    window.removeEventListener('resize', this._boundResize);
    clearTimeout(this._resizeTimer);
    this.drags.forEach((d) => d.destroy());
    this.drags = [];
    if (this.pckry) { this.pckry.destroy(); this.pckry = null; }
  }
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
