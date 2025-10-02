[🇬🇧 English Version](README.md) | [🇨🇳 中文版](README_CN.md)

# Dage Telegram Bot Sender

This project provides a **Cloudflare Worker** function that integrates with the **Telegram Bot API** to send messages and media (text, images, videos, and more) to a Telegram chat.

## Features
1. Accepts **POST** requests with either JSON (`application/json`) or form-data (`multipart/form-data`).
2. Sends messages to Telegram with or without attachments, with fallbacks for unsupported content types.
3. Supports file uploads (up to **50MB for videos**) and auto-detects media types before sending.
4. Handles multiple media items in a group, with automatic re-uploads if Telegram fetch fails.
5. Includes error handling and fallback text messages if media cannot be uploaded.

## Setup

### Environment Variables
You need to configure **two environment variables** in your Cloudflare Worker dashboard:

- `DAGEBOTTOKEN`: Your Telegram bot API token (from **BotFather**).
- `DAGECHATID`: The Telegram chat ID where messages will be sent (find it via [@dageinfobot](https://t.me/dageinfobot)).

### How to Configure
1. Log in to your Cloudflare dashboard → go to **Workers**.
2. Open your Worker settings.
3. Under **Environment Variables**, click **Add Variable**.
4. Add `DAGEBOTTOKEN` and paste your Telegram bot’s token.
5. Add `DAGECHATID` and paste the target chat ID.
6. Save and deploy your Worker.

## Example Usage

### JSON request
```bash
curl -X POST https://your-cloudflare-worker-url \
-H "Content-Type: application/json" \
-d '{"content": "Your message", "attachments": ["https://example.com/image.jpg"]}'
```

### Form-data request
```bash
curl -X POST https://your-cloudflare-worker-url \
-F "content=Your message" \
-F "file=@/path/to/your/file.jpg"
```
