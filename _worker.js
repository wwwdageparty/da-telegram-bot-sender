/**
 * Dage Telegram Bot Sender -- www.dage.party
 * 
 * This Cloudflare Worker integrates with the Telegram Bot API to send messages (text, images, videos) to a Telegram chat.
 * 
 * For detailed setup instructions, including how to configure environment variables and run the bot, please refer to the README.md.
 */

let G_BotToken = "";
let G_ChatID = "";
let G_BotBasicUrl = "";


export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ OK: false, error: 'Only POST allowed' }), { 
        status: 405, 
        headers: { 'Content-Type': 'application/json' }
      });
    }
    G_BotToken = env.DAGEBOTTOKEN || ""
    G_ChatID = env.DAGECHATID || ""
    if (G_BotToken === "" || G_ChatID === "") {
      return new Response(JSON.stringify({ OK: false, error: 'Bot Token or Chat ID not configured' }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' }
      });
    }
    G_BotBasicUrl = `https://api.telegram.org/bot${G_BotToken}/`;

    const contentType = request.headers.get('content-type') || '';
    let content = '';
    const files = [];
    let ret = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      content = formData.get('content') || '';
      // const file = formData.get('file');

      // if (file && typeof file !== 'string') {
      //   const size = file.size;
      //   if (size <= 50 * 1024 * 1024) { // Max Telegram video size
      //     files.push({ name: file.name, blob: file });
      //   }
      // }

      const fileFields = formData.getAll('file');
      for (const file of fileFields) {
        if (file && typeof file !== 'string' && file.size <= 50 * 1024 * 1024) {
          files.push({ name: file.name, blob: file });
        }
      }

      ret = await sendFileDataFromClient(files, content);

    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      content = body.content || '';
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];

      ret = await sendSmartMessage(content, attachments);

    } else {
      return new Response(JSON.stringify({ OK: false, error: 'Unsupported content type' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (ret.ok) {
      return new Response(JSON.stringify({ OK: true, message: 'Message sent to Telegram' }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      const errText = JSON.stringify(ret || { error: 'Unknown error' });
      return new Response(JSON.stringify({ OK: false, error: 'Text send failed', details: errText }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' }
      });
    }

  }
};

async function sendFileDataFromClient(files, content) {

  let ret = null;

  if (files.length > 0) {
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      const mime = file.blob.type;
      const form = new FormData();
      form.append('chat_id', G_ChatID);
      form.append('caption', content);
      let endpoint = '';

      if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
        form.append('photo', file.blob, file.name);
        endpoint = 'sendPhoto';
      } else if (mime.startsWith('video/') || ['mp4', 'mov', 'webm'].includes(ext)) {
        form.append('video', file.blob, file.name);
        endpoint = 'sendVideo';
      } else {
        form.append('document', file.blob, file.name);
        endpoint = 'sendDocument';
      }

      try {
        const res = await fetch(`${G_BotBasicUrl}${endpoint}`, {
          method: 'POST',
          body: form
        });

        ret = await res.json();
        // if (res.ok) {
        //   sent = true;
        // } else {
        //   lastError = await res.text();
        // }
      } catch (err) {
        console.error(err);
      }
    }
  }

  // Fallback: send text message if no media sent
  if (!ret || !ret.ok) {
    try {
      const res = await fetch(`${G_BotBasicUrl}sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: G_ChatID,
          text: content
        })
      });

      ret = await res.json();
    } catch (err) {
      console.error('Telegram send error: ' + err.toString());
    }
  }

  return ret;
}




let G_CookieIndex = 0;

/**
 * Send a message to Telegram that may include zero, one, or many media items (photos/videos).
 * - 0 items: sendMessage
 * - 1 item: sendPhoto / sendVideo (by URL) with upload-fallback
 * - 2–10 items: sendMediaGroup (by URL) with upload-fallback
 * - >10 items: split into chunks of up to 10 and send multiple groups
 *
 * If Telegram fails to fetch remote media, we download each file and re-send via multipart/form-data using attach://.
 */
async function sendSmartMessage(htmlMessage, mediaUrls = []) {
    // 0) No media -> plain text
    if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) {
      return await jsonPost(G_BotBasicUrl + "sendMessage", {
        chat_id: G_ChatID,
        text: htmlMessage,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  
    // 1) One media -> sendPhoto/sendVideo
    if (mediaUrls.length === 1) {
      const url = mediaUrls[0];
      const kind = guessKindFromUrl(url); // "photo" | "video"
      const method = kind === "video" ? "sendVideo" : "sendPhoto";
  
      let data = await jsonPost(G_BotBasicUrl + method, {
        chat_id: G_ChatID,
        caption: htmlMessage,
        parse_mode: "HTML",
        [kind === "video" ? "video" : "photo"]: url,
      });
  
      if (!data.ok) {// whatever the reason we will download files then send file content; && needsUploadFallback(data)) {
        data = await sendSingleMediaUpload(htmlMessage, url, kind);
      }
      return data;
    }
  
    // 2) Many media -> sendMediaGroup (Telegram requires 2–10 per group)
    const chunks = chunk(mediaUrls, 10);
    const results = [];
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const urls = chunks[chunkIdx];
  
      // First attempt: remote URLs
      const media = urls.map((u, idx) => {
        const kind = guessKindFromUrl(u);
        const obj = {
          type: kind,         // "photo" or "video"
          media: u,
        };
        if (idx === 0) {
          obj.caption = htmlMessage;
          obj.parse_mode = "HTML";
        }
        return obj;
      });
  
      let data = await jsonPost(G_BotBasicUrl + "sendMediaGroup", {
        chat_id: G_ChatID,
        media,
      });
  
      if (!data.ok) {// && needsUploadFallback(data)) {
        // Fallback: upload files (attach://)
        data = await sendMediaGroupUpload(htmlMessage, urls);
      }
  
      results.push(data);
    }
  
    // If only one chunk, return single result; else return array of results
    return results.length === 1 ? results[0] : results;
  }
  
  /* ------------------------ Helpers ------------------------ */
  
  function guessKindFromUrl(url) {
    // Quick heuristic from extension
    const u = url.split("?")[0].toLowerCase();
    if (/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(u)) return "video";
    // default to photo for unknown (Telegram accepts either if URL points to the right mime)
    return "photo";
  }
  
  function needsUploadFallback(respJson) {
    const d = (respJson && respJson.description || "").toLowerCase();
    // Common Telegram fetch failures
    const markers = [
      "failed to get http url content",
      "wrong type of the web page content",
      "image_process_failed",
      "wrong file identifier/http url specified",
      "could not fetch",
      "failed to get file",
      "http url content"
    ];
    return markers.some(m => d.includes(m));
  }
  
  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
  
  function fileNameFor(idx, contentType, url) {
    // Try to derive sensible filename + extension
    const extFromCT = (() => {
      if (!contentType) return "";
      if (contentType.startsWith("image/")) return "." + contentType.split("/")[1].split(";")[0];
      if (contentType.startsWith("video/")) return "." + contentType.split("/")[1].split(";")[0];
      return "";
    })();
  
    const extFromUrl = (() => {
      const m = url.split("?")[0].match(/\.(\w{2,5})$/i);
      return m ? "." + m[1].toLowerCase() : "";
    })();
  
    const ext = extFromCT || extFromUrl || "";
    return `file_${idx}${ext || ".bin"}`;
  }
  
  async function jsonPost(url, payload) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await resp.json();
  }
  
  /**
   * Upload a single media item (photo/video) after downloading it locally.
   */
  async function sendSingleMediaUpload(htmlMessage, mediaUrl, kindMaybe) {
  
    const mediaResp = await httpGet(mediaUrl);
    const contentType = (mediaResp.headers.get("Content-Type") || "").toLowerCase();
  
    // Decide kind by Content-Type if possible, otherwise fallback to guess
    let kind = "photo";
    if (contentType.startsWith("video/")) kind = "video";
    else if (contentType.startsWith("image/")) kind = "photo";
    else if (kindMaybe) kind = kindMaybe;
  
    // If it's not a supported media, revert to plain text
    if (!(contentType.startsWith("image/") || contentType.startsWith("video/"))) {
      return await jsonPost(G_BotBasicUrl + "sendMessage", {
        chat_id: G_ChatID,
        text: htmlMessage,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  
    const blob = await mediaResp.blob();
    const formData = new FormData();
    formData.append("chat_id", G_ChatID);
    formData.append("caption", htmlMessage);
    formData.append("parse_mode", "HTML");
  
    const filename = fileNameFor(0, contentType, mediaUrl);
    if (kind === "video") formData.append("video", blob, filename);
    else formData.append("photo", blob, filename);
  
    const resp = await fetch(G_BotBasicUrl + (kind === "video" ? "sendVideo" : "sendPhoto"), {
      method: "POST",
      body: formData,
    });
    return await resp.json();
  }
  
  /**
   * Upload a media group using attach:// after downloading each file.
   * Skips any URL that is not image/* or video/* by Content-Type.
   */
  async function sendMediaGroupUpload(htmlMessage, urls) {
  
    // Download all files
    const files = [];
    for (let i = 0; i < urls.length; i++) {
      try {
        const r = await httpGet(urls[i]);
        const ct = (r.headers.get("Content-Type") || "").toLowerCase();
        if (!(ct.startsWith("image/") || ct.startsWith("video/"))) {
          // ignore non-media items
          continue;
        }
        const blob = await r.blob();
        const fname = fileNameFor(i, ct, urls[i]);
        const kind = ct.startsWith("video/") ? "video" : "photo";
        files.push({ idx: i, url: urls[i], blob, filename: fname, kind });
      } catch (e) {
        // Skip failed downloads; we still try to send others
        // (optional) console.warn("Download failed for", urls[i], e);
      }
    }
  
    if (files.length === 0) {
      // Nothing valid -> send text
      return await jsonPost(G_BotBasicUrl + "sendMessage", {
        chat_id: G_ChatID,
        text: htmlMessage,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  
    // Build media array referencing attach://filename
    const media = files.map((f, idx) => {
      const item = {
        type: f.kind,                     // "photo" | "video"
        media: `attach://${f.filename}`,
      };
      if (idx === 0) {
        item.caption = htmlMessage;
        item.parse_mode = "HTML";
      }
      return item;
    });
  
    // Prepare FormData with files + JSON media
    const fd = new FormData();
    fd.append("chat_id", G_ChatID);
    fd.append("media", JSON.stringify(media));
    files.forEach(f => {
      fd.append(f.filename, f.blob, f.filename); // field name must match after attach://
    });
  
    const resp = await fetch(G_BotBasicUrl + "sendMediaGroup", { method: "POST", body: fd });
    return await resp.json();
  }




async function httpGet(targetUrl, strReferer = "", strHosturl = "") {
    const headers = { ...C_BrowserHeaders[G_CookieIndex] };
    if (strReferer && strReferer !== "") {
      headers['Referer'] = strReferer;
    }
    if (strHosturl && strHosturl !== "") {
      headers['Origin'] = strHosturl;
    }
  
  
    const response = await fetch(targetUrl, {
      method: "GET",
      headers,
    });
  
    return response;
  }

  function randomCookie() {
    // Random session ID (hex)
    const sessionId = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    const sessionKey = [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
  
    // Random consent UUID
    const consentUUID = [...Array(8)].map(() => Math.floor(Math.random() * 16).toString(16)).join('-') +
                        '-' + [...Array(4)].map(() => Math.floor(Math.random() * 16).toString(16)).join('-') +
                        '-' + [...Array(4)].map(() => Math.floor(Math.random() * 16).toString(16)).join('-') +
                        '-' + [...Array(12)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
  
    // Example anonymous cookies with Singapore country code
    const cookies = [
      `country_code=SG`,
      `session_id=${sessionId}`,
      `_user-data={"status":"anonymous"}`,
      `exp_pref=AMER`,
      `consentUUID=${consentUUID}`,
      `session_key=${sessionKey}`
    ];
  
    // Return joined cookie string
    return cookies.join('; ');
  }
  


const C_BrowserLikeHeaders1 = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  };
  const C_BrowserLikeHeaders2 = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Cookie": randomCookie()
  };
  const C_BrowserHeaders = [C_BrowserLikeHeaders1,
    C_BrowserLikeHeaders2,
  ]
  
