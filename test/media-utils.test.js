const test = require('node:test');
const assert = require('node:assert/strict');

const { downloadRemoteMedia, extensionFromMime, findVideoMarkers } = require('../media-utils');

test('根据响应类型为下载的视频保留 mp4 扩展名', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(Buffer.from('video-bytes'), {
    status: 200,
    headers: { 'content-type': 'video/mp4' },
  });

  try {
    const file = await downloadRemoteMedia('https://example.com/video');
    assert.equal(file.mime, 'video/mp4');
    assert.equal(file.ext, 'mp4');
    assert.deepEqual(file.buffer, Buffer.from('video-bytes'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('未知图片类型使用安全的 jpg 扩展名', () => {
  assert.equal(extensionFromMime('image/unknown', 'image'), 'jpg');
});

test('识别正文中的视频标记及其标题和地址', () => {
  const markers = findVideoMarkers('开头\n@[video: 深圳小店](https://cdn.example.com/a.mp4)\n结尾');
  assert.deepEqual(markers, [{ title: '深圳小店', url: 'https://cdn.example.com/a.mp4' }]);
});
