/**
 * Filtro de serviços (multi-select) + Carregar mais (Home).
 */
(function () {
  'use strict';

  var activeServices = new Set();

  function getButtons() {
    return document.querySelectorAll('.home-filter__btn[data-service]');
  }

  function syncButtonStyles() {
    var isAll = activeServices.size === 0;
    getButtons().forEach(function (btn) {
      var svc = btn.getAttribute('data-service');
      if (svc === '__all__') {
        btn.classList.toggle('home-filter__btn--active', isAll);
      } else {
        btn.classList.toggle('home-filter__btn--active', activeServices.has(svc));
      }
    });
  }

  function onFilterClick(e) {
    var btn = e.target.closest('.home-filter__btn[data-service]');
    if (!btn) return;
    e.preventDefault();

    var service = btn.getAttribute('data-service') || '__all__';

    if (service === '__all__') {
      activeServices.clear();
    } else {
      if (activeServices.has(service)) {
        activeServices.delete(service);
      } else {
        activeServices.add(service);
      }
    }

    syncButtonStyles();

    try {
      btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    } catch (_) {
      btn.scrollIntoView();
    }

    if (window.HomeMasonry && typeof window.HomeMasonry.setFilter === 'function') {
      var filterValue = activeServices.size === 0
        ? '__all__'
        : Array.from(activeServices);
      window.HomeMasonry.setFilter(filterValue);
    }
  }

  function onLoadMore() {
    if (window.HomeMasonry && typeof window.HomeMasonry.loadMore === 'function') {
      window.HomeMasonry.loadMore();
    }
  }

  function init() {
    var filter = document.getElementById('home-filter');
    if (filter) {
      filter.addEventListener('click', onFilterClick);
    }
    var more = document.getElementById('load-more-btn');
    if (more) {
      more.addEventListener('click', onLoadMore);
    }
    syncButtonStyles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
