const axios = require('axios');
const cheerio = require('cheerio');
const { decodeHTML } = require('entities');
const { requestWithCache } = require('./request-cache');

const BASE_URL = 'https://www.xvideos.com';
const RESPONSE_CACHE = new Map();
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.95,en-US;q=0.8,en;q=0.7',
  'Referer': BASE_URL,
  'Cookie': 'age_verified=1; platform=pc; country=BR; language=pt'
};

function buildLocaleHeaders(options = {}) {
  if (String(options.locale || '').trim() === 'en-US') {
    return {
      'Accept-Language': 'en-US,en;q=0.95,pt-BR;q=0.7,pt;q=0.6',
      'Cookie': 'age_verified=1; platform=pc; country=US; language=en'
    };
  }

  return {
    'Accept-Language': REQUEST_HEADERS['Accept-Language'],
    'Cookie': REQUEST_HEADERS.Cookie
  };
}

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

function isVideoHref(value = '') {
  return /^\/(?:video(?:[\d-]+|\.[^/?#]+)(?:\/[^?#]*)?|prof-video-click\/upload\/[^/?#]+\/[^/?#]+\/[^/?#]+)/i.test(String(value).trim());
}

function buildSearchUrl(params) {
  const url = new URL('/', BASE_URL);

  url.searchParams.set('k', params.search);
  url.searchParams.set('sort', params.sort);
  url.searchParams.set('p', String(Math.max((params.pagination ?? 1) - 1, 0)));
  url.searchParams.set('top', '');

  if (params.filterDate) {
    url.searchParams.set('datef', params.filterDate);
  }

  if (params.filterDuration) {
    url.searchParams.set('durf', params.filterDuration);
  }

  if (params.filterQuality) {
    url.searchParams.set('quality', params.filterQuality);
  }

  if (params.viewWatched) {
    url.searchParams.set('vw', params.viewWatched);
  }

  return url.toString();
}

function buildFeedUrl(params = {}) {
  const url = new URL('/', BASE_URL);
  const page = Math.max(Number(params.page ?? 1), 1);

  if (page > 1) {
    url.searchParams.set('p', String(page - 1));
  }

  return url.toString();
}

function parseSearchResultsFromHtml(html) {
  const $ = cheerio.load(html);
  const seen = new Set();

  return $('div#content .mozaique .thumb-block')
    .map((index, element) => {
      const card = $(element);
      const link = card.find('.thumb a[href]').first().attr('href');

      if (!isVideoHref(link)) {
        return null;
      }

      const video = absoluteUrl(link);

      if (!video || seen.has(video)) {
        return null;
      }

      seen.add(video);

      const titleElement = card.find('.thumb-under a[title]').first();
      const title = cleanText(titleElement.attr('title') || titleElement.text());
      const thumbnail = absoluteUrl(
        card.find('.thumb img').attr('data-src') ||
          card.find('.thumb img').attr('data-src0') ||
          card.find('.thumb img').attr('src') ||
          ''
      );
      const duration = cleanText(card.find('.thumb-under .duration').first().text());
      const uploaderAnchor = card.find('.metadata a[href]').first();
      const uploaderName = cleanText(card.find('.metadata .name').first().text() || uploaderAnchor.text());
      const uploaderProfile = absoluteUrl(uploaderAnchor.attr('href'));

      return {
        video,
        thumbnail,
        title,
        duration,
        uploaderName,
        uploaderProfile,
        index
      };
    })
    .get()
    .filter(Boolean);
}

function parseProfileVideosFromHtml(html, creator = {}) {
  const directMatches = parseSearchResultsFromHtml(html);

  if (directMatches.length) {
    return directMatches.map((item) => ({
      ...item,
      uploaderName: item.uploaderName || creator.name || 'Perfil não informado',
      uploaderProfile: item.uploaderProfile || creator.profileUrl || ''
    }));
  }

  const $ = cheerio.load(html);
  const seen = new Set();

  return $('a[href*="/video."]')
    .map((index, element) => {
      const anchor = $(element);
      const video = absoluteUrl(anchor.attr('href'));

      if (!video || seen.has(video)) {
        return null;
      }

      seen.add(video);

      const container = anchor.closest('li, article, div');
      const image = container.find('img').first();
      const title = cleanText(anchor.attr('title') || anchor.text() || container.find('[title]').first().attr('title') || '');

      if (!title) {
        return null;
      }

      return {
        video,
        thumbnail: absoluteUrl(image.attr('data-src') || image.attr('data-src0') || image.attr('src') || ''),
        title,
        duration: cleanText(container.find('.duration').first().text()),
        uploaderName: creator.name || 'Perfil não informado',
        uploaderProfile: creator.profileUrl || '',
        index
      };
    })
    .get()
    .filter(Boolean)
    .slice(0, 24);
}

function buildCreatorVideosApiUrl(profileUrl) {
  const parsed = new URL(profileUrl);
  parsed.search = '';
  parsed.hash = '';

  return `${parsed.toString().replace(/\/$/, '')}/videos/best/0`;
}

function parseProfileVideosPayload(payload, creator = {}) {
  const items = Array.isArray(payload?.videos) ? payload.videos : [];

  return items
    .map((item, index) => ({
      video: absoluteUrl(item?.u || ''),
      thumbnail: absoluteUrl(item?.i || item?.il || item?.if || item?.ip || item?.mu || ''),
      title: cleanText(item?.t || item?.tf || ''),
      duration: cleanText(item?.d || ''),
      uploaderName: cleanText(item?.pn || creator.name || ''),
      uploaderProfile: absoluteUrl(item?.pu || creator.profileUrl || ''),
      index
    }))
    .filter((item) => item.video && item.title);
}

function extractCreatorProfileDataFromHtml(html, profileUrl) {
  const $ = cheerio.load(html);
  const heading = cleanText($('h1').first().text() || $('h2').first().text() || '');
  const title = cleanText($('meta[property="og:title"]').attr('content') || $('title').text());
  const display = heading || title.replace(/\s*-\s*xvideos.*$/i, '').trim();
  const headingMatch = display.match(/^(.*?)\s*((?:Man|Woman|Couple|Male|Female|Trans).*)$/i);
  const name = cleanText(headingMatch?.[1] || display || 'Perfil sem nome');
  const headline = cleanText(headingMatch?.[2] || '');
  const description = cleanText(
    $('.profile-description, .about-me, .bio, .profile-bio, .description').first().text() ||
      $('meta[name="description"]').attr('content') ||
      ''
  );
  const avatar = absoluteUrl(
    $('.profile-avatar img, .main-profile img, .avatar img, .profile img').first().attr('src') ||
      $('meta[property="og:image"]').attr('content') ||
      ''
  );
  const summaryText = cleanText($('body').text());
  const statSelectors = [
    ['Gênero', '#pinfo-sex span'],
    ['Idade', '#pinfo-age span'],
    ['País', '#pinfo-country span'],
    ['Visitas ao perfil', '#pinfo-profile-hits span'],
    ['Inscritos', '#pinfo-subscribers span'],
    ['Visualizações', '#pinfo-videos-views span'],
    ['Cidade', '#pinfo-city span'],
    ['Entrou em', '#pinfo-signedup span']
  ];
  const stats = statSelectors
    .map(([label, selector]) => ({ label, value: cleanText($(selector).first().text()) }))
    .filter((entry) => entry.value);
  const subscribers = stats.find((entry) => entry.label === 'Inscritos')?.value || cleanText(summaryText.match(/(?:Subscribers?:|Subscribe)\s*([0-9.,kKmM]+)/i)?.[1] || '');

  return {
    name,
    headline,
    description: description || 'Sem descrição pública disponível.',
    avatar,
    profileUrl,
    uploadsUrl: buildCreatorVideosApiUrl(profileUrl),
    stats: stats.length ? stats : [
      ...(headline ? [{ label: 'Perfil', value: headline }] : []),
      ...(subscribers ? [{ label: 'Inscritos', value: subscribers }] : [])
    ],
    sourceKey: 'xvideos',
    sourceName: 'XVideos'
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
        interactionStatistic: video.interactionStatistic || undefined
      };
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return null;
}

function extractFormatsFromHtml(html) {
  const patterns = [
    ['Default_Quality', /setVideoUrl\('([^']+)'\)/g],
    ['Low_Quality', /setVideoUrlLow\('([^']+)'\)/g],
    ['HD_Quality', /setVideoUrlHigh\('([^']+)'\)/g],
    ['HLS_Quality', /setVideoHLS\('([^']+)'\)/g]
  ];

  const formats = {};

  for (const [label, regex] of patterns) {
    const match = regex.exec(html);

    if (match?.[1]) {
      formats[label] = decodeHTML(match[1]);
    }
  }

  return formats;
}

function fallbackVideoMetadata(html) {
  const $ = cheerio.load(html);

  return {
    name: cleanText($('meta[property="og:title"]').attr('content') || $('title').text()),
    description: cleanText(
      $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || ''
    ),
    thumbnailUrl: [absoluteUrl($('meta[property="og:image"]').attr('content') || '')].filter(Boolean),
    uploadDate: '',
    interactionStatistic: undefined
  };
}

async function requestHtml(url, options = {}) {
  const localeHeaders = buildLocaleHeaders(options);
  return requestWithCache({
    cache: RESPONSE_CACHE,
    key: `GET:${url}`,
    ttlMs: 30_000,
    staleTtlMs: 300_000,
    retries: 2,
    retryDelayMs: 900,
    execute: async () => {
      const response = await axios.get(url, {
        headers: {
          ...REQUEST_HEADERS,
          ...localeHeaders,
          ...(options.headers && typeof options.headers === 'object' ? options.headers : {})
        },
        timeout: 30000
      });

      return response.data;
    }
  });
}

async function requestJson(url, options = {}) {
  const localeHeaders = buildLocaleHeaders(options);
  return requestWithCache({
    cache: RESPONSE_CACHE,
    key: `POST:${url}`,
    ttlMs: 30_000,
    staleTtlMs: 300_000,
    retries: 2,
    retryDelayMs: 900,
    execute: async () => {
      const response = await axios.post(url, null, {
        headers: {
          ...REQUEST_HEADERS,
          ...localeHeaders,
          ...(options.headers && typeof options.headers === 'object' ? options.headers : {})
        },
        timeout: 30000
      });

      return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    }
  });
}

async function searchVideosDirect(params, options = {}) {
  const html = await requestHtml(buildSearchUrl(params), options);
  return parseSearchResultsFromHtml(html);
}

async function getFeedVideosDirect(params = {}, options = {}) {
  const html = await requestHtml(buildFeedUrl(params), options);
  return parseSearchResultsFromHtml(html);
}

async function getVideoDataDirect(videoUrl, options = {}) {
  const html = await requestHtml(videoUrl, options);
  const structured = extractStructuredVideoData(html) || fallbackVideoMetadata(html);
  const formats = extractFormatsFromHtml(html);

  return {
    ...structured,
    contentUrl: Object.keys(formats).length ? formats : structured.contentUrl
  };
}

async function getCreatorDataDirect(profileUrl, options = {}) {
  const html = await requestHtml(profileUrl, options);
  const creator = extractCreatorProfileDataFromHtml(html, profileUrl);
  let items = [];

  try {
    const payload = await requestJson(buildCreatorVideosApiUrl(profileUrl), options);
    items = parseProfileVideosPayload(payload, creator);
  } catch {
    items = parseProfileVideosFromHtml(html, creator);
  }

  return {
    creator,
    items
  };
}

module.exports = {
  BASE_URL,
  buildSearchUrl,
  buildFeedUrl,
  buildCreatorVideosApiUrl,
  parseSearchResultsFromHtml,
  parseProfileVideosFromHtml,
  parseProfileVideosPayload,
  isVideoHref,
  extractStructuredVideoData,
  extractFormatsFromHtml,
  extractCreatorProfileDataFromHtml,
  searchVideosDirect,
  getFeedVideosDirect,
  getVideoDataDirect,
  getCreatorDataDirect
};
