/**
 * Visual Portfolio CMS — backend Cloudflare Worker (cf-api.js)
 * Base URL: meta reverso-cms-api (Jekyll preenche a partir de _config.yml).
 */
function reversoCmsApiBase() {
  const el = document.querySelector('meta[name="reverso-cms-api"]');
  const v = el?.getAttribute('content')?.trim();
  if (v) return v.replace(/\/$/, '');
  return null;
}

/** Rascunho de «Novo projeto» antes de publicar */
const DRAFT_NEW = '__new__';

const ADMIN_CONFIG = {
  serviceTypes: [
    'EFEITOS VISUAIS',
    'ANIMAÇÃO & MOTION GRAPHICS',
    'FESTIVAIS & EVENTOS',
    'INSTITUCIONAL',
    'EVENTO CORPORATIVO',
    'PUBLICITÁRIO',
    'ARTE & CULTURA',
    'MAKING OF',
    'DOCUMENTÁRIO',
    'MOBILE',
    'FOTOS',
    'VFX',
    'ARTISTICOS',
    'MIDIAS SOCIAIS',
    'EVENTOS',
  ],
};

function pickWeightedHomeSize() {
  const r = Math.random() * 100;
  if (r < 60) return '1x1';
  if (r < 75) return '1x2';
  if (r < 90) return '2x1';
  return '2x2';
}

/**
 * Gera um array de tamanhos com distribuição balanceada e embaralhado
 * de forma a evitar corridas longas do mesmo tamanho. A ordem do array é
 * aplicada posição-a-posição sobre os projetos (preservando a ordem
 * cronológica dos próprios projetos).
 *
 * Proporção-alvo: 55% 1x1 · 17% 1x2 · 17% 2x1 · 11% 2x2.
 * Garante pelo menos 1 tile de cada tamanho quando N >= 4.
 */
function buildBalancedSizePool(n) {
  if (n <= 0) return [];
  const targets = { '1x1': 0.55, '1x2': 0.17, '2x1': 0.17, '2x2': 0.11 };
  const order = ['1x1', '1x2', '2x1', '2x2'];
  const counts = {};
  let assigned = 0;
  for (const k of order) {
    counts[k] = Math.round(targets[k] * n);
    assigned += counts[k];
  }
  // Ajuste fino para fechar exactamente em N.
  let drift = n - assigned;
  const adj = drift > 0 ? ['1x1', '1x2', '2x1', '2x2'] : ['2x2', '2x1', '1x2', '1x1'];
  let i = 0;
  while (drift !== 0) {
    const k = adj[i % adj.length];
    if (drift > 0) {
      counts[k] += 1;
      drift -= 1;
    } else if (counts[k] > 0) {
      counts[k] -= 1;
      drift += 1;
    }
    i += 1;
  }
  // Assegura pelo menos 1 de cada tipo quando houver «orçamento».
  if (n >= 4) {
    for (const k of order) {
      if (counts[k] === 0) {
        const donor = order
          .slice()
          .sort((a, b) => counts[b] - counts[a])
          .find((x) => x !== k && counts[x] > 1);
        if (donor) {
          counts[donor] -= 1;
          counts[k] += 1;
        }
      }
    }
  }

  const pool = [];
  for (const k of order) for (let c = 0; c < counts[k]; c++) pool.push(k);
  // Shuffle Fisher-Yates.
  for (let j = pool.length - 1; j > 0; j--) {
    const r = Math.floor(Math.random() * (j + 1));
    [pool[j], pool[r]] = [pool[r], pool[j]];
  }
  // Anti-run: evita três tamanhos iguais em sequência. Troca o item «ofensor»
  // pelo próximo diferente no array. A ordem geral continua aleatória.
  for (let k = 2; k < pool.length; k++) {
    if (pool[k] === pool[k - 1] && pool[k] === pool[k - 2]) {
      let swap = -1;
      for (let m = k + 1; m < pool.length; m++) {
        if (pool[m] !== pool[k]) { swap = m; break; }
      }
      if (swap !== -1) {
        [pool[k], pool[swap]] = [pool[swap], pool[k]];
      }
    }
  }
  return pool;
}

function adminApp() {
  return {
    authed: false,
    user: null,

    projects: [],
    baselineProjects: [],
    loading: true,
    saving: false,

    /** view: 'hero' (ex-Site) | 'projetos' (todos os projetos — a Home mostra tudo) */
    view: 'hero',
    /** @type {Record<string, { payload: object, thumbFile: File|null, videoFile: File|null, isNew: boolean, version?: number }>} */
    projectDrafts: {},

    /**
     * Mapa `slug` → `home_size` a repor com «Descartar formatos» (estado antes da
     * primeira aleatorização após carga / última publicação).
     * @type {Record<string, string> | null}
     */
    _homeSizeRandomizeSnapshot: null,

    editorOpen: false,
    editorLoading: false,
    editSlug: null,
    form: {},
    isNew: false,
    formDirty: false,
    _suppressFormDirty: false,

    thumbFile: null,
    thumbPreview: null,
    videoFile: null,
    videoPreview: null,

    /** YouTube IFrame API — scrub + timestamps a persistir / ingest */
    ytApiPlayer: null,
    ytPlayerDuration: 0,
    ytScrubTime: 0,
    ytPlayerIniting: false,
    /** Pré-visualização 9:16 no admin quando o URL não é /shorts/ (ex.: watch?v= com vídeo vertical). */
    ytPreviewPortrait: false,
    /** Importação Pixieset — capa + slideshow (Worker resolve + proxy) */
    pixiesetBusy: false,
    pixiesetCidOverride: '',
    _ytUrlDebounce: null,
    _ytDurationPoll: null,

    publishing: false,
    publishPhase: '',

    _auth: null,
    _api: null,
    _beforeUnloadBound: null,
    _packery: null,
    _masonryResizeBound: null,

    toast: null,

    /* Site (Hero) */
    siteSettings: { hero_video: null },
    siteLoading: false,
    siteSaving: false,
    /** @type {{ file: File, previewUrl: string, fileName: string, fileSizeLabel: string } | null} */
    siteDraft: null,
    masonryReady: false,

    async init() {
      const apiBase = reversoCmsApiBase();
      if (!apiBase) {
        this.loading = false;
        this._toast(
          'Meta reverso-cms-api ausente ou vazia. Sirva o admin pelo Jekyll (build que processa admin/index.html).',
          'error',
        );
        return;
      }
      this._auth = new Auth(apiBase);
      this._api = new CfAPI(apiBase);

      this._beforeUnloadBound = (e) => {
        if (this.hasUnpublishedChanges) {
          e.preventDefault();
          e.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', this._beforeUnloadBound);

      const loginErr = this._auth.checkLoginError();
      if (loginErr) {
        this.loading = false;
        this._toast(loginErr, 'error');
        return;
      }

      const ok = await this._auth.checkSession(this._api);
      if (ok) {
        this.user = this._auth.user;
        this.authed = true;
        await this._loadProjects();
        // Carrega definições do Site (hero video) para a aba Hero, que é a default.
        await this._loadSiteSettings();
        await this.$nextTick();
        this.$watch(
          'form',
          () => {
            if (this._suppressFormDirty) return;
            if (!this.editorOpen) return;
            this.formDirty = true;
          },
          { deep: true },
        );
        this.$watch(
          () =>
            (this.editorOpen
              ? `|${(this.form?.youtube_url || '').trim()}|`
              : 'closed'),
          () => {
            if (!this.editorOpen || !this.authed) return;
            if (this._ytUrlDebounce) clearTimeout(this._ytUrlDebounce);
            this._ytUrlDebounce = setTimeout(() => {
              this._initYoutubePlayerPanel();
            }, 650);
          },
        );
        this.$watch('view', () => this._onViewChange());
      }
      this.loading = false;
    },

    loginOAuth() {
      if (!this._auth) return;
      this.loading = true;
      this._auth.login();
    },

    async logout() {
      if (!this._auth || !this._api) return;
      if (this.hasUnpublishedChanges) {
        const ok = confirm(
          'Existem alterações não publicadas (rascunho no navegador). Sair mesmo assim?',
        );
        if (!ok) return;
      }
      window.removeEventListener('beforeunload', this._beforeUnloadBound);
      await this._auth.logout(this._api);
      this.authed = false;
      this.user = null;
      this.projects = [];
      this.baselineProjects = [];
      this.projectDrafts = {};
      this._homeSizeRandomizeSnapshot = null;
      this.editorOpen = false;
      this._clearSiteDraftPreview();
      this.siteDraft = null;
      this._destroyMasonry();
    },

    _cloneProjects(list) {
      return list.map((p) => ({ ...p }));
    },

    _snapshotBaseline() {
      this.baselineProjects = this._cloneProjects(this.projects);
    },

    async _loadProjects(opts = {}) {
      const silent = opts.silent === true;
      if (!this._api) return;
      if (!silent) this.loading = true;
      let ok = false;
      try {
        this.projects = await this._api.listProjects();
        this.projects.forEach((p) => {
          p._slug = p.slug;
          if (!p.url) p.url = `/projects/${p.slug}/`;
        });
        this._snapshotBaseline();
        ok = true;
      } catch (e) {
        console.error(e);
        this._toast('Erro ao carregar projetos: ' + e.message, 'error');
      }
      if (!silent) this.loading = false;
    },

    setView(v) {
      this.view = v;
    },

    _onViewChange() {
      if (this.view === 'hero') {
        this._destroyMasonry();
        this._loadSiteSettings();
        return;
      }
      if (this.view === 'projetos') {
        // Alpine tem de renderizar o x-for antes de inicializar o Packery.
        this.$nextTick(() => this._initMasonry());
      }
    },

    get visibleProjects() {
      if (this.view === 'projetos') {
        // A Home mostra TODOS os projetos (migration 0005 removeu os
        // filtros `show_on_home` e `published`). A ordem replica
        // exactamente o Liquid da Home: `sort asc (estável) → reverse`
        // — sequência que INVERTE a ordem dos empates em relação a um
        // `sort desc` directo. Como a API devolve os projetos em
        // `date DESC, year DESC, slug ASC`, tanto aqui quanto no Jekyll
        // os empates acabam em `year ASC, slug DESC`.
        const arr = this.projects.slice();
        arr.sort((a, b) => {
          const da = String(a.date_mmddyyyy || '');
          const db = String(b.date_mmddyyyy || '');
          if (da < db) return -1;
          if (da > db) return 1;
          return 0;
        });
        arr.reverse();
        return arr;
      }
      return [];
    },

    get heroPreviewSrc() {
      if (this.siteDraft && this.siteDraft.previewUrl) return this.siteDraft.previewUrl;
      return this.siteSettings.hero_video || null;
    },

    hasDraftFor(slug) {
      return !!this.projectDrafts[slug];
    },

    get canUndoRandomHomeSizes() {
      const s = this._homeSizeRandomizeSnapshot;
      return s != null && Object.keys(s).length > 0;
    },

    async _loadSiteSettings() {
      if (!this._api) return;
      this.siteLoading = true;
      try {
        const data = await this._api.getSettings();
        const next = { hero_video: null };
        for (const row of data.settings || []) {
          if (row.key === 'hero_video') {
            next[row.key] = row.value || null;
          }
        }
        this.siteSettings = next;
      } catch (e) {
        this._toast('Erro ao carregar definições do site: ' + e.message, 'error');
      }
      this.siteLoading = false;
    },

    onSiteHeroVideo(e) {
      const file = e.target?.files?.[0];
      // Limpa o input para permitir re-escolher o mesmo arquivo depois.
      if (e.target) e.target.value = '';
      if (!file) return;
      try {
        MediaUpload.validate(file, MediaUpload.VID_TYPES);
      } catch (err) {
        this._toast(err.message || String(err), 'error');
        return;
      }
      this._setSiteDraft(file);
      this._toast(
        'Vídeo em rascunho. Clique em «Publicar» para enviar ao servidor.',
        'success',
      );
    },

    _setSiteDraft(file) {
      this._clearSiteDraftPreview();
      this.siteDraft = {
        file,
        previewUrl: MediaUpload.preview(file),
        fileName: file.name,
        fileSizeLabel: `${(file.size / 1048576).toFixed(1)} MB`,
      };
    },

    _clearSiteDraftPreview() {
      if (this.siteDraft && this.siteDraft.previewUrl) {
        MediaUpload.revokePreview(this.siteDraft.previewUrl);
      }
    },

    discardSiteDraft() {
      if (!this.siteDraft) return;
      this._clearSiteDraftPreview();
      this.siteDraft = null;
      this._toast('Rascunho do vídeo da Hero descartado.', 'warning');
    },

    get hasStagedProjects() {
      return Object.keys(this.projectDrafts).length > 0;
    },

    get hasStagedSite() {
      return !!this.siteDraft;
    },

    get hasUnpublishedChanges() {
      return (
        this.hasStagedProjects ||
        this.hasStagedSite ||
        (this.editorOpen && (this.formDirty || this.thumbFile || this.videoFile))
      );
    },

    get canPublish() {
      return (
        this.hasStagedProjects ||
        this.hasStagedSite ||
        (this.editorOpen && (this.formDirty || this.thumbFile || this.videoFile))
      );
    },

    get unpublishedSummary() {
      const parts = [];
      if (this.hasStagedProjects) {
        const n = Object.keys(this.projectDrafts).length;
        parts.push(n === 1 ? '1 projeto em rascunho' : `${n} projetos em rascunho`);
      }
      if (this.hasStagedSite) {
        parts.push('vídeo da Hero em rascunho');
      }
      if (this.editorOpen && (this.formDirty || this.thumbFile || this.videoFile)) {
        parts.push('formulário em edição');
      }
      return parts.length ? parts.join(' · ') : '';
    },

    randomizeHomeSizes() {
      // Usamos a mesma ordem da Home (`visibleProjects` = todos os projetos,
      // cronológico desc) para que o pool balanceado seja aplicado
      // posição-a-posição sem alterar a ordem dos projetos.
      const targets = this.visibleProjects;
      if (!targets.length) {
        this._toast('Nenhum projeto para aleatorizar.', 'warning');
        return;
      }
      if (!this._homeSizeRandomizeSnapshot) {
        const snap = {};
        for (const p of targets) {
          snap[p._slug] = p.home_size || '1x1';
        }
        this._homeSizeRandomizeSnapshot = snap;
      }
      const pool = buildBalancedSizePool(targets.length);
      targets.forEach((p, i) => {
        const size = pool[i] || '1x1';
        const key = p._slug;
        const ex = this.projectDrafts[key];
        if (ex) {
          ex.payload = { ...ex.payload, home_size: size };
        } else {
          this.projectDrafts[key] = {
            payload: this._projectToPayload(p, { home_size: size }),
            thumbFile: null,
            videoFile: null,
            isNew: false,
            version: p.version,
          };
        }
        const live = this.projects.find((x) => x._slug === key);
        if (live) live.home_size = size;
      });
      // Reaplica tamanhos + re-layout (após Alpine atualizar o DOM com os
      // novos data-size).
      this.$nextTick(() => this._relayoutMasonry());
      this._toast(
        `Formatos aleatorizados para ${targets.length} projeto(s). Publique para salvar no servidor.`,
        'success',
      );
    },

    /**
     * Repõe `home_size` na grade e em `projectDrafts[*].payload` ao estado
     * anterior à **primeira** «Aleatorizar formatos» desta sequência.
     */
    discardRandomizedHomeSizes() {
      const snap = this._homeSizeRandomizeSnapshot;
      if (!snap || !Object.keys(snap).length) {
        this._toast('Nada para reverter.', 'warning');
        return;
      }
      for (const p of this.projects) {
        if (!Object.prototype.hasOwnProperty.call(snap, p._slug)) continue;
        const h = snap[p._slug];
        p.home_size = h;
        const d = this.projectDrafts[p._slug];
        if (d) d.payload.home_size = h;
      }
      this._homeSizeRandomizeSnapshot = null;
      this.$nextTick(() => this._relayoutMasonry());
      this._toast('Tamanhos de grelha repostos. As alterações continuam em rascunho até «Publicar».', 'success');
    },

    _numOrNull(v) {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    },

    _projectToPayload(p, overrides = {}) {
      const base = {
        title: p.title,
        body_md: p.body_md || '',
        description: p.description != null ? p.description : null,
        service_types: Array.isArray(p.service_types) ? [...p.service_types] : [],
        client: p.client || '',
        date_mmddyyyy: p.date_mmddyyyy || '',
        year: p.year != null ? p.year : null,
        home_size: p.home_size || '1x1',
        youtube_url: p.youtube_url || '',
        pixieset_url: p.pixieset_url || '',
        youtube_thumb_time_sec: this._numOrNull(p.youtube_thumb_time_sec),
        youtube_preview_start_sec: this._numOrNull(p.youtube_preview_start_sec),
        ...overrides,
      };
      if (p.thumbnail) base.thumbnail = p.thumbnail;
      if (p.hover_preview) base.hover_preview = p.hover_preview;
      return base;
    },

    async openEditor(project) {
      this._destroyYoutubePanel();
      this.isNew = false;
      this.editSlug = project._slug;
      this.editorOpen = true;
      this.editorLoading = true;
      this._clearUploads();
      this.formDirty = false;

      try {
        const data = await this._api.getProject(project._slug);
        this._suppressFormDirty = true;
        this.form = {
          ...data,
          body: data.body_md || '',
          description: data.description || '',
          _slug: project._slug,
        };
        if (!Array.isArray(this.form.service_types)) {
          this.form.service_types = [];
        }
        const draft = this.projectDrafts[project._slug];
        if (draft) {
          this._applyDraftPayloadToForm(draft);
        }
        this._mergeYouTubeTimeDraft();
      } catch (e) {
        this._toast('Erro ao carregar projeto', 'error');
        this.editorOpen = false;
      }
      this.editorLoading = false;

      await this.$nextTick();
      this._suppressFormDirty = false;
      this.formDirty = false;
      await this.$nextTick();
      this._initYoutubePlayerPanel();
    },

    _applyDraftPayloadToForm(draft) {
      const pl = draft.payload;
      this.form.title = pl.title;
      this.form.body = pl.body_md || '';
      this.form.description = pl.description != null ? pl.description : '';
      this.form.service_types = Array.isArray(pl.service_types) ? [...pl.service_types] : [];
      this.form.client = pl.client || '';
      this.form.date_mmddyyyy = pl.date_mmddyyyy || '';
      this.form.year = pl.year != null ? pl.year : this.form.year;
      this.form.home_size = pl.home_size || '1x1';
      this.form.youtube_url = pl.youtube_url || '';
      this.form.pixieset_url = pl.pixieset_url || '';
      this.form.youtube_thumb_time_sec = pl.youtube_thumb_time_sec;
      this.form.youtube_preview_start_sec = pl.youtube_preview_start_sec;
      if (pl.thumbnail) this.form.thumbnail = pl.thumbnail;
      if (pl.hover_preview) this.form.hover_preview = pl.hover_preview;
      this.thumbFile = draft.thumbFile || null;
      this.videoFile = draft.videoFile || null;
      if (this.thumbFile) {
        MediaUpload.revokePreview(this.thumbPreview);
        this.thumbPreview = MediaUpload.preview(this.thumbFile);
      }
      if (this.videoFile) {
        MediaUpload.revokePreview(this.videoPreview);
        this.videoPreview = MediaUpload.preview(this.videoFile);
      }
    },

    newProject() {
      this._destroyYoutubePanel();
      this.isNew = true;
      this.editSlug = null;
      this.editorOpen = true;
      this.editorLoading = false;
      this._clearUploads();
      this.formDirty = false;

      const existing = this.projectDrafts[DRAFT_NEW];
      this._suppressFormDirty = true;
      const emptyForm = () => ({
        title: '',
        thumbnail: '',
        hover_preview: '',
        service_types: [],
        client: '',
        date_mmddyyyy: '',
        year: new Date().getFullYear(),
        home_size: '1x1',
        youtube_url: '',
        pixieset_url: '',
        body: '',
        description: '',
        youtube_thumb_time_sec: null,
        youtube_preview_start_sec: null,
      });
      this.form = emptyForm();
      if (existing) this._applyDraftPayloadToForm(existing);
      this._mergeYouTubeTimeDraft();

      this.$nextTick(() => {
        this._suppressFormDirty = false;
        this.formDirty = false;
        this._initYoutubePlayerPanel();
      });
    },

    closeEditor() {
      this._destroyYoutubePanel();
      this.editorOpen = false;
      this.editSlug = null;
      this.form = {};
      this.isNew = false;
      this.formDirty = false;
      this.ytPreviewPortrait = false;
      this.pixiesetCidOverride = '';
      this._clearUploads();
    },

    closeEditorGuarded() {
      if (this.formDirty) {
        const ok = confirm(
          'Existem alterações neste formulário que não foram confirmadas com «Salvar». Descartar?',
        );
        if (!ok) return;
      }
      this.closeEditor();
    },

    _clearYouTubeTimeDraftStorage(slug) {
      if (!slug) return;
      try {
        localStorage.removeItem(`reverso-yt-times:${slug}`);
      } catch { /* */ }
    },

    async discardEditorDraft() {
      const key = this.isNew ? DRAFT_NEW : this.form._slug;
      if (this.projectDrafts[key]) {
        delete this.projectDrafts[key];
        this._clearUploads();
        if (this.isNew) {
          this._clearYouTubeTimeDraftStorage(DRAFT_NEW);
          this.closeEditor();
          this._toast('Rascunho do novo projeto removido.', 'success');
          return;
        }
        this._clearYouTubeTimeDraftStorage(this.form._slug);
        await this._reloadEditorFromApi(this.form._slug);
        this.formDirty = false;
        this._toast('Rascunho removido; formulário reposto a partir do servidor.', 'warning');
        return;
      }
      if (this.isNew) {
        if (this.formDirty && !confirm('Descartar alterações não confirmadas?')) return;
        this._clearYouTubeTimeDraftStorage(DRAFT_NEW);
        this.closeEditor();
        return;
      }
      this._clearYouTubeTimeDraftStorage(this.form._slug);
      await this._reloadEditorFromApi(this.form._slug);
      this.formDirty = false;
      this._toast('Alterações não confirmadas descartadas.', 'success');
    },

    async _reloadEditorFromApi(slug) {
      this.editorLoading = true;
      this._clearUploads();
      this._destroyYoutubePanel();
      try {
        const data = await this._api.getProject(slug);
        this._suppressFormDirty = true;
        this.form = {
          ...data,
          body: data.body_md || '',
          description: data.description || '',
          _slug: slug,
        };
        if (!Array.isArray(this.form.service_types)) {
          this.form.service_types = [];
        }
        /* Não fazer _mergeYouTubeTimeDraft aqui: o «Descartar» deve reflectir só o servidor. */
      } catch (e) {
        this._toast('Erro ao recarregar projeto', 'error');
      }
      this.editorLoading = false;
      await this.$nextTick();
      this._suppressFormDirty = false;
      this.formDirty = false;
      await this.$nextTick();
      await this.$nextTick();
      if (typeof requestAnimationFrame === 'function') {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      this._initYoutubePlayerPanel();
    },

    toggleService(svc) {
      const arr = this.form.service_types || [];
      const idx = arr.indexOf(svc);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(svc);
      this.form.service_types = [...arr];
    },

    hasService(svc) {
      return (this.form.service_types || []).includes(svc);
    },

    _buildPayloadFromForm(slugForUploads) {
      const payload = {
        title: this.form.title,
        body_md: this.form.body || '',
        description: (this.form.description || '').trim() || null,
        service_types: this.form.service_types || [],
        client: this.form.client || '',
        date_mmddyyyy: this.form.date_mmddyyyy || '',
        year: this.form.year ? Number(this.form.year) : null,
        home_size: this.form.home_size || '1x1',
        youtube_url: this.form.youtube_url || '',
        pixieset_url: this.form.pixieset_url || '',
        youtube_thumb_time_sec: this._numOrNull(this.form.youtube_thumb_time_sec),
        youtube_preview_start_sec: this._numOrNull(this.form.youtube_preview_start_sec),
      };

      if (this.form.thumbnail) payload.thumbnail = this.form.thumbnail;
      if (this.form.hover_preview) payload.hover_preview = this.form.hover_preview;

      return { payload, slugForUploads };
    },

    /**
     * Inclui o projecto aberto no rascunho de publicação (payload + ficheiros locais
     * de miniatura / vídeo, ex. gerados pelo Pixieset). Sem isto, «Publicar» só
     * enviava a Hero se o utilizador nunca tivesse clicado em «Salvar».
     * @param {{ silent?: boolean }} opts — se silent, não mostra toast nem fecha o editor
     *   (usado antes de «Publicar»).
     * @returns {boolean}
     */
    saveProject(opts = {}) {
      const silent = opts.silent === true;
      if (!this.form.title) {
        this._toast('Título é obrigatório', 'error');
        return false;
      }

      const slug = this.isNew ? this._makeSlug() : this.form._slug;
      const { payload } = this._buildPayloadFromForm(slug);
      const key = this.isNew ? DRAFT_NEW : this.form._slug;

      this.projectDrafts[key] = {
        payload: { ...payload },
        thumbFile: this.thumbFile,
        videoFile: this.videoFile,
        isNew: this.isNew,
        version: this.isNew ? undefined : this.form.version,
      };

      if (!this.isNew) {
        const p = this.projects.find((x) => x._slug === this.form._slug);
        if (p) {
          p.title = this.form.title;
          p.home_size = this.form.home_size || '1x1';
          p.client = this.form.client || '';
          if (this.form.thumbnail) p.thumbnail = this.form.thumbnail;
          if (this.form.hover_preview) p.hover_preview = this.form.hover_preview;
        }
      }

      this.formDirty = false;
      this._persistYouTubeTimeDraft();
      if (!silent) {
        this._toast(
          'Rascunho guardado. Clique em «Publicar» (topo) para enviar ao servidor e atualizar o site.',
          'success',
        );
        this.$nextTick(() => {
          this.closeEditor();
          if (this.view === 'projetos') {
            this.$nextTick(() => this._relayoutMasonry());
          }
        });
      } else if (this.view === 'projetos') {
        this.$nextTick(() => this._relayoutMasonry());
      }
      return true;
    },

    async publishAll() {
      if (!this.canPublish || !this._api) return;

      this.publishing = true;
      this.publishPhase = 'Preparando…';

      try {
        if (this.editorOpen && (this.formDirty || this.thumbFile || this.videoFile)) {
          if (!this.saveProject({ silent: true })) {
            this.publishing = false;
            this.publishPhase = '';
            return;
          }
        }

        const createDraft = this.projectDrafts[DRAFT_NEW];
        const updateKeys = Object.keys(this.projectDrafts).filter((k) => k !== DRAFT_NEW);
        const siteDraft = this.siteDraft;

        if (createDraft) {
          this.publishPhase = 'Criando novo projeto…';
          const slug = this._makeSlugFromPayload(createDraft.payload);
          await this._runUploadsForDraft(slug, createDraft);
          await this._api.createProject({ ...createDraft.payload, slug });
          delete this.projectDrafts[DRAFT_NEW];
        }

        for (const slug of updateKeys) {
          const d = this.projectDrafts[slug];
          if (!d) continue;
          this.publishPhase = `Atualizando «${slug}»…`;
          await this._runUploadsForDraft(slug, d);
          const body = { ...d.payload, version: d.version };
          await this._api.updateProject(slug, body);
          delete this.projectDrafts[slug];
        }

        if (siteDraft && siteDraft.file) {
          this.publishPhase = 'Enviando vídeo da Hero…';
          MediaUpload.validate(siteDraft.file, MediaUpload.VID_TYPES);
          const { key } = await this._api.uploadSiteMedia('hero_video', siteDraft.file);
          this.publishPhase = 'Salvando configuração da Hero…';
          await this._api.updateSetting('hero_video', key);
          this._clearSiteDraftPreview();
          this.siteDraft = null;
        }

        this.publishPhase = 'Disparando deploy no Netlify…';
        try {
          const deployRes = await this._api.triggerDeploy();
          if (deployRes?.skipped) {
            this._toast(
              deployRes.message || 'Deploy adiado (debounce de 5 min). Os dados já foram salvos.',
              'warning',
            );
          } else {
            this._toast('Publicação concluída.', 'success');
          }
        } catch (de) {
          this._toast(
            `Dados salvos no servidor; deploy falhou: ${de.message}`,
            'error',
          );
        }

        await this._loadProjects({ silent: true });
        if (siteDraft) await this._loadSiteSettings();
        this._homeSizeRandomizeSnapshot = null;
        this.closeEditor();
        if (this.view === 'projetos') {
          this.$nextTick(() => this._relayoutMasonry());
        }
      } catch (e) {
        const msg = e.message || String(e);
        if (msg.includes('409') || msg.includes('Conflict')) {
          this._toast('Conflito: recarregue a página e tente de novo.', 'error');
        } else {
          this._toast('Erro ao salvar: ' + msg, 'error');
        }
        await this._loadProjects({ silent: true });
      } finally {
        this.publishing = false;
        this.publishPhase = '';
      }
    },

    async _runUploadsForDraft(slug, draft) {
      if (draft.thumbFile) {
        MediaUpload.validate(draft.thumbFile, MediaUpload.IMG_TYPES);
        const result = await this._api.uploadMedia(slug, 'thumbnail', draft.thumbFile);
        draft.payload.thumbnail = result.key;
      }
      if (draft.videoFile) {
        MediaUpload.validate(draft.videoFile, MediaUpload.VID_TYPES);
        const result = await this._api.uploadMedia(slug, 'preview', draft.videoFile);
        draft.payload.hover_preview = result.key;
      }
    },

    async deleteProject() {
      if (!this.form._slug) return;
      if (!confirm(`Excluir "${this.form.title}"? Esta ação não pode ser desfeita.`)) return;

      const slug = this.form._slug;
      delete this.projectDrafts[slug];

      this.saving = true;
      try {
        const result = await this._api.deleteProject(slug);
        this._toast('Projeto excluído', 'success');
        await this._maybeTriggerDeploy(result);
        this.closeEditor();
        await this._loadProjects({ silent: true });
        if (this.view === 'projetos') {
          this.$nextTick(() => this._relayoutMasonry());
        }
      } catch (e) {
        this._toast('Erro ao excluir: ' + e.message, 'error');
      }
      this.saving = false;
    },

    onThumbChange(e) {
      const file = e.target?.files?.[0];
      if (!file) return;
      try {
        MediaUpload.validate(file, MediaUpload.IMG_TYPES);
        this.thumbFile = file;
        this.thumbPreview = MediaUpload.preview(file);
        this.formDirty = true;
      } catch (err) {
        this._toast(err.message, 'error');
      }
    },

    onVideoChange(e) {
      const file = e.target?.files?.[0];
      if (!file) return;
      try {
        MediaUpload.validate(file, MediaUpload.VID_TYPES);
        this.videoFile = file;
        this.videoPreview = MediaUpload.preview(file);
        this.formDirty = true;
      } catch (err) {
        this._toast(err.message, 'error');
      }
    },

    _destroyYoutubePanel() {
      if (this._ytDurationPoll) {
        try {
          clearInterval(this._ytDurationPoll);
        } catch { /* */ }
        this._ytDurationPoll = null;
      }
      this.ytPlayerIniting = false;
      const Y = globalThis.ReversoYoutubeIframe;
      if (Y && this.ytApiPlayer) {
        try {
          Y.destroyPlayer(this.ytApiPlayer);
        } catch { /* */ }
      }
      this.ytApiPlayer = null;
      this.ytPlayerDuration = 0;
      this.ytScrubTime = 0;
      if (Y && Y.clearPlayerHost) {
        try {
          Y.clearPlayerHost('yt-iframe-admin-host');
        } catch { /* */ }
      }
    },

    _persistYouTubeTimeDraft() {
      const slug = this.isNew ? DRAFT_NEW : this.form?._slug;
      if (!slug) return;
      try {
        localStorage.setItem(
          `reverso-yt-times:${slug}`,
          JSON.stringify({
            u: (this.form?.youtube_url || '').trim(),
            t: this._numOrNull(this.form?.youtube_thumb_time_sec),
            p: this._numOrNull(this.form?.youtube_preview_start_sec),
          }),
        );
      } catch { /* */ }
    },

    _mergeYouTubeTimeDraft() {
      const slug = this.isNew ? DRAFT_NEW : this.form?._slug;
      if (!slug) return;
      let raw;
      try {
        raw = localStorage.getItem(`reverso-yt-times:${slug}`);
      } catch {
        return;
      }
      if (!raw) return;
      let o;
      try {
        o = JSON.parse(raw);
      } catch {
        return;
      }
      if (o.u !== (this.form?.youtube_url || '').trim()) return;
      if (
        o.t != null
        && (this.form.youtube_thumb_time_sec == null || this.form.youtube_thumb_time_sec === '')
      ) {
        this.form.youtube_thumb_time_sec = o.t;
      }
      if (
        o.p != null
        && (this.form.youtube_preview_start_sec == null || this.form.youtube_preview_start_sec === '')
      ) {
        this.form.youtube_preview_start_sec = o.p;
      }
    },

    _pollYoutubeDuration(p) {
      if (this._ytDurationPoll) {
        try {
          clearInterval(this._ytDurationPoll);
        } catch { /* */ }
        this._ytDurationPoll = null;
      }
      if (!p || typeof p.getDuration !== 'function') return;
      const tick = () => {
        let d = 0;
        try {
          d = p.getDuration();
        } catch { /* */ }
        if (d > 0.5) {
          this.ytPlayerDuration = d;
          if (this._ytDurationPoll) {
            try {
              clearInterval(this._ytDurationPoll);
            } catch { /* */ }
            this._ytDurationPoll = null;
          }
        }
      };
      tick();
      if (this.ytPlayerDuration > 0.5) return;
      this._ytDurationPoll = setInterval(tick, 200);
      setTimeout(() => {
        if (this._ytDurationPoll) {
          try {
            clearInterval(this._ytDurationPoll);
          } catch { /* */ }
          this._ytDurationPoll = null;
        }
      }, 10000);
    },

    async _initYoutubePlayerPanel() {
      const Y = globalThis.ReversoYoutubeIframe;
      if (!Y || !this.editorOpen) {
        this._destroyYoutubePanel();
        return;
      }
      const url = (this.form?.youtube_url || '').trim();
      const id = url ? Y.extractVideoId(url) : null;
      if (!id) {
        this._destroyYoutubePanel();
        return;
      }
      this._destroyYoutubePanel();
      this.ytPlayerIniting = true;
      const isShorts =
        (typeof Y.isShortsUrl === 'function' && Y.isShortsUrl(url)) || this.ytPreviewPortrait;
      const w = isShorts ? 300 : 640;
      const h = isShorts ? Math.round((w * 16) / 9) : 360;
      try {
        await this.$nextTick();
        if (typeof requestAnimationFrame === 'function') {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
        const p = await Y.createPlayer('yt-iframe-admin-host', id, {
          width: w,
          height: h,
          timeoutMs: 25000,
        });
        this.ytApiPlayer = p;
        this.ytPlayerDuration = typeof p.getDuration === 'function' ? p.getDuration() : 0;
        this._pollYoutubeDuration(p);
        const t0 = this._numOrNull(this.form?.youtube_thumb_time_sec);
        this.ytScrubTime = t0 != null && t0 > 0 ? t0 : 0;
        if (this.ytPlayerDuration > 0 && this.ytScrubTime > this.ytPlayerDuration) {
          this.ytScrubTime = 0;
        }
        if (typeof p.mute === 'function') p.mute();
        p.seekTo(this.ytScrubTime, true);
      } catch (e) {
        this._toast('YouTube: ' + (e.message || 'falha ao carregar o leitor'), 'error');
      } finally {
        this.ytPlayerIniting = false;
      }
    },

    onYtScrubInput() {
      const t = Number(this.ytScrubTime) || 0;
      const p = this.ytApiPlayer;
      if (p && typeof p.seekTo === 'function') p.seekTo(t, true);
    },

    applyYoutubeThumbTime() {
      this.form.youtube_thumb_time_sec = Number(this.ytScrubTime) || 0;
      this._persistYouTubeTimeDraft();
    },

    applyYoutubePreviewStart() {
      const d = this.ytPlayerDuration || 0;
      const t = Math.min(Number(this.ytScrubTime) || 0, Math.max(0, d - 5.01));
      this.form.youtube_preview_start_sec = t;
      this._persistYouTubeTimeDraft();
    },

    formatYoutubeSec(v) {
      if (v == null || v === '') return '—';
      const n = Number(v);
      return Number.isFinite(n) ? `${n.toFixed(1)} s` : '—';
    },

    /**
     * @param {Blob} blob
     * @param {string} baseName
     */
    _imageFileFromBlob(blob, baseName) {
      const t = blob.type || 'image/jpeg';
      const ext = t.includes('png') ? 'png' : t.includes('webp') ? 'webp' : 'jpg';
      const name = `${baseName.replace(/\.[a-z0-9]+$/i, '')}.${ext}`;
      return new File([blob], name, { type: t });
    },

    /**
     * Gera miniatura (capa) e/ou vídeo de hover a partir do URL Pixieset no formulário.
     * @param {'thumb' | 'video' | 'both'} which
     */
    async generatePixiesetFromLink(which) {
      const galleryUrl = (this.form?.pixieset_url || '').trim();
      if (!galleryUrl) {
        this._toast('Cole o link da galeria Pixieset.', 'error');
        return;
      }
      const S = globalThis.ReversoPixiesetSlideshow;
      if ((which === 'video' || which === 'both') && !S) {
        this._toast('Módulo de slideshow (pixieset-slideshow.js) não carregado.', 'error');
        return;
      }

      this.pixiesetBusy = true;
      try {
        const data = await this._api.pixiesetResolve(galleryUrl, this.pixiesetCidOverride);
        if (which === 'thumb' || which === 'both') {
          if (!data.cover) {
            throw new Error('Não foi possível obter a imagem de capa.');
          }
          const p = `${this._api.base}/api/pixieset/proxy?u=${encodeURIComponent(data.cover)}`;
          const res = await fetch(p, { credentials: 'include' });
          if (!res.ok) {
            throw new Error(`Capa: pedido HTTP ${res.status}`);
          }
          const blob = await res.blob();
          const file = this._imageFileFromBlob(blob, 'pixieset-thumbnail');
          MediaUpload.validate(file, MediaUpload.IMG_TYPES);
          MediaUpload.revokePreview(this.thumbPreview);
          this.thumbFile = file;
          this.thumbPreview = MediaUpload.preview(this.thumbFile);
        }
        if (which === 'video' || which === 'both') {
          const slides = data.slides;
          if (!Array.isArray(slides) || !slides.length) {
            throw new Error('Não foi possível obter as fotos para o vídeo.');
          }
          const buildProxy = (u) =>
            `${this._api.base}/api/pixieset/proxy?u=${encodeURIComponent(u)}`;
          const vBlob = await S.buildWebmFromImages(slides, buildProxy, {
            totalSeconds: 5,
            secondsPerSlide: 1,
            width: 1280,
            height: 720,
          });
          const vFile = new File([vBlob], 'pixieset-hover.webm', {
            type: vBlob.type && vBlob.type.startsWith('video/') ? vBlob.type : 'video/webm',
          });
          MediaUpload.validate(vFile, MediaUpload.VID_TYPES);
          MediaUpload.revokePreview(this.videoPreview);
          this.videoFile = vFile;
          this.videoPreview = MediaUpload.preview(this.videoFile);
        }
        const msg =
          which === 'both'
            ? 'Miniatura e vídeo (5 fotos × 1 s) gerados a partir do Pixieset.'
            : which === 'thumb'
              ? 'Miniatura (capa) gerada a partir do Pixieset.'
              : 'Vídeo de hover gerado a partir de 5 fotos do Pixieset.';
        this._toast(msg, 'success');
        this.formDirty = true;
      } catch (e) {
        this._toast(
          (e && e.message) || 'Falha ao importar do Pixieset. Pode indicar o «cid» opcional (Rede → loadphotos).',
          'error',
        );
      } finally {
        this.pixiesetBusy = false;
      }
    },

    _clearUploads() {
      MediaUpload.revokePreview(this.thumbPreview);
      MediaUpload.revokePreview(this.videoPreview);
      this.thumbFile = null;
      this.thumbPreview = null;
      this.videoFile = null;
      this.videoPreview = null;
    },

    async _maybeTriggerDeploy(result) {
      if (!result?.triggerDeploy) return;
      try {
        const deployRes = await this._api.triggerDeploy();
        if (deployRes?.skipped) {
          this._toast(
            deployRes.message || 'Deploy no Netlify adiado (debounce de 5 min).',
            'warning',
          );
        }
      } catch (e) {
        this._toast('Deploy no Netlify falhou: ' + e.message, 'error');
      }
    },

    /* ====== Masonry (Projetos tab — simula a Home) ======
     *
     * Replica fielmente o algoritmo de «masonry-init.js» da Home:
     *   1. Packery é criado APENAS com os primeiros INITIAL_VISIBLE itens
     *      (os restantes recebem a classe `is-pack-hidden` e são filtrados
     *      pelo `itemSelector`).
     *   2. Em lotes de LOAD_STEP, removemos a classe e chamamos
     *      `packery.appended(lote)` — que PRESERVA as posições dos itens
     *      já colocados e encaixa os novos nos vãos. Sem isso, um único
     *      `layout()` com todos os itens produz um packing diferente.
     *   3. Durante o progressive append, `transitionDuration` é 0 para não
     *      animar; depois restauramos 0.25s (idêntico à Home).
     *
     * `_masonryDomOrder` é um Map construído UMA VEZ a partir da ordem
     * cronológica do DOM, e usado como tiebreaker estável na ordenação
     * por área decrescente (igual à Home).
     */

    _masonryConfig: {
      GUTTER: 4,
      BASE_ITEM: 200,
      MIN_COL: 150,
      INITIAL_VISIBLE: 12,
      LOAD_STEP: 8,
    },
    _masonryDomOrder: null,

    _initMasonry() {
      const grid = document.getElementById('admin-masonry-grid');
      const container = document.getElementById('admin-masonry-container');
      if (!grid || !container) return;
      if (typeof Packery === 'undefined') return;

      this._destroyMasonry();

      const allItems = Array.from(grid.querySelectorAll('.admin-project-item'));
      if (!allItems.length) {
        this.masonryReady = true;
        return;
      }

      // Mapa DOM order (cronológico) — construído UMA ÚNICA VEZ e usado
      // como tiebreaker em todas as ordenações por área.
      this._masonryDomOrder = new Map();
      allItems.forEach((el, i) => this._masonryDomOrder.set(el, i));

      const { columnWidth, rowHeight, columns } = this._calcMasonryGrid(container);
      allItems.forEach((el) => this._sizeMasonryItem(el, columnWidth, rowHeight, columns));

      const { INITIAL_VISIBLE, LOAD_STEP } = this._masonryConfig;
      const firstBatch = allItems.slice(0, INITIAL_VISIBLE);
      const rest = allItems.slice(INITIAL_VISIBLE);

      // Oculta os itens para além dos 12 primeiros (mesma classe usada
      // pela Home). Será removida lote-a-lote no progressive append.
      rest.forEach((el) => el.classList.add('is-pack-hidden'));

      this._packery = new Packery(grid, {
        // Filtra hidden: idêntico ao selector da Home.
        itemSelector: '.admin-project-item:not(.is-pack-hidden)',
        gutter: this._masonryConfig.GUTTER,
        columnWidth,
        rowHeight,
        percentPosition: false,
        initLayout: false,
        transitionDuration: 0,
      });
      this._reorderMasonryForPacking();
      this._packery.layout();

      // Progressive append em lotes de 8. Cada chamada de `appended()`
      // preserva os itens já colocados e encaixa os novos — exactamente
      // como a Home faria ao clicar «Carregar mais» repetidamente.
      for (let cursor = 0; cursor < rest.length; cursor += LOAD_STEP) {
        const batch = rest.slice(cursor, cursor + LOAD_STEP);
        batch.forEach((el) => el.classList.remove('is-pack-hidden'));
        const ordered = batch.slice().sort((a, b) => this._compareBySizeAndDom(a, b));
        try {
          this._packery.appended(ordered);
        } catch (_) { /* ignore */ }
      }

      // Restaura a transição para futuros relayouts (resize).
      this._packery.options.transitionDuration = '0.25s';
      this.masonryReady = true;

      if (!this._masonryResizeBound) {
        // Debounce 200ms — idêntico ao handleResize da Home — evita
        // re-init em cascata durante o arraste da janela.
        let timer = null;
        this._masonryResizeBound = () => {
          clearTimeout(timer);
          timer = setTimeout(() => this._relayoutMasonry(), 200);
        };
        window.addEventListener('resize', this._masonryResizeBound);
      }
    },

    /**
     * Resize / alteração de dados. Em caso de mudança significativa
     * (contagem de colunas, randomização, novo item, remoção) fazemos um
     * re-init completo para manter o algoritmo two-phase idêntico ao da
     * Home. Em resize sem troca de `columns` poderíamos só redimensionar;
     * por simplicidade e paridade, sempre re-iniciamos.
     */
    _relayoutMasonry() {
      if (this.view !== 'projetos') return;
      const grid = document.getElementById('admin-masonry-grid');
      if (!grid) return;
      // Limpa qualquer `is-pack-hidden` remanescente antes do re-init
      // (evita que o próximo init herde estado dos lotes anteriores).
      grid.querySelectorAll('.admin-project-item.is-pack-hidden')
        .forEach((el) => el.classList.remove('is-pack-hidden'));
      this._initMasonry();
    },

    _destroyMasonry() {
      if (this._packery) {
        try { this._packery.destroy(); } catch (_) { /* ignore */ }
        this._packery = null;
      }
      if (this._masonryResizeBound) {
        window.removeEventListener('resize', this._masonryResizeBound);
        this._masonryResizeBound = null;
      }
      this._masonryDomOrder = null;
      this.masonryReady = false;
    },

    /**
     * Comparador estável: ordena por área (maiores primeiro, idêntico ao
     * `reorderPackeryItemsForPacking` da Home) e usa a ordem DOM
     * cronológica como tiebreaker. Opera em elementos DOM.
     */
    _compareBySizeAndDom(a, b) {
      const sA = this._parseSize(a);
      const sB = this._parseSize(b);
      const areaA = sA.w * sA.h;
      const areaB = sB.w * sB.h;
      if (areaA !== areaB) return areaB - areaA;
      const domOrder = this._masonryDomOrder;
      const iA = domOrder ? domOrder.get(a) : 0;
      const iB = domOrder ? domOrder.get(b) : 0;
      return (iA ?? 0) - (iB ?? 0);
    },

    _calcMasonryGrid(container) {
      const { GUTTER, BASE_ITEM, MIN_COL } = this._masonryConfig;
      const rect = container.getBoundingClientRect();
      const containerWidth = Math.max(rect.width || 0, container.clientWidth || 0);
      const columns = Math.max(
        1,
        Math.floor((containerWidth + GUTTER) / (BASE_ITEM + GUTTER)),
      );
      const rawCol = Math.floor((containerWidth - GUTTER * (columns - 1)) / columns);
      const columnWidth = Math.max(MIN_COL, rawCol);
      return { columnWidth, rowHeight: columnWidth, columns };
    },

    _parseSize(item) {
      const [w, h] = (item.getAttribute('data-size') || '1x1').split('x').map(Number);
      return { w: w || 1, h: h || 1 };
    },

    _sizeMasonryItem(item, columnWidth, rowHeight, columns) {
      const { GUTTER } = this._masonryConfig;
      let { w, h } = this._parseSize(item);
      if (columns && w > columns) w = columns;
      item.style.width = `${w * columnWidth + (w - 1) * GUTTER}px`;
      item.style.height = `${h * rowHeight + (h - 1) * GUTTER}px`;
    },

    _reorderMasonryForPacking() {
      if (!this._packery || !this._packery.items) return;
      // Usa o mapa estável construído em `_initMasonry` (ordem DOM
      // cronológica original). NÃO deriva do estado actual do Packery,
      // que já foi reordenado por chamadas anteriores.
      this._packery.items.sort((a, b) =>
        this._compareBySizeAndDom(a.element, b.element),
      );
    },

    _makeSlug() {
      return this._makeSlugFromPayload({
        date_mmddyyyy: this.form.date_mmddyyyy,
        title: this.form.title,
        client: this.form.client,
      });
    },

    _makeSlugFromPayload(p) {
      const d = p.date_mmddyyyy || '';
      const title = (p.title || 'projeto')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
        .toLowerCase();
      const client = (p.client || 'cliente')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
        .toLowerCase();
      return `${d}-${title}-${client}`;
    },

    _toast(msg, type) {
      this.toast = { msg, type };
      setTimeout(() => {
        this.toast = null;
      }, 4000);
    },

    get serviceOptions() {
      return ADMIN_CONFIG.serviceTypes;
    },

    get youtubeIframeBlockVisible() {
      const Y = globalThis.ReversoYoutubeIframe;
      const u = (this.form?.youtube_url || '').trim();
      return !!(Y && u && Y.extractVideoId(u));
    },

    /** True quando o link já é do formato /shorts/ (o leitor 9:16 aplica-se automaticamente). */
    get isYoutubeUrlShortsFormat() {
      const Y = globalThis.ReversoYoutubeIframe;
      const u = (this.form?.youtube_url || '').trim();
      return !!(Y && u && Y.isShortsUrl && Y.isShortsUrl(u));
    },
  };
}
