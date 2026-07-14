const ALLOWED_VIDEO_HOSTS = new Set([
  'platform-outputs.agnes-ai.space',
  'outputs.agnes-ai.space',
]);

const ALLOWED_ORIGINS = new Set([
  'https://miaomiaoxiaoxianer.cn',
  'https://www.miaomiaoxiaoxianer.cn',
  'http://127.0.0.1:3100',
  'http://localhost:3100',
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
    'Vary': 'Origin',
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function json(request, status, payload) {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), { status, headers });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (!['GET', 'HEAD'].includes(request.method)) return json(request, 405, { error: '仅支持读取视频文件' });

    const source = new URL(request.url).searchParams.get('url');
    if (!source) return json(request, 400, { error: '缺少视频地址' });

    let target;
    try {
      target = new URL(source);
    } catch {
      return json(request, 400, { error: '视频地址无效' });
    }
    if (target.protocol !== 'https:' || !ALLOWED_VIDEO_HOSTS.has(target.hostname)) {
      return json(request, 403, { error: '仅允许转存 Agnes 视频文件' });
    }

    const upstreamHeaders = new Headers();
    const range = request.headers.get('Range');
    if (range) upstreamHeaders.set('Range', range);
    const upstream = await fetch(target.toString(), { headers: upstreamHeaders });
    const headers = corsHeaders(request);
    for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('Cache-Control', 'private, max-age=600');
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
  },
};
