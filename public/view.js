import {
  bindHeaderSearch,
  buildStarHref,
  createSearchControls,
  escapeHtml,
  fetchJson,
  fillSearchControls,
  getMimeTypeForUrl,
  getSourceLabel,
  loadProviderPreferences,
  loadStorage,
  pickPreferredFormat,
  renderSiteHeader,
  saveStorage,
  saveProviderPreferences,
  setStatus,
  setupHeaderSearch
} from './common.js';

renderSiteHeader(document.querySelector('#siteHeader'), {
  subtitle: 'Player',
  currentPath: ''
});

const controls = createSearchControls();
const params = new URLSearchParams(window.location.search);
const videoUrl = params.get('url') || '';
const fallbackTitle = params.get('title') || '';
const fallbackThumb = params.get('thumb') || '';
const fallbackUploader = params.get('uploader') || '';
const fallbackProfile = params.get('profile') || '';
const fallbackDuration = params.get('duration') || '';
const fallbackSource = params.get('source') || '';

const elements = {
  searchForm: document.querySelector('#searchForm'),
  clearFiltersButton: document.querySelector('#clearFiltersButton'),
  statusMessage: document.querySelector('#statusMessage'),
  pageTitle: document.querySelector('#viewPageTitle'),
  viewContent: document.querySelector('#viewContent'),
  favoriteButton: document.querySelector('#favoriteButton')
};

let currentFavoritePayload = null;
let activeHls = null;

bootstrap().catch((error) => {
  setStatus(elements.statusMessage, `Erro ao iniciar a página: ${error.message}`, true);
});

async function bootstrap() {
  await setupHeaderSearch(controls);
  bindHeaderSearch(elements.searchForm, controls);
  fillSearchControls(controls, { includePornhub: loadProviderPreferences().includePornhub });
  elements.clearFiltersButton.addEventListener('click', () => fillSearchControls(controls, { includePornhub: loadProviderPreferences().includePornhub }));
  controls.pornhubCheckbox?.addEventListener('change', () => {
    saveProviderPreferences({ includePornhub: controls.pornhubCheckbox.checked });
  });
  elements.favoriteButton.addEventListener('click', toggleFavorite);

  if (!videoUrl) {
    elements.pageTitle.textContent = 'Vídeo indisponível';
    elements.viewContent.innerHTML = '<div class="empty-state">Nenhuma URL de vídeo foi informada.</div>';
    elements.favoriteButton.disabled = true;
    return;
  }

  await loadVideo();
}

async function loadVideo() {
  const response = await fetchJson(`/api/video?url=${encodeURIComponent(videoUrl)}`);
  const video = response.video;
  const title = video.title || fallbackTitle || 'Sem título';
  const cover = video.thumbnails[0] || fallbackThumb || '';
  const uploadDate = video.uploadDate ? new Date(video.uploadDate).toLocaleString('pt-BR') : 'Não informado';
  const preferredFormat = pickPreferredFormat(video.formats);
  currentFavoritePayload = {
    title,
    videoUrl,
    thumbnail: cover,
    uploaderName: fallbackUploader || 'Canal não informado',
    uploaderProfile: fallbackProfile || '',
    duration: fallbackDuration || 'Duração indisponível',
    sourceKey: video.sourceKey || fallbackSource || '',
    sourceName: video.sourceName || getSourceLabel(fallbackSource)
  };

  elements.pageTitle.textContent = title;
  elements.favoriteButton.disabled = false;
  syncFavoriteButton();

  const formatsMarkup = video.formats.length
    ? video.formats
        .map((format) => `<li><a class="format-link" href="${escapeHtml(format.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(format.label)}</a></li>`)
        .join('')
    : '<li class="empty-state">Nenhum link de qualidade retornado.</li>';

  elements.viewContent.innerHTML = `
    <article class="panel detail-page">
      <div class="panel-heading panel-heading-split">
        <div>
          <p>${escapeHtml(video.description || 'Descrição indisponível.')}</p>
        </div>
        <a class="secondary button-link" href="/explore">Voltar para explorar</a>
      </div>

      ${preferredFormat ? `
        <section class="player-card" aria-labelledby="playerTitle">
          <div class="player-header">
            <h3 id="playerTitle">Player</h3>
            <p id="playerStatus" class="player-status">Fonte inicial: ${escapeHtml(preferredFormat.label)}</p>
          </div>
          <video id="detailsVideoPlayer" class="details-player" controls preload="metadata" playsinline poster="${escapeHtml(cover)}" aria-describedby="playerStatus">
            <source src="${escapeHtml(preferredFormat.url)}" type="${escapeHtml(getMimeTypeForUrl(preferredFormat.url))}" />
            Seu navegador não conseguiu carregar este vídeo diretamente.
          </video>
          <div class="player-toolbar">
            <label class="field field-full player-source-field">
              <span>Qualidade / fonte</span>
              <select id="playerSourceSelect" aria-label="Selecionar qualidade do player">
                ${video.formats.map((format) => `<option value="${escapeHtml(format.url)}" ${format.url === preferredFormat.url ? 'selected' : ''}>${escapeHtml(format.label)}</option>`).join('')}
              </select>
            </label>
            <a id="openSourceLink" class="text-link" href="${escapeHtml(preferredFormat.url)}" target="_blank" rel="noreferrer noopener">Abrir fonte atual</a>
          </div>
        </section>
      ` : '<div class="empty-state">Nenhuma fonte reproduzível foi retornada para este item.</div>'}

      <div class="detail-columns">
        ${cover ? `<img class="details-cover" src="${escapeHtml(cover)}" alt="Miniatura de ${escapeHtml(title)}" />` : ''}
        <div class="details-meta">
          <p><strong>Data:</strong> ${escapeHtml(uploadDate)}</p>
          <p><strong>Visualizações:</strong> ${escapeHtml(video.views || 'Não informado')}</p>
          <p><strong>Origem:</strong> ${escapeHtml(video.sourceName || getSourceLabel(fallbackSource))}</p>
          ${fallbackProfile ? `<p><a class="text-link detail-inline-link" href="${escapeHtml(buildStarHref({ uploaderProfile: fallbackProfile, uploaderName: fallbackUploader, sourceKey: video.sourceKey || fallbackSource }))}">Ver página da estrela</a></p>` : ''}
          <div class="details-actions">
            <a class="text-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer noopener">Abrir página original</a>
            <button class="secondary" type="button" id="copyVideoLinkButton">Copiar link</button>
          </div>
        </div>
      </div>

      <div>
        <h3>Links disponíveis</h3>
        <ul class="format-list">${formatsMarkup}</ul>
      </div>
    </article>
  `;

  bindViewInteractions(video.formats, preferredFormat);
}

function applyPlayerFormat(player, sourceSelect, playerStatus, openSourceLink, format, onHlsFatalError) {
  if (!player || !format?.url) return;

  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }

  player.pause();
  player.removeAttribute('src');
  // Remove todos os elementos <source> existentes para evitar conflitos
  while (player.firstChild) {
    player.removeChild(player.firstChild);
  }

  const isHlsSource = getMimeTypeForUrl(format.url) === 'application/x-mpegURL';
  const canPlayHlsNatively = Boolean(player.canPlayType('application/vnd.apple.mpegurl') || player.canPlayType('application/x-mpegURL'));

  if (isHlsSource && !canPlayHlsNatively && window.Hls?.isSupported?.()) {
    activeHls = new window.Hls();
    if (window.Hls?.Events?.ERROR && typeof onHlsFatalError === 'function') {
      activeHls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) {
          onHlsFatalError();
        }
      });
    }
    activeHls.loadSource(format.url);
    activeHls.attachMedia(player);
  } else {
    player.src = format.url;
    player.load();
  }

  if (sourceSelect) {
    sourceSelect.value = format.url;
  }

  if (playerStatus) {
    playerStatus.textContent = `Fonte atual: ${format.label || 'Fonte atual'}`;
  }

  if (openSourceLink) {
    openSourceLink.href = format.url;
  }
}

function bindViewInteractions(formats = [], initialFormat = null) {
  const copyButton = document.querySelector('#copyVideoLinkButton');
  const player = document.querySelector('#detailsVideoPlayer');
  const sourceSelect = document.querySelector('#playerSourceSelect');
  const playerStatus = document.querySelector('#playerStatus');
  const openSourceLink = document.querySelector('#openSourceLink');
  const triedFormats = new Set();

  const switchToNextFormat = (reason = 'A fonte atual falhou.') => {
    markCurrentFormatAsTried();
    const fallbackFormat = formats.find((format) => format?.url && !triedFormats.has(format.url));

    if (fallbackFormat) {
      triedFormats.add(fallbackFormat.url);
      applyPlayerFormat(player, sourceSelect, playerStatus, openSourceLink, fallbackFormat);
      setStatus(elements.statusMessage, `${reason} Tentando automaticamente ${fallbackFormat.label}.`, true);
      return true;
    }

    setStatus(elements.statusMessage, 'O navegador não conseguiu reproduzir nenhuma fonte automática. Tente abrir um link manualmente abaixo.', true);
    return false;
  };

  const activateFormat = (format, announcement = '') => {
    if (!format?.url) {
      return false;
    }

    triedFormats.add(format.url);
    applyPlayerFormat(
      player,
      sourceSelect,
      playerStatus,
      openSourceLink,
      format,
      () => switchToNextFormat('A transmissão HLS falhou.')
    );

    if (announcement) {
      setStatus(elements.statusMessage, announcement, true);
    }

    return true;
  };

  const markCurrentFormatAsTried = () => {
    const currentUrl = sourceSelect?.value || player?.currentSrc || player?.src;
    if (currentUrl) {
      triedFormats.add(currentUrl);
    }
  };

  copyButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(videoUrl);
      setStatus(elements.statusMessage, 'Link copiado para a área de transferência.', true);
    } catch {
      setStatus(elements.statusMessage, 'Não foi possível copiar automaticamente.', true);
    }
  });

  sourceSelect?.addEventListener('change', () => {
    const selectedUrl = sourceSelect.value;
    const selectedLabel = sourceSelect.selectedOptions[0]?.textContent || 'Fonte atual';
    if (!player || !selectedUrl) return;
    triedFormats.clear();
    activateFormat({
      url: selectedUrl,
      label: selectedLabel
    }, `Fonte do player alterada para ${selectedLabel}.`);
  });

  player?.addEventListener('error', () => {
    switchToNextFormat('A fonte atual falhou.');
  });

  if (initialFormat?.url) {
    activateFormat(initialFormat);
  } else {
    markCurrentFormatAsTried();
  }
}

function toggleFavorite() {
  if (!currentFavoritePayload) return;
  const favorites = loadStorage('bx_favorites', []);
  const exists = favorites.some((item) => item.videoUrl === currentFavoritePayload.videoUrl);

  if (exists) {
    saveStorage('bx_favorites', favorites.filter((item) => item.videoUrl !== currentFavoritePayload.videoUrl));
    setStatus(elements.statusMessage, 'Favorito removido.', true);
  } else {
    saveStorage('bx_favorites', [currentFavoritePayload, ...favorites].slice(0, 20));
    setStatus(elements.statusMessage, 'Favorito salvo.', true);
  }

  syncFavoriteButton();
}

function syncFavoriteButton() {
  const favorites = loadStorage('bx_favorites', []);
  const isFavorite = currentFavoritePayload && favorites.some((item) => item.videoUrl === currentFavoritePayload.videoUrl);
  elements.favoriteButton.textContent = isFavorite ? 'Remover favorito' : 'Salvar favorito';
}
