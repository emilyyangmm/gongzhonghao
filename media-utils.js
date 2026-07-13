const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

function extensionFromMime(mime, kind = 'image') {
  return MIME_EXTENSIONS[String(mime || '').toLowerCase()] || (kind === 'video' ? 'mp4' : 'jpg');
}

async function downloadRemoteMedia(url, kind = '') {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 WechatAgentPanel' },
    });
  } catch (error) {
    throw new Error(`媒体下载失败：${error.message || '网络连接失败'}`);
  }
  if (!res.ok) throw new Error(`媒体下载失败：${res.status}`);

  const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
  if (kind && !mime.startsWith(`${kind}/`)) {
    throw new Error(`下载的文件不是${kind === 'video' ? '视频' : '图片'}：${mime}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('媒体下载失败：文件为空');
  return { mime, buffer, ext: extensionFromMime(mime, kind) };
}

function findVideoMarkers(markdown) {
  const markers = [];
  const regex = /^@\[video(?:\s*:\s*(.*?))?\]\((https?:\/\/[^)]+)\)$/gm;
  let match;
  while ((match = regex.exec(String(markdown || '')))) {
    markers.push({ title: String(match[1] || '视频').trim() || '视频', url: match[2] });
  }
  return markers;
}

module.exports = { downloadRemoteMedia, extensionFromMime, findVideoMarkers };
