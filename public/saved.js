import {
  bindHeaderSearch,
  buildViewHref,
  createSearchControls,
  escapeHtml,
  fillSearchControls,
  loadProviderPreferences,
  loadStorage,
  readProviderPreferencesFromControls,
  renderSiteHeader,
  saveProviderPreferences,
  setStatus,
  setupHeaderSearch
} from './common.js';

renderSiteHeader(document.querySelector('#siteHeader'), {
  subtitle: 'Salvos',
  currentPath: '/saved'
});

const controls = createSearchControls();
const elements = {
  searchForm: document.querySelector('#searchForm'),
  clearFiltersButton: document.querySelector('#clearFiltersButton'),
  clearFavoritesButton: document.querySelector('#clearFavoritesButton'),
  favoritesList: document.querySelector('#favoritesList'),
  savedSummary: document.querySelector('#savedSummary'),
  statusMessage: document.querySelector('#statusMessage')
};

bootstrap().catch((error) => {
  setStatus(elements.statusMessage, `Erro ao iniciar a página: ${error.message}`, true);
});

async function bootstrap() {
  await setupHeaderSearch(controls);
  bindHeaderSearch(elements.searchForm, controls);
  fillSearchControls(controls, loadProviderPreferences());
  elements.clearFiltersButton.addEventListener('click', () => fillSearchControls(controls, loadProviderPreferences()));
  controls.providerCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const preferences = saveProviderPreferences(readProviderPreferencesFromControls(controls));
      fillSearchControls(controls, preferences);
    });
  });
  elements.clearFavoritesButton.addEventListener('click', clearFavorites);
  renderFavorites();
}

function renderFavorites() {
  const favorites = loadStorage('bx_favorites', []);
  elements.favoritesList.innerHTML = '';
  elements.savedSummary.textContent = favorites.length
    ? `${favorites.length} vídeo(s) salvo(s) localmente.`
    : 'Nenhum vídeo salvo ainda.';

  if (!favorites.length) {
    elements.favoritesList.innerHTML = '<li class="empty-state">Nenhum favorito salvo ainda.</li>';
    return;
  }

  favorites.forEach((item) => {
    const row = document.createElement('li');
    row.className = 'favorite-card';
    row.innerHTML = `
      ${item.thumbnail ? `<img class="favorite-thumb" src="${escapeHtml(item.thumbnail)}" alt="Miniatura de ${escapeHtml(item.title)}" />` : ''}
      <div class="favorite-copy">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.duration)} · ${escapeHtml(item.uploaderName)}</p>
        <p>${escapeHtml(item.sourceName || 'Fonte não informada')}</p>
      </div>
      <a class="secondary button-link" href="${escapeHtml(buildViewHref(item))}">Abrir</a>
      <button class="ghost" type="button" data-remove-url="${escapeHtml(item.videoUrl)}">Remover</button>
    `;
    elements.favoritesList.appendChild(row);
  });

  elements.favoritesList.querySelectorAll('[data-remove-url]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = loadStorage('bx_favorites', []).filter((item) => item.videoUrl !== button.dataset.removeUrl);
      localStorage.setItem('bx_favorites', JSON.stringify(next));
      renderFavorites();
      setStatus(elements.statusMessage, 'Favorito removido.', true);
    });
  });
}

function clearFavorites() {
  localStorage.removeItem('bx_favorites');
  renderFavorites();
  setStatus(elements.statusMessage, 'Lista de favoritos limpa.', true);
}
