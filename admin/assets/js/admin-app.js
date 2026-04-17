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
  sizeOptions: ['1x1', '1x2', '2x1', '2x2'],
};

function adminApp() {
  return {
    authed: false,
    user: null,

    projects: [],
    /** Snapshot do último carregamento/publicação (comparar ordem ao confirmar rascunho de ordem) */
    baselineProjects: [],
    loading: true,
    saving: false,

    view: 'home',
    pendingOrder: [],
    /** Itens `{ slug, order }` a enviar em POST /reorder na publicação (vs. baseline) */
    reorderDraft: [],

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

    publishing: false,
    publishPhase: '',

    _mde: null,
    _auth: null,
    _api: null,
    _grid: null,
    _beforeUnloadBound: null,

    toast: null,

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
      this.reorderDraft = [];
      this.projectDrafts = {};
      this.editorOpen = false;
      this._grid?.destroy();
      this._grid = null;
    },

    _cloneProjects(list) {
      return list.map((p) => ({ ...p }));
    },

    _snapshotBaseline() {
      this.baselineProjects = this._cloneProjects(this.projects);
    },

    /**
     * @param {{ silent?: boolean }} opts
     */
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

      if (!ok) return;

      await this.$nextTick();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => this._renderGrid());
      });
    },

    _draftSlugSet() {
      const s = new Set();
      for (const k of Object.keys(this.projectDrafts)) {
        if (k !== DRAFT_NEW) s.add(k);
      }
      return s;
    },

    _renderGrid() {
      const container = document.getElementById('grid-container');
      if (!container) return;

      if (!this._grid) {
        this._grid = new GridManager(container);
        this._grid.onClick((p) => this.openEditor(p));
        this._grid.onReorder((order) => {
          this.pendingOrder = order;
        });
      }

      const list =
        this.view === 'home'
          ? this.projects.filter((p) => p.show_on_home)
          : [...this.projects];

      this._grid.render(list, this.view, { draftSlugs: this._draftSlugSet() });
      this.pendingOrder = [];
    },

    setView(v) {
      this.view = v;
      this._renderGrid();
    },

    get hasPendingOrder() {
      return this.pendingOrder.length > 0;
    },

    get homeProjectCount() {
      return this.projects.filter((p) => p.show_on_home).length;
    },

    get pendingCount() {
      return this.pendingOrder.filter((o) => {
        const p = this.projects.find((x) => x._slug === o.slug);
        return p && p.order !== o.order;
      }).length;
    },

    get hasStagedOrder() {
      return Array.isArray(this.reorderDraft) && this.reorderDraft.length > 0;
    },

    get hasStagedProjects() {
      return Object.keys(this.projectDrafts).length > 0;
    },

    /** Inclui rascunhos confirmados + ordem/form ainda não confirmados */
    get hasUnpublishedChanges() {
      return (
        this.hasStagedOrder ||
        this.hasStagedProjects ||
        this.pendingCount > 0 ||
        (this.editorOpen && this.formDirty)
      );
    },

    get canPublish() {
      return this.hasStagedOrder || this.hasStagedProjects;
    },

    get unpublishedSummary() {
      const parts = [];
      if (this.pendingCount > 0) parts.push('ordem não confirmada');
      if (this.hasStagedOrder) parts.push('ordem em rascunho');
      if (this.hasStagedProjects) {
        const n = Object.keys(this.projectDrafts).length;
        parts.push(n === 1 ? '1 projeto em rascunho' : `${n} projetos em rascunho`);
      }
      if (this.editorOpen && this.formDirty) parts.push('formulário em edição');
      return parts.length ? parts.join(' · ') : '';
    },

    saveOrder() {
      if (!this.pendingCount) return;

      this.pendingOrder.forEach(({ slug, order }) => {
        const p = this.projects.find((x) => x._slug === slug);
        if (p) p.order = order;
      });

      const items = this.pendingOrder
        .filter((o) => {
          const baseline = this.baselineProjects.find((x) => x._slug === o.slug);
          return baseline && baseline.order !== o.order;
        })
        .map((o) => ({ slug: o.slug, order: o.order }));

      if (!items.length) {
        this.pendingOrder = [];
        this._renderGrid();
        return;
      }

      this.reorderDraft = items;
      this.pendingOrder = [];
      this._renderGrid();
      this._toast('Ordem incluída na publicação pendente.', 'success');
    },

    discardPendingOrder() {
      this.pendingOrder = [];
      this._renderGrid();
    },

    async openEditor(project) {
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
      } catch (e) {
        this._toast('Erro ao carregar projeto', 'error');
        this.editorOpen = false;
      }
      this.editorLoading = false;

      await this.$nextTick();
      this._suppressFormDirty = false;
      this.formDirty = false;

      this.$nextTick(() => {
        this._initMDE();
        this._grid?.relayout();
      });
    },

    _applyDraftPayloadToForm(draft) {
      const p = draft.payload;
      this.form.title = p.title;
      this.form.body = p.body_md || '';
      this.form.description = p.description != null ? p.description : '';
      this.form.service_types = Array.isArray(p.service_types) ? [...p.service_types] : [];
      this.form.client = p.client || '';
      this.form.date_mmddyyyy = p.date_mmddyyyy || '';
      this.form.year = p.year != null ? p.year : this.form.year;
      this.form.show_on_home = !!p.show_on_home;
      this.form.order = p.order != null ? p.order : this.form.order;
      this.form.home_size = p.home_size || '1x1';
      this.form.youtube_url = p.youtube_url || '';
      this.form.pixieset_url = p.pixieset_url || '';
      this.form.published = !!p.published;
      if (p.thumbnail) this.form.thumbnail = p.thumbnail;
      if (p.hover_preview) this.form.hover_preview = p.hover_preview;
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
      this.isNew = true;
      this.editSlug = null;
      this.editorOpen = true;
      this.editorLoading = false;
      this._clearUploads();
      this.formDirty = false;

      const existing = this.projectDrafts[DRAFT_NEW];
      this._suppressFormDirty = true;
      if (existing) {
        this.form = {
          title: '',
          thumbnail: '',
          hover_preview: '',
          service_types: [],
          client: '',
          date_mmddyyyy: '',
          year: new Date().getFullYear(),
          show_on_home: false,
          order: this.projects.length + 1,
          home_size: '1x1',
          youtube_url: '',
          pixieset_url: '',
          published: false,
          body: '',
          description: '',
        };
        this._applyDraftPayloadToForm(existing);
      } else {
        this.form = {
          title: '',
          thumbnail: '',
          hover_preview: '',
          service_types: [],
          client: '',
          date_mmddyyyy: '',
          year: new Date().getFullYear(),
          show_on_home: false,
          order: this.projects.length + 1,
          home_size: '1x1',
          youtube_url: '',
          pixieset_url: '',
          published: false,
          body: '',
          description: '',
        };
      }

      this.$nextTick(() => {
        this._suppressFormDirty = false;
        this.formDirty = false;
        this._initMDE();
        this._grid?.relayout();
      });
    },

    closeEditor() {
      this.editorOpen = false;
      this.editSlug = null;
      this.form = {};
      this.isNew = false;
      this.formDirty = false;
      this._clearUploads();
      this._destroyMDE();
      this.$nextTick(() => this._grid?.relayout());
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

    async discardEditorDraft() {
      const key = this.isNew ? DRAFT_NEW : this.form._slug;
      if (this.projectDrafts[key]) {
        delete this.projectDrafts[key];
        this._clearUploads();
        if (this.isNew) {
          this.closeEditor();
          this._toast('Rascunho do novo projeto removido.', 'success');
          this._renderGrid();
          return;
        }
        await this._reloadEditorFromApi(this.form._slug);
        this.formDirty = false;
        this._toast('Rascunho removido; formulário reposto a partir do servidor.', 'warning');
        this._renderGrid();
        return;
      }
      if (this.isNew) {
        if (this.formDirty && !confirm('Descartar alterações não confirmadas?')) return;
        this.closeEditor();
        return;
      }
      await this._reloadEditorFromApi(this.form._slug);
      this.formDirty = false;
      this._toast('Alterações não confirmadas descartadas.', 'success');
    },

    async _reloadEditorFromApi(slug) {
      this.editorLoading = true;
      this._clearUploads();
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
      } catch (e) {
        this._toast('Erro ao recarregar projeto', 'error');
      }
      this.editorLoading = false;
      await this.$nextTick();
      this._suppressFormDirty = false;
      this.formDirty = false;
      this.$nextTick(() => {
        this._initMDE();
        this._grid?.relayout();
      });
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

    setSize(size) {
      this.form.home_size = size;
    },

    _buildPayloadFromForm(slugForUploads) {
      if (this._mde) this.form.body = this._mde.value();

      const payload = {
        title: this.form.title,
        body_md: this.form.body || '',
        description: (this.form.description || '').trim() || null,
        service_types: this.form.service_types || [],
        client: this.form.client || '',
        date_mmddyyyy: this.form.date_mmddyyyy || '',
        year: this.form.year ? Number(this.form.year) : null,
        show_on_home: !!this.form.show_on_home,
        order: this.form.order ? Number(this.form.order) : 0,
        home_size: this.form.home_size || '1x1',
        youtube_url: this.form.youtube_url || '',
        pixieset_url: this.form.pixieset_url || '',
        published: this.form.published !== undefined ? !!this.form.published : false,
      };

      if (this.form.thumbnail) payload.thumbnail = this.form.thumbnail;
      if (this.form.hover_preview) payload.hover_preview = this.form.hover_preview;

      return { payload, slugForUploads };
    },

    saveProject() {
      if (!this.form.title) {
        this._toast('Título é obrigatório', 'error');
        return;
      }

      if (this._mde) this.form.body = this._mde.value();

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
          p.show_on_home = !!this.form.show_on_home;
          p.home_size = this.form.home_size || '1x1';
          p.client = this.form.client || '';
          if (this.form.thumbnail) p.thumbnail = this.form.thumbnail;
          if (this.form.hover_preview) p.hover_preview = this.form.hover_preview;
        }
      }

      this.formDirty = false;
      this._toast('Alterações incluídas na publicação pendente.', 'success');
      this._renderGrid();
    },

    async publishAll() {
      if (!this.canPublish || !this._api) return;

      const createDraft = this.projectDrafts[DRAFT_NEW];
      const updateKeys = Object.keys(this.projectDrafts).filter((k) => k !== DRAFT_NEW);
      const reorderItems = this.reorderDraft?.length ? [...this.reorderDraft] : [];

      this.publishing = true;
      this.publishPhase = 'A preparar…';

      try {
        if (createDraft) {
          this.publishPhase = 'A criar novo projeto…';
          const slug = this._makeSlugFromPayload(createDraft.payload);
          await this._runUploadsForDraft(slug, createDraft);
          await this._api.createProject({ ...createDraft.payload, slug });
          delete this.projectDrafts[DRAFT_NEW];
        }

        for (const slug of updateKeys) {
          const d = this.projectDrafts[slug];
          if (!d) continue;
          this.publishPhase = `A atualizar «${slug}»…`;
          await this._runUploadsForDraft(slug, d);
          const body = { ...d.payload, version: d.version };
          await this._api.updateProject(slug, body);
          delete this.projectDrafts[slug];
        }

        if (reorderItems.length) {
          this.publishPhase = 'A aplicar ordem…';
          await this._api.reorderProjects(reorderItems);
          this.reorderDraft = [];
        }

        this.publishPhase = 'A disparar deploy no Netlify…';
        try {
          const deployRes = await this._api.triggerDeploy();
          if (deployRes?.skipped) {
            this._toast(
              deployRes.message || 'Deploy adiado (debounce de 5 min). Os dados já estão guardados.',
              'warning',
            );
          } else {
            this._toast('Publicação concluída.', 'success');
          }
        } catch (de) {
          this._toast(
            `Dados gravados no servidor; deploy falhou: ${de.message}`,
            'error',
          );
        }

        await this._loadProjects({ silent: true });
        this.closeEditor();
      } catch (e) {
        const msg = e.message || String(e);
        if (msg.includes('409') || msg.includes('Conflict')) {
          this._toast('Conflito: recarregue a página e tente de novo.', 'error');
        } else {
          this._toast('Erro ao gravar: ' + msg, 'error');
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
      this.reorderDraft = (this.reorderDraft || []).filter((i) => i.slug !== slug);

      this.saving = true;
      try {
        const result = await this._api.deleteProject(slug);
        this._toast('Projeto excluído', 'success');
        await this._maybeTriggerDeploy(result);
        this.closeEditor();
        await this._loadProjects({ silent: true });
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
      } catch (err) {
        this._toast(err.message, 'error');
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

    _initMDE() {
      this._destroyMDE();
      const el = document.getElementById('md-editor');
      if (!el) return;
      this._mde = new EasyMDE({
        element: el,
        initialValue: this.form.body || '',
        spellChecker: false,
        status: false,
        autoDownloadFontAwesome: false,
        minHeight: '120px',
        toolbar: [
          'bold', 'italic', 'heading', '|',
          'unordered-list', 'ordered-list', '|',
          'link', 'image', '|', 'preview',
        ],
      });
    },

    _destroyMDE() {
      if (this._mde) {
        this._mde.toTextArea();
        this._mde = null;
      }
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
    get sizeOptions() {
      return ADMIN_CONFIG.sizeOptions;
    },
  };
}
