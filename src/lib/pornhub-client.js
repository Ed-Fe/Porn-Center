const axios = require('axios');
const cheerio = require('cheerio');
const { decodeHTML } = require('entities');
const { requestWithCache } = require('./request-cache');

const BASE_URL = 'https://pt.pornhub.com';
const BASE_URL_EN = 'https://www.pornhub.com';
const RESPONSE_CACHE = new Map();
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.95,en-US;q=0.8,en;q=0.7',
  'Cookie': 'age_verified=1; platform=pc; country=BR; language=pt_BR',
  'Referer': BASE_URL
};

function absoluteUrl(value = '', baseUrl = BASE_URL) {
  if (!value) {
    return '';
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return '';
  }
}

function cleanText(value = '') {
  return decodeHTML(String(value)).replace(/\s+/g, ' ').trim();
}

function resolveLocaleContext(options = {}) {
  const locale = String(options.locale || '').trim() === 'en-US' ? 'en-US' : 'pt-BR';
  const baseUrl = locale === 'en-US' ? BASE_URL_EN : BASE_URL;

  if (locale === 'en-US') {
    return {
      locale,
      baseUrl,
      headers: {
        'Accept-Language': 'en-US,en;q=0.95,pt-BR;q=0.7,pt;q=0.6',
        'Cookie': 'age_verified=1; platform=pc; country=US; language=en_US',
        'Referer': baseUrl
      }
    };
  }

  return {
    locale,
    baseUrl,
    headers: {
      'Accept-Language': REQUEST_HEADERS['Accept-Language'],
      'Cookie': REQUEST_HEADERS.Cookie,
      'Referer': baseUrl
    }
  };
}

function buildSearchUrl(params = {}, baseUrl = BASE_URL) {
  const url = new URL('/video/search', baseUrl);
  const page = Math.max(Number(params.pagination ?? params.page ?? 1), 1);

  url.searchParams.set('search', String(params.search ?? '').trim());

  if (page > 1) {
    url.searchParams.set('page', String(page));
  }

  return url.toString();
}

function buildFeedUrl(params = {}, baseUrl = BASE_URL) {
  const url = new URL('/video', baseUrl);
  const page = Math.max(Number(params.page ?? 1), 1);

  if (page > 1) {
    url.searchParams.set('page', String(page));
  }

  return url.toString();
}

function parseSearchResultsFromHtml(html, baseUrl = BASE_URL) {
  const $ = cheerio.load(html);
  const seen = new Set();

  return $('li.pcVideoListItem')
    .map((index, element) => {
      const card = $(element);
      const linkElement = card.find('a[href*="/view_video.php?"]').first();
      const video = absoluteUrl(linkElement.attr('href'), baseUrl);

      if (!video || seen.has(video)) {
        return null;
      }

      seen.add(video);

      const image = card.find('img').first();
      const uploaderAnchor = card.find('.usernameWrap a[href], .videoUploaderBlock a[href], .usernameBadgesWrapper a[href]').first();
      const title = cleanText(
        linkElement.attr('title') ||
          card.find('.title a, span.title').first().text() ||
          image.attr('title') ||
          image.attr('alt') ||
          ''
      );

      return {
        video,
        thumbnail: absoluteUrl(image.attr('data-mediumthumb') || image.attr('data-path') || image.attr('src') || '', baseUrl),
        title,
        duration: cleanText(card.find('.duration').first().text()),
        uploaderName: cleanText(uploaderAnchor.text()),
        uploaderProfile: absoluteUrl(uploaderAnchor.attr('href'), baseUrl),
        index,
        sourceKey: 'pornhub',
        sourceName: 'Pornhub'
      };
    })
    .get()
    .filter(Boolean);
}

function parseCreatorUploadsFromHtml(html, creator = {}, baseUrl = BASE_URL) {
  const $ = cheerio.load(html);
  const expectedIdentity = buildCreatorIdentity(creator.profileUrl || creator.uploadsUrl || '');
  const seen = new Set();

  return $('.videoUList li.pcVideoListItem, .videoUList li.videoBox, .videoUList li')
    .map((index, element) => {
      const card = $(element);
      const linkElement = card.find('a[href*="/view_video.php?"]').first();
      const video = absoluteUrl(linkElement.attr('href'), baseUrl);

      if (!video || seen.has(video)) {
        return null;
      }

      const image = card.find('img').first();
      const uploaderAnchor = card.find('.usernameWrap a[href], .videoUploaderBlock a[href], .usernameBadgesWrapper a[href]').first();
      const uploaderProfile = absoluteUrl(uploaderAnchor.attr('href'), baseUrl);

      if (expectedIdentity && uploaderProfile && buildCreatorIdentity(uploaderProfile) !== expectedIdentity) {
        return null;
      }

      seen.add(video);

      const title = cleanText(
        linkElement.attr('title') ||
          card.find('.thumbnailTitle, .title a, span.title').first().text() ||
          image.attr('title') ||
          image.attr('alt') ||
          ''
      );

      return {
        video,
        thumbnail: absoluteUrl(image.attr('data-mediumthumb') || image.attr('data-path') || image.attr('src') || '', baseUrl),
        title,
        duration: cleanText(card.find('.duration').first().text()),
        uploaderName: cleanText(uploaderAnchor.text()) || creator.name || '',
        uploaderProfile: uploaderProfile || creator.profileUrl || '',
        index,
        sourceKey: 'pornhub',
        sourceName: 'Pornhub'
      };
    })
    .get()
    .filter(Boolean);
}

function buildCreatorIdentity(profileUrl) {
  try {
    const parsed = new URL(profileUrl);
    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 2)
      .map((entry) => entry.toLowerCase());

    return segments.length === 2 ? `/${segments[0]}/${segments[1]}` : '';
  } catch {
    return '';
  }
}

function buildCreatorBaseUrl(profileUrl, baseUrl = BASE_URL) {
  const parsed = new URL(profileUrl, baseUrl);
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (segments.length >= 2) {
    parsed.pathname = `/${segments[0]}/${segments[1]}`;
    parsed.search = '';
    parsed.hash = '';
  }

  return parsed.toString();
}

function buildCreatorUploadsUrl(profileUrl, baseUrl = BASE_URL) {
  return `${buildCreatorBaseUrl(profileUrl, baseUrl).replace(/\/$/, '')}/videos/upload`;
}

function extractCreatorProfileDataFromHtml(html, profileUrl, baseUrl = BASE_URL) {
  const $ = cheerio.load(html);
  const pageText = cleanText($('body').text());
  const heading = cleanText($('h1').first().text() || $('meta[property="og:title"]').attr('content') || $('title').text());
  const name = heading.replace(/\s*\|.*$/g, '').trim() || 'Perfil sem nome';
  const bio = cleanText(pageText.match(/Bio\s+(.+?)(?=Featured in:|Relationship status:|Pornstar Profile Views:|Career Status:|Gender:|Birth Place:|Height:|Weight:|Ethnicity:|Videos Watched:|Abella Danger's Uploaded Videos|$)/i)?.[1] || '');
  const avatar = absoluteUrl(
    $('.profileUserPic img, .userImage img, .avatar img, img[alt]').first().attr('src') ||
      $('meta[property="og:image"]').attr('content') ||
      '',
    baseUrl
  );

  const fields = [
    ['Inscritos', /Subscribers\s*([0-9.,kKmMbB]+)/i],
    ['Visualizações', /Video views\s*([0-9.,kKmMbB]+)/i],
    ['Nascimento', /Birth Place:([^:]+?)(?=Star Sign:|Measurements:|Height:|Weight:|Ethnicity:|Hair Color:|Fake Boobs:|Profile Views:|Videos Watched:|$)/i],
    ['Altura', /Height:([^:]+?)(?=Weight:|Ethnicity:|Hair Color:|Fake Boobs:|Profile Views:|Videos Watched:|$)/i],
    ['Peso', /Weight:([^:]+?)(?=Ethnicity:|Hair Color:|Fake Boobs:|Profile Views:|Videos Watched:|$)/i],
    ['Etnia', /Ethnicity:([^:]+?)(?=Hair Color:|Fake Boobs:|Profile Views:|Videos Watched:|$)/i]
  ];

  return {
    name,
    headline: cleanText(pageText.match(/([0-9.,kKmMbB]+\s+Subscribers)/i)?.[1] || ''),
    description: bio || cleanText($('meta[property="og:description"]').attr('content') || 'Sem descrição pública disponível.'),
    avatar,
    profileUrl: buildCreatorBaseUrl(profileUrl, baseUrl),
    uploadsUrl: buildCreatorUploadsUrl(profileUrl, baseUrl),
    stats: fields
      .map(([label, pattern]) => ({ label, value: cleanText(pageText.match(pattern)?.[1] || '') }))
      .filter((entry) => entry.value),
    sourceKey: 'pornhub',
    sourceName: 'Pornhub'
  };
}

function flattenStructuredData(payload) {
  if (Array.isArray(payload)) {
    return payload.flatMap(flattenStructuredData);
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (Array.isArray(payload['@graph'])) {
    return payload['@graph'].flatMap(flattenStructuredData);
  }

  return [payload];
}

function extractStructuredVideoData(html) {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]')
    .map((_, element) => $(element).contents().text())
    .get();

  for (const rawScript of scripts) {
    try {
      const parsed = JSON.parse(rawScript);
      const candidates = flattenStructuredData(parsed);
      const video = candidates.find((item) => {
        const type = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        return type.includes('VideoObject') || (item.name && (item.thumbnailUrl || item.uploadDate || item.contentUrl));
      });

      if (!video) {
        continue;
      }

      const interactionValue = Array.isArray(video.interactionStatistic)
        ? video.interactionStatistic.find((entry) => entry?.userInteractionCount)?.userInteractionCount
        : video.interactionStatistic?.userInteractionCount;

      return {
        name: cleanText(video.name),
        description: cleanText(video.description || video.name),
        thumbnailUrl: Array.isArray(video.thumbnailUrl)
          ? video.thumbnailUrl.filter(Boolean).map(absoluteUrl)
          : video.thumbnailUrl
            ? [absoluteUrl(video.thumbnailUrl)]
            : [],
        uploadDate: video.uploadDate ? String(video.uploadDate) : '',
        contentUrl: video.contentUrl,
        interactionStatistic: interactionValue
          ? { userInteractionCount: String(interactionValue) }
          : undefined
      };
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return null;
}

function extractBalancedArrayAfterKey(html, key) {
  const keyIndex = html.indexOf(key);

  if (keyIndex < 0) {
    return '';
  }

  const startIndex = html.indexOf('[', keyIndex);

  if (startIndex < 0) {
    return '';
  }

  let depth = 0;
  let currentQuote = '';
  let isEscaped = false;

  for (let index = startIndex; index < html.length; index += 1) {
    const char = html[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (currentQuote) {
      if (char === currentQuote) {
        currentQuote = '';
      }

      continue;
    }

    if (char === '"' || char === "'") {
      currentQuote = char;
      continue;
    }

    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;

      if (depth === 0) {
        return html.slice(startIndex, index + 1);
      }
    }
  }

  return '';
}

function formatMediaDefinitionLabel(item = {}) {
  const quality = cleanText(item.quality ?? item.label ?? '');
  const format = cleanText(item.format ?? item.type ?? '');
  const normalizedQuality = quality && /\d/.test(quality) ? `${quality.replace(/p$/i, '')}p` : quality;

  if (normalizedQuality && format && !/mp4/i.test(format)) {
    return `${normalizedQuality} ${format.toUpperCase()}`;
  }

  if (normalizedQuality) {
    return normalizedQuality;
  }

  if (format) {
    return format.toUpperCase();
  }

  return 'Qualidade padrão';
}

function isIndirectMediaResolverUrl(url = '') {
  return /\/video\/get_media(?:$|\?)/i.test(String(url));
}

function normalizeMediaDefinition(item = {}, baseUrl = BASE_URL) {
  const url = absoluteUrl(item.videoUrl || item.remote || '', baseUrl);

  return {
    label: formatMediaDefinitionLabel(item),
    url,
    remote: isIndirectMediaResolverUrl(url) || Boolean(item.remote)
  };
}

function extractMediaDefinitionsFromHtml(html, options = {}) {
  const rawArray = extractBalancedArrayAfterKey(html, 'mediaDefinitions');
  const includeRemote = options.includeRemote === true;
  const baseUrl = String(options.baseUrl || BASE_URL);

  if (!rawArray) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawArray);
    const seen = new Set();

    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeMediaDefinition(item, baseUrl))
      .filter((item) => item.url && (includeRemote || !item.remote) && !seen.has(item.url) && seen.add(item.url))
      .map((item) => (includeRemote ? item : { label: item.label, url: item.url }));
  } catch {
    return [];
  }
}

function fallbackVideoMetadata(html, baseUrl = BASE_URL) {
  const $ = cheerio.load(html);

  return {
    name: cleanText($('meta[property="og:title"]').attr('content') || $('#videoTitle .title, .video-title').first().text()),
    description: cleanText(
      $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || ''
    ),
    thumbnailUrl: [absoluteUrl($('meta[property="og:image"]').attr('content') || '', baseUrl)].filter(Boolean),
    uploadDate: cleanText($('meta[itemprop="uploadDate"]').attr('content') || ''),
    interactionStatistic: undefined
  };
}

async function requestHtml(url, options = {}) {

  return requestWithCache({
    cache: RESPONSE_CACHE,
    key: String(options.cacheKey || `GET:${url}`),
    ttlMs: Number.isFinite(options.ttlMs) ? options.ttlMs : 30_000,
    staleTtlMs: Number.isFinite(options.staleTtlMs) ? options.staleTtlMs : 300_000,
    retries: Number.isFinite(options.retries) ? options.retries : 2,
    retryDelayMs: Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 900,
    execute: async () => {
      const response = await axios.get(url, {
        headers: {
          ...REQUEST_HEADERS,
          ...(options.headers && typeof options.headers === 'object' ? options.headers : {})
        },
        timeout: Number.isFinite(options.timeout) ? options.timeout : 30000,
        maxRedirects: Number.isFinite(options.maxRedirects) ? options.maxRedirects : 5
      });

      return response.data;
    }
  });
}

async function requestJson(url, options = {}) {
  return requestWithCache({
    cache: RESPONSE_CACHE,
    key: String(options.cacheKey || `JSON:${url}`),
    ttlMs: Number.isFinite(options.ttlMs) ? options.ttlMs : 15_000,
    staleTtlMs: Number.isFinite(options.staleTtlMs) ? options.staleTtlMs : 0,
    retries: Number.isFinite(options.retries) ? options.retries : 1,
    retryDelayMs: Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 500,
    execute: async () => {
      const response = await axios.get(url, {
        headers: {
          ...REQUEST_HEADERS,
          ...(options.headers && typeof options.headers === 'object' ? options.headers : {})
        },
        timeout: Number.isFinite(options.timeout) ? options.timeout : 30000,
        maxRedirects: Number.isFinite(options.maxRedirects) ? options.maxRedirects : 5,
        responseType: 'text'
      });

      if (typeof response.data === 'string') {
        return JSON.parse(response.data);
      }

      return response.data;
    }
  });
}

async function resolveMediaDefinitions(formats = [], options = {}) {
  const requestJsonImpl = typeof options.requestJsonImpl === 'function' ? options.requestJsonImpl : requestJson;
  const referer = String(options.referer || BASE_URL);
  const directFormats = [];
  const remoteFormats = [];

  for (const format of Array.isArray(formats) ? formats : []) {
    if (!format?.url) {
      continue;
    }

    if (format.remote || isIndirectMediaResolverUrl(format.url)) {
      remoteFormats.push(format);
    } else {
      directFormats.push({
        label: String(format.label || 'Qualidade padrão'),
        url: String(format.url)
      });
    }
  }

  const resolvedRemoteFormats = [];

  for (const format of remoteFormats) {
    try {
      const payload = await requestJsonImpl(format.url, {
        cacheKey: `GET_MEDIA:${format.url}`,
        ttlMs: 15_000,
        staleTtlMs: 0,
        retries: 1,
        retryDelayMs: 400,
        headers: {
          Referer: referer
        }
      });

      const items = Array.isArray(payload) ? payload : [];

      resolvedRemoteFormats.push(
        ...items
          .filter((item) => item && typeof item === 'object')
          .map((item) => normalizeMediaDefinition(item))
          .filter((item) => item.url && !item.remote)
          .map((item) => ({
            label: item.label,
            url: item.url
          }))
      );
    } catch {
      // Keep available direct formats even if a remote resolver fails.
    }
  }

  const seen = new Set();

  return [...directFormats, ...resolvedRemoteFormats]
    .filter((item) => item.url && !seen.has(item.url) && seen.add(item.url));
}

async function searchVideosDirect(params, options = {}) {
  const context = resolveLocaleContext(options);
  const html = await requestHtml(buildSearchUrl(params, context.baseUrl), {
    headers: context.headers
  });
  return parseSearchResultsFromHtml(html, context.baseUrl);
}

async function getFeedVideosDirect(params = {}, options = {}) {
  const context = resolveLocaleContext(options);
  const html = await requestHtml(buildFeedUrl(params, context.baseUrl), {
    headers: context.headers
  });
  return parseSearchResultsFromHtml(html, context.baseUrl);
}

async function getVideoDataDirect(videoUrl, options = {}) {
  const context = resolveLocaleContext(options);
  const mediaBaseUrl = (() => {
    try {
      return new URL(videoUrl).origin;
    } catch {
      return context.baseUrl;
    }
  })();
  const html = await requestHtml(videoUrl, {
    cacheKey: `VIDEO:${videoUrl}`,
    ttlMs: 0,
    staleTtlMs: 0,
    retries: 1,
    retryDelayMs: 500,
    headers: context.headers
  });
  const structured = extractStructuredVideoData(html) || fallbackVideoMetadata(html, mediaBaseUrl);
  const formats = await resolveMediaDefinitions(extractMediaDefinitionsFromHtml(html, { includeRemote: true, baseUrl: mediaBaseUrl }), {
    referer: videoUrl,
    requestJsonImpl: (url, requestOptions = {}) => requestJson(url, {
      ...requestOptions,
      headers: {
        ...context.headers,
        ...(requestOptions.headers && typeof requestOptions.headers === 'object' ? requestOptions.headers : {})
      }
    })
  });

  return {
    ...structured,
    contentUrl: formats.length ? formats : structured.contentUrl,
    sourceKey: 'pornhub',
    sourceName: 'Pornhub'
  };
}

async function getCreatorDataDirect(profileUrl, options = {}) {
  const context = resolveLocaleContext(options);
  const baseUrl = buildCreatorBaseUrl(profileUrl, context.baseUrl);
  const [profileHtml, uploadsHtml] = await Promise.all([
    requestHtml(baseUrl, { headers: context.headers }),
    requestHtml(buildCreatorUploadsUrl(baseUrl, context.baseUrl), { headers: context.headers })
  ]);
  const creator = extractCreatorProfileDataFromHtml(profileHtml, baseUrl, context.baseUrl);
  const items = parseCreatorUploadsFromHtml(uploadsHtml, creator, context.baseUrl).map((item) => ({
    ...item,
    uploaderName: item.uploaderName || creator.name,
    uploaderProfile: item.uploaderProfile || creator.profileUrl
  }));

  return {
    creator,
    items
  };
}

module.exports = {
  BASE_URL,
  BASE_URL_EN,
  buildSearchUrl,
  buildFeedUrl,
  buildCreatorBaseUrl,
  buildCreatorUploadsUrl,
  parseSearchResultsFromHtml,
  parseCreatorUploadsFromHtml,
  extractStructuredVideoData,
  extractCreatorProfileDataFromHtml,
  extractMediaDefinitionsFromHtml,
  resolveMediaDefinitions,
  searchVideosDirect,
  getFeedVideosDirect,
  getVideoDataDirect,
  getCreatorDataDirect
};