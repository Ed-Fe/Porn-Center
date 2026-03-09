import {
  bindHeaderSearch,
  createSearchControls,
  escapeHtml,
  fetchJson,
  fillSearchControls,
  loadProviderPreferences,
  readProviderPreferencesFromControls,
  renderSiteHeader,
  renderVideoCards,
  saveProviderPreferences,
  setStatus,
  setupHeaderSearch
} from './common.js';

renderSiteHeader(document.querySelector('#siteHeader'), {
  subtitle: 'Estrela',
  currentPath: ''
});

const controls = createSearchControls();
const params = new URLSearchParams(window.location.search);
const profileUrl = params.get('url') || '';
const fallbackName = params.get('name') || '';

const elements = {
  searchForm: document.querySelector('#searchForm'),
  clearFiltersButton: document.querySelector('#clearFiltersButton'),
  statusMessage: document.querySelector('#statusMessage'),
  pageTitle: document.querySelector('#starPageTitle'),
  summary: document.querySelector('#starSummary'),
  content: document.querySelector('#starContent')
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

  if (!profileUrl) {
    elements.pageTitle.textContent = 'Estrela indisponível';
    elements.summary.textContent = 'Nenhuma URL de perfil foi informada.';
    elements.content.innerHTML = '<div class="panel empty-state">Informe uma estrela válida para ver os detalhes.</div>';
    return;
  }

  await loadPerformer();
}

async function loadPerformer() {
  setStatus(elements.statusMessage, 'Carregando detalhes da estrela...');
  const response = await fetchJson(`/api/star?url=${encodeURIComponent(profileUrl)}`);
  const performer = response.performer;
  const name = performer.name || fallbackName || 'Estrela sem nome';
  const statsMarkup = performer.stats?.length
    ? performer.stats.map((entry) => `<li><strong>${escapeHtml(entry.label)}:</strong> ${escapeHtml(entry.value)}</li>`).join('')
    : '<li class="empty-state">Sem detalhes adicionais disponíveis.</li>';

  elements.pageTitle.textContent = name;
  elements.summary.textContent = `${response.totalOnPage} vídeo(s) enviados por ${name}.`;
  elements.content.innerHTML = `
    <article class="panel detail-page">
      <div class="detail-columns performer-columns">
        ${performer.avatar ? `<img class="details-cover performer-avatar" src="${escapeHtml(performer.avatar)}" alt="Foto de ${escapeHtml(name)}" />` : ''}
        <div class="details-meta performer-meta">
          <p><strong>Origem:</strong> ${escapeHtml(performer.sourceName || 'Não informada')}</p>
          ${performer.headline ? `<p><strong>Resumo:</strong> ${escapeHtml(performer.headline)}</p>` : ''}
          <p>${escapeHtml(performer.description || 'Sem descrição pública disponível.')}</p>
          <div class="details-actions">
            <a class="text-link" href="${escapeHtml(performer.profileUrl)}" target="_blank" rel="noreferrer noopener">Abrir perfil original</a>
            <a class="text-link" href="${escapeHtml(performer.uploadsUrl || performer.profileUrl)}" target="_blank" rel="noreferrer noopener">Abrir uploads</a>
          </div>
          <div>
            <h3>Detalhes</h3>
            <ul class="format-list performer-stats">${statsMarkup}</ul>
          </div>
        </div>
      </div>
      <div>
        <h3>Vídeos enviados</h3>
        <ol id="starResultsList" class="feed-grid"></ol>
      </div>
    </article>
  `;

  renderVideoCards(
    document.querySelector('#starResultsList'),
    response.items,
    'Nenhum vídeo enviado foi encontrado para esta estrela.',
    { showStarLinks: false }
  );
  setStatus(elements.statusMessage, '');
}