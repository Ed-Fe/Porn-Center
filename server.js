const path = require('path');
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
  ALLOWED_SORTS,
  ALLOWED_DATES,
  ALLOWED_DURATIONS,
  ALLOWED_QUALITIES
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

function hasUsableVideoData(response) {
  if (!response || typeof response !== 'object') {
    return false;
  }

  const hasTitle = typeof response.name === 'string' && response.name.trim().length > 0;
  const hasThumbnail = Array.isArray(response.thumbnailUrl) && response.thumbnailUrl.length > 0;
  const hasContent = Boolean(response.contentUrl);

  return hasTitle || hasThumbnail || hasContent;
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
      const providerTasks = [searchXVideos(params)];

      if (providerPreferences.includePornhub) {
        providerTasks.push(searchPornhub(params));
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
        includePornhub: providerPreferences.includePornhub,
        providers: completedProviders.map((provider) => provider.providerKey),
        source: completedProviders.length > 1 ? 'mixed-providers' : completedProviders[0].source
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

    try {
      const providerTasks = [getXVideosFeed(page)];

      if (providerPreferences.includePornhub) {
        providerTasks.push(getPornhubFeed(page));
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
        includePornhub: providerPreferences.includePornhub,
        providers: completedProviders.map((provider) => provider.providerKey),
        source: completedProviders.length > 1 ? 'mixed-feed' : completedProviders[0].source
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

    if (!videoUrl) {
      return res.status(400).json({ error: 'Informe a URL do vídeo.' });
    }

    if (!isSafeVideoUrl(videoUrl)) {
      return res.status(400).json({ error: 'A URL informada não pertence a um domínio suportado.' });
    }

    try {
      const providerKey = getVideoProviderKey(videoUrl);
      const providerName = getSourceName(providerKey);
      const { response, source } = providerKey === 'pornhub'
        ? {
            response: await getPornhubVideoDataDirect(videoUrl),
            source: 'pornhub-direct'
          }
        : await getXVideosVideo(videoUrl);

      return res.json({
        video: normalizeVideoData({
          ...response,
          url: videoUrl,
          mainEntityOfPage: videoUrl
        }, {
          sourceKey: providerKey,
          sourceName: providerName,
          sourceUrl: videoUrl
        }),
        provider: providerKey,
        source
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

    if (!profileUrl) {
      return res.status(400).json({ error: 'Informe a URL da estrela.' });
    }

    if (!isSafeCreatorUrl(profileUrl)) {
      return res.status(400).json({ error: 'A URL informada não pertence a um perfil suportado.' });
    }

    try {
      const providerKey = getProviderKeyFromUrl(profileUrl);
      const providerName = getSourceName(providerKey);
      const response = providerKey === 'pornhub'
        ? await getPornhubCreatorDataDirect(profileUrl)
        : await getCreatorDataDirect(profileUrl);

      return res.json({
        performer: {
          ...response.creator,
          sourceKey: providerKey,
          sourceName: providerName
        },
        items: normalizeSearchResults(response.items, { sourceKey: providerKey, sourceName: providerName }),
        totalOnPage: response.items.length,
        source: `${providerKey}-creator`
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao carregar os dados da estrela.',
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

async function searchXVideos(params) {
  const fallbackResponse = await searchVideosDirect(params);
  const items = normalizeSearchResults(fallbackResponse, { sourceKey: 'xvideos', sourceName: 'XVideos' });

  return {
    providerKey: 'xvideos',
    source: 'direct-search',
    items
  };
}

async function searchPornhub(params) {
  const response = await searchPornhubVideosDirect(params);

  return {
    providerKey: 'pornhub',
    source: 'pornhub-direct',
    items: normalizeSearchResults(response, { sourceKey: 'pornhub', sourceName: 'Pornhub' })
  };
}

async function getXVideosFeed(page) {
  return {
    providerKey: 'xvideos',
    source: 'direct-feed',
    items: normalizeSearchResults(await getFeedVideosDirect({ page }), { sourceKey: 'xvideos', sourceName: 'XVideos' })
  };
}

async function getPornhubFeed(page) {
  return {
    providerKey: 'pornhub',
    source: 'pornhub-feed',
    items: normalizeSearchResults(await getPornhubFeedVideosDirect({ page }), { sourceKey: 'pornhub', sourceName: 'Pornhub' })
  };
}

async function getXVideosVideo(videoUrl) {
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
    response = await getVideoDataDirect(videoUrl);
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

module.exports = { createApp };
