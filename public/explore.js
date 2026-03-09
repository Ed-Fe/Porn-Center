import {
  bindHeaderSearch,
  buildExploreHref,
  createSearchControls,
  fetchJson,
  fillSearchControls,
  getSourceLabel,
  loadProviderPreferences,
  persistRecentSearch,
  readProviderPreferencesFromControls,
  renderSiteHeader,
  renderQuickCategories,
  renderVideoCards,
  resolveProviderPreferences,
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
  providerPreferences: resolveProviderPreferences(params)
};

bootstrap().catch((error) => {
  setStatus(elements.statusMessage, `Erro ao iniciar a página: ${error.message}`, true);
});

async function bootstrap() {
  await setupHeaderSearch(controls);
  bindHeaderSearch(elements.searchForm, controls);
  fillSearchControls(controls, { ...state, ...state.providerPreferences });
  renderQuickCategories(elements.quickCategories);
  elements.clearFiltersButton.addEventListener('click', () => {
    fillSearchControls(controls, { q: state.q, ...state.providerPreferences });
  });
  controls.providerCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      state.providerPreferences = saveProviderPreferences(readProviderPreferencesFromControls(controls));
      fillSearchControls(controls, { ...state, ...state.providerPreferences });
      state.page = 1;
      if (state.q) {
        window.location.href = buildExploreHref({ ...state, ...state.providerPreferences });
      }
    });
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
    page: String(state.page),
    providers: state.providerPreferences.enabledProviders.join(',')
  });

  if (state.watched === 'h') {
    search.set('watched', 'h');
  }

  const data = await fetchJson(`/api/search?${search.toString()}`);
  renderVideoCards(elements.resultsList, data.items, 'Nenhum resultado encontrado para esta busca.');
  const loadedProviders = (data.providers || []).map((providerKey) => getSourceLabel(providerKey)).join(' + ');
  elements.resultSummary.textContent = `${data.totalOnPage} resultado(s) para “${data.query}”${loadedProviders ? ` em ${loadedProviders}` : ''}.`;
  elements.pageIndicator.textContent = `Página ${state.page}`;
  elements.prevPageButton.disabled = state.page <= 1;
  persistRecentSearch(state.q);
}

function navigatePage(offset) {
  const nextPage = Math.max(1, state.page + offset);
  if (nextPage === state.page) return;

  state.page = nextPage;
  window.location.href = buildExploreHref({ ...state, ...state.providerPreferences });
}
