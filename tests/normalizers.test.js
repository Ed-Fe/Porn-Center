const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  getProviderKeyFromUrl,
  normalizeProviderPreferences,
  normalizeSearchParams,
  normalizeSearchResults,
  mixSearchResults,
  normalizeVideoData,
  getVideoProviderKey,
  isSafeCreatorUrl,
  isSafeVideoUrl,
  clampPage
} = require('../src/lib/normalizers');
const {
  buildSearchUrl,
  buildFeedUrl,
  buildCreatorVideosApiUrl,
  parseSearchResultsFromHtml,
  isVideoHref,
  extractFormatsFromHtml,
  extractCreatorProfileDataFromHtml: extractXVideosCreatorProfileDataFromHtml,
  parseProfileVideosFromHtml,
  parseProfileVideosPayload
} = require('../src/lib/xvideos-client');
const {
  buildSearchUrl: buildPornhubSearchUrl,
  buildFeedUrl: buildPornhubFeedUrl,
  buildCreatorUploadsUrl,
  parseSearchResultsFromHtml: parsePornhubSearchResultsFromHtml,
  parseCreatorUploadsFromHtml,
  extractStructuredVideoData: extractPornhubStructuredVideoData,
  extractCreatorProfileDataFromHtml: extractPornhubCreatorProfileDataFromHtml,
  extractMediaDefinitionsFromHtml
} = require('../src/lib/pornhub-client');
const {
  isRetryableRequestError,
  requestWithCache
} = require('../src/lib/request-cache');

test('normalizeProviderPreferences respeita query e fallback', () => {
  assert.deepEqual(normalizeProviderPreferences({ ph: '0' }), { includePornhub: false });
  assert.deepEqual(normalizeProviderPreferences({}, { includePornhub: false }), { includePornhub: false });
  assert.deepEqual(normalizeProviderPreferences({ includePornhub: '1' }), { includePornhub: true });
});

test('normalizeSearchParams sanitiza valores e remove filtros padrão', () => {
  const params = normalizeSearchParams({
    q: '  sample  ',
    sort: 'rating',
    date: 'week',
    duration: '3-10min',
    quality: 'hd',
    watched: 'h',
    page: '4.8'
  });

  assert.deepEqual(params, {
    search: 'sample',
    sort: 'rating',
    pagination: 4,
    proxy: false,
    filterDate: 'week',
    filterDuration: '3-10min',
    filterQuality: 'hd',
    viewWatched: 'h'
  });
});

test('normalizeSearchResults preserva apenas itens válidos', () => {
  const items = normalizeSearchResults([
    null,
    {
      video: 'https://www.xvideos2.com/video123/demo',
      title: 'Demo',
      thumbnail: 'https://cdn.example/thumb.jpg',
      duration: '10 min',
      uploaderName: 'Canal',
      uploaderProfile: 'https://www.xvideos2.com/channels/demo'
    },
    {
      title: 'Inválido sem url'
    }
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Demo');
  assert.equal(items[0].videoUrl, 'https://www.xvideos2.com/video123/demo');
  assert.equal(items[0].sourceKey, 'xvideos');
});

test('mixSearchResults intercala coleções por provedor', () => {
  const items = mixSearchResults([
    [{ videoUrl: 'https://www.xvideos.com/video1', sourceKey: 'xvideos' }, { videoUrl: 'https://www.xvideos.com/video2', sourceKey: 'xvideos' }],
    [{ videoUrl: 'https://www.pornhub.com/view_video.php?viewkey=abc', sourceKey: 'pornhub' }]
  ]);

  assert.deepEqual(items.map((item) => item.sourceKey), ['xvideos', 'pornhub', 'xvideos']);
});

test('normalizeVideoData converte contentUrl objeto em lista amigável', () => {
  const video = normalizeVideoData({
    name: 'Vídeo exemplo',
    description: 'Descrição',
    thumbnailUrl: ['https://cdn.example/thumb.jpg'],
    uploadDate: '2026-03-08T10:00:00.000Z',
    interactionStatistic: { userInteractionCount: '1000 Views' },
    contentUrl: {
      Default_Quality: 'https://cdn.example/default.mp4',
      HD_Quality: 'https://cdn.example/hd.mp4'
    }
  });

  assert.equal(video.title, 'Vídeo exemplo');
  assert.equal(video.formats.length, 2);
  assert.equal(video.formats[1].label, 'HD Quality');
});

test('isSafeVideoUrl aceita domínios xvideos e rejeita domínios externos', () => {
  assert.equal(isSafeVideoUrl('https://www.xvideos2.com/video123/demo'), true);
  assert.equal(isSafeVideoUrl('https://www.xvideos.com/prof-video-click/upload/loki06/abc123/demo'), true);
  assert.equal(isSafeVideoUrl('https://pt.pornhub.com/view_video.php?viewkey=123'), true);
  assert.equal(isSafeVideoUrl('https://www.xvideos.com/models/demo'), false);
  assert.equal(isSafeVideoUrl('https://evil.example/video123/demo'), false);
});

test('getVideoProviderKey identifica o provedor pelo domínio', () => {
  assert.equal(getVideoProviderKey('https://www.xvideos2.com/video123/demo'), 'xvideos');
  assert.equal(getVideoProviderKey('https://www.pornhub.com/view_video.php?viewkey=abc123'), 'pornhub');
  assert.equal(getVideoProviderKey('https://example.com/video'), '');
});

test('getProviderKeyFromUrl também reconhece urls de perfis', () => {
  assert.equal(getProviderKeyFromUrl('https://www.xvideos.com/profiles/demo'), 'xvideos');
  assert.equal(getProviderKeyFromUrl('https://www.pornhub.com/model/demo'), 'pornhub');
});

test('isSafeCreatorUrl aceita perfis suportados e rejeita rotas soltas', () => {
  assert.equal(isSafeCreatorUrl('https://www.xvideos.com/profiles/demo'), true);
  assert.equal(isSafeCreatorUrl('https://www.xvideos.com/demo_user'), true);
  assert.equal(isSafeCreatorUrl('https://www.xvideos.com/video.abc/demo'), false);
  assert.equal(isSafeCreatorUrl('https://www.pornhub.com/pornstar/demo'), true);
  assert.equal(isSafeCreatorUrl('https://www.pornhub.com/video/search?search=test'), false);
});

test('clampPage mantém página entre 1 e 250', () => {
  assert.equal(clampPage(-10), 1);
  assert.equal(clampPage(500), 250);
  assert.equal(clampPage(7.9), 7);
});

test('buildSearchUrl monta query compatível com a busca atual', () => {
  const url = buildSearchUrl({
    search: 'nature',
    sort: 'views',
    pagination: 3,
    filterDate: 'week',
    filterDuration: '10-20min',
    filterQuality: 'hd',
    viewWatched: 'h'
  });

  assert.equal(
    url,
    'https://www.xvideos.com/?k=nature&sort=views&p=2&top=&datef=week&durf=10-20min&quality=hd&vw=h'
  );
});

test('buildFeedUrl monta a url da home e paginação do feed', () => {
  assert.equal(buildFeedUrl({ page: 1 }), 'https://www.xvideos.com/');
  assert.equal(buildFeedUrl({ page: 3 }), 'https://www.xvideos.com/?p=2');
});

test('parseSearchResultsFromHtml encontra cards mesmo com classes adicionais', () => {
  const html = `
    <div id="content">
      <div class="mozaique cust-nb-cols">
        <div class="thumb-block thumb-adaptive">
          <div class="thumb-inside">
            <div class="thumb">
              <a href="/video123/demo"><img data-src="https://cdn.example/thumb.jpg" /></a>
            </div>
          </div>
          <div class="thumb-under">
            <p><a title="Demo title">Demo title <span class="duration">10 min</span></a></p>
            <p class="metadata"><span><span><a href="/profiles/demo"><span class="name">Canal Demo</span></a></span></span></p>
          </div>
        </div>
      </div>
    </div>
  `;

  const items = parseSearchResultsFromHtml(html);

  assert.equal(items.length, 1);
  assert.equal(items[0].video, 'https://www.xvideos.com/video123/demo');
  assert.equal(items[0].title, 'Demo title');
  assert.equal(items[0].uploaderName, 'Canal Demo');
});

test('parseSearchResultsFromHtml ignora cards de perfil do XVideos', () => {
  const html = `
    <div id="content">
      <div class="mozaique cust-nb-cols">
        <div class="thumb-block thumb-adaptive">
          <div class="thumb-inside">
            <div class="thumb">
              <a href="/models/abella592"><img data-src="https://cdn.example/profile.jpg" /></a>
            </div>
          </div>
          <div class="thumb-under">
            <p><a title="Perfil da modelo">Perfil da modelo</a></p>
          </div>
        </div>
        <div class="thumb-block thumb-adaptive">
          <div class="thumb-inside">
            <div class="thumb">
              <a href="/video.abc/demo_video"><img data-src="https://cdn.example/video.jpg" /></a>
            </div>
          </div>
          <div class="thumb-under">
            <p><a title="Vídeo demo">Vídeo demo <span class="duration">10 min</span></a></p>
          </div>
        </div>
      </div>
    </div>
  `;

  const items = parseSearchResultsFromHtml(html);

  assert.equal(items.length, 1);
  assert.equal(items[0].video, 'https://www.xvideos.com/video.abc/demo_video');
});

test('isVideoHref reconhece apenas links de vídeo do XVideos', () => {
  assert.equal(isVideoHref('/video123/demo'), true);
  assert.equal(isVideoHref('/video.abc/demo'), true);
  assert.equal(isVideoHref('/prof-video-click/upload/user/abc/demo'), true);
  assert.equal(isVideoHref('/models/abella592'), false);
  assert.equal(isVideoHref('/profiles/demo'), false);
});

test('extractFormatsFromHtml reconhece links inline de qualidade', () => {
  const html = `
    <script>
      html5player.setVideoUrl('https://cdn.example/default.mp4');
      html5player.setVideoUrlLow('https://cdn.example/low.mp4');
      html5player.setVideoUrlHigh('https://cdn.example/hd.mp4');
      html5player.setVideoHLS('https://cdn.example/stream.m3u8');
    </script>
  `;

  const formats = extractFormatsFromHtml(html);

  assert.deepEqual(formats, {
    Default_Quality: 'https://cdn.example/default.mp4',
    Low_Quality: 'https://cdn.example/low.mp4',
    HD_Quality: 'https://cdn.example/hd.mp4',
    HLS_Quality: 'https://cdn.example/stream.m3u8'
  });
});

test('extractXVideosCreatorProfileDataFromHtml lê dados básicos do perfil', () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="https://cdn.example/avatar.jpg" />
        <meta name="description" content="Perfil de teste" />
      </head>
      <body>
        <h2>Loki06 Man, 35y</h2>
        <div>Subscribe 6.9k</div>
      </body>
    </html>
  `;

  const profile = extractXVideosCreatorProfileDataFromHtml(html, 'https://www.xvideos.com/profiles/loki06');

  assert.equal(profile.name, 'Loki06');
  assert.equal(profile.stats[0].value, 'Man, 35y');
  assert.equal(profile.stats[1].value, '6.9k');
});

test('parseProfileVideosFromHtml usa fallback genérico quando não há thumb-block', () => {
  const html = `
    <div>
      <div class="clip">
        <a href="/video.abc/demo_video" title="Demo vídeo"><img src="https://cdn.example/thumb.jpg" /></a>
        <span class="duration">4 min</span>
      </div>
    </div>
  `;

  const items = parseProfileVideosFromHtml(html, { name: 'Perfil Demo', profileUrl: 'https://www.xvideos.com/profiles/demo' });

  assert.equal(items.length, 1);
  assert.equal(items[0].uploaderName, 'Perfil Demo');
  assert.equal(items[0].video, 'https://www.xvideos.com/video.abc/demo_video');
});

test('buildCreatorVideosApiUrl monta endpoint de uploads do perfil no XVideos', () => {
  assert.equal(
    buildCreatorVideosApiUrl('https://www.xvideos.com/profiles/loki06'),
    'https://www.xvideos.com/profiles/loki06/videos/best/0'
  );
});

test('parseProfileVideosPayload lê uploads JSON do perfil XVideos', () => {
  const items = parseProfileVideosPayload({
    videos: [
      {
        u: '/prof-video-click/upload/loki06/vhpihp133f/short_hair_webcam_blowjob',
        i: 'https://thumb.example/xv_8_t.jpg',
        t: 'Short hair webcam blowjob',
        d: '51 min',
        pn: 'Loki06',
        pu: '/profiles/loki06'
      }
    ]
  }, { name: 'Fallback', profileUrl: 'https://www.xvideos.com/profiles/loki06' });

  assert.equal(items.length, 1);
  assert.equal(items[0].video, 'https://www.xvideos.com/prof-video-click/upload/loki06/vhpihp133f/short_hair_webcam_blowjob');
  assert.equal(items[0].uploaderProfile, 'https://www.xvideos.com/profiles/loki06');
});

test('buildPornhubSearchUrl monta query compatível com busca do Pornhub', () => {
  assert.equal(buildPornhubSearchUrl({ search: 'cosplay', pagination: 1 }), 'https://www.pornhub.com/video/search?search=cosplay');
  assert.equal(buildPornhubSearchUrl({ search: 'cosplay', pagination: 3 }), 'https://www.pornhub.com/video/search?search=cosplay&page=3');
});

test('buildPornhubFeedUrl monta a url do feed com paginação', () => {
  assert.equal(buildPornhubFeedUrl({ page: 1 }), 'https://www.pornhub.com/video');
  assert.equal(buildPornhubFeedUrl({ page: 4 }), 'https://www.pornhub.com/video?page=4');
});

test('buildCreatorUploadsUrl monta a rota de uploads do Pornhub', () => {
  assert.equal(buildCreatorUploadsUrl('https://www.pornhub.com/pornstar/demo'), 'https://www.pornhub.com/pornstar/demo/videos/upload');
  assert.equal(buildCreatorUploadsUrl('https://www.pornhub.com/model/demo/videos'), 'https://www.pornhub.com/model/demo/videos/upload');
});

test('parsePornhubSearchResultsFromHtml encontra cards do catálogo', () => {
  const html = `
    <ul>
      <li class="pcVideoListItem">
        <a href="/view_video.php?viewkey=abc123" title="Demo Pornhub">
          <img data-mediumthumb="https://cdn.example/pornhub-thumb.jpg" />
        </a>
        <span class="duration">12 min</span>
        <div class="videoUploaderBlock">
          <div class="usernameWrap"><a href="/model/demo">Modelo Demo</a></div>
        </div>
      </li>
    </ul>
  `;

  const items = parsePornhubSearchResultsFromHtml(html);

  assert.equal(items.length, 1);
  assert.equal(items[0].video, 'https://www.pornhub.com/view_video.php?viewkey=abc123');
  assert.equal(items[0].title, 'Demo Pornhub');
  assert.equal(items[0].uploaderName, 'Modelo Demo');
});

test('parseCreatorUploadsFromHtml filtra uploads corretos do Pornhub', () => {
  const html = `
    <div class="videoUList latestThumbDesign">
      <li class="pcVideoListItem">
        <a href="/view_video.php?viewkey=abc123" title="Vídeo certo">
          <img data-mediumthumb="https://cdn.example/right.jpg" />
        </a>
        <span class="duration">12 min</span>
        <div class="usernameWrap"><a href="/pornstar/demo">Demo Star</a></div>
      </li>
      <li class="pcVideoListItem">
        <a href="/view_video.php?viewkey=def456" title="Vídeo errado">
          <img data-mediumthumb="https://cdn.example/wrong.jpg" />
        </a>
        <span class="duration">5 min</span>
        <div class="usernameWrap"><a href="/model/other">Outra conta</a></div>
      </li>
    </div>
  `;

  const items = parseCreatorUploadsFromHtml(html, {
    name: 'Demo Star',
    profileUrl: 'https://www.pornhub.com/pornstar/demo'
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].video, 'https://www.pornhub.com/view_video.php?viewkey=abc123');
  assert.equal(items[0].uploaderName, 'Demo Star');
});

test('extractPornhubStructuredVideoData lê json-ld do detalhe', () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "name": "Pornhub Demo",
        "description": "Descrição Pornhub",
        "thumbnailUrl": ["https://cdn.example/thumb.jpg"],
        "uploadDate": "2026-03-08T10:00:00.000Z",
        "interactionStatistic": {
          "userInteractionCount": "55K"
        }
      }
    </script>
  `;

  const video = extractPornhubStructuredVideoData(html);

  assert.equal(video.name, 'Pornhub Demo');
  assert.equal(video.uploadDate, '2026-03-08T10:00:00.000Z');
  assert.equal(video.interactionStatistic.userInteractionCount, '55K');
});

test('extractPornhubCreatorProfileDataFromHtml lê bio e stats', () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Abella Danger" />
        <meta property="og:image" content="https://cdn.example/abella.jpg" />
        <meta property="og:description" content="Descrição curta" />
      </head>
      <body>
        <h1>Abella Danger</h1>
        <p>Video views 2.2B Subscribers 1.5M Bio Danger might be her last name. Featured in: Bang Bros Network</p>
        <p>Birth Place: Miami Height: 5 ft 4 in (163 cm) Weight: 130 lbs (59 kg) Ethnicity: White</p>
      </body>
    </html>
  `;

  const profile = extractPornhubCreatorProfileDataFromHtml(html, 'https://www.pornhub.com/pornstar/abella-danger');

  assert.equal(profile.name, 'Abella Danger');
  assert.equal(profile.stats[0].value, '1.5M');
  assert.equal(profile.stats[1].value, '2.2B');
  assert.match(profile.description, /Danger might be her last name/);
});

test('extractMediaDefinitionsFromHtml reconhece fontes do Pornhub', () => {
  const html = `
    <script>
      var flashvars_1 = {
        "mediaDefinitions": [
          {"format":"mp4","quality":"720","videoUrl":"https://cdn.example/720.mp4"},
          {"format":"hls","quality":"1080","videoUrl":"https://cdn.example/master.m3u8"},
          {"format":"mp4","videoUrl":"https://www.pornhub.com/video/get_media?s=abc&v=demo"}
        ]
      };
    </script>
  `;

  const formats = extractMediaDefinitionsFromHtml(html);

  assert.deepEqual(formats, [
    { label: '720p', url: 'https://cdn.example/720.mp4' },
    { label: '1080p HLS', url: 'https://cdn.example/master.m3u8' }
  ]);
});

test('pickPreferredFormat prioriza arquivo direto sobre HLS quando ambos existem', async () => {
  const { pickPreferredFormat } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'common.js')).href);

  const format = pickPreferredFormat([
    { label: '1080p HLS', url: 'https://cdn.example/master.m3u8' },
    { label: 'Low Quality', url: 'https://cdn.example/video.mp4' }
  ]);

  assert.equal(format.label, 'Low Quality');
});

test('pickPreferredFormat prioriza HLS sobre get_media indireto do Pornhub', async () => {
  const { pickPreferredFormat } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'common.js')).href);

  const format = pickPreferredFormat([
    { label: 'MP4', url: 'https://www.pornhub.com/video/get_media?s=abc&v=demo' },
    { label: '1080p HLS', url: 'https://ev-h.phncdn.com/hls/demo/master.m3u8' }
  ]);

  assert.equal(format.label, '1080p HLS');
});

test('isRetryableRequestError reconhece falhas temporárias', () => {
  assert.equal(isRetryableRequestError({ response: { status: 429 } }), true);
  assert.equal(isRetryableRequestError({ response: { status: 503 } }), true);
  assert.equal(isRetryableRequestError({ response: { status: 404 } }), false);
  assert.equal(isRetryableRequestError(new Error('socket hang up')), true);
});

test('requestWithCache reutiliza cache fresco sem nova chamada', async () => {
  const cache = new Map();
  let calls = 0;
  let currentTime = 10_000;

  const first = await requestWithCache({
    cache,
    key: 'demo',
    ttlMs: 30_000,
    now: () => currentTime,
    execute: async () => {
      calls += 1;
      return { value: 'fresh' };
    }
  });

  currentTime += 5_000;

  const second = await requestWithCache({
    cache,
    key: 'demo',
    ttlMs: 30_000,
    now: () => currentTime,
    execute: async () => {
      calls += 1;
      return { value: 'should-not-run' };
    }
  });

  assert.deepEqual(first, { value: 'fresh' });
  assert.deepEqual(second, { value: 'fresh' });
  assert.equal(calls, 1);
});

test('requestWithCache usa cache stale quando a origem falha com 429', async () => {
  const cache = new Map();
  cache.set('demo', {
    value: { value: 'stale' },
    timestamp: 1_000
  });

  const result = await requestWithCache({
    cache,
    key: 'demo',
    ttlMs: 100,
    staleTtlMs: 10_000,
    retries: 1,
    retryDelayMs: 0,
    now: () => 2_000,
    sleep: (resolve) => resolve(),
    execute: async () => {
      const error = new Error('rate limited');
      error.response = { status: 429 };
      throw error;
    }
  });

  assert.deepEqual(result, { value: 'stale' });
});
