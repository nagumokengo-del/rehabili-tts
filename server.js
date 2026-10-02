const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const PORT = process.env.PORT || 3000;
const audioCache = new Map(); // cacheKey: `${voice}:${rate}:${text}` -> Buffer

async function synthesizeText(voice, text, rate = '+0%') {
  const cacheKey = `${voice}:${rate}:${text}`;
  if (audioCache.has(cacheKey)) {
    return audioCache.get(cacheKey);
  }

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  return new Promise((resolve, reject) => {
    const { audioStream } = tts.toStream(text, { rate: rate });
    const chunks = [];
    audioStream.on('data', d => chunks.push(d));
    audioStream.on('end', () => {
      tts.close();
      const buf = Buffer.concat(chunks);
      audioCache.set(cacheKey, buf);
      resolve(buf);
    });
    audioStream.on('error', err => {
      tts.close();
      reject(err);
    });
  });
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. Health / Status check
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', cachedItems: audioCache.size }));
    return;
  }

  // 2. TTS API endpoint: /api/tts?voice=...&text=...&rate=...
  if (pathname === '/api/tts') {
    const voice = parsedUrl.query.voice;
    const text = parsedUrl.query.text;
    const rate = parsedUrl.query.rate || '+0%';

    if (!voice || !text) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing voice or text parameter' }));
      return;
    }

    try {
      const audioBuffer = await synthesizeText(voice, text, rate);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length,
        'Cache-Control': 'public, max-age=86400'
      });
      res.end(audioBuffer);
    } catch (err) {
      console.error('Synthesis error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Synthesis failed', details: err.message }));
    }
    return;
  }

  // 3. Serve Frontend HTML or static files
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '/interactive_player' || reqPath === '/index.html') reqPath = '/interactive_player.html';
  if (reqPath === '/numbers' || reqPath === '/numbers_player') reqPath = '/numbers_player.html';
  if (reqPath === '/calendar' || reqPath === '/calendar_player') reqPath = '/calendar_player.html';

  // もしパスの中に "flags/..." が含まれている場合（例: /numbers/flags/cn.svg など）、flags/cn.svg に確実にマップ
  if (reqPath.includes('/flags/')) {
    const flagFile = reqPath.split('/flags/')[1];
    reqPath = '/flags/' + flagFile;
  }

  let filePath = path.join(__dirname, reqPath);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.mp3': 'audio/mpeg',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log('========================================================');
  console.log(`🚀 多言語自己紹介 クラウド音声サーバーが起動しました！`);
  console.log(`👉 ブラウザで http://localhost:${PORT} を開いてください`);
  console.log('========================================================');
});
