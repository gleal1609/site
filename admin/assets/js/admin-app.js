/**
 * Main Alpine.js application — Visual Portfolio CMS
 */
const ADMIN_CONFIG = {
  repo: 'gleal1609/site',
  branch: 'temp',
  serviceTypes: ['VFX', 'ARTISTICOS', 'MIDIAS SOCIAIS', 'INSTITUCIONAL', 'EVENTOS'],
  sizeOptions: ['1x1', '1x2', '2x1', '2x2'],
};

function adminApp() {
  return {
    /* ---- state ---- */
    authed: false,
    user: null,
    patInput: '',
    showPat: false,

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
    _auth: new GitHubAuth(),
    _api: null,
    _grid: null,

    toast: null,

    /* ---- lifecycle ---- */

    async init() {
      if (this._auth.init()) {
        await this._boot();
      } else {
        this.loading = false;
      }
    },

    async _boot() {
      try {
        this._api = new GitHubAPI(
          this._auth.token,
          ADMIN_CONFIG.repo,
          ADMIN_CONFIG.branch,
        );
        this.user = await this._api.getUser();
        this.authed = true;
        await this._loadProjects();
      } catch (e) {
        console.error(e);
        this._auth.logout();
        this.authed = false;
        this._toast('Falha na autenticação: ' + e.message, 'error');
      }
      this.loading = false;
    },

    /* ---- auth ---- */

    async loginOAuth() {
      try {
        this.loading = true;
        await this._auth.loginWithOAuth();
        await this._boot();
      } catch (e) {
        this.loading = false;
        this._toast(e.message, 'error');
      }
    },

    async loginPAT() {
      try {
        this._auth.loginWithPAT(this.patInput);
        this.loading = true;
        await this._boot();
      } catch (e) {
        this.loading = false;
        this._toast(e.message, 'error');
      }
    },

    logout() {
      this._auth.logout();
      this.authed = false;
      this.user = null;
      this.projects = [];
      this.editorOpen = false;
      this._grid?.destroy();
      this._grid = null;
    },

    /* ---- data loading ---- */

    async _loadProjects() {
      this.loading = true;
      try {
        const files = await this._api.listDir('_projects');
        const mdFiles = files.filter((f) => f.name.endsWith('.md'));

        const results = await Promise.all(
          mdFiles.map((f) => this._api.getFile(f.path).catch(() => null)),
        );

        this.projects = results.filter(Boolean).map((r) => {
          const { data, body } = FrontMatter.parse(r.content);
          const slug = r.path.replace('_projects/', '').replace('.md', '');
          return {
            ...data,
            body,
            _path: r.path,
            _slug: slug,
            url: `/projects/${slug}/`,
          };
        });

        this.$nextTick(() => this._renderGrid());
      } catch (e) {
        console.error(e);
        this._toast('Erro ao carregar projetos: ' + e.message, 'error');
      }
      this.loading = false;
    },

    /* ---- grid ---- */

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
        let saved = 0;
        for (const item of this.pendingOrder) {
          const proj = this.projects.find((p) => p._slug === item.slug);
          if (!proj || proj.order === item.order) continue;

          const file = await this._api.getFile(proj._path);
          const { data, body } = FrontMatter.parse(file.content);
          data.order = item.order;
          const content = FrontMatter.serialize(data, body);

          await this._api.putFile(
            proj._path,
            content,
            `Reorder: ${data.title || proj._slug} → #${item.order}`,
          );
          proj.order = item.order;
          saved++;
        }

        if (saved) {
          this.pendingOrder = [];
          this._toast(`Ordem de ${saved} projeto(s) salva!`, 'success');
        }
      } catch (e) {
        this._toast('Erro ao salvar ordem: ' + e.message, 'error');
      }
      this.saving = false;
    },

    /* ---- editor ---- */

    async openEditor(project) {
      this.isNew = false;
      this.editSlug = project._slug;
      this.editorOpen = true;
      this.editorLoading = true;
      this._clearUploads();

      try {
        const file = await this._api.getFile(project._path);
        const { data, body } = FrontMatter.parse(file.content);
        this.form = {
          ...data,
          body: body || '',
          _path: project._path,
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

    /* ---- save / delete ---- */

    async saveProject() {
      if (!this.form.title) {
        this._toast('Título é obrigatório', 'error');
        return;
      }

      this.saving = true;
      try {
        if (this._mde) this.form.body = this._mde.value();

        const slug = this.isNew ? this._makeSlug() : this.form._slug;
        const path = this.isNew ? `_projects/${slug}.md` : this.form._path;

        if (this.thumbFile) {
          MediaUpload.validate(this.thumbFile, MediaUpload.IMG_TYPES);
          const thumbPath = MediaUpload.imgPath(this.thumbFile, slug);
          await this._api.uploadMedia(thumbPath, this.thumbFile);
          this.form.thumbnail = `/${thumbPath}`;
        }

        if (this.videoFile) {
          MediaUpload.validate(this.videoFile, MediaUpload.VID_TYPES);
          const vidPath = MediaUpload.vidPath(this.videoFile, slug);
          await this._api.uploadMedia(vidPath, this.videoFile);
          this.form.hover_preview = `/${vidPath}`;
        }

        const data = {};
        const fields = [
          'title', 'thumbnail', 'hover_preview', 'service_types', 'client',
          'date_mmddyyyy', 'year', 'show_on_home', 'order', 'home_size',
          'youtube_url', 'pixieset_url',
        ];
        fields.forEach((k) => {
          if (this.form[k] !== undefined) data[k] = this.form[k];
        });

        if (data.year) data.year = Number(data.year);
        if (data.order) data.order = Number(data.order);
        data.show_on_home = !!data.show_on_home;

        if (!data.hover_preview) delete data.hover_preview;
        if (!data.youtube_url) delete data.youtube_url;
        if (!data.pixieset_url) delete data.pixieset_url;

        const body = this.form.body || '';
        const content = FrontMatter.serialize(data, body);
        const msg = this.isNew
          ? `Add project: ${data.title}`
          : `Update: ${data.title}`;

        await this._api.putFile(path, content, msg);

        this._toast(this.isNew ? 'Projeto criado!' : 'Projeto salvo!', 'success');
        this.closeEditor();
        await this._loadProjects();
      } catch (e) {
        this._toast('Erro: ' + e.message, 'error');
      }
      this.saving = false;
    },

    async deleteProject() {
      if (!this.form._path) return;
      if (!confirm(`Excluir "${this.form.title}"? Esta ação não pode ser desfeita.`)) return;

      this.saving = true;
      try {
        await this._api.deleteFile(
          this.form._path,
          `Delete: ${this.form.title}`,
        );
        this._toast('Projeto excluído', 'success');
        this.closeEditor();
        await this._loadProjects();
      } catch (e) {
        this._toast('Erro ao excluir: ' + e.message, 'error');
      }
      this.saving = false;
    },

    /* ---- media ---- */

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

    /* ---- markdown editor ---- */

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

    /* ---- helpers ---- */

    _makeSlug() {
      const d = this.form.date_mmddyyyy || '';
      const title = (this.form.title || 'projeto')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '');
      const client = (this.form.client || 'cliente')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '');
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
