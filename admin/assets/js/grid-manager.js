/**
 * Visual masonry grid with drag-and-drop reordering.
 * Uses Packery for layout and Draggabilly for drag interaction.
 *
 * Nota: NÃO usamos `packery.bindDraggabillyEvents()` — essa API recalcula o layout
 * a cada movimento (`shift` + `layout`), puxando todos os cartões para encaixar e
 * causando sobreposição com o cartão em arraste. Em vez disso, só o item arrastado
 * move durante o drag; no fim reordenamos os nós no DOM e fazemos um único `layout()`.
 *
 * O Packery empacota da esquerda para a direita e de cima para baixo. Não existe
 * «posição livre» arbitrária na margem direita: o espaço vazio à direita na última
 * fila é normal quando a soma das larguras dos blocos não enche a grelha.
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
      const draftBadge = draftSlugs && draftSlugs.has(slug)
        ? '<span class="gc-badge draft">RASCUNHO</span>'
        : '';
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
          ${draftBadge}
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
      const draggie = new Draggabilly(c, { handle: '.gc-handle' });
      draggie.on('dragStart', () => {
        c.classList.add('is-dragging');
      });
      draggie.on('dragEnd', (event) => {
        c.classList.remove('is-dragging');
        this._onManualDragEnd(c, event);
      });
      this.drags.push(draggie);
    });
  }

  /**
   * Coordenadas do ponteiro no fim do arraste (rato ou toque).
   * @param {Event} event
   */
  _pointerCoords(event) {
    if (!event) return null;
    const e = event;
    if (e.changedTouches && e.changedTouches[0]) {
      return {
        x: e.changedTouches[0].clientX,
        y: e.changedTouches[0].clientY,
      };
    }
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      return { x: e.clientX, y: e.clientY };
    }
    return null;
  }

  /**
   * Reordena o DOM com base no cartão sob o ponteiro e recalcula o masonry uma vez.
   */
  _onManualDragEnd(dragged, event) {
    if (!this.pckry) return;

    const pt = this._pointerCoords(event);
    if (!pt) {
      this.pckry.reloadItems();
      this.pckry.layout();
      this._emitOrder();
      return;
    }

    dragged.style.pointerEvents = 'none';
    dragged.style.visibility = 'hidden';
    let under = document.elementFromPoint(pt.x, pt.y);
    dragged.style.pointerEvents = '';
    dragged.style.visibility = '';

    let dropTarget = under && under.closest ? under.closest('.gc') : null;
    if (dropTarget && !this.el.contains(dropTarget)) {
      dropTarget = null;
    }

    if (dropTarget && dropTarget !== dragged) {
      this._insertDraggedNearTarget(dragged, dropTarget, pt);
    }

    this.pckry.reloadItems();
    this.pckry.layout();
    this._emitOrder();
  }

  /**
   * Insere o cartão arrastado antes ou depois do alvo, conforme o quadrante do ponteiro.
   * Usa o eixo (horizontal vs vertical) em que o ponteiro está mais deslocado em relação
   * ao centro — melhora trocas na mesma coluna e na mesma linha em grelhas 2D.
   */
  _insertDraggedNearTarget(dragged, target, pt) {
    const r = target.getBoundingClientRect();
    const midX = r.left + r.width / 2;
    const midY = r.top + r.height / 2;
    const dx = Math.abs(pt.x - midX);
    const dy = Math.abs(pt.y - midY);

    let insertBefore;
    if (dy >= dx) {
      insertBefore = pt.y < midY;
    } else {
      insertBefore = pt.x < midX;
    }

    if (insertBefore) {
      this.el.insertBefore(dragged, target);
    } else if (target.nextSibling) {
      this.el.insertBefore(dragged, target.nextSibling);
    } else {
      this.el.appendChild(dragged);
    }
  }

  _calcCol() {
    const w = this.el.clientWidth;
    if (w <= 0) return { col: 100, row: 100 };
    const n = Math.max(2, Math.round(w / 210));
    const col = Math.floor((w - (n - 1) * this.gutter) / n);
    return { col, row: col };
  }

  _sizeCard(card, col, row) {
    if (this._mode === 'home') {
      const [cw, ch] = (card.dataset.size || '1x1').split('x').map(Number);
      card.style.width = col * cw + this.gutter * (cw - 1) + 'px';
      card.style.height = row * ch + this.gutter * (ch - 1) + 'px';
    } else {
      card.style.width = col + 'px';
      card.style.height = row + 'px';
    }
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

  onReorder(fn) {
    this._onReorder = fn;
  }

  onClick(fn) {
    this._onClick = fn;
  }

  destroy() {
    window.removeEventListener('resize', this._boundResize);
    clearTimeout(this._resizeTimer);
    this.drags.forEach((d) => d.destroy());
    this.drags = [];
    if (this.pckry) {
      this.pckry.destroy();
      this.pckry = null;
    }
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
