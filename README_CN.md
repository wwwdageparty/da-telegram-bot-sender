[🇬🇧 English Version](README.md) | [🇨🇳 中文版](README_CN.md)

# Dage Telegram 机器人发送器

本项目提供了一个 **Cloudflare Worker** 函数，集成了 **Telegram Bot API**，用于向 Telegram 聊天发送消息和媒体（文本、图片、视频等）。

## 功能特点
1. 接收 **POST** 请求，支持 JSON (`application/json`) 和表单数据 (`multipart/form-data`)。
2. 可发送带或不带附件的消息，支持不兼容类型的回退机制。
3. 支持文件上传（视频最大 **50MB**），自动识别媒体类型后再发送。
4. 支持多媒体文件分组发送，如果 Telegram 拉取失败则会自动重新上传。
5. 包含错误处理机制，当文件上传失败时，会发送回退文本消息。

## 配置方法

### 环境变量
需要在 Cloudflare Worker 控制台配置 **两个环境变量**：

- `DAGEBOTTOKEN`：你的 Telegram 机器人 API Token（在 **BotFather** 中生成）。
- `DAGECHATID`：目标 Telegram 聊天 ID（可通过 [@dageinfobot](https://t.me/dageinfobot) 获取）。

### 配置步骤
1. 登录 Cloudflare 控制台 → 打开 **Workers**。
2. 找到并打开你的 Worker 设置。
3. 在 **Environment Variables** 中点击 **Add Variable**。
4. 添加 `DAGEBOTTOKEN` 并粘贴你的机器人 Token。
5. 添加 `DAGECHATID` 并粘贴目标聊天 ID。
6. 保存并部署 Worker。

## 使用示例

### JSON 请求
```bash
curl -X POST https://your-cloudflare-worker-url \
-H "Content-Type: application/json" \
-d '{"content": "你的消息", "attachments": ["https://example.com/image.jpg"]}'
```

### 表单数据请求
```bash
curl -X POST https://your-cloudflare-worker-url \
-F "content=你的消息" \
-F "file=@/path/to/your/file.jpg"
```
