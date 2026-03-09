const axios = require('axios');
const cheerio = require('cheerio');
const { decodeHTML } = require('entities');
const { requestWithCache } = require('./request-cache');

const BASE_URL = 'https://www.mallandrinhas.net';
const RESPONSE_CACHE = new Map();
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': BASE_URL,
  'Cookie': 'age_verified=1; platform=pc'
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

function humanizeAuthorSlug(slug = '') {
  return cleanText(
    String(slug)
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function isPostHref(value = '') {
  const url = absoluteUrl(value);

  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();

    if (!/^\/[^/?#]+\/?$/i.test(pathname)) {
      return false;
    }

    const slug = pathname.replace(/^\//, '').replace(/\/$/, '');
    const reserved = new Set([
      '',
      '15-anos',
      'aviso-contato',
      'bucetao',
      'guia-salvador-2',
      'incesto',
      'parceria',
      'porno-amador',
      'videos'
    ]);

    return !reserved.has(slug);
  } catch {
    return false;
  }
}

function buildSearchUrl(params = {}) {
  const page = Math.max(Number(params.pagination ?? params.page ?? 1), 1);
  const url = new URL(page > 1 ? `/page/${page}/` : '/', BASE_URL);

  url.searchParams.set('s', String(params.search ?? '').trim());
  return url.toString();
}

function buildFeedUrl(params = {}) {
  const page = Math.max(Number(params.page ?? 1), 1);
  return new URL(page > 1 ? `/page/${page}/` : '/', BASE_URL).toString();
}

function parseSearchResultsFromHtml(html) {
  const $ = cheerio.load(html);
  const seen = new Set();

  return $('article')
    .map((index, element) => {
      const card = $(element);
      const titleAnchor = card.find('h1 a[href], h2 a[href], h3 a[href], .entry-title a[href], .post-title a[href]').first();
      const href = titleAnchor.attr('href');

      if (!isPostHref(href)) {
        return null;
      }

      const video = absoluteUrl(href);

      if (!video || seen.has(video)) {
        return null;
      }

      seen.add(video);

      const image = card.find('img').first();
      const authorAnchor = card.find('a[href*="/author/"]').first();
      const durationMatch = cleanText(card.text()).match(/(\d+\s*min\s*read)/i);

      return {
        video,
        thumbnail: absoluteUrl(image.attr('data-src') || image.attr('data-lazy-src') || image.attr('src') || ''),
        title: cleanText(titleAnchor.attr('title') || titleAnchor.text()),
        duration: cleanText(durationMatch?.[1] || '1 min read'),
        uploaderName: cleanText(authorAnchor.text() || 'Mallandrinhas'),
        uploaderProfile: '',
        sourceKey: 'mallandrinhas',
        sourceName: 'Malandrinhas',
        index
      };
    })
    .get()
    .filter((item) => item && item.title);
}

function extractStructuredVideoData(html) {
  const $ = cheerio.load(html);
  const title = cleanText(
    $('h1.entry-title, h1').first().text() ||
      $('meta[property="og:title"]').attr('content') ||
      $('title').text()
  );
  const description = cleanText(
    $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $('.entry-content p, .post-content p').first().text() ||
      ''
  );
  const image = absoluteUrl(
    $('meta[property="og:image"]').attr('content') ||
      $('.entry-content img, .post-content img, article img').first().attr('src') ||
      ''
  );
  const uploadDate = cleanText(
    $('meta[property="article:published_time"]').attr('content') ||
      $('time').first().attr('datetime') ||
      ''
  );

  return {
    name: title || 'Sem título',
    description: description || 'Descrição indisponível.',
    thumbnailUrl: image ? [image] : [],
    uploadDate,
    contentUrl: []
  };
}

function extractPlayableFormatsFromHtml(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const urls = [
    ...$('video source[src], video[src], iframe[src]')
      .map((_, element) => $(element).attr('src'))
      .get(),
    ...Array.from(html.matchAll(/https?:\/\/[^"'\s)<>]+\.(?:mp4|m3u8|webm|3gp)(?:\?[^"'\s)<>]*)?/gi)).map((match) => match[0])
  ];

  return urls
    .map((value) => absoluteUrl(value))
    .filter((value) => value && !seen.has(value) && seen.add(value))
    .map((url) => ({
      label: /\.m3u8($|\?)/i.test(url) ? 'HLS' : 'Qualidade padrão',
      url
    }));
}

function extractCreatorProfileDataFromHtml(html, profileUrl) {
  const $ = cheerio.load(html);
  const pathname = new URL(profileUrl).pathname;
  const authorSlug = pathname.split('/').filter(Boolean).pop() || '';
  const pageHeading = cleanText($('h1.page-title, h1.archive-title, h1').first().text());

  return {
    name: pageHeading || humanizeAuthorSlug(authorSlug) || 'Autor desconhecido',
    headline: 'Autor no Mallandrinhas',
    description: cleanText(
      $('meta[property="og:description"]').attr('content') ||
        $('meta[name="description"]').attr('content') ||
        ''
    ) || 'Perfil público do autor no Mallandrinhas.',
    avatar: absoluteUrl($('meta[property="og:image"]').attr('content') || ''),
    profileUrl,
    uploadsUrl: profileUrl,
    stats: [],
    sourceKey: 'mallandrinhas',
    sourceName: 'Malandrinhas'
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
  const structured = extractStructuredVideoData(html);
  const formats = extractPlayableFormatsFromHtml(html);

  return {
    ...structured,
    contentUrl: formats.length ? formats : structured.contentUrl,
    sourceKey: 'mallandrinhas',
    sourceName: 'Malandrinhas'
  };
}

async function getCreatorDataDirect(profileUrl) {
  const html = await requestHtml(profileUrl);
  const creator = extractCreatorProfileDataFromHtml(html, profileUrl);
  const items = parseSearchResultsFromHtml(html).map((item) => ({
    ...item,
    uploaderName: item.uploaderName || creator.name,
    uploaderProfile: creator.profileUrl
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
  parseSearchResultsFromHtml,
  extractStructuredVideoData,
  extractCreatorProfileDataFromHtml,
  searchVideosDirect,
  getFeedVideosDirect,
  getVideoDataDirect,
  getCreatorDataDirect
};