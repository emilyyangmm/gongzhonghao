# 公众号智能体面板

一个独立的小工具，用来生成公众号文章、生成封面、预览排版，并通过微信公众号官方 API 一键保存到草稿箱。

## 本地启动

```bash
cd wechat-agent-panel
node server.js
```

打开：

```text
http://127.0.0.1:3100
```

## 配置

真实密钥放在 `config.local.json`，不要提交到 Git。

```json
{
  "server": {
    "port": 3100
  },
  "security": {
    "publishToken": "change-this-token"
  },
  "wechat": {
    "name": "喵喵小仙儿",
    "appId": "wx...",
    "appSecret": "your_app_secret",
    "author": "小仙儿"
  }
}
```

## 部署到腾讯云服务器

服务器 IP 已固定为 `106.53.141.12`，只要微信公众号后台白名单包含这个 IP，服务端调用微信接口就稳定。

建议部署后把 `security.publishToken` 改成强口令。面板发布时填写这个口令，避免别人调用你的接口创建草稿。

## 当前能力

- 输入选题、读者、语气和要点
- 调用后端 AI Key 生成公众号文章初稿；如果 AI 接口不可用，会自动回落到本地模板
- 编辑 Markdown 正文
- 生成文字封面图
- 调用 AI 生成插图
- 在面板上显示 AI 插图库
- 支持把插图库缩略图拖到正文 Markdown 中插入排版
- 支持点选图片后插入正文，或设为封面
- 发布时自动把正文里的 AI 图片上传到微信正文图片接口
- 提供视频生成入口，需按实际平台补充 `ai.videoEndpoint`
- 微信公众号排版预览
- 一键上传封面并保存到公众号草稿箱

## AI 配置

`config.local.json` 里增加：

```json
{
  "ai": {
    "baseUrl": "https://apihub.agnes-ai.com/v1",
    "apiKey": "sk-...",
    "textModel": "agnes-2.0-flash",
    "imageModel": "agnes-image-2.1-flash",
    "videoModel": "agnes-video-v2.0",
    "videoEndpoint": ""
  }
}
```

Agnes 文本接口响应可能需要 1-2 分钟，面板已经把文章生成等待时间调到 150 秒。

## 后续可升级

- 增加文章历史库
- 增加定时选题和内容日历
- 给视频生成增加任务轮询和下载结果
