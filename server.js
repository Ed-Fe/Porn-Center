const path = require('path');
const axios = require('axios');
const express = require('express');
const xvideos = require('xvideos-scraper');
const {
  normalizeSearchParams,
  normalizeProviderPreferences,
  normalizeSearchResults,
  mixSearchResults,
  normalizeVideoData,
  getProviderKeyFromUrl,
  getVideoProviderKey,
  getSourceName,
  isSafeCreatorUrl,
  isSafeVideoUrl,
  clampPage,
  AVAILABLE_PROVIDER_KEYS,
  ALLOWED_SORTS,
  ALLOWED_DATES,
  ALLOWED_DURATIONS,
  ALLOWED_QUALITIES,
  ALLOWED_LOCALES,
  DEFAULT_LOCALE,
  normalizeLocale
} = require('./src/lib/normalizers');
const {
  searchVideosDirect,
  getFeedVideosDirect,
  getVideoDataDirect,
  getCreatorDataDirect
} = require('./src/lib/xvideos-client');
const {
  searchVideosDirect: searchPornhubVideosDirect,
  getFeedVideosDirect: getPornhubFeedVideosDirect,
  getVideoDataDirect: getPornhubVideoDataDirect,
  getCreatorDataDirect: getPornhubCreatorDataDirect
} = require('./src/lib/pornhub-client');
const {
  searchVideosDirect: searchMallandrinhasVideosDirect,
  getFeedVideosDirect: getMallandrinhasFeedVideosDirect,
  getVideoDataDirect: getMallandrinhasVideoDataDirect,
  getCreatorDataDirect: getMallandrinhasCreatorDataDirect
} = require('./src/lib/mallandrinhas-client');

const MEDIA_PROXY_ALLOWED_HOSTS = [
  /(^|\.)pornhub\.com$/i,
  /(^|\.)phncdn\.com$/i,
  /(^|\.)phprcdn\.com$/i
];

const MEDIA_PROXY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8',
  'Cookie': 'age_verified=1; platform=pc'
};

function hasUsableVideoData(response) {
  if (!response || typeof response !== 'object') {
    return false;
  }

  const hasTitle = typeof response.name === 'string' && response.name.trim().length > 0;
  const hasThumbnail = Array.isArray(response.thumbnailUrl) && response.thumbnailUrl.length > 0;
  const hasContent = Boolean(response.contentUrl);

  return hasTitle || hasThumbnail || hasContent;
}

function isSafeMediaProxyUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';

    if (!isHttp) {
      return false;
    }

    return MEDIA_PROXY_ALLOWED_HOSTS.some((pattern) => pattern.test(parsed.hostname));
  } catch {
    return false;
  }
}

function buildMediaProxyUrl(mediaUrl, sourceUrl = '') {
  const params = new URLSearchParams();
  params.set('url', String(mediaUrl || ''));

  if (sourceUrl) {
    params.set('source', String(sourceUrl));
  }

  return `/api/media-proxy?${params.toString()}`;
}

function rewriteM3u8Manifest(manifestText, manifestUrl, sourceUrl = '') {
  const manifestBase = new URL(manifestUrl);

  return String(manifestText)
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return line;
      }

      if (trimmed.startsWith('#EXT-X-KEY') && trimmed.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/, (_match, uri) => {
          try {
            const absolute = new URL(uri, manifestBase).toString();
            return `URI="${buildMediaProxyUrl(absolute, sourceUrl)}"`;
          } catch {
            return `URI="${uri}"`;
          }
        });
      }

      if (trimmed.startsWith('#')) {
        return line;
      }

      try {
        const absolute = new URL(trimmed, manifestBase).toString();
        return buildMediaProxyUrl(absolute, sourceUrl);
      } catch {
        return line;
      }
    })
    .join('\n');
}

function createApp() {
  const app = express();
  const publicDir = path.join(__dirname, 'public');

  app.use(express.static(publicDir));
  app.use('/vendor/hls', express.static(path.join(__dirname, 'node_modules', 'hls.js', 'dist')));

  app.get('/api/meta', (req, res) => {
    res.json({
      sorts: ALLOWED_SORTS,
      dates: ALLOWED_DATES,
      durations: ALLOWED_DURATIONS,
      qualities: ALLOWED_QUALITIES,
      locales: ALLOWED_LOCALES,
      defaultLocale: DEFAULT_LOCALE,
      providers: AVAILABLE_PROVIDER_KEYS.map((providerKey) => ({
        key: providerKey,
        label: getSourceName(providerKey)
      })),
      shortcuts: [
        { key: '/', description: 'Foca a busca' },
        { key: 'ArrowUp / ArrowDown', description: 'Navega entre os resultados' },
        { key: 'Enter', description: 'Abre os detalhes do item selecionado' },
        { key: 'Alt + ArrowLeft', description: 'Volta para a página anterior' },
        { key: 'Alt + ArrowRight', description: 'Vai para a próxima página' }
      ]
    });
  });

  app.get('/api/search', async (req, res) => {
    const params = normalizeSearchParams(req.query);
    const providerPreferences = normalizeProviderPreferences(req.query);

    if (!params.search) {
      return res.status(400).json({ error: 'Informe um termo de busca.' });
    }

    try {
      const providerTasks = [];

      if (providerPreferences.includeXVideos) {
        providerTasks.push(searchXVideos(params, { locale: params.locale }));
      }

      if (providerPreferences.includePornhub) {
        providerTasks.push(searchPornhub(params, { locale: params.locale }));
      }

      if (providerPreferences.includeMallandrinhas) {
        providerTasks.push(searchMallandrinhas(params));
      }

      const settled = await Promise.allSettled(providerTasks);
      const completedProviders = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);

      if (!completedProviders.length) {
        throw new Error('Nenhum provedor respondeu à busca no momento.');
      }

      const items = mixSearchResults(completedProviders.map((provider) => provider.items));

      return res.json({
        query: params.search,
        page: params.pagination,
        items,
        totalOnPage: items.length,
        providerPreferences,
        includePornhub: providerPreferences.includePornhub,
        providers: completedProviders.map((provider) => provider.providerKey),
        source: completedProviders.length > 1 ? 'mixed-providers' : completedProviders[0].source,
        locale: params.locale
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao consultar o catálogo remoto.',
        details: error.message
      });
    }
  });

  app.get('/api/feed', async (req, res) => {
    const page = clampPage(Number(req.query.page ?? 1));
    const providerPreferences = normalizeProviderPreferences(req.query);
    const locale = normalizeLocale(req.query.locale, DEFAULT_LOCALE);

    try {
      const providerTasks = [];

      if (providerPreferences.includeXVideos) {
        providerTasks.push(getXVideosFeed(page, { locale }));
      }

      if (providerPreferences.includePornhub) {
        providerTasks.push(getPornhubFeed(page, { locale }));
      }

      if (providerPreferences.includeMallandrinhas) {
        providerTasks.push(getMallandrinhasFeed(page));
      }

      const settled = await Promise.allSettled(providerTasks);
      const completedProviders = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);

      if (!completedProviders.length) {
        throw new Error('Nenhum provedor respondeu ao feed no momento.');
      }

      const items = mixSearchResults(completedProviders.map((provider) => provider.items));

      return res.json({
        page,
        items,
        totalOnPage: items.length,
        providerPreferences,
        includePornhub: providerPreferences.includePornhub,
        providers: completedProviders.map((provider) => provider.providerKey),
        source: completedProviders.length > 1 ? 'mixed-feed' : completedProviders[0].source,
        locale
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao carregar o feed inicial.',
        details: error.message
      });
    }
  });

  app.get('/api/video', async (req, res) => {
    const videoUrl = String(req.query.url ?? '').trim();
    const locale = normalizeLocale(req.query.locale, DEFAULT_LOCALE);

    if (!videoUrl) {
      return res.status(400).json({ error: 'Informe a URL do vídeo.' });
    }

    if (!isSafeVideoUrl(videoUrl)) {
      return res.status(400).json({ error: 'A URL informada não pertence a um domínio suportado.' });
    }

    try {
      const providerKey = getVideoProviderKey(videoUrl);
      const providerName = getSourceName(providerKey);
      let response;
      let source;

      if (providerKey === 'pornhub') {
        response = await getPornhubVideoDataDirect(videoUrl, { locale });
        source = 'pornhub-direct';
      } else if (providerKey === 'mallandrinhas') {
        response = await getMallandrinhasVideoDataDirect(videoUrl);
        source = 'mallandrinhas-direct';
      } else {
        ({ response, source } = await getXVideosVideo(videoUrl, { locale }));
      }

      const normalizedVideo = normalizeVideoData({
          ...response,
          url: videoUrl,
          mainEntityOfPage: videoUrl
        }, {
          sourceKey: providerKey,
          sourceName: providerName,
          sourceUrl: videoUrl
        });

      const video = providerKey === 'pornhub'
        ? {
            ...normalizedVideo,
            formats: normalizedVideo.formats.map((format) => ({
              ...format,
              url: buildMediaProxyUrl(format.url, videoUrl)
            }))
          }
        : normalizedVideo;

      return res.json({
        video,
        provider: providerKey,
        source,
        locale
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao carregar os detalhes do vídeo.',
        details: error.message
      });
    }
  });

  app.get('/api/star', async (req, res) => {
    const profileUrl = String(req.query.url ?? '').trim();
    const locale = normalizeLocale(req.query.locale, DEFAULT_LOCALE);

    if (!profileUrl) {
      return res.status(400).json({ error: 'Informe a URL da estrela.' });
    }

    if (!isSafeCreatorUrl(profileUrl)) {
      return res.status(400).json({ error: 'A URL informada não pertence a um perfil suportado.' });
    }

    try {
      const providerKey = getProviderKeyFromUrl(profileUrl);
      const providerName = getSourceName(providerKey);
      let response;

      if (providerKey === 'pornhub') {
        response = await getPornhubCreatorDataDirect(profileUrl, { locale });
      } else if (providerKey === 'mallandrinhas') {
        response = await getMallandrinhasCreatorDataDirect(profileUrl);
      } else {
        response = await getCreatorDataDirect(profileUrl, { locale });
      }

      return res.json({
        performer: {
          ...response.creator,
          sourceKey: providerKey,
          sourceName: providerName
        },
        items: normalizeSearchResults(response.items, { sourceKey: providerKey, sourceName: providerName }),
        totalOnPage: response.items.length,
        source: `${providerKey}-creator`,
        locale
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao carregar os dados da estrela.',
        details: error.message
      });
    }
  });

  app.get('/api/media-proxy', async (req, res) => {
    const targetUrl = String(req.query.url ?? '').trim();
    const sourceUrl = String(req.query.source ?? '').trim();

    if (!targetUrl) {
      return res.status(400).json({ error: 'Informe a URL de mídia.' });
    }

    if (!isSafeMediaProxyUrl(targetUrl)) {
      return res.status(400).json({ error: 'A URL de mídia informada não é suportada.' });
    }

    try {
      const response = await axios.get(targetUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
        headers: {
          ...MEDIA_PROXY_HEADERS,
          Referer: isSafeVideoUrl(sourceUrl) ? sourceUrl : 'https://www.pornhub.com/',
          ...(req.headers.range ? { Range: String(req.headers.range) } : {})
        },
        validateStatus: (status) => status >= 200 && status < 400
      });

      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      const isManifest = /\.m3u8(?:$|\?)/i.test(targetUrl) || contentType.includes('mpegurl');

      if (isManifest) {
        const manifest = Buffer.from(response.data).toString('utf8');
        const rewritten = rewriteM3u8Manifest(manifest, targetUrl, sourceUrl);

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=20');
        return res.status(200).send(rewritten);
      }

      const passthroughHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      for (const headerName of passthroughHeaders) {
        const value = response.headers[headerName];
        if (value) {
          res.setHeader(headerName, value);
        }
      }

      return res.status(response.status).send(Buffer.from(response.data));
    } catch (error) {
      return res.status(502).json({
        error: 'Falha ao carregar a mídia remota.',
        details: error.message
      });
    }
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/explore', (req, res) => {
    res.sendFile(path.join(publicDir, 'explore.html'));
  });

  app.get('/saved', (req, res) => {
    res.sendFile(path.join(publicDir, 'saved.html'));
  });

  app.get('/view', (req, res) => {
    res.sendFile(path.join(publicDir, 'view.html'));
  });

  app.get('/star', (req, res) => {
    res.sendFile(path.join(publicDir, 'star.html'));
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

async function searchXVideos(params, options = {}) {
  const fallbackResponse = await searchVideosDirect(params, options);
  const items = normalizeSearchResults(fallbackResponse, { sourceKey: 'xvideos', sourceName: 'XVideos' });

  return {
    providerKey: 'xvideos',
    source: 'direct-search',
    items
  };
}

async function searchPornhub(params, options = {}) {
  const response = await searchPornhubVideosDirect(params, options);

  return {
    providerKey: 'pornhub',
    source: 'pornhub-direct',
    items: normalizeSearchResults(response, { sourceKey: 'pornhub', sourceName: 'Pornhub' })
  };
}

async function searchMallandrinhas(params) {
  const response = await searchMallandrinhasVideosDirect(params);

  return {
    providerKey: 'mallandrinhas',
    source: 'mallandrinhas-search',
    items: normalizeSearchResults(response, { sourceKey: 'mallandrinhas', sourceName: 'Malandrinhas' })
  };
}

async function getXVideosFeed(page, options = {}) {
  return {
    providerKey: 'xvideos',
    source: 'direct-feed',
    items: normalizeSearchResults(await getFeedVideosDirect({ page }, options), { sourceKey: 'xvideos', sourceName: 'XVideos' })
  };
}

async function getPornhubFeed(page, options = {}) {
  return {
    providerKey: 'pornhub',
    source: 'pornhub-feed',
    items: normalizeSearchResults(await getPornhubFeedVideosDirect({ page }, options), { sourceKey: 'pornhub', sourceName: 'Pornhub' })
  };
}

async function getMallandrinhasFeed(page) {
  return {
    providerKey: 'mallandrinhas',
    source: 'mallandrinhas-feed',
    items: normalizeSearchResults(await getMallandrinhasFeedVideosDirect({ page }), { sourceKey: 'mallandrinhas', sourceName: 'Malandrinhas' })
  };
}

async function getXVideosVideo(videoUrl, options = {}) {
  let response;
  let source = 'xvideos-scraper';

  try {
    response = await xvideos.getVideoData({
      videoUrl,
      proxy: false
    });
  } catch {
    response = null;
  }

  if (!hasUsableVideoData(response)) {
    response = await getVideoDataDirect(videoUrl, options);
    source = 'direct-fallback';
  }

  return { response, source };
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);

  app.listen(port, () => {
    console.log(`Servidor disponível em http://localhost:${port}`);
  });
}

module.exports = {
  createApp,
  isSafeMediaProxyUrl,
  buildMediaProxyUrl,
  rewriteM3u8Manifest
};
