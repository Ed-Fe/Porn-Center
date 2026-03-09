import {
  bindHeaderSearch,
  createSearchControls,
  fetchJson,
  fillSearchControls,
  getSourceLabel,
  loadLocalePreference,
  loadProviderPreferences,
  loadStorage,
  readProviderPreferencesFromControls,
  renderSiteHeader,
  renderQuickCategories,
  renderRecentSearches,
  renderVideoCards,
  saveProviderPreferences,
  saveLocalePreference,
  setStatus,
  setupHeaderSearch
} from './common.js';

renderSiteHeader(document.querySelector('#siteHeader'), {
  subtitle: 'Feed inicial',
  currentPath: '/'
});

const controls = createSearchControls();
const elements = {
  searchForm: document.querySelector('#searchForm'),
  clearFiltersButton: document.querySelector('#clearFiltersButton'),
  clearRecentButton: document.querySelector('#clearRecentButton'),
  resultsList: document.querySelector('#resultsList'),
  resultSummary: document.querySelector('#resultSummary'),
  statusMessage: document.querySelector('#statusMessage'),
  pageIndicator: document.querySelector('#pageIndicator'),
  prevPageButton: document.querySelector('#prevPageButton'),
  nextPageButton: document.querySelector('#nextPageButton'),
  recentSearches: document.querySelector('#recentSearches'),
  quickCategories: document.querySelector('#quickCategories')
};

const state = {
  page: 1,
  locale: loadLocalePreference(),
  providerPreferences: loadProviderPreferences()
};

bootstrap().catch((error) => {
  setStatus(elements.statusMessage, `Erro ao iniciar a página: ${error.message}`, true);
});

async function bootstrap() {
  await setupHeaderSearch(controls);
  bindHeaderSearch(elements.searchForm, controls);
  fillSearchControls(controls, { ...state.providerPreferences, locale: state.locale });
  renderRecentSearches(elements.recentSearches, loadStorage('bx_recent_searches', []));
  renderQuickCategories(elements.quickCategories);
  elements.clearFiltersButton.addEventListener('click', () => fillSearchControls(controls, state.providerPreferences));
  elements.clearRecentButton.addEventListener('click', () => {
    localStorage.removeItem('bx_recent_searches');
    renderRecentSearches(elements.recentSearches, []);
    setStatus(elements.statusMessage, 'Histórico de buscas limpo.', true);
  });
  controls.providerCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      state.providerPreferences = saveProviderPreferences(readProviderPreferencesFromControls(controls));
      state.locale = saveLocalePreference(controls.localeSelect.value);
      fillSearchControls(controls, state.providerPreferences);
      state.page = 1;
      await loadFeed();
    });
  });
  controls.localeSelect.addEventListener('change', async () => {
    state.locale = saveLocalePreference(controls.localeSelect.value);
    fillSearchControls(controls, { ...state.providerPreferences, locale: state.locale });
    state.page = 1;
    await loadFeed();
  });
  elements.prevPageButton.addEventListener('click', () => changePage(-1));
  elements.nextPageButton.addEventListener('click', () => changePage(1));
  await loadFeed();
}

async function loadFeed() {
  setStatus(elements.statusMessage, 'Carregando feed inicial...');
  const search = new URLSearchParams({ page: String(state.page) });
  search.set('providers', state.providerPreferences.enabledProviders.join(','));
  search.set('locale', state.locale);
  const data = await fetchJson(`/api/feed?${search.toString()}`);
  renderVideoCards(elements.resultsList, data.items, 'Nenhum vídeo disponível no feed inicial.');
  const loadedProviders = (data.providers || []).map((providerKey) => getSourceLabel(providerKey)).join(' + ');
  elements.resultSummary.textContent = `${data.totalOnPage} vídeo(s) carregados no feed ${loadedProviders ? `de ${loadedProviders}` : 'selecionado'}.`;
  elements.pageIndicator.textContent = `Página ${state.page}`;
  elements.prevPageButton.disabled = state.page <= 1;
  setStatus(elements.statusMessage, '');
}

async function changePage(offset) {
  const nextPage = Math.max(1, state.page + offset);
  if (nextPage === state.page) return;
  state.page = nextPage;
  await loadFeed();
}
