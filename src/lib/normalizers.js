const ALLOWED_SORTS = ['relevance', 'uploaddate', 'rating', 'length', 'views', 'random'];
const ALLOWED_DATES = ['all', 'today', 'week', 'month', '3month', '6month'];
const ALLOWED_DURATIONS = ['allduration', '1-3min', '3-10min', '10min_more', '10-20min', '20min_more'];
const ALLOWED_QUALITIES = ['all', 'hd', '1080p'];
const DEFAULT_PROVIDER_PREFERENCES = Object.freeze({
  includePornhub: true
});

const SOURCE_LABELS = Object.freeze({
  xvideos: 'XVideos',
  pornhub: 'Pornhub'
});

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value == null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['1', 'true', 'on', 'yes', 'y', 'sim'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'off', 'no', 'n', 'nao', 'não'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeProviderPreferences(query = {}, defaults = DEFAULT_PROVIDER_PREFERENCES) {
  const fallback = {
    ...DEFAULT_PROVIDER_PREFERENCES,
    ...(defaults && typeof defaults === 'object' ? defaults : {})
  };
  const rawIncludePornhub = query.ph ?? query.includePornhub ?? query.pornhub;

  return {
    includePornhub: parseBoolean(rawIncludePornhub, fallback.includePornhub)
  };
}

function getSourceName(sourceKey = '') {
  return SOURCE_LABELS[sourceKey] || 'Fonte externa';
}

function clampPage(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 250);
}

function normalizeSearchParams(query = {}) {
  const search = String(query.q ?? query.search ?? '').trim();
  const sort = pickAllowed(String(query.sort ?? '').trim(), ALLOWED_SORTS, 'relevance');
  const filterDate = pickAllowed(String(query.date ?? query.filterDate ?? '').trim(), ALLOWED_DATES, 'all');
  const filterDuration = pickAllowed(String(query.duration ?? query.filterDuration ?? '').trim(), ALLOWED_DURATIONS, 'allduration');
  const filterQuality = pickAllowed(String(query.quality ?? query.filterQuality ?? '').trim(), ALLOWED_QUALITIES, 'all');
  const watched = String(query.watched ?? query.viewWatched ?? '').trim() === 'h' ? 'h' : undefined;
  const pagination = clampPage(Number(query.page ?? query.pagination ?? 1));

  return {
    search,
    sort,
    pagination,
    proxy: false,
    ...(filterDate !== 'all' ? { filterDate } : {}),
    ...(filterDuration !== 'allduration' ? { filterDuration } : {}),
    ...(filterQuality !== 'all' ? { filterQuality } : {}),
    ...(watched ? { viewWatched: watched } : {})
  };
}

function normalizeSearchResults(results = [], options = {}) {
  const defaultSourceKey = String(options.sourceKey ?? '').trim() || 'xvideos';
  const defaultSourceName = String(options.sourceName ?? '').trim() || getSourceName(defaultSourceKey);

  return results
    .filter(Boolean)
    .map((item, index) => ({
      id: `${String(item.sourceKey ?? defaultSourceKey)}-${index}-${Buffer.from(String(item.video ?? '')).toString('base64').slice(0, 12)}`,
      title: String(item.title ?? 'Sem título'),
      videoUrl: String(item.video ?? ''),
      thumbnail: item.thumbnail ? String(item.thumbnail) : '',
      duration: String(item.duration ?? 'Duração indisponível'),
      uploaderName: String(item.uploaderName ?? 'Canal não informado'),
      uploaderProfile: item.uploaderProfile ? String(item.uploaderProfile) : '',
      sourceKey: String(item.sourceKey ?? defaultSourceKey),
      sourceName: String(item.sourceName ?? defaultSourceName)
    }))
    .filter((item) => item.videoUrl && isSafeVideoUrl(item.videoUrl));
}

function mixSearchResults(collections = []) {
  const queues = collections.map((items) => (Array.isArray(items) ? items.filter(Boolean) : []));
  const mixed = [];
  let index = 0;

  while (true) {
    let appended = false;

    for (const items of queues) {
      if (index < items.length) {
        mixed.push(items[index]);
        appended = true;
      }
    }

    if (!appended) {
      return mixed;
    }

    index += 1;
  }
}

function formatQualityLabel(label) {
  return String(label)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeFormats(contentUrl) {
  if (!contentUrl) {
    return [];
  }

  if (Array.isArray(contentUrl)) {
    return contentUrl
      .filter((format) => format && typeof format === 'object')
      .map((format) => ({
        label: String(format.label ?? 'Qualidade padrão'),
        url: String(format.url ?? '')
      }))
      .filter((format) => format.url);
  }

  if (typeof contentUrl === 'string') {
    return [{ label: 'Qualidade padrão', url: contentUrl }];
  }

  return Object.entries(contentUrl)
    .filter(([, url]) => typeof url === 'string' && url)
    .map(([label, url]) => ({
      label: formatQualityLabel(label),
      url
    }));
}

function normalizeVideoData(videoData = {}, options = {}) {
  const formats = normalizeFormats(videoData.contentUrl);
  const thumbnails = Array.isArray(videoData.thumbnailUrl)
    ? videoData.thumbnailUrl.filter(Boolean).map(String)
    : videoData.thumbnailUrl
      ? [String(videoData.thumbnailUrl)]
      : [];
  const sourceKey = String(options.sourceKey ?? videoData.sourceKey ?? getVideoProviderKey(videoData.url ?? videoData.mainEntityOfPage ?? '')).trim() || 'xvideos';
  const sourceName = String(options.sourceName ?? videoData.sourceName ?? getSourceName(sourceKey));

  return {
    title: String(videoData.name ?? 'Sem título'),
    description: String(videoData.description ?? 'Descrição indisponível.'),
    uploadDate: videoData.uploadDate ? String(videoData.uploadDate) : '',
    thumbnails,
    views: String(videoData?.interactionStatistic?.userInteractionCount ?? 'Não informado'),
    sourceUrl: String(options.sourceUrl ?? videoData.url ?? videoData.mainEntityOfPage ?? ''),
    sourceKey,
    sourceName,
    formats
  };
}

function getProviderKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const isXVideos = /(^|\.)xvideos\d*\.com$/i.test(hostname);
    const isPornhub = /(^|\.)pornhub\.com$/i.test(hostname);

    if (!isHttp) {
      return '';
    }

    if (isXVideos) {
      return 'xvideos';
    }

    if (isPornhub) {
      return 'pornhub';
    }

    return '';
  } catch {
    return '';
  }
}

function getVideoProviderKey(url) {
  return getProviderKeyFromUrl(url);
}

function isSafeCreatorUrl(url) {
  try {
    const parsed = new URL(url);
    const providerKey = getProviderKeyFromUrl(url);
    const pathname = parsed.pathname.toLowerCase();

    if (providerKey === 'pornhub') {
      return /^\/(pornstar|model|channels|users)\/[^/?#]+\/?$/i.test(pathname);
    }

    if (providerKey !== 'xvideos') {
      return false;
    }

    if (/^\/(profiles|channels|pornstars)\/[^/?#]+\/?$/i.test(pathname)) {
      return true;
    }

    if (!/^\/[^/?#]+\/?$/i.test(pathname)) {
      return false;
    }

    const slug = pathname.replace(/^\//, '').replace(/\/$/, '');
    const reserved = new Set([
      '',
      'account',
      'amateur',
      'best',
      'categories',
      'channels-index',
      'games',
      'gay',
      'language',
      'new',
      'pornstars-index',
      'premium',
      'profileslist',
      'tags',
      'trans',
      'video',
      'videos'
    ]);

    return !reserved.has(slug) && !slug.startsWith('video.');
  } catch {
    return false;
  }
}

function isSafeVideoUrl(url) {
  try {
    const parsed = new URL(url);
    const providerKey = getProviderKeyFromUrl(url);
    const pathname = parsed.pathname.toLowerCase();

    if (providerKey === 'pornhub') {
      return pathname === '/view_video.php';
    }

    if (providerKey !== 'xvideos') {
      return false;
    }

    return /^\/(?:video(?:[\d-]+|\.[^/?#]+)(?:\/[^?#]*)?|prof-video-click\/upload\/[^/?#]+\/[^/?#]+\/[^/?#]+)\/?$/i.test(pathname);
  } catch {
    return false;
  }
}

module.exports = {
  ALLOWED_SORTS,
  ALLOWED_DATES,
  ALLOWED_DURATIONS,
  ALLOWED_QUALITIES,
  DEFAULT_PROVIDER_PREFERENCES,
  normalizeSearchParams,
  normalizeProviderPreferences,
  normalizeSearchResults,
  mixSearchResults,
  normalizeVideoData,
  getProviderKeyFromUrl,
  getVideoProviderKey,
  isSafeCreatorUrl,
  isSafeVideoUrl,
  getSourceName,
  clampPage
};
