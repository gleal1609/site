/**
 * Alpine.js data and methods for the Projects page
 */
function projectsPage(projectsJsonUrl) {
  return {
    allProjects: [],
    filteredProjects: [],
    loading: true,
    error: null,
    projectsJsonUrl: projectsJsonUrl || '/projects.json',
    
    // Filter state
    searchTerm: '',
    selectedServiceTypes: [],
    selectedYear: '',
    /** 'order' = Padrão (CMS); 'date' = data; 'service' = tipo de serviço */
    sortMode: 'order',
    showFilters: false,
    
    // Available filter options (populated from projects)
    availableServiceTypes: [],
    availableYears: [],
    
    // URL sync debounce timer
    urlSyncTimer: null,
    
    /**
     * Initialize the page - fetch projects and set up filters
     */
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
        this.applySortToList(this.filteredProjects);
        
        // Extract unique service types and years
        this.extractFilterOptions();
        
        // Check URL hash for pre-selected filters (after options are extracted)
        // Use setTimeout to ensure Alpine has finished initializing
        setTimeout(() => {
          this.applyUrlFilters();
          // If filters are applied from URL, show the filter section
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
     * Apply filters from URL hash parameters
     * Supports format: #search=term&service=ARTISTICOS&service=Type2&year=2025
     */
    applyUrlFilters() {
      if (window.location.hash) {
        const hash = window.location.hash.substring(1); // Remove #
        const params = new URLSearchParams(hash);
        
        // Apply search term filter
        const searchParam = params.get('search');
        if (searchParam) {
          this.searchTerm = decodeURIComponent(searchParam);
        }
        
        // Apply service type filters (support multiple)
        const serviceParams = params.getAll('service');
        if (serviceParams.length > 0) {
          this.selectedServiceTypes = serviceParams
            .map(param => decodeURIComponent(param))
            .filter(service => this.availableServiceTypes.includes(service));
        }
        
        // Apply year filter
        const yearParam = params.get('year');
        if (yearParam && this.availableYears.includes(parseInt(yearParam))) {
          this.selectedYear = yearParam;
        }
        
        const sortParam = params.get('sort');
        if (sortParam === 'date' || sortParam === 'order' || sortParam === 'service') {
          this.sortMode = sortParam;
        }
        
        // Update filters if any were applied
        if (searchParam || serviceParams.length > 0 || yearParam || sortParam) {
          this.updateFilters();
        }
      }
    },
    
    /**
     * Extract unique service types and years from all projects
     */
    extractFilterOptions() {
      const serviceTypesSet = new Set();
      const yearsSet = new Set();
      
      this.allProjects.forEach(project => {
        // Add all service types
        if (project.service_types && Array.isArray(project.service_types)) {
          project.service_types.forEach(type => {
            if (type && type.trim()) {
              serviceTypesSet.add(type.trim());
            }
          });
        }
        
        // Add year
        if (project.year) {
          yearsSet.add(project.year);
        }
      });
      
      // Sort service types alphabetically
      this.availableServiceTypes = Array.from(serviceTypesSet).sort();
      
      // Sort years descending
      this.availableYears = Array.from(yearsSet).sort((a, b) => b - a);
    },
    
    /**
     * Update filtered projects based on current filter state
     */
    updateFilters() {
      let filtered = [...this.allProjects];
      
      // Filter by search term
      if (this.searchTerm.trim()) {
        const searchLower = this.searchTerm.toLowerCase().trim();
        filtered = filtered.filter(project => {
          return project.search_blob && project.search_blob.toLowerCase().includes(searchLower);
        });
      }
      
      // Filter by service types
      if (this.selectedServiceTypes.length > 0) {
        filtered = filtered.filter(project => {
          if (!project.service_types || !Array.isArray(project.service_types)) {
            return false;
          }
          // Check if project has at least one of the selected service types
          return this.selectedServiceTypes.some(selectedType => 
            project.service_types.some(projectType => 
              projectType && projectType.trim() === selectedType
            )
          );
        });
      }
      
      // Filter by year
      if (this.selectedYear) {
        filtered = filtered.filter(project => {
          return project.year && project.year.toString() === this.selectedYear;
        });
      }
      
      this.applySortToList(filtered);
      this.filteredProjects = filtered;
      
      // Sync filters to URL (debounced for search input)
      this.syncFiltersToUrl();
    },
    
    /**
     * Ordenação da lista: por `order` (CMS) ou por data (mais recente primeiro).
     */
    applySortToList(list) {
      list.sort((a, b) => this.compareProjects(a, b));
    },
    
    compareProjects(a, b) {
      if (this.sortMode === 'date') {
        const ya = Number(a.year);
        const yb = Number(b.year);
        if (!Number.isNaN(yb) && !Number.isNaN(ya) && yb !== ya) {
          return yb - ya;
        }
        const da = a.date_mmddyyyy || '';
        const db = b.date_mmddyyyy || '';
        return db.localeCompare(da);
      }
      if (this.sortMode === 'service') {
        const sa = this.primaryServiceSortKey(a);
        const sb = this.primaryServiceSortKey(b);
        const c = sa.localeCompare(sb, 'pt-BR');
        if (c !== 0) return c;
        return (a.title || '').localeCompare(b.title || '', 'pt-BR');
      }
      const orderA = Number(a.order != null ? a.order : 999);
      const orderB = Number(b.order != null ? b.order : 999);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return (a.title || '').localeCompare(b.title || '', 'pt-BR');
    },

    /** Primeiro tipo de serviço (ordem alfabética PT) para ordenação */
    primaryServiceSortKey(project) {
      const types = project.service_types;
      if (!types || !Array.isArray(types) || types.length === 0) {
        return '\uffff';
      }
      const sorted = types
        .map((t) => String(t).trim())
        .filter(Boolean)
        .sort((x, y) => x.localeCompare(y, 'pt-BR'));
      return sorted[0] || '\uffff';
    },
    
    /**
     * Sync current filter state to URL hash
     */
    syncFiltersToUrl() {
      // Clear existing timer
      if (this.urlSyncTimer) {
        clearTimeout(this.urlSyncTimer);
      }
      
      // Debounce URL updates (especially for search input)
      this.urlSyncTimer = setTimeout(() => {
        const params = new URLSearchParams();
        
        // Add search term
        if (this.searchTerm.trim()) {
          params.set('search', encodeURIComponent(this.searchTerm.trim()));
        }
        
        // Add service types (multiple values)
        this.selectedServiceTypes.forEach(serviceType => {
          params.append('service', encodeURIComponent(serviceType));
        });
        
        // Add year
        if (this.selectedYear) {
          params.set('year', this.selectedYear);
        }
        
        if (this.sortMode && this.sortMode !== 'order') {
          params.set('sort', this.sortMode);
        }
        
        // Update URL hash without page reload
        const newHash = params.toString();
        const newUrl = newHash ? `#${newHash}` : '';
        
        // Only update if hash actually changed to avoid unnecessary history entries
        if (window.location.hash !== newUrl) {
          history.pushState(null, '', window.location.pathname + newUrl);
        }
      }, 300); // 300ms debounce for search input
    },
    
    /**
     * Clear all filters
     */
    clearFilters() {
      this.searchTerm = '';
      this.selectedServiceTypes = [];
      this.selectedYear = '';
      this.sortMode = 'order';
      this.updateFilters();
      // Clear URL hash
      history.pushState(null, '', window.location.pathname);
    },
    
    /**
     * Check if any filters are active
     */
    hasActiveFilters() {
      return this.searchTerm.trim() !== '' || 
             this.selectedServiceTypes.length > 0 || 
             this.selectedYear !== '' ||
             this.sortMode !== 'order';
    }
  };
}
