const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'config.local.json');
const EXAMPLE_CONFIG_PATH = path.join(ROOT, 'config.example.json');
const BODY_LIMIT = 25 * 1024 * 1024;

let tokenCache = null;

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function loadConfig() {
  const example = readJson(EXAMPLE_CONFIG_PATH, {});
  const local = readJson(CONFIG_PATH, {});
  return {
    ...example,
    ...local,
    server: { ...(example.server || {}), ...(local.server || {}) },
    security: { ...(example.security || {}), ...(local.security || {}) },
    wechat: { ...(example.wechat || {}), ...(local.wechat || {}) },
    ai: { ...(example.ai || {}), ...(local.ai || {}) },
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Publish-Token',
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(text);
}

function requireAuth(req, config) {
  const expected = config.security?.publishToken;
  if (!expected || expected === 'change-this-token') return true;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = req.headers['x-publish-token'] || bearer;
  return token === expected;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function markdownToWechatHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p style="margin: 12px 0; line-height: 1.9; color: #263238; font-size: 15px;">${inlineMarkdown(paragraph.join('<br>'))}</p>`);
    paragraph = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    if (/^<!--[\s\S]*-->$/.test(trimmed)) {
      flushParagraph();
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushParagraph();
      blocks.push(`<h3 style="margin: 22px 0 10px; color: #155e75; font-size: 17px;">${inlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushParagraph();
      blocks.push(`<h2 style="margin: 26px 0 12px; padding-left: 10px; border-left: 4px solid #0ea5e9; color: #0f172a; font-size: 19px;">${inlineMarkdown(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('# ')) continue;
    if (trimmed.startsWith('> ')) {
      flushParagraph();
      blocks.push(`<blockquote style="margin: 16px 0; padding: 12px 14px; background: #f0f9ff; border-left: 4px solid #38bdf8; color: #334155;">${inlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }
    const imageMatch = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (imageMatch) {
      flushParagraph();
      const alt = escapeHtml(imageMatch[1] || '文章配图');
      const src = escapeHtml(imageMatch[2] || '');
      blocks.push(`<p style="margin: 18px 0; text-align: center;"><img src="${src}" alt="${alt}" style="max-width: 100%; border-radius: 8px;"></p>`);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      blocks.push(`<p style="margin: 8px 0; line-height: 1.8; color: #263238; font-size: 15px;">• ${inlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</p>`);
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();

  return `<section style="max-width: 100%; margin: 0 auto; padding: 4px 0 12px; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;">${blocks.join('\n')}</section>`;
}

function getAiConfig(config) {
  const ai = config.ai || {};
  if (!ai.apiKey || ai.apiKey === 'sk-...') {
    throw new Error('请先在 config.local.json 配置 ai.apiKey');
  }
  return {
    baseUrl: String(ai.baseUrl || 'https://apihub.agnes-ai.com/v1').replace(/\/+$/, ''),
    apiKey: ai.apiKey,
    textModel: ai.textModel || 'agnes-2.0-flash',
    imageModel: ai.imageModel || 'agnes-image-2.1-flash',
    videoModel: ai.videoModel || 'agnes-video-v2.0',
    videoEndpoint: ai.videoEndpoint || '',
  };
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 返回内容不是 JSON，请重试');
  return JSON.parse(match[0]);
}

async function composeArticleWithAi(config, body) {
  const ai = getAiConfig(config);
  const topic = body.topic?.trim() || '公众号文章选题';
  const audience = body.audience?.trim() || '地产、工程、招采、造价从业者';
  const tone = body.tone?.trim() || '清楚、接地气、有判断';
  const points = body.points?.trim() || '';
  const system = [
    '你是微信公众号文章写作助手。',
    '用户是地产招采和造价背景，正在做 AI 工具和个人 IP。',
    '文章要像真人写的，清楚、接地气、有逻辑，少空话。',
    '输出必须是严格 JSON，不要 Markdown 代码块。',
    'JSON 字段：title、summary、markdown、imagePrompts。',
    'markdown 里不要放封面图，但可以在合适位置预留 3-5 个插图提示，格式为：<!-- image: 描述 -->。',
    'imagePrompts 是 3-5 个中文图片提示词数组，适合公众号配图。'
  ].join('\n');

  const user = `选题：${topic}
目标读者：${audience}
语气：${tone}
必须写进去的要点：
${points}

要求：
1. 标题 16-28 个中文字符。
2. 摘要 60-120 字。
3. 正文 1200-2200 字，Markdown 格式。
4. 小标题清楚，不要营销腔。
5. 结合地产招采、造价、AI 工具、个人成长的真实语境。`;

  const res = await fetch(`${ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ai.textModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.75,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`AI 文本生成失败：${data.error?.message || res.statusText}`);
  }
  const content = data.choices?.[0]?.message?.content;
  const parsed = extractJsonObject(content);
  const markdown = String(parsed.markdown || '').trim();
  return {
    title: String(parsed.title || topic).trim().slice(0, 64),
    summary: String(parsed.summary || '').trim().slice(0, 120),
    markdown,
    html: markdownToWechatHtml(markdown),
    imagePrompts: Array.isArray(parsed.imagePrompts) ? parsed.imagePrompts.slice(0, 5) : [],
    model: ai.textModel,
  };
}

async function dataUrlFromRemoteImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片下载失败：${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

async function generateImage(config, body) {
  const ai = getAiConfig(config);
  const prompt = body.prompt?.trim();
  if (!prompt) throw new Error('图片提示词不能为空');
  const requestBody = {
    model: body.model || ai.imageModel,
    prompt,
    size: body.size || '1024x1024',
    return_base64: true,
  };
  if (body.negative_prompt) requestBody.negative_prompt = String(body.negative_prompt);
  const res = await fetch(`${ai.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`AI 图片生成失败：${data.error?.message || res.statusText}`);
  }
  const item = data.data?.[0];
  if (item?.b64_json) {
    return { ok: true, dataUrl: `data:image/png;base64,${item.b64_json}`, model: body.model || ai.imageModel };
  }
  if (item?.url) {
    return { ok: true, dataUrl: await dataUrlFromRemoteImage(item.url), model: body.model || ai.imageModel };
  }
  throw new Error('AI 图片生成失败：没有拿到图片数据');
}

async function generateVideo(config, body) {
  const ai = getAiConfig(config);
  const prompt = body.prompt?.trim();
  if (!prompt) throw new Error('视频提示词不能为空');
  const endpointConfig = ai.videoEndpoint || 'videos';
  const endpoint = endpointConfig.startsWith('http')
    ? endpointConfig
    : `${ai.baseUrl}/${endpointConfig.replace(/^\/+/, '')}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: body.model || ai.videoModel,
      prompt,
      height: body.height || 768,
      width: body.width || 1152,
      num_frames: body.num_frames || 121,
      frame_rate: body.frame_rate || 24,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`AI 视频生成失败：${data.error?.message || data.message || res.statusText}`);
  }
  return { ok: true, data };
}

async function getVideoStatus(config, body) {
  const ai = getAiConfig(config);
  const videoId = body.video_id || body.videoId;
  const taskId = body.task_id || body.taskId;
  if (!videoId && !taskId) throw new Error('请提供 video_id 或 task_id');
  const endpoint = videoId
    ? `https://apihub.agnes-ai.com/agnesapi?video_id=${encodeURIComponent(videoId)}`
    : `${ai.baseUrl}/videos/${encodeURIComponent(taskId)}`;
  const res = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${ai.apiKey}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`查询视频结果失败：${data.error?.message || data.message || res.statusText}`);
  }
  return { ok: true, data };
}

function composeArticle({ topic, audience, tone, points }) {
  const cleanTopic = topic?.trim() || '一个值得认真讲清楚的话题';
  const cleanAudience = audience?.trim() || '对这个话题感兴趣的读者';
  const cleanTone = tone?.trim() || '清楚、接地气、有判断';
  const pointList = String(points || '')
    .split(/\n|,|，|；|;/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  const title = cleanTopic.length > 24 ? cleanTopic.slice(0, 24) : cleanTopic;
  const summary = `写给${cleanAudience}：用${cleanTone}的方式，把${cleanTopic}讲清楚。`;
  const bullets = pointList.length ? pointList : ['为什么现在值得关注', '普通人最容易误解什么', '可以马上怎么做'];
  const markdown = `# ${title}

> ${summary}

## 先把问题说透

很多文章一上来就堆概念，但真正有用的内容，应该先回答一个问题：这件事和我有什么关系？

${cleanTopic} 的价值不在于听起来新，而在于它能不能帮 ${cleanAudience} 少走弯路、少花冤枉钱、少做无效动作。

## 关键判断

${bullets.map(item => `- ${item}`).join('\n')}

## 我的建议

第一步，不要急着追求大而全，先把一个最小闭环跑通。

第二步，把过程记录下来。能复盘的动作，才有机会变成稳定能力。

第三步，别把工具当结果。工具只是放大器，真正决定效果的，还是你的判断、素材和执行。

## 写在最后

如果只记住一句话：**先做出一个能验证的版本，再慢慢把它做漂亮。**`;

  return {
    title,
    summary,
    markdown,
    html: markdownToWechatHtml(markdown),
    imagePrompts: [
      '一个真实工作场景的横版照片，表现资料整理、判断问题和行动清单，画面干净、有专业感',
      '一张清晰的信息结构图，表现问题、判断、行动三步关系，适合公众号正文配图',
      '一张简洁的行动清单风格图片，表现从想法到执行再到复盘的过程'
    ],
  };
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error('封面图格式错误，请重新生成封面');
  return {
    mime: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

async function uploadContentImage(token, dataUrl, name = 'article-image') {
  const { mime, buffer } = parseDataUrl(dataUrl);
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mime }), `${name}.${ext}`);

  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!data.url) {
    throw new Error(`正文图片上传失败 [${data.errcode || '-'}]: ${data.errmsg || '未知错误'}`);
  }
  return data.url.startsWith('http://') ? `https://${data.url.slice(7)}` : data.url;
}

async function replaceInlineDataImages(token, markdown) {
  let index = 0;
  return await String(markdown || '').replaceAllAsync(/!\[(.*?)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+)\)/g, async (full, alt, dataUrl) => {
    index += 1;
    const url = await uploadContentImage(token, dataUrl, `article-image-${index}`);
    return `![${alt || '文章配图'}](${url})`;
  });
}

if (!String.prototype.replaceAllAsync) {
  Object.defineProperty(String.prototype, 'replaceAllAsync', {
    value: async function replaceAllAsync(regex, asyncFn) {
      const matches = [];
      this.replace(regex, (...args) => {
        matches.push(args);
        return args[0];
      });
      let result = String(this);
      for (const args of matches) {
        result = result.replace(args[0], await asyncFn(...args));
      }
      return result;
    },
  });
}

async function getAccessToken(config, force = false) {
  const appId = config.wechat?.appId;
  const appSecret = config.wechat?.appSecret;
  if (!appId || !appSecret || appId === 'wx...' || appSecret === 'your_app_secret') {
    throw new Error('请先在 config.local.json 配置微信公众号 AppID 和 AppSecret');
  }

  const now = Date.now();
  if (!force && tokenCache?.appId === appId && tokenCache.expiresAt > now + 300000) {
    return tokenCache.token;
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);

  const res = await fetch(url);
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`微信 token 获取失败 [${data.errcode || '-'}]: ${data.errmsg || '未知错误'}`);
  }

  tokenCache = {
    appId,
    token: data.access_token,
    expiresAt: now + (data.expires_in || 7200) * 1000,
  };
  return tokenCache.token;
}

async function uploadCover(token, coverDataUrl) {
  const { mime, buffer } = parseDataUrl(coverDataUrl);
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mime }), `cover.${ext}`);

  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!data.media_id) {
    throw new Error(`封面上传失败 [${data.errcode || '-'}]: ${data.errmsg || '未知错误'}`);
  }
  return data.media_id;
}

async function createDraft(config, payload) {
  const token = await getAccessToken(config);
  const thumbMediaId = await uploadCover(token, payload.coverDataUrl);
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('标题不能为空');

  const preparedMarkdown = await replaceInlineDataImages(token, payload.markdown || '');
  const html = markdownToWechatHtml(preparedMarkdown);
  const article = {
    title: title.slice(0, 64),
    author: String(payload.author || config.wechat?.author || '').slice(0, 8),
    digest: String(payload.summary || '').slice(0, 120),
    content: html,
    content_source_url: '',
    thumb_media_id: thumbMediaId,
    need_open_comment: 1,
    only_fans_can_comment: 0,
    show_cover_pic: 1,
  };

  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ articles: [article] }),
  });
  const data = await res.json();
  if (!data.media_id) {
    throw new Error(`草稿创建失败 [${data.errcode || '-'}]: ${data.errmsg || '未知错误'}`);
  }
  return data;
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const safePath = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendText(res, 404, 'Not found');
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
    : ext === '.js' ? 'application/javascript; charset=utf-8'
    : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, config) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (req.method === 'GET' && req.url === '/api/status') {
    return sendJson(res, 200, {
      ok: true,
      configured: Boolean(config.wechat?.appId && config.wechat?.appSecret && config.wechat.appId !== 'wx...'),
      account: config.wechat?.name || '',
      authRequired: Boolean(config.security?.publishToken && config.security.publishToken !== 'change-this-token'),
    });
  }

  if (req.method === 'POST' && req.url === '/api/compose') {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, await composeArticleWithAi(config, body));
    } catch (err) {
      const fallback = composeArticle(body);
      return sendJson(res, 200, { ...fallback, fallback: true, warning: err.message });
    }
  }

  if (!requireAuth(req, config)) return sendJson(res, 401, { error: '发布口令不正确' });

  if (req.method === 'POST' && req.url === '/api/wechat/test-token') {
    const token = await getAccessToken(config, true);
    return sendJson(res, 200, { ok: true, tokenPreview: `${token.slice(0, 8)}...` });
  }

  if (req.method === 'POST' && req.url === '/api/ai/image') {
    const body = await readBody(req);
    return sendJson(res, 200, await generateImage(config, body));
  }

  if (req.method === 'POST' && req.url === '/api/ai/video') {
    const body = await readBody(req);
    return sendJson(res, 200, await generateVideo(config, body));
  }

  if (req.method === 'POST' && req.url === '/api/ai/video-status') {
    const body = await readBody(req);
    return sendJson(res, 200, await getVideoStatus(config, body));
  }

  if (req.method === 'POST' && req.url === '/api/wechat/draft') {
    const body = await readBody(req);
    const data = await createDraft(config, body);
    return sendJson(res, 200, {
      ok: true,
      mediaId: data.media_id,
      message: '文章已保存到微信公众号草稿箱',
    });
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

const config = loadConfig();
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) return await handleApi(req, res, loadConfig());
    return serveStatic(req, res);
  } catch (err) {
    return sendJson(res, 500, { error: err.message || '服务器错误' });
  }
});

const port = Number(config.server?.port || process.env.PORT || 3100);
server.listen(port, '0.0.0.0', () => {
  console.log(`Wechat Agent Panel running at http://127.0.0.1:${port}`);
  console.log(`Config: ${CONFIG_PATH}`);
});
