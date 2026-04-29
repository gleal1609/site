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

/** Posição na coluna Home (1-based). Valores inválidos/atraso → fim da pilha. */
function coerceHomeOrderNum(v) {
  const n = v != null && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 999999;
}

function dateMmddyyyySortKey(p) {
  const s = p && p.date_mmddyyyy != null ? String(p.date_mmddyyyy) : '';
  if (s.length === 8 && /^\d{8}$/.test(s)) {
    return s.slice(4) + s.slice(0, 4);
  }
  const y = p && p.year != null ? Number(p.year) : 0;
  return y ? String(10000 + y) : '0';
}

function truthyShowOnHome(p) {
  if (!p) return false;
  const v = p.show_on_home;
  return v === true || v === 1 || v === '1';
}

function displayHomeOrderBadge(p) {
  const n = p && p.order != null && p.order !== '' ? Number(p.order) : NaN;
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function adminApp() {
  return {
    authed: false,
    user: null,

    projects: [],
    baselineProjects: [],
    loading: true,
    saving: false,

    /** view: 'hero' | 'home' (5 col + Sortable) | 'projetos' (lista por data) */
    view: 'hero',
    _homeSortableInstances: [],
    /** @type {Record<string, { payload: object, thumbFile: File|null, videoFile: File|null, isNew: boolean, version?: number }>} */
    projectDrafts: {},

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

    /** YouTube preview — HTML5 video via servidor local */
    ytLocalPreviewUrl: null,
    ytLocalPreviewLoading: false,
    ytPlayerDuration: 0,
    ytScrubTime: 0,
    _lastYtVideoId: null,
    /** Estado do botão «Gerar capa e prévia» para evitar duplos cliques. */
    ytIngestBusy: false,
    /** Importação Pixieset — capa + slideshow */
    pixiesetBusy: false,
    /** Servidor local de mídia (localhost:7847) */
    localServerAvailable: false,
    localServerChecking: false,
    _ytUrlDebounce: null,

    publishing: false,
    publishPhase: '',

    _auth: null,
    _api: null,
    _beforeUnloadBound: null,
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

      this._checkLocalServer();
      this._localServerPollInterval = setInterval(() => this._checkLocalServer(), 30000);

      window.addEventListener('reverso-local-server:online', () => {
        if (this.localServerAvailable) return;
        this._checkLocalServer().then(() => {
          if (this.localServerAvailable && this.editorOpen) {
            this._initYoutubePlayerPanel();
          }
        });
      });

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
      if (this.view === 'home') {
        this.$nextTick(() => this._initMasonry());
        return;
      }
      if (this.view === 'projetos') {
        this._destroyMasonry();
      }
    },

    /** 5 colunas: D1 `home_col` 1–5 + order *dentro* da coluna (1 = primeiro; igual Jekyll). Legado `home_col` 0–4 = índice. */
    get visibleHomeProjectCols() {
      if (this.view !== 'home') return [[], [], [], [], []];
      const arr = this.projects.filter((p) => truthyShowOnHome(p));
      arr.sort((a, b) => {
        const oa = coerceHomeOrderNum(a.order);
        const ob = coerceHomeOrderNum(b.order);
        if (oa !== ob) return oa - ob;
        return String(a._slug).localeCompare(String(b._slug));
      });
      const cols = [[], [], [], [], []];
      arr.forEach((p, i) => {
        const n = p.home_col != null && p.home_col !== '' ? Number(p.home_col) : NaN;
        let idx;
        if (Number.isFinite(n) && n >= 1 && n <= 5) {
          idx = (n - 1) | 0;
        } else if (Number.isFinite(n) && n >= 0 && n <= 4) {
          idx = n | 0;
        } else {
          idx = i % 5;
        }
        if (idx < 0) idx = 0;
        if (idx > 4) idx = 4;
        cols[idx].push(p);
      });
      for (let cc = 0; cc < 5; cc += 1) {
        cols[cc].sort((a, b) => {
          const oa = coerceHomeOrderNum(a.order);
          const ob = coerceHomeOrderNum(b.order);
          if (oa !== ob) return oa - ob;
          return String(a._slug).localeCompare(String(b._slug));
        });
      }
      return cols;
    },

    homeColItems(c) {
      const cols = this.visibleHomeProjectCols;
      return cols && cols[c] ? cols[c] : [];
    },

    get visibleHomeProjects() {
      if (this.view !== 'home') return [];
      const cols = this.visibleHomeProjectCols;
      const out = [];
      for (let c = 0; c < 5; c += 1) {
        (cols[c] || []).forEach((p) => out.push(p));
      }
      return out;
    },

    /** Todos os projetos, data mais recente primeiro (tab Projetos). */
    get projectsListByDate() {
      if (this.view !== 'projetos') return [];
      const arr = this.projects.slice();
      arr.sort((a, b) => {
        const ka = dateMmddyyyySortKey(a);
        const kb = dateMmddyyyySortKey(b);
        const c = kb.localeCompare(ka);
        if (c !== 0) return c;
        return String(a._slug).localeCompare(String(b._slug));
      });
      return arr;
    },

    get heroPreviewSrc() {
      if (this.siteDraft && this.siteDraft.previewUrl) return this.siteDraft.previewUrl;
      return this.siteSettings.hero_video || null;
    },

    hasDraftFor(slug) {
      return !!this.projectDrafts[slug];
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
        order: displayHomeOrderBadge(p),
        home_col: Math.max(1, Math.min(5, Number(p.home_col) || 1)),
        home_size: p.home_size || '1x1',
        show_on_home: truthyShowOnHome(p) ? 1 : 0,
        youtube_url: p.youtube_url || '',
        pixieset_url: p.pixieset_url || '',
        youtube_thumb_time_sec: this._numOrNull(p.youtube_thumb_time_sec),
        youtube_preview_start_sec: this._numOrNull(p.youtube_preview_start_sec),
      };
      if (p.thumbnail) base.thumbnail = p.thumbnail;
      if (p.hover_preview) base.hover_preview = p.hover_preview;
      const out = { ...base, ...overrides };
      if (overrides.show_on_home !== undefined) {
        out.show_on_home = truthyShowOnHome({ show_on_home: overrides.show_on_home }) ? 1 : 0;
      }
      if (overrides.order !== undefined) {
        const n = Number(overrides.order);
        out.order = Number.isFinite(n) && n >= 1 ? n : 1;
      }
      if (overrides.home_col !== undefined) {
        out.home_col = Math.max(1, Math.min(5, Number(overrides.home_col) || 1));
      }
      return out;
    },

    async openEditor(project) {
      this._destroyYoutubePanel(true);
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
        this.form.show_on_home = truthyShowOnHome(this.form);
        if (this.form.order == null || this.form.order === '' || Number(this.form.order) < 1) {
          this.form.order = 1;
        }
        if (this.form.home_col == null || this.form.home_col === '') this.form.home_col = 1;
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
      this.form.show_on_home = truthyShowOnHome(pl);
      this.form.order = displayHomeOrderBadge({ order: pl.order });
      this.form.home_col = pl.home_col != null ? pl.home_col : 1;
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
      this._destroyYoutubePanel(true);
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
        show_on_home: false,
        home_col: 1,
        order: 1,
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
      this._destroyYoutubePanel(true);
      this.editorOpen = false;
      this.editSlug = null;
      this.form = {};
      this.isNew = false;
      this.formDirty = false;
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
      this._destroyYoutubePanel(true);
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
      let orderVal =
        this.form.order != null && this.form.order !== '' ? Number(this.form.order) : 1;
      if (!Number.isFinite(orderVal) || orderVal < 1) orderVal = 1;
      const hcVal =
        this.form.home_col != null && this.form.home_col !== '' ? Number(this.form.home_col) : 1;
      const homeCol = Math.max(1, Math.min(5, Number.isFinite(hcVal) ? hcVal : 1));
      const payload = {
        title: this.form.title,
        body_md: this.form.body || '',
        description: (this.form.description || '').trim() || null,
        service_types: this.form.service_types || [],
        client: this.form.client || '',
        date_mmddyyyy: this.form.date_mmddyyyy || '',
        year: this.form.year ? Number(this.form.year) : null,
        order: orderVal,
        home_col: homeCol,
        home_size: this.form.home_size || '1x1',
        show_on_home: this.form.show_on_home ? 1 : 0,
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
          p.show_on_home = this.form.show_on_home ? 1 : 0;
          p.order = payload.order != null ? payload.order : 1;
          p.home_col = payload.home_col;
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
          if (this.view === 'home') {
            this.$nextTick(() => this._relayoutMasonry());
          }
        });
      } else if (this.view === 'home') {
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
        this.closeEditor();
        if (this.view === 'home') {
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
        if (this.view === 'home') {
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

    _destroyYoutubePanel(resetVideoId) {
      this.ytLocalPreviewLoading = false;
      this.ytPlayerDuration = 0;
      this.ytScrubTime = 0;
      if (resetVideoId) {
        this._lastYtVideoId = null;
        this.ytLocalPreviewUrl = null;
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

    _extractYoutubeVideoId(url) {
      if (!url || typeof url !== 'string') return null;
      const u = url.trim();
      let m = u.match(/youtube\.com\/shorts\/([^?&/]+)/i);
      if (m) return m[1];
      m = u.match(/[?&]v=([^&]+)/i);
      if (m) return m[1];
      m = u.match(/youtu\.be\/([^?&/]+)/i);
      if (m) return m[1];
      m = u.match(/youtube\.com\/embed\/([^?&/]+)/i);
      if (m) return m[1];
      return null;
    },

    async _initYoutubePlayerPanel(forceRetry) {
      const url = (this.form?.youtube_url || '').trim();
      const id = this._extractYoutubeVideoId(url);

      if (!id || !this.editorOpen || !this.localServerAvailable) {
        this._destroyYoutubePanel(true);
        return;
      }

      if (!forceRetry && id === this._lastYtVideoId && this.ytLocalPreviewUrl) {
        return;
      }

      const LS = globalThis.ReversoLocalServer;
      if (!LS) { this._destroyYoutubePanel(true); return; }

      this._destroyYoutubePanel();
      this._lastYtVideoId = id;
      this.ytLocalPreviewLoading = true;

      try {
        const data = await LS.youtubePreview(url);
        if (!this.editorOpen || this._lastYtVideoId !== id) return;

        this.ytLocalPreviewUrl = data.preview_url;
        this.ytLocalPreviewLoading = false;

        await this.$nextTick();
        const vid = document.getElementById('yt-local-video');
        if (vid) {
          vid.src = data.preview_url;
          vid.load();
        }
      } catch (e) {
        console.warn('[preview local] Falhou:', e.message);
        this.ytLocalPreviewLoading = false;
        this.ytLocalPreviewUrl = null;
        this._toast('Preview local falhou: ' + (e.message || ''), 'error');
      }
    },

    onLocalVideoLoaded() {
      const vid = document.getElementById('yt-local-video');
      if (!vid) return;
      this.ytPlayerDuration = vid.duration || 0;
      const t0 = this._numOrNull(this.form?.youtube_thumb_time_sec);
      this.ytScrubTime = t0 != null && t0 > 0 ? t0 : 0;
      if (this.ytPlayerDuration > 0 && this.ytScrubTime > this.ytPlayerDuration) {
        this.ytScrubTime = 0;
      }
      vid.currentTime = this.ytScrubTime;
    },

    retryYoutubePlayer() {
      this._lastYtVideoId = null;
      this._initYoutubePlayerPanel(true);
    },

    onYtScrubInput() {
      const t = Number(this.ytScrubTime) || 0;
      const vid = document.getElementById('yt-local-video');
      if (vid) { vid.currentTime = t; vid.pause(); }
    },

    applyYoutubeThumbTime() {
      this.form.youtube_thumb_time_sec = Number(this.ytScrubTime) || 0;
      this.formDirty = true;
      this._persistYouTubeTimeDraft();
    },

    applyYoutubePreviewStart() {
      const d = this.ytPlayerDuration || 0;
      const t = Math.min(Number(this.ytScrubTime) || 0, Math.max(0, d - 5.01));
      this.form.youtube_preview_start_sec = t;
      this.formDirty = true;
      this._persistYouTubeTimeDraft();
    },

    async _checkLocalServer() {
      const LS = globalThis.ReversoLocalServer;
      if (!LS) { this.localServerAvailable = false; return; }
      this.localServerChecking = true;
      try {
        this.localServerAvailable = await LS.checkHealth();
      } catch {
        this.localServerAvailable = false;
      } finally {
        this.localServerChecking = false;
      }
    },

    async ingestYoutubeFromPanel() {
      if (this.ytIngestBusy) return;
      if (!this.localServerAvailable) {
        this._toast('Inicie o Reverso Media Server (.bat) para usar esta função.', 'warning');
        return;
      }
      const url = (this.form?.youtube_url || '').trim();
      if (!url) {
        this._toast('URL do YouTube em falta.', 'error');
        return;
      }
      return this._ingestYoutubeLocal(url);
    },

    async _ingestYoutubeLocal(youtubeUrl) {
      const LS = globalThis.ReversoLocalServer;
      if (!LS) return;

      this.ytIngestBusy = true;
      try {
        this._toast('Gerando capa e prévia localmente... Isso pode levar alguns minutos.', 'info');
        const result = await LS.ingestYoutube({
          youtube_url: youtubeUrl,
          thumb_time_sec: Number(this.form?.youtube_thumb_time_sec) || 0,
          preview_start_sec: Number(this.form?.youtube_preview_start_sec) || 0,
        });

        const thumbFile = new File([result.poster], 'yt-poster.jpg', { type: 'image/jpeg' });
        MediaUpload.validate(thumbFile, MediaUpload.IMG_TYPES);
        MediaUpload.revokePreview(this.thumbPreview);
        this.thumbFile = thumbFile;
        this.thumbPreview = MediaUpload.preview(thumbFile);

        const videoFile = new File([result.hover], 'yt-hover.mp4', { type: 'video/mp4' });
        MediaUpload.validate(videoFile, MediaUpload.VID_TYPES);
        MediaUpload.revokePreview(this.videoPreview);
        this.videoFile = videoFile;
        this.videoPreview = MediaUpload.preview(videoFile);

        this.formDirty = true;
        this._toast('Capa e prévia geradas com sucesso! Use «Salvar» e «Publicar» para aplicar.', 'success');
      } catch (e) {
        this._toast('Falha ao gerar localmente: ' + (e.message || String(e)), 'error');
      } finally {
        this.ytIngestBusy = false;
      }
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

      if (!this.localServerAvailable) {
        this._toast('Inicie o Reverso Media Server (.bat) para usar esta função.', 'warning');
        return;
      }
      const LS = globalThis.ReversoLocalServer;
      if (!LS) { this._toast('Cliente do servidor local não carregado.', 'error'); return; }

      this.pixiesetBusy = true;
      try {
        const data = await LS.resolvePixieset(galleryUrl);
        if (which === 'thumb' || which === 'both') {
          if (!data.cover) {
            throw new Error('Não foi possível obter a imagem de capa.');
          }
          const proxyUrl = LS.pixiesetProxyUrl(data.cover);
          const res = await fetch(proxyUrl);
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
          const buildProxy = (u) => LS.pixiesetProxyUrl(u);
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
        const msg = (e && e.message) || '';
        this._toast(msg || 'Falha ao importar do Pixieset.', 'error');
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

    /* ====== Home: 5 colunas empilhadas + Sortable (igual site; sem vãos) ====== */
    _masonryConfig: {
      GUTTER: 14,
      HOME_COLS: 5,
      INITIAL_VISIBLE: 12,
      LOAD_STEP: 8,
    },
    _masonryDomOrder: null,

    _rasterOrderAdminEls() {
      const root = document.getElementById('admin-masonry-cols');
      if (!root) return [];
      const colEls = root.querySelectorAll('.admin-projects-col');
      const buckets = Array.from(colEls).map((c) => Array.from(c.querySelectorAll('.admin-project-item')));
      const maxH = Math.max(0, ...buckets.map((b) => b.length), 0);
      const out = [];
      for (let r = 0; r < maxH; r += 1) {
        for (let c = 0; c < 5; c += 1) {
          if (buckets[c] && buckets[c][r]) out.push(buckets[c][r]);
        }
      }
      return out;
    },

    _homeGridClickHandler: null,
    _homeGridKeyHandler: null,

    _escHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    _escAttr(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    _renderHomeItemHtml(p, colNum) {
      const size = p.home_size || '1x1';
      const order = displayHomeOrderBadge(p);
      const slug = p._slug || '';
      const title = this._escHtml(p.title || '');
      const client = this._escHtml(p.client || '');
      const thumb = p.thumbnail || '';
      const hasDraft = !!this.projectDrafts[slug];
      const sizeLabel = size === '1x1.5' ? '1\u00d71,5' : size.replace('x', '\u00d7');

      const thumbHtml = thumb
        ? '<img src="' + this._escAttr(thumb) + '" alt="' + this._escAttr(p.title || '') + '" loading="lazy" draggable="false"/>'
        : '<div class="admin-project-item__ph" aria-hidden="true">Sem imagem</div>';

      const clientHtml = client
        ? '<p class="admin-project-item__client">' + client + '</p>'
        : '';

      const draftDisplay = hasDraft ? '' : 'display:none';

      const dragHandleSvg = '<svg viewBox="0 0 16 16"><circle cx="4" cy="2" r="1.5"/><circle cx="4" cy="8" r="1.5"/><circle cx="4" cy="14" r="1.5"/><circle cx="12" cy="2" r="1.5"/><circle cx="12" cy="8" r="1.5"/><circle cx="12" cy="14" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>';

      const draftBadge = hasDraft
        ? '<span class="gc-badge draft">Rascunho</span>'
        : '';

      return '<a href="#" class="admin-project-item"'
        + ' data-size="' + this._escAttr(size) + '"'
        + ' data-order="' + order + '"'
        + ' data-home-col="' + colNum + '"'
        + ' data-slug="' + this._escAttr(slug) + '"'
        + ' draggable="false"'
        + ' role="button"'
        + ' aria-label="' + this._escAttr(p.title || '') + '"'
        + ' tabindex="0">'
        + '<div class="admin-project-item__meta-badges" aria-hidden="true">'
        + '<span class="gc-badge order">#' + order + '</span>'
        + '<span class="gc-badge home">C' + colNum + '</span>'
        + '<span class="gc-badge size">' + sizeLabel + '</span>'
        + draftBadge
        + '</div>'
        + '<div class="admin-project-item__drag-handle" title="Arrastar">' + dragHandleSvg + '</div>'
        + '<div class="admin-project-item__thumb">' + thumbHtml + '</div>'
        + '<div class="admin-project-item__overlay">'
        + '<h3 class="admin-project-item__title">' + title + '</h3>'
        + clientHtml
        + '</div>'
        + '</a>';
    },

    _renderHomeGrid() {
      const root = document.getElementById('admin-masonry-cols');
      if (!root) return;
      const colEls = root.querySelectorAll('.admin-projects-col');
      if (colEls.length !== 5) return;

      const cols = this.visibleHomeProjectCols;
      for (let c = 0; c < 5; c++) {
        const items = cols[c] || [];
        const colNum = c + 1;
        colEls[c].innerHTML = items.map((p) => this._renderHomeItemHtml(p, colNum)).join('');
      }
    },

    _setupHomeGridClickHandler() {
      const root = document.getElementById('admin-masonry-cols');
      if (!root) return;
      this._removeHomeGridClickHandler();

      this._homeGridClickHandler = (e) => {
        if (e.target.closest('.admin-project-item__drag-handle')) return;
        const item = e.target.closest('.admin-project-item');
        if (!item) return;
        e.preventDefault();
        const slug = item.getAttribute('data-slug');
        if (!slug) return;
        const p = this.projects.find((x) => x._slug === slug);
        if (p) this.openEditor(p);
      };

      this._homeGridKeyHandler = (e) => {
        if (e.key !== 'Enter') return;
        const item = e.target.closest('.admin-project-item');
        if (!item) return;
        e.preventDefault();
        const slug = item.getAttribute('data-slug');
        if (!slug) return;
        const p = this.projects.find((x) => x._slug === slug);
        if (p) this.openEditor(p);
      };

      root.addEventListener('click', this._homeGridClickHandler);
      root.addEventListener('keydown', this._homeGridKeyHandler);
    },

    _removeHomeGridClickHandler() {
      const root = document.getElementById('admin-masonry-cols');
      if (!root) return;
      if (this._homeGridClickHandler) {
        root.removeEventListener('click', this._homeGridClickHandler);
        this._homeGridClickHandler = null;
      }
      if (this._homeGridKeyHandler) {
        root.removeEventListener('keydown', this._homeGridKeyHandler);
        this._homeGridKeyHandler = null;
      }
    },

    _initMasonry() {
      const cols = document.getElementById('admin-masonry-cols');
      if (!cols) {
        this.masonryReady = true;
        return;
      }
      if (typeof Sortable === 'undefined') {
        this.masonryReady = true;
        return;
      }
      this._destroyMasonry();

      this.$nextTick(() => {
        this._renderHomeGrid();
        this._setupHomeGridClickHandler();

        const allEls = Array.from(cols.querySelectorAll('.admin-project-item'));
        if (!allEls.length) {
          this.masonryReady = true;
          return;
        }

        const { columnWidth, rowHeight, columns } = this._calcMasonryGrid(cols);
        allEls.forEach((el) => {
          el.classList.remove('is-pack-hidden');
          this._sizeMasonryItem(el, columnWidth, rowHeight, columns);
        });

        const colEls = cols.querySelectorAll('.admin-projects-col');
        colEls.forEach((cel) => {
          const s = Sortable.create(cel, {
            group: 'reverso-home-cols',
            handle: '.admin-project-item__drag-handle',
            animation: 250,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            draggable: '.admin-project-item',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            forceFallback: true,
            fallbackClass: 'sortable-fallback',
            fallbackOnBody: true,
            fallbackTolerance: 2,
            swapThreshold: 0.55,
            emptyInsertThreshold: 200,
            scrollSensitivity: 120,
            scrollSpeed: 14,
            bubbleScroll: true,
            onStart: () => {
              document.body.classList.add('admin-home-sorting');
            },
            onEnd: () => {
              document.body.classList.remove('admin-home-sorting');
              this._applyHomeOrderFromSortable();
              this._reapplyAdminMasonrySizes();
            },
          });
          this._homeSortableInstances.push(s);
        });

        this.masonryReady = true;

        if (!this._masonryResizeBound) {
          let timer = null;
          this._masonryResizeBound = () => {
            clearTimeout(timer);
            timer = setTimeout(() => this._reapplyAdminMasonrySizes(), 200);
          };
          window.addEventListener('resize', this._masonryResizeBound);
        }
      });
    },

    _applyHomeOrderFromSortable() {
      const root = document.getElementById('admin-masonry-cols');
      if (!root) return;
      const colEls = root.querySelectorAll('.admin-projects-col');
      colEls.forEach((el, cIdx) => {
        if (cIdx < 0 || cIdx > 4) return;
        const colNum = cIdx + 1;
        const links = el.querySelectorAll('.admin-project-item');
        links.forEach((node, i) => {
          const slug = node.getAttribute('data-slug');
          if (!slug) return;

          const pos = i + 1;
          node.setAttribute('data-order', String(pos));
          node.setAttribute('data-home-col', String(colNum));

          const orderBadge = node.querySelector('.gc-badge.order');
          if (orderBadge) orderBadge.textContent = '#' + pos;
          const homeBadge = node.querySelector('.gc-badge.home');
          if (homeBadge) homeBadge.textContent = 'C' + colNum;

          const badges = node.querySelector('.admin-project-item__meta-badges');
          if (badges && !badges.querySelector('.gc-badge.draft')) {
            const d = document.createElement('span');
            d.className = 'gc-badge draft';
            d.textContent = 'Rascunho';
            badges.appendChild(d);
          }

          const p = this.projects.find((x) => x._slug === slug);
          if (p) {
            p.order = pos;
            p.home_col = colNum;
          }
          const ex = this.projectDrafts[slug];
          const pl = { order: pos, home_col: colNum };
          if (ex) {
            ex.payload = { ...ex.payload, ...pl };
          } else if (p) {
            this.projectDrafts[slug] = {
              payload: this._projectToPayload(p, pl),
              thumbFile: null,
              videoFile: null,
              isNew: false,
              version: p.version,
            };
          }
        });
      });
    },

    _reapplyAdminMasonrySizes() {
      const cols = document.getElementById('admin-masonry-cols');
      if (!cols) return;
      const { columnWidth, rowHeight, columns } = this._calcMasonryGrid(cols);
      cols.querySelectorAll('.admin-project-item').forEach((el) => {
        this._sizeMasonryItem(el, columnWidth, rowHeight, columns);
      });
    },

    _relayoutMasonry() {
      if (this.view !== 'home') return;
      this._destroyMasonry();
      this._initMasonry();
    },

    _destroyMasonry() {
      document.body.classList.remove('admin-home-sorting');
      this._removeHomeGridClickHandler();
      this._homeSortableInstances.forEach((s) => {
        try { s.destroy(); } catch (_) {}
      });
      this._homeSortableInstances = [];
      if (this._masonryResizeBound) {
        window.removeEventListener('resize', this._masonryResizeBound);
        this._masonryResizeBound = null;
      }
      this._masonryDomOrder = null;
      this.masonryReady = false;
    },

    _calcMasonryGrid(sizingEl) {
      const { GUTTER, HOME_COLS } = this._masonryConfig;
      if (!sizingEl) {
        return { columnWidth: 1, rowHeight: 1, columns: HOME_COLS };
      }
      const wGrid = Math.max(
        sizingEl.getBoundingClientRect().width || 0,
        sizingEl.clientWidth || 0,
      );
      const parent = sizingEl.parentElement;
      let W = wGrid;
      if (parent && (parent.id === 'admin-masonry-container' || parent.classList?.contains('admin-masonry-container'))) {
        const st = getComputedStyle(parent);
        const pl = parseFloat(st.paddingLeft) || 0;
        const pr = parseFloat(st.paddingRight) || 0;
        const wInner = parent.getBoundingClientRect().width - pl - pr;
        W = Math.max(0, Math.min(wGrid, wInner));
      }
      const col = (W - 4 * GUTTER) / HOME_COLS;
      const columnWidth = Math.max(1, Math.floor(col * 1000) / 1000);
      return { columnWidth, rowHeight: columnWidth, columns: HOME_COLS };
    },

    _parseMasonrySize(item) {
      const s = String(item.getAttribute('data-size') || '1x1')
        .toLowerCase()
        .replace(/\s/g, '');
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
    },

    _sizeMasonryItem(item, columnWidth, rowHeight, columns) {
      const { GUTTER } = this._masonryConfig;
      let { w, h } = this._parseMasonrySize(item);
      if (w > columns) w = columns;
      item.style.width = `${w * columnWidth + (w - 1) * GUTTER}px`;
      item.style.maxWidth = '100%';
      item.style.height = `${h * rowHeight + (h - 1) * GUTTER}px`;
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

    get youtubePreviewVisible() {
      const u = (this.form?.youtube_url || '').trim();
      return !!(u && this._extractYoutubeVideoId(u) && this.localServerAvailable);
    },
  };
}
