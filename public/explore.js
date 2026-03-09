import {
  bindHeaderSearch,
  buildExploreHref,
  createSearchControls,
  fetchJson,
  fillSearchControls,
  loadProviderPreferences,
  persistRecentSearch,
  renderSiteHeader,
  renderQuickCategories,
  renderVideoCards,
  saveProviderPreferences,
  setStatus,
  setupHeaderSearch
} from './common.js';

renderSiteHeader(document.querySelector('#siteHeader'), {
  subtitle: 'Explorar',
  currentPath: '/explore'
});

const controls = createSearchControls();
const elements = {
  searchForm: document.querySelector('#searchForm'),
  clearFiltersButton: document.querySelector('#clearFiltersButton'),
  quickCategories: document.querySelector('#quickCategories'),
  resultsList: document.querySelector('#resultsList'),
  resultSummary: document.querySelector('#resultSummary'),
  statusMessage: document.querySelector('#statusMessage'),
  pageIndicator: document.querySelector('#pageIndicator'),
  prevPageButton: document.querySelector('#prevPageButton'),
  nextPageButton: document.querySelector('#nextPageButton')
};

const params = new URLSearchParams(window.location.search);
const state = {
  q: params.get('q') || '',
  page: Number(params.get('page') || '1') || 1,
  sort: params.get('sort') || 'relevance',
  date: params.get('date') || 'all',
  duration: params.get('duration') || 'allduration',
  quality: params.get('quality') || 'all',
  watched: params.get('watched') || '',
  ph: params.has('ph') ? params.get('ph') || '' : (loadProviderPreferences().includePornhub ? '1' : '')
};

bootstrap().catch((error) => {
  setStatus(elements.statusMessage, `Erro ao iniciar a página: ${error.message}`, true);
});

async function bootstrap() {
  await setupHeaderSearch(controls);
  bindHeaderSearch(elements.searchForm, controls);
  fillSearchControls(controls, state);
  renderQuickCategories(elements.quickCategories);
  elements.clearFiltersButton.addEventListener('click', () => {
    fillSearchControls(controls, { q: state.q, ph: state.ph });
  });
  controls.pornhubCheckbox?.addEventListener('change', () => {
    state.ph = saveProviderPreferences({ includePornhub: controls.pornhubCheckbox.checked }).includePornhub ? '1' : '';
    state.page = 1;
    if (state.q) {
      window.location.href = buildExploreHref(state);
    }
  });
  elements.prevPageButton.addEventListener('click', () => navigatePage(-1));
  elements.nextPageButton.addEventListener('click', () => navigatePage(1));

  if (!state.q) {
    elements.resultSummary.textContent = 'Digite algo na busca acima para explorar vídeos.';
    renderVideoCards(elements.resultsList, [], 'Nenhuma busca feita ainda.');
    elements.prevPageButton.disabled = true;
    return;
  }

  await loadResults();
}

async function loadResults() {
  const search = new URLSearchParams({
    q: state.q,
    sort: state.sort,
    date: state.date,
    duration: state.duration,
    quality: state.quality,
    page: String(state.page)
  });

  if (state.watched === 'h') {
    search.set('watched', 'h');
  }

  if (state.ph === '1') {
    search.set('ph', '1');
  }

  const data = await fetchJson(`/api/search?${search.toString()}`);
  renderVideoCards(elements.resultsList, data.items, 'Nenhum resultado encontrado para esta busca.');
  elements.resultSummary.textContent = `${data.totalOnPage} resultado(s) para “${data.query}” ${state.ph === '1' ? 'em XVideos + Pornhub' : 'no XVideos'}.`;
  elements.pageIndicator.textContent = `Página ${state.page}`;
  elements.prevPageButton.disabled = state.page <= 1;
  persistRecentSearch(state.q);
}

function navigatePage(offset) {
  const nextPage = Math.max(1, state.page + offset);
  if (nextPage === state.page) return;

  state.page = nextPage;
  window.location.href = buildExploreHref(state);
}
