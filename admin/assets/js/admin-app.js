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

const ADMIN_CONFIG = {
  serviceTypes: ['VFX', 'ARTISTICOS', 'MIDIAS SOCIAIS', 'INSTITUCIONAL', 'EVENTOS'],
  sizeOptions: ['1x1', '1x2', '2x1', '2x2'],
};

function adminApp() {
  return {
    authed: false,
    user: null,

    projects: [],
    loading: true,
    saving: false,

    view: 'home',
    pendingOrder: [],

    editorOpen: false,
    editorLoading: false,
    editSlug: null,
    form: {},
    isNew: false,

    thumbFile: null,
    thumbPreview: null,
    videoFile: null,
    videoPreview: null,

    _mde: null,
    _auth: null,
    _api: null,
    _grid: null,

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
      await this._auth.logout(this._api);
      this.authed = false;
      this.user = null;
      this.projects = [];
      this.editorOpen = false;
      this._grid?.destroy();
      this._grid = null;
    },

    async _loadProjects() {
      if (!this._api) return;
      this.loading = true;
      try {
        this.projects = await this._api.listProjects();
        this.projects.forEach(p => {
          p._slug = p.slug;
          if (!p.url) p.url = `/projects/${p.slug}/`;
        });
        this.$nextTick(() => this._renderGrid());
      } catch (e) {
        console.error(e);
        this._toast('Erro ao carregar projetos: ' + e.message, 'error');
      }
      this.loading = false;
    },

    _renderGrid() {
      const container = document.getElementById('grid-container');
      if (!container) return;

      if (!this._grid) {
        this._grid = new GridManager(container);
        this._grid.onClick((p) => this.openEditor(p));
        this._grid.onReorder((order) => { this.pendingOrder = order; });
      }

      const list =
        this.view === 'home'
          ? this.projects.filter((p) => p.show_on_home)
          : [...this.projects];

      this._grid.render(list, this.view);
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

    async saveOrder() {
      if (!this.pendingCount) return;
      this.saving = true;
      try {
        const items = this.pendingOrder
          .filter(o => {
            const p = this.projects.find(x => x._slug === o.slug);
            return p && p.order !== o.order;
          })
          .map(o => ({ slug: o.slug, order: o.order }));

        await this._api.reorderProjects(items);

        items.forEach(item => {
          const p = this.projects.find(x => x._slug === item.slug);
          if (p) p.order = item.order;
        });

        this.pendingOrder = [];
        this._toast(`Ordem de ${items.length} projeto(s) salva!`, 'success');
      } catch (e) {
        this._toast('Erro ao salvar ordem: ' + e.message, 'error');
      }
      this.saving = false;
    },

    async openEditor(project) {
      this.isNew = false;
      this.editSlug = project._slug;
      this.editorOpen = true;
      this.editorLoading = true;
      this._clearUploads();

      try {
        const data = await this._api.getProject(project._slug);
        this.form = {
          ...data,
          body: data.body_md || '',
          _slug: project._slug,
        };
        if (!Array.isArray(this.form.service_types)) {
          this.form.service_types = [];
        }
      } catch (e) {
        this._toast('Erro ao carregar projeto', 'error');
        this.editorOpen = false;
      }
      this.editorLoading = false;

      this.$nextTick(() => {
        this._initMDE();
        this._grid?.relayout();
      });
    },

    newProject() {
      this.isNew = true;
      this.editSlug = null;
      this.editorOpen = true;
      this.editorLoading = false;
      this._clearUploads();

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
      };

      this.$nextTick(() => {
        this._initMDE();
        this._grid?.relayout();
      });
    },

    closeEditor() {
      this.editorOpen = false;
      this.editSlug = null;
      this.form = {};
      this.isNew = false;
      this._clearUploads();
      this._destroyMDE();
      this.$nextTick(() => this._grid?.relayout());
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

    async saveProject() {
      if (!this.form.title) {
        this._toast('Título é obrigatório', 'error');
        return;
      }

      this.saving = true;
      try {
        if (this._mde) this.form.body = this._mde.value();

        const slug = this.isNew ? this._makeSlug() : this.form._slug;

        if (this.thumbFile) {
          MediaUpload.validate(this.thumbFile, MediaUpload.IMG_TYPES);
          const result = await this._api.uploadMedia(slug, 'thumbnail', this.thumbFile);
          this.form.thumbnail = result.key;
        }

        if (this.videoFile) {
          MediaUpload.validate(this.videoFile, MediaUpload.VID_TYPES);
          const result = await this._api.uploadMedia(slug, 'preview', this.videoFile);
          this.form.hover_preview = result.key;
        }

        const payload = {
          title: this.form.title,
          body_md: this.form.body || '',
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

        if (this.isNew) {
          payload.slug = slug;
          await this._api.createProject(payload);
          this._toast('Projeto criado!', 'success');
        } else {
          payload.version = this.form.version;
          const result = await this._api.updateProject(slug, payload);
          if (result.triggerDeploy) {
            this._api.triggerDeploy().catch(() => {});
          }
          this._toast('Projeto salvo!', 'success');
        }

        this.closeEditor();
        await this._loadProjects();
      } catch (e) {
        if (e.message.includes('409') || e.message.includes('Conflict')) {
          this._toast('Conflito: outro utilizador editou. Recarregue a página.', 'error');
        } else {
          this._toast('Erro: ' + e.message, 'error');
        }
      }
      this.saving = false;
    },

    async deleteProject() {
      if (!this.form._slug) return;
      if (!confirm(`Excluir "${this.form.title}"? Esta ação não pode ser desfeita.`)) return;

      this.saving = true;
      try {
        await this._api.deleteProject(this.form._slug);
        this._toast('Projeto excluído', 'success');
        this.closeEditor();
        await this._loadProjects();
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

    _makeSlug() {
      const d = this.form.date_mmddyyyy || '';
      const title = (this.form.title || 'projeto')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
        .toLowerCase();
      const client = (this.form.client || 'cliente')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
        .toLowerCase();
      return `${d}-${title}-${client}`;
    },

    _toast(msg, type) {
      this.toast = { msg, type };
      setTimeout(() => { this.toast = null; }, 4000);
    },

    get serviceOptions() { return ADMIN_CONFIG.serviceTypes; },
    get sizeOptions() { return ADMIN_CONFIG.sizeOptions; },
  };
}
