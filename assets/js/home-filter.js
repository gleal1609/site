/**
 * Filtro de serviços + Carregar mais (Home).
 */
(function () {
  'use strict';

  function getButtons() {
    return document.querySelectorAll('.home-filter__btn[data-service]');
  }

  function setActive(service) {
    getButtons().forEach((btn) => {
      const isAct = btn.getAttribute('data-service') === service;
      btn.classList.toggle('home-filter__btn--active', isAct);
    });
  }

  function onFilterClick(e) {
    const btn = e.target.closest('.home-filter__btn[data-service]');
    if (!btn) return;
    e.preventDefault();
    const service = btn.getAttribute('data-service') || '__all__';
    setActive(service);
    if (window.HomeMasonry && typeof window.HomeMasonry.setFilter === 'function') {
      window.HomeMasonry.setFilter(service);
    }
  }

  function onLoadMore() {
    if (window.HomeMasonry && typeof window.HomeMasonry.loadMore === 'function') {
      window.HomeMasonry.loadMore();
    }
  }

  function init() {
    const filter = document.getElementById('home-filter');
    if (filter) {
      filter.addEventListener('click', onFilterClick);
    }
    const more = document.getElementById('load-more-btn');
    if (more) {
      more.addEventListener('click', onLoadMore);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
