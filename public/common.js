export const QUICK_CATEGORIES = ['amateur', 'latina', 'milf', 'asian', 'anal', 'massage', 'public', 'cosplay'];
export const PROVIDER_OPTIONS = Object.freeze([
  { key: 'xvideos', label: 'XVideos', queryKey: 'xv', checkboxId: 'xvideosCheckbox' },
  { key: 'pornhub', label: 'Pornhub', queryKey: 'ph', checkboxId: 'pornhubCheckbox' },
  { key: 'mallandrinhas', label: 'Malandrinhas', queryKey: 'ml', checkboxId: 'mallandrinhasCheckbox' }
]);
export const DEFAULT_PROVIDER_PREFERENCES = Object.freeze({
  includeXVideos: true,
  includePornhub: true,
  includeMallandrinhas: true
});
export const SOURCE_LABELS = Object.freeze({
  xvideos: 'XVideos',
  pornhub: 'Pornhub',
  mallandrinhas: 'Malandrinhas'
});

export const OPTION_LABELS = {
  sorts: {
    relevance: 'Relevância',
    uploaddate: 'Data de upload',
    rating: 'Avaliação',
    length: 'Duração',
    views: 'Visualizações',
    random: 'Aleatório'
  },
  dates: {
    all: 'Qualquer data',
    today: 'Hoje',
    week: 'Última semana',
    month: 'Último mês',
    '3month': 'Últimos 3 meses',
    '6month': 'Últimos 6 meses'
  },
  durations: {
    allduration: 'Qualquer duração',
    '1-3min': '1 a 3 min',
    '3-10min': '3 a 10 min',
    '10min_more': 'Mais de 10 min',
    '10-20min': '10 a 20 min',
    '20min_more': 'Mais de 20 min'
  },
  qualities: {
    all: 'Qualquer qualidade',
    hd: 'HD',
    '1080p': '1080p'
  }
};

const MAIN_NAV_ITEMS = Object.freeze([
  { href: '/', label: 'Início' },
  { href: '/saved', label: 'Salvos' },
  { href: '/explore', label: 'Explorar' }
]);

function providerBooleanKey(providerKey) {
  if (providerKey === 'xvideos') {
    return 'includeXVideos';
  }

  if (providerKey === 'pornhub') {
    return 'includePornhub';
  }

  if (providerKey === 'mallandrinhas') {
    return 'includeMallandrinhas';
  }

  return '';
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value == null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'on', 'yes', 'y', 'sim'].includes(String(value).trim().toLowerCase());
}

export function normalizeProviderPreferences(value = {}, defaults = DEFAULT_PROVIDER_PREFERENCES) {
  const fallback = {
    includeXVideos: parseBoolean(defaults.includeXVideos ?? defaults.xvideos, DEFAULT_PROVIDER_PREFERENCES.includeXVideos),
    includePornhub: parseBoolean(defaults.includePornhub ?? defaults.pornhub, DEFAULT_PROVIDER_PREFERENCES.includePornhub),
    includeMallandrinhas: parseBoolean(defaults.includeMallandrinhas ?? defaults.mallandrinhas, DEFAULT_PROVIDER_PREFERENCES.includeMallandrinhas)
  };
  const providers = String(value.providers ?? value.enabledProviders ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => PROVIDER_OPTIONS.some((option) => option.key === entry));

  let preferences;

  if (providers.length) {
    preferences = {
      includeXVideos: providers.includes('xvideos'),
      includePornhub: providers.includes('pornhub'),
      includeMallandrinhas: providers.includes('mallandrinhas')
    };
  } else {
    preferences = {
      includeXVideos: parseBoolean(value.xv ?? value.includeXVideos ?? value.xvideos, fallback.includeXVideos),
      includePornhub: parseBoolean(value.ph ?? value.includePornhub ?? value.pornhub, fallback.includePornhub),
      includeMallandrinhas: parseBoolean(value.ml ?? value.includeMallandrinhas ?? value.mallandrinhas, fallback.includeMallandrinhas)
    };
  }

  let enabledProviders = PROVIDER_OPTIONS
    .map((option) => option.key)
    .filter((providerKey) => preferences[providerBooleanKey(providerKey)]);

  if (!enabledProviders.length) {
    enabledProviders = PROVIDER_OPTIONS
      .map((option) => option.key)
      .filter((providerKey) => fallback[providerBooleanKey(providerKey)]);

    if (!enabledProviders.length) {
      enabledProviders = ['xvideos'];
    }

    preferences = {
      includeXVideos: enabledProviders.includes('xvideos'),
      includePornhub: enabledProviders.includes('pornhub'),
      includeMallandrinhas: enabledProviders.includes('mallandrinhas')
    };
  }

  return {
    ...preferences,
    enabledProviders
  };
}

export function loadProviderPreferences() {
  return normalizeProviderPreferences(loadStorage('bx_provider_preferences', DEFAULT_PROVIDER_PREFERENCES));
}

export function saveProviderPreferences(value) {
  const preferences = normalizeProviderPreferences(value);
  saveStorage('bx_provider_preferences', preferences);
  return preferences;
}

export function resolveProviderPreferences(params) {
  const stored = loadProviderPreferences();

  if (!params) {
    return stored;
  }

  if (params instanceof URLSearchParams) {
    return normalizeProviderPreferences({
      providers: params.get('providers') || undefined,
      xv: params.has('xv') ? params.get('xv') : undefined,
      ph: params.has('ph') ? params.get('ph') : undefined,
      ml: params.has('ml') ? params.get('ml') : undefined
    }, stored);
  }

  return normalizeProviderPreferences(params, stored);
}

export function getSourceLabel(sourceKey = '', fallback = '') {
  return SOURCE_LABELS[sourceKey] || fallback || 'Fonte externa';
}

export function getEnabledProviderLabels(preferences = {}) {
  const normalized = normalizeProviderPreferences(preferences, loadProviderPreferences());

  return normalized.enabledProviders
    .map((providerKey) => getSourceLabel(providerKey))
    .join(' + ');
}

export async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Erro inesperado na comunicação com o servidor.');
  }

  return payload;
}

export async function loadMeta() {
  return fetchJson('/api/meta');
}

export function loadStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

export function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderSiteHeader(target, options = {}) {
  if (!target) return;

  const subtitle = escapeHtml(options.subtitle || 'Feed inicial');
  const currentPath = String(options.currentPath || '/');
  const navMarkup = MAIN_NAV_ITEMS
    .map((item) => {
      const isActive = item.href === currentPath;
      return `<a class="nav-link${isActive ? ' is-active' : ''}" href="${item.href}"${isActive ? ' aria-current="page"' : ''}>${item.label}</a>`;
    })
    .join('');

  target.innerHTML = `
    <header class="site-header">
      <div class="header-topbar">
        <a class="brand-block brand-link" href="/" aria-label="Ir para a página inicial">
          <span class="brand-badge" aria-hidden="true">BX</span>
          <div class="brand-copy">
            <h1>Beter XVideos</h1>
            <span>${subtitle}</span>
          </div>
        </a>

        <nav class="main-nav" aria-label="Navegação principal">
          ${navMarkup}
        </nav>
      </div>

      <details class="search-disclosure">
        <summary class="search-disclosure-summary">Busca e filtros</summary>
        <form id="searchForm" class="header-search-form">
          <div c
          lass="search-row">
            <label class="field field-full header-search-field">
              <span class="sr-only">Termo de busca</span>
              <input id="searchInput" name="q" type="search" autocomplete="off" placeholder="Buscar vídeos, canais ou temas..." required />
            </label>
            <button class="primary search-submit" type="submit">Buscar</button>
          </div>

          <div class="filter-row">
            <label class="field"><span>Ordenar por</span><select id="sortSelect" name="sort"></select></label>
            <label class="field"><span>Data</span><select id="dateSelect" name="date"></select></label>
            <label class="field"><span>Duração</span><select id="durationSelect" name="duration"></select></label>
            <label class="field"><span>Qualidade</span><select id="qualitySelect" name="quality"></select></label>
            <label class="checkbox-row header-checkbox-row"><input id="watchedCheckbox" name="watched" type="checkbox" value="h" /><span>Ocultar vistos</span></label>
            <fieldset class="field provider-fieldset">
              <legend>Provedores</legend>
              <div class="provider-options">
                ${PROVIDER_OPTIONS.map((option) => `
                  <label class="checkbox-row header-checkbox-row provider-checkbox-row">
                    <input id="${option.checkboxId}" data-provider="${option.key}" name="${option.queryKey}" type="checkbox" value="1" />
                    <span>${option.label}</span>
                  </label>
                `).join('')}
              </div>
            </fieldset>
            <button class="secondary compact-button" id="clearFiltersButton" type="button">Limpar</button>
          </div>
        </form>
      </details>
    </header>
  `;
}

export function hydrateSelect(select, values, labels) {
  select.innerHTML = values
    .map((value) => `<option value="${value}">${labels[value] || value}</option>`)
    .join('');
}

export function fillSearchControls(controls, params = {}) {
  controls.searchInput.value = params.q || '';
  controls.sortSelect.value = params.sort || 'relevance';
  controls.dateSelect.value = params.date || 'all';
  controls.durationSelect.value = params.duration || 'allduration';
  controls.qualitySelect.value = params.quality || 'all';
  controls.watchedCheckbox.checked = params.watched === 'h';
  const preferences = normalizeProviderPreferences(params, loadProviderPreferences());
  controls.providerCheckboxes.forEach((checkbox) => {
    checkbox.checked = preferences[providerBooleanKey(checkbox.dataset.provider)];
  });
}

export function readProviderPreferencesFromControls(controls) {
  const enabledProviders = PROVIDER_OPTIONS
    .filter((option) => controls.providerCheckboxes.some((checkbox) => checkbox.dataset.provider === option.key && checkbox.checked))
    .map((option) => option.key);

  return normalizeProviderPreferences({ providers: enabledProviders.join(',') }, {
    includeXVideos: false,
    includePornhub: false,
    includeMallandrinhas: false
  });
}

export function readSearchControls(controls) {
  const providerPreferences = readProviderPreferencesFromControls(controls);

  return {
    q: controls.searchInput.value.trim(),
    sort: controls.sortSelect.value,
    date: controls.dateSelect.value,
    duration: controls.durationSelect.value,
    quality: controls.qualitySelect.value,
    watched: controls.watchedCheckbox.checked ? 'h' : '',
    providers: providerPreferences.enabledProviders.join(',')
  };
}

export function buildExploreHref(params = {}) {
  const search = new URLSearchParams();

  if (params.q) search.set('q', params.q);
  if (params.sort && params.sort !== 'relevance') search.set('sort', params.sort);
  if (params.date && params.date !== 'all') search.set('date', params.date);
  if (params.duration && params.duration !== 'allduration') search.set('duration', params.duration);
  if (params.quality && params.quality !== 'all') search.set('quality', params.quality);
  if (params.watched === 'h') search.set('watched', 'h');
  search.set('providers', normalizeProviderPreferences(params, loadProviderPreferences()).enabledProviders.join(','));
  if (params.page && Number(params.page) > 1) search.set('page', String(params.page));

  const query = search.toString();
  return query ? `/explore?${query}` : '/explore';
}

export function buildViewHref(item = {}) {
  const params = new URLSearchParams();
  params.set('url', item.videoUrl || item.video || '');
  if (item.title) params.set('title', item.title);
  if (item.thumbnail) params.set('thumb', item.thumbnail);
  if (item.uploaderName) params.set('uploader', item.uploaderName);
  if (item.uploaderProfile) params.set('profile', item.uploaderProfile);
  if (item.duration) params.set('duration', item.duration);
  if (item.sourceKey) params.set('source', item.sourceKey);
  return `/view?${params.toString()}`;
}

export function buildStarHref(item = {}) {
  const profileUrl = item.uploaderProfile || item.profileUrl || item.url || '';
  const params = new URLSearchParams();

  params.set('url', profileUrl);
  if (item.uploaderName || item.name) params.set('name', item.uploaderName || item.name);
  if (item.sourceKey) params.set('source', item.sourceKey);

  return `/star?${params.toString()}`;
}

export function setStatus(element, message, announce = false) {
  if (!element) return;
  element.textContent = message;
  element.setAttribute('aria-live', announce ? 'polite' : 'off');
  if (announce) {
    element.setAttribute('role', 'status');
  } else {
    element.removeAttribute('role');
  }
}

export function renderRecentSearches(container, items) {
  if (!container) return;
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">Suas buscas recentes aparecerão aqui.</p>';
    return;
  }

  items.forEach((query) => {
    const link = document.createElement('a');
    link.className = 'chip';
    link.href = buildExploreHref({ q: query });
    link.textContent = query;
    container.appendChild(link);
  });
}

export function renderQuickCategories(container) {
  if (!container) return;
  container.innerHTML = '';
  QUICK_CATEGORIES.forEach((category) => {
    const link = document.createElement('a');
    link.className = 'chip chip-large';
    link.href = buildExploreHref({ q: category });
    link.textContent = category;
    container.appendChild(link);
  });
}

export function renderVideoCards(container, items, emptyMessage = 'Nenhum vídeo disponível.', options = {}) {
  if (!container) return;
  container.innerHTML = '';

  const showStarLinks = options.showStarLinks !== false;

  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = emptyMessage;
    container.appendChild(li);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const sourceLabel = getSourceLabel(item.sourceKey, item.sourceName);
    const uploaderName = item.uploaderName || 'Canal não informado';
    const hasStarLink = showStarLinks && Boolean(item.uploaderProfile);
    const li = document.createElement('li');
    li.innerHTML = `
      <article class="result-card-shell">
        <header class="result-card-header">
          <div class="result-card-heading">
            <span class="source-pill">${escapeHtml(sourceLabel)}</span>
            <strong class="result-star-name">${escapeHtml(uploaderName)}</strong>
          </div>
          ${hasStarLink ? `<a class="text-link result-star-link" href="${escapeHtml(buildStarHref(item))}" aria-label="Ver página da estrela ${escapeHtml(uploaderName)}">Ver estrela</a>` : ''}
        </header>
        <a class="result-card" href="${escapeHtml(buildViewHref(item))}">
          <img class="result-thumb" src="${escapeHtml(item.thumbnail || '')}" alt="${escapeHtml(item.thumbnail ? `Miniatura de ${item.title}` : '')}" loading="lazy" />
          <div class="result-body">
            <h3 class="result-title">${escapeHtml(item.title || 'Sem título')}</h3>
            <span class="result-meta">${escapeHtml(item.duration || 'Duração indisponível')}</span>
            <span class="result-uploader">Vídeo de ${escapeHtml(uploaderName)}</span>
          </div>
        </a>
      </article>
    `;
    fragment.appendChild(li);
  });

  container.appendChild(fragment);
}

export function persistRecentSearch(query) {
  if (!query) return;
  const recent = loadStorage('bx_recent_searches', []);
  const next = [query, ...recent.filter((item) => item !== query)].slice(0, 8);
  saveStorage('bx_recent_searches', next);
}

function isDirectPlayableFormat(format = {}) {
  const url = String(format.url || '');
  const label = String(format.label || '');
  return !isResolverFormat(format) && (/\.(mp4|webm|3gp)($|\?)/i.test(url) || /\b(mp4|webm|3gp)\b/i.test(label));
}

function isStreamingFormat(format = {}) {
  const url = String(format.url || '');
  const label = String(format.label || '');
  return /\.m3u8($|\?)/i.test(url) || /\bhls\b/i.test(label);
}

function isResolverFormat(format = {}) {
  return /\/video\/get_media(?:$|\?)/i.test(String(format.url || ''));
}

export function pickPreferredFormat(formats = []) {
  const playableFormats = formats.filter((format) => typeof format?.url === 'string' && /^https?:/i.test(format.url));
  const priority = ['HD Quality', 'Default Quality', 'Low Quality', 'HLS Quality', 'Qualidade padrão'];
  const scoredFormats = playableFormats
    .map((format) => {
      const numericLabel = String(format.label || '').match(/(\d{3,4})p/i);
      return {
        ...format,
        score: numericLabel ? Number(numericLabel[1]) : 0,
        directScore: isDirectPlayableFormat(format)
          ? 3
          : (isStreamingFormat(format)
              ? 2
              : (isResolverFormat(format) ? 1 : 0))
      };
    })
    .sort((left, right) => {
      if (right.directScore !== left.directScore) {
        return right.directScore - left.directScore;
      }

      return right.score - left.score;
    });

  if (scoredFormats[0]) {
    return scoredFormats[0];
  }

  for (const label of priority) {
    const match = playableFormats.find((format) => format.label === label);
    if (match) return match;
  }

  return playableFormats[0] || null;
}

export function getMimeTypeForUrl(url) {
  if (/\.m3u8($|\?)/i.test(url)) return 'application/x-mpegURL';
  if (/\.mp4($|\?)/i.test(url)) return 'video/mp4';
  if (/\.webm($|\?)/i.test(url)) return 'video/webm';
  if (/\.3gp($|\?)/i.test(url)) return 'video/3gpp';
  return 'video/mp4';
}

export function bindHeaderSearch(form, controls) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const href = buildExploreHref(readSearchControls(controls));
    const query = controls.searchInput.value.trim();
    if (query) {
      persistRecentSearch(query);
    }
    window.location.href = href;
  });
}

export async function setupHeaderSearch(controls) {
  const meta = await loadMeta();
  hydrateSelect(controls.sortSelect, meta.sorts, OPTION_LABELS.sorts);
  hydrateSelect(controls.dateSelect, meta.dates, OPTION_LABELS.dates);
  hydrateSelect(controls.durationSelect, meta.durations, OPTION_LABELS.durations);
  hydrateSelect(controls.qualitySelect, meta.qualities, OPTION_LABELS.qualities);
  return meta;
}

export function createSearchControls(root = document) {
  return {
    searchInput: root.querySelector('#searchInput'),
    sortSelect: root.querySelector('#sortSelect'),
    dateSelect: root.querySelector('#dateSelect'),
    durationSelect: root.querySelector('#durationSelect'),
    qualitySelect: root.querySelector('#qualitySelect'),
    watchedCheckbox: root.querySelector('#watchedCheckbox'),
    xvideosCheckbox: root.querySelector('#xvideosCheckbox'),
    pornhubCheckbox: root.querySelector('#pornhubCheckbox'),
    mallandrinhasCheckbox: root.querySelector('#mallandrinhasCheckbox'),
    providerCheckboxes: Array.from(root.querySelectorAll('[data-provider]'))
  };
}
