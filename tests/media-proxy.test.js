const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSafeMediaProxyUrl,
  buildMediaProxyUrl,
  rewriteM3u8Manifest
} = require('../server');

test('isSafeMediaProxyUrl aceita hosts de mídia do Pornhub e rejeita externos', () => {
  assert.equal(isSafeMediaProxyUrl('https://www.pornhub.com/video/get_media?s=abc&v=demo'), true);
  assert.equal(isSafeMediaProxyUrl('https://ev-h.phncdn.com/hls/videos/demo/master.m3u8'), true);
  assert.equal(isSafeMediaProxyUrl('https://cdn.example.com/video.mp4'), false);
});

test('buildMediaProxyUrl serializa url e source corretamente', () => {
  const href = buildMediaProxyUrl(
    'https://ev-h.phncdn.com/hls/videos/demo/master.m3u8?token=abc',
    'https://www.pornhub.com/view_video.php?viewkey=demo'
  );

  assert.equal(
    href,
    '/api/media-proxy?url=https%3A%2F%2Fev-h.phncdn.com%2Fhls%2Fvideos%2Fdemo%2Fmaster.m3u8%3Ftoken%3Dabc&source=https%3A%2F%2Fwww.pornhub.com%2Fview_video.php%3Fviewkey%3Ddemo'
  );
});

test('rewriteM3u8Manifest converte segmentos e URI de chave para proxy local', () => {
  const sourceVideoUrl = 'https://www.pornhub.com/view_video.php?viewkey=demo';
  const manifestUrl = 'https://ev-h.phncdn.com/hls/videos/demo/master.m3u8?token=abc';
  const original = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.key"',
    '#EXTINF:10.0,',
    'segment1.ts',
    '#EXTINF:10.0,',
    'https://ev-h.phncdn.com/hls/videos/demo/segment2.ts?sig=1'
  ].join('\n');

  const rewritten = rewriteM3u8Manifest(original, manifestUrl, sourceVideoUrl);

  assert.match(rewritten, /\/api\/media-proxy\?url=https%3A%2F%2Fev-h\.phncdn\.com%2Fhls%2Fvideos%2Fdemo%2Fkey\.key&source=https%3A%2F%2Fwww\.pornhub\.com%2Fview_video\.php%3Fviewkey%3Ddemo/);
  assert.match(rewritten, /\/api\/media-proxy\?url=https%3A%2F%2Fev-h\.phncdn\.com%2Fhls%2Fvideos%2Fdemo%2Fsegment1\.ts&source=https%3A%2F%2Fwww\.pornhub\.com%2Fview_video\.php%3Fviewkey%3Ddemo/);
  assert.match(rewritten, /\/api\/media-proxy\?url=https%3A%2F%2Fev-h\.phncdn\.com%2Fhls%2Fvideos%2Fdemo%2Fsegment2\.ts%3Fsig%3D1&source=https%3A%2F%2Fwww\.pornhub\.com%2Fview_video\.php%3Fviewkey%3Ddemo/);
});
