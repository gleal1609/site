/**
 * Alpine.js data and methods for the Projects page
 * Listagem: sempre por date_mmddyyyy (mais recente primeiro), após filtros Buscar + Tipos de serviço.
 */

/**
 * Códigos curtos na URL (iniciais por palavra; caracteres especiais ignorados).
 * Resolve colisões e evita ambiguidade por prefixo (ex.: E vs EC).
 */
function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function lettersCompact(name) {
  return stripDiacritics(name).replace(/[^A-Za-z]/g, '').toUpperCase();
}

function preferredInitials(name) {
  const parts = stripDiacritics(name)
    .split(/[\s&/–—,.]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  let code = '';
  for (const part of parts) {
    if (/^\d+$/.test(part)) continue;
    const m = part.match(/[A-Za-z]/);
    if (m) code += m[0].toUpperCase();
  }
  const c = lettersCompact(name);
  if (!code && c) return c[0];
  return code;
}

function hasPrefixConflict(candidate, codes) {
  const up = candidate.toUpperCase();
  for (const u of codes) {
    if (!u) continue;
    if (u === up) return true;
    if (u.startsWith(up) || up.startsWith(u)) return true;
  }
  return false;
}

function buildServiceUrlMaps(labels) {
  const sorted = [
    ...new Set(labels.map((x) => String(x || '').trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const labelToCode = new Map();
  const assigned = [];

  const rows = sorted.map((label) => ({
    label,
    pref: preferredInitials(label),
    compact: lettersCompact(label),
  }));

  rows.sort((a, b) => {
    if (b.pref.length !== a.pref.length) return b.pref.length - a.pref.length;
    return a.label.localeCompare(b.label, 'pt-BR');
  });

  for (const { label, pref, compact } of rows) {
    if (!compact) {
      const code = `S${labelToCode.size + 1}`;
      assigned.push(code);
      labelToCode.set(label, code);
      continue;
    }

    let chosen = null;

    if (pref && !hasPrefixConflict(pref, assigned)) {
      chosen = pref.toUpperCase();
    }

    if (!chosen) {
      let n = Math.max(pref.length || 1, 1);
      while (n <= compact.length) {
        const cand = compact.slice(0, n);
        if (!hasPrefixConflict(cand, assigned)) {
          chosen = cand;
          break;
        }
        n += 1;
      }
    }

    if (!chosen) {
      let base = (pref && pref.slice(0, 3)) || compact.slice(0, 3);
      let i = 2;
      while (hasPrefixConflict(`${base}${i}`, assigned)) i += 1;
      chosen = `${base}${i}`;
    }

    assigned.push(chosen);
    labelToCode.set(label, chosen);
  }

  const toCode = {};
  const fromCode = {};
  labelToCode.forEach((code, label) => {
    const k = String(code).toUpperCase();
    toCode[label] = k;
    fromCode[k] = label;
  });

  return { toCode, fromCode };
}

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

    /** label canónico → código URL (ex. "ANIMAÇÃO & MOTION GRAPHICS" → "AMG") */
    _serviceToUrlCode: {},
    /** código URL → label (maiúsculas) */
    _urlCodeToService: {},

    urlSyncTimer: null,

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

    _unescapeUrlToken(raw) {
      let v = String(raw || '');
      for (let i = 0; i < 4; i++) {
        try {
          const d = decodeURIComponent(v.replace(/\+/g, ' '));
          if (d === v) break;
          v = d;
        } catch (_) {
          break;
        }
      }
      return v;
    },

    /**
     * Associa string da URL ao nome completo do serviço (URLs antigas com nome + percent-encoding).
     */
    _matchServiceTypeFromUrl(raw, allowedSet) {
      let v = String(raw || '').trim();
      if (!v) return null;
      if (allowedSet.has(v)) return v;
      for (let i = 0; i < 4; i++) {
        try {
          const d = decodeURIComponent(v.replace(/\+/g, ' '));
          if (d === v) break;
          v = d.trim();
          if (allowedSet.has(v)) return v;
        } catch (_) {
          break;
        }
      }
      return null;
    },

    /**
     * Resolve um token do hash: código curto, nome completo ou legado codificado.
     */
    _resolveServiceCandidate(raw, allowedSet) {
      const v = String(raw || '').trim();
      if (!v) return null;
      if (allowedSet.has(v)) return v;

      const fromCode = this._urlCodeToService[v.toUpperCase()];
      if (fromCode && allowedSet.has(fromCode)) return fromCode;

      return this._matchServiceTypeFromUrl(v, allowedSet);
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
     * Hash: #search=... opcional;
     *   - #service=AMG (código curto) ou nome completo (legado / links Jekyll)
     *   - #services=AMG,AC,EC (vários códigos, separados por vírgula)
     * Legado: #services= com | entre nomes; #service= repetido; codificação dupla.
     */
    applyUrlFilters() {
      if (!window.location.hash || window.location.hash.length <= 1) return;
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);

      const searchParam = params.get('search');
      if (searchParam) {
        this.searchTerm = this._unescapeUrlToken(searchParam);
      }

      const bundled = params.get('services');
      const legacyRepeated = params.getAll('service');
      const candidates = [];

      if (bundled) {
        bundled.split(/[|,]/).forEach((s) => {
          const t = s.trim();
          if (t) candidates.push(t);
        });
      }
      legacyRepeated.forEach((s) => {
        const t = (s || '').trim();
        if (t) candidates.push(t);
      });

      const allowed = new Set(this.availableServiceTypes);
      const resolved = [];
      const seen = new Set();
      candidates.forEach((c) => {
        const norm = this._resolveServiceCandidate(c, allowed);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          resolved.push(norm);
        }
      });
      this.selectedServiceTypes = resolved;

      if (searchParam || candidates.length > 0) {
        this.updateFilters();
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
      const maps = buildServiceUrlMaps(this.availableServiceTypes);
      this._serviceToUrlCode = maps.toCode;
      this._urlCodeToService = maps.fromCode;
    },

    toggleServiceType(serviceType) {
      const sel = this.selectedServiceTypes;
      const i = sel.indexOf(serviceType);
      if (i === -1) {
        this.selectedServiceTypes = [...sel, serviceType];
      } else {
        this.selectedServiceTypes = sel.filter((s) => s !== serviceType);
      }
      this.updateFilters();
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
              (projectType) => projectType && projectType.trim() === selectedType,
            ),
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
          params.set('search', this.searchTerm.trim());
        }

        const types = this.selectedServiceTypes;
        const enc = (label) => this._serviceToUrlCode[label] || label;

        if (types.length === 1) {
          params.set('service', enc(types[0]));
        } else if (types.length > 1) {
          params.set('services', types.map(enc).join(','));
        }

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
