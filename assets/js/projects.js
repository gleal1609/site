/**
 * Alpine.js data and methods for the Projects page
 * Listagem: sempre por date_mmddyyyy (mais recente primeiro), após filtros Buscar + Tipos de serviço.
 */
function projectsPage(projectsJsonUrl) {
  return {
    allProjects: [],
    filteredProjects: [],
    loading: true,
    error: null,
    projectsJsonUrl: projectsJsonUrl || '/projects.json',

    searchTerm: '',
    selectedServiceTypes: [],
    showFilters: false,

    availableServiceTypes: [],

    urlSyncTimer: null,

    /**
     * MMDDYYYY (8 chars) → chave YYYYMMDD para ordenação correcta
     */
    _dateSortKey(s) {
      const raw = String(s || '').replace(/\D/g, '');
      if (raw.length !== 8) return '00000000';
      const mm = raw.slice(0, 2);
      const dd = raw.slice(2, 4);
      const yyyy = raw.slice(4, 8);
      return `${yyyy}${mm}${dd}`;
    },

    _sortByDateDesc(list) {
      list.sort((a, b) => {
        const ka = this._dateSortKey(a.date_mmddyyyy);
        const kb = this._dateSortKey(b.date_mmddyyyy);
        if (ka !== kb) return kb.localeCompare(ka);
        const sa = a.slug || a.url || '';
        const sb = b.slug || b.url || '';
        return sa.localeCompare(sb, 'pt-BR');
      });
    },

    async init() {
      try {
        this.loading = true;
        const response = await fetch(this.projectsJsonUrl);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const raw = await response.json();
        const projects = Array.isArray(raw) ? raw : [];

        this.allProjects = projects;
        this.filteredProjects = projects.slice();
        this._sortByDateDesc(this.filteredProjects);

        this.extractFilterOptions();

        setTimeout(() => {
          this.applyUrlFilters();
          if (window.location.hash && window.location.hash.length > 1) {
            this.showFilters = true;
          }
        }, 0);

        this.loading = false;
      } catch (err) {
        console.error('Error loading projects:', err);
        this.error = 'Erro ao carregar projetos. Por favor, tente novamente mais tarde.';
        this.loading = false;
      }
    },

    /**
     * URL hash: #search=...&service=...
     * Parâmetros antigos (year, sort) são ignorados.
     */
    applyUrlFilters() {
      if (window.location.hash) {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);

        const searchParam = params.get('search');
        if (searchParam) {
          this.searchTerm = decodeURIComponent(searchParam);
        }

        const serviceParams = params.getAll('service');
        if (serviceParams.length > 0) {
          this.selectedServiceTypes = serviceParams
            .map((param) => decodeURIComponent(param))
            .filter((service) => this.availableServiceTypes.includes(service));
        }

        if (searchParam || serviceParams.length > 0) {
          this.updateFilters();
        }
      }
    },

    extractFilterOptions() {
      const serviceTypesSet = new Set();

      this.allProjects.forEach((project) => {
        if (project.service_types && Array.isArray(project.service_types)) {
          project.service_types.forEach((type) => {
            if (type && type.trim()) {
              serviceTypesSet.add(type.trim());
            }
          });
        }
      });

      this.availableServiceTypes = Array.from(serviceTypesSet).sort();
    },

    updateFilters() {
      let filtered = [...this.allProjects];

      if (this.searchTerm.trim()) {
        const searchLower = this.searchTerm.toLowerCase().trim();
        filtered = filtered.filter((project) => {
          return project.search_blob && project.search_blob.toLowerCase().includes(searchLower);
        });
      }

      if (this.selectedServiceTypes.length > 0) {
        filtered = filtered.filter((project) => {
          if (!project.service_types || !Array.isArray(project.service_types)) {
            return false;
          }
          return this.selectedServiceTypes.some((selectedType) =>
            project.service_types.some(
              (projectType) => projectType && projectType.trim() === selectedType
            )
          );
        });
      }

      this._sortByDateDesc(filtered);
      this.filteredProjects = filtered;

      this.syncFiltersToUrl();
    },

    syncFiltersToUrl() {
      if (this.urlSyncTimer) {
        clearTimeout(this.urlSyncTimer);
      }

      this.urlSyncTimer = setTimeout(() => {
        const params = new URLSearchParams();

        if (this.searchTerm.trim()) {
          params.set('search', encodeURIComponent(this.searchTerm.trim()));
        }

        this.selectedServiceTypes.forEach((serviceType) => {
          params.append('service', encodeURIComponent(serviceType));
        });

        const newHash = params.toString();
        const newUrl = newHash ? `#${newHash}` : '';

        if (window.location.hash !== newUrl) {
          history.pushState(null, '', window.location.pathname + newUrl);
        }
      }, 300);
    },

    clearFilters() {
      this.searchTerm = '';
      this.selectedServiceTypes = [];
      this.updateFilters();
      history.pushState(null, '', window.location.pathname);
    },

    hasActiveFilters() {
      return this.searchTerm.trim() !== '' || this.selectedServiceTypes.length > 0;
    },
  };
}
