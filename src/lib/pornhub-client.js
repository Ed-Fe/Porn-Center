const axios = require('axios');
const cheerio = require('cheerio');
const { decodeHTML } = require('entities');
const { requestWithCache } = require('./request-cache');

const BASE_URL = 'https://www.pornhub.com';
const RESPONSE_CACHE = new Map();
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8',
  'Cookie': 'age_verified=1; platform=pc',
  'Referer': BASE_URL
};

function absoluteUrl(value = '') {
  if (!value) {
    return '';
  }

  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return '';
  }
}

function cleanText(value = '') {
  return decodeHTML(String(value)).replace(/\s+/g, ' ').trim();
}

function buildSearchUrl(params = {}) {
  const url = new URL('/video/search', BASE_URL);
  const page = Math.max(Number(params.pagination ?? params.page ?? 1), 1);

  url.searchParams.set('search', String(params.search ?? '').trim());

  if (page > 1) {
    url.searchParams.set('page', String(page));
  }

  return url.toString();
}

function buildFeedUrl(params = {}) {
  const url = new URL('/video', BASE_URL);
  const page = Math.max(Number(params.page ?? 1), 1);

  if (page > 1) {
    url.searchParams.set('page', String(page));
  }

  return url.toString();
}

function parseSearchResultsFromHtml(html) {
  const $ = cheerio.load(html);
  const seen = new Set();

  return $('li.pcVideoListItem')
    .map((index, element) => {
      const card = $(element);
      const linkElement = card.find('a[href*="/view_video.php?"]').first();
      const video = absoluteUrl(linkElement.attr('href'));

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
        thumbnail: absoluteUrl(image.attr('data-mediumthumb') || image.attr('data-path') || image.attr('src') || ''),
        title,
        duration: cleanText(card.find('.duration').first().text()),
        uploaderName: cleanText(uploaderAnchor.text()),
        uploaderProfile: absoluteUrl(uploaderAnchor.attr('href')),
        index,
        sourceKey: 'pornhub',
        sourceName: 'Pornhub'
      };
    })
    .get()
    .filter(Boolean);
}

function parseCreatorUploadsFromHtml(html, creator = {}) {
  const $ = cheerio.load(html);
  const expectedProfile = buildCreatorBaseUrl(creator.profileUrl || creator.uploadsUrl || '');
  const seen = new Set();

  return $('.videoUList li.pcVideoListItem, .videoUList li.videoBox, .videoUList li')
    .map((index, element) => {
      const card = $(element);
      const linkElement = card.find('a[href*="/view_video.php?"]').first();
      const video = absoluteUrl(linkElement.attr('href'));

      if (!video || seen.has(video)) {
        return null;
      }

      const image = card.find('img').first();
      const uploaderAnchor = card.find('.usernameWrap a[href], .videoUploaderBlock a[href], .usernameBadgesWrapper a[href]').first();
      const uploaderProfile = absoluteUrl(uploaderAnchor.attr('href'));

      if (expectedProfile && uploaderProfile && buildCreatorBaseUrl(uploaderProfile) !== expectedProfile) {
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
        thumbnail: absoluteUrl(image.attr('data-mediumthumb') || image.attr('data-path') || image.attr('src') || ''),
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

function buildCreatorBaseUrl(profileUrl) {
  const parsed = new URL(profileUrl);
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (segments.length >= 2) {
    parsed.pathname = `/${segments[0]}/${segments[1]}`;
    parsed.search = '';
    parsed.hash = '';
  }

  return parsed.toString();
}

function buildCreatorUploadsUrl(profileUrl) {
  return `${buildCreatorBaseUrl(profileUrl).replace(/\/$/, '')}/videos/upload`;
}

function extractCreatorProfileDataFromHtml(html, profileUrl) {
  const $ = cheerio.load(html);
  const pageText = cleanText($('body').text());
  const heading = cleanText($('h1').first().text() || $('meta[property="og:title"]').attr('content') || $('title').text());
  const name = heading.replace(/\s*\|.*$/g, '').trim() || 'Perfil sem nome';
  const bio = cleanText(pageText.match(/Bio\s+(.+?)(?=Featured in:|Relationship status:|Pornstar Profile Views:|Career Status:|Gender:|Birth Place:|Height:|Weight:|Ethnicity:|Videos Watched:|Abella Danger's Uploaded Videos|$)/i)?.[1] || '');
  const avatar = absoluteUrl(
    $('.profileUserPic img, .userImage img, .avatar img, img[alt]').first().attr('src') ||
      $('meta[property="og:image"]').attr('content') ||
      ''
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
    profileUrl: buildCreatorBaseUrl(profileUrl),
    uploadsUrl: buildCreatorUploadsUrl(profileUrl),
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

function extractMediaDefinitionsFromHtml(html) {
  const rawArray = extractBalancedArrayAfterKey(html, 'mediaDefinitions');

  if (!rawArray) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawArray);
    const seen = new Set();

    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        label: formatMediaDefinitionLabel(item),
        url: absoluteUrl(item.videoUrl || item.remote || '')
      }))
      .filter((item) => item.url && !isIndirectMediaResolverUrl(item.url) && !seen.has(item.url) && seen.add(item.url));
  } catch {
    return [];
  }
}

function fallbackVideoMetadata(html) {
  const $ = cheerio.load(html);

  return {
    name: cleanText($('meta[property="og:title"]').attr('content') || $('#videoTitle .title, .video-title').first().text()),
    description: cleanText(
      $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || ''
    ),
    thumbnailUrl: [absoluteUrl($('meta[property="og:image"]').attr('content') || '')].filter(Boolean),
    uploadDate: cleanText($('meta[itemprop="uploadDate"]').attr('content') || ''),
    interactionStatistic: undefined
  };
}

async function requestHtml(url) {
  return requestWithCache({
    cache: RESPONSE_CACHE,
    key: `GET:${url}`,
    ttlMs: 30_000,
    staleTtlMs: 300_000,
    retries: 2,
    retryDelayMs: 900,
    execute: async () => {
      const response = await axios.get(url, {
        headers: REQUEST_HEADERS,
        timeout: 30000
      });

      return response.data;
    }
  });
}

async function searchVideosDirect(params) {
  const html = await requestHtml(buildSearchUrl(params));
  return parseSearchResultsFromHtml(html);
}

async function getFeedVideosDirect(params = {}) {
  const html = await requestHtml(buildFeedUrl(params));
  return parseSearchResultsFromHtml(html);
}

async function getVideoDataDirect(videoUrl) {
  const html = await requestHtml(videoUrl);
  const structured = extractStructuredVideoData(html) || fallbackVideoMetadata(html);
  const formats = extractMediaDefinitionsFromHtml(html);

  return {
    ...structured,
    contentUrl: formats.length ? formats : structured.contentUrl,
    sourceKey: 'pornhub',
    sourceName: 'Pornhub'
  };
}

async function getCreatorDataDirect(profileUrl) {
  const baseUrl = buildCreatorBaseUrl(profileUrl);
  const [profileHtml, uploadsHtml] = await Promise.all([
    requestHtml(baseUrl),
    requestHtml(buildCreatorUploadsUrl(baseUrl))
  ]);
  const creator = extractCreatorProfileDataFromHtml(profileHtml, baseUrl);
  const items = parseCreatorUploadsFromHtml(uploadsHtml, creator).map((item) => ({
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
  buildSearchUrl,
  buildFeedUrl,
  buildCreatorBaseUrl,
  buildCreatorUploadsUrl,
  parseSearchResultsFromHtml,
  parseCreatorUploadsFromHtml,
  extractStructuredVideoData,
  extractCreatorProfileDataFromHtml,
  extractMediaDefinitionsFromHtml,
  searchVideosDirect,
  getFeedVideosDirect,
  getVideoDataDirect,
  getCreatorDataDirect
};