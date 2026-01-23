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
        
        const projects = await response.json();
        
        // Sort projects: newest first (year desc, then date_mmddyyyy desc)
        projects.sort((a, b) => {
          if (b.year !== a.year) {
            return b.year - a.year;
          }
          // If same year, sort by date_mmddyyyy descending
          return b.date_mmddyyyy.localeCompare(a.date_mmddyyyy);
        });
        
        this.allProjects = projects;
        this.filteredProjects = projects;
        
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
        
        // Update filters if any were applied
        if (searchParam || serviceParams.length > 0 || yearParam) {
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
      
      this.filteredProjects = filtered;
      
      // Sync filters to URL (debounced for search input)
      this.syncFiltersToUrl();
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
             this.selectedYear !== '';
    }
  };
}
