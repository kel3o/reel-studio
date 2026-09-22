'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseScript } = require('./lib/parse-script');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = process.env.REEL_CONFIG_PATH || path.join(ROOT, 'config.json');
const CONFIG_EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

const SLUG_RE = /^[A-Za-z0-9_-]+$/;
const NUMBER_RE = /^[0-9]{1,4}$/;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn(
      'config.json پیدا نشد. از config.example.json کپی کن، اسمش رو بذار config.json و مسیر پوشهٔ سناریوها رو توش تنظیم کن. فعلا با تنظیمات نمونه بالا میاد.'
    );
    return JSON.parse(fs.readFileSync(CONFIG_EXAMPLE_PATH, 'utf8'));
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.warn('config.json خراب است و خوانده نشد: ' + err.message + '. فعلا با تنظیمات نمونه بالا میاد.');
    return JSON.parse(fs.readFileSync(CONFIG_EXAMPLE_PATH, 'utf8'));
  }
}

const config = loadConfig();
const PORT = config.port || 7180;
const TAKES_DIR = resolveFromRoot(config.takesDir || './takes');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const filePath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.join(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('یافت نشد');
      return;
    }
    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function listScripts() {
  const dir = config.scriptsDir;
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
  const items = files.map((file) => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    const content = fs.readFileSync(full, 'utf8');
    const { title, paragraphs } = parseScript(content);
    return {
      path: full,
      file,
      title: title || file,
      paragraphCount: paragraphs.length,
      mtime: stat.mtimeMs,
    };
  });
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://127.0.0.1');
  const pathname = parsed.pathname;

  if (pathname === '/api/devices-config') {
    sendJson(res, 200, {
      preferredCamera: config.preferredCamera || '',
      preferredMic: config.preferredMic || '',
    });
    return;
  }

  if (pathname === '/api/scripts') {
    try {
      sendJson(res, 200, listScripts());
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/script') {
    const scriptPath = parsed.searchParams.get('path');
    if (!scriptPath) {
      sendJson(res, 400, { error: 'مسیر فایل لازم است' });
      return;
    }
    const scriptsDir = config.scriptsDir ? path.resolve(config.scriptsDir) : '';
    const resolved = path.resolve(scriptPath);
    if (!scriptsDir || !resolved.startsWith(scriptsDir)) {
      sendJson(res, 403, { error: 'این مسیر مجاز نیست' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      sendJson(res, 404, { error: 'فایل پیدا نشد' });
      return;
    }
    try {
      const content = fs.readFileSync(resolved, 'utf8');
      const parsed = parseScript(content);
      const slug = path.basename(resolved, path.extname(resolved));
      sendJson(res, 200, Object.assign({ slug }, parsed));
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/clip' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    const paragraph = parsed.searchParams.get('paragraph');
    const take = parsed.searchParams.get('take');
    if (!slug || !SLUG_RE.test(slug) || !NUMBER_RE.test(paragraph || '') || !NUMBER_RE.test(take || '')) {
      sendJson(res, 400, { error: 'اسم سناریو، شماره پاراگراف و شماره ضبط لازم است' });
      return;
    }
    readRawBody(req)
      .then((buffer) => {
        const dir = path.join(TAKES_DIR, slug);
        fs.mkdirSync(dir, { recursive: true });
        const fileName = `${paragraph}-${take}.webm`;
        fs.writeFileSync(path.join(dir, fileName), buffer);
        sendJson(res, 200, { file: fileName });
      })
      .catch((err) => sendJson(res, 500, { error: err.message }));
    return;
  }

  if (pathname === '/api/open-folder' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    if (!slug || !SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: 'اسم سناریو لازم است' });
      return;
    }
    const dir = path.join(TAKES_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    // explorer.exe sometimes exits non zero even when it opened the window
    // fine, so spawning it and moving on is the correct thing to do here.
    const opener = spawn('explorer.exe', [dir]);
    opener.on('error', () => {});
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/session' && req.method === 'GET') {
    const slug = parsed.searchParams.get('slug');
    if (!slug || !SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: 'اسم سناریو لازم است' });
      return;
    }
    const sessionPath = path.join(TAKES_DIR, slug, 'session.json');
    if (!fs.existsSync(sessionPath)) {
      sendJson(res, 404, { error: 'هنوز جلسه‌ای ثبت نشده' });
      return;
    }
    try {
      sendJson(res, 200, JSON.parse(fs.readFileSync(sessionPath, 'utf8')));
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/session' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    if (!slug || !SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: 'اسم سناریو لازم است' });
      return;
    }
    readRawBody(req)
      .then((buffer) => {
        const session = JSON.parse(buffer.toString('utf8'));
        const dir = path.join(TAKES_DIR, slug);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(session, null, 2));
        sendJson(res, 200, { ok: true });
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
    return;
  }

  serveStatic(res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`reel-studio روی http://127.0.0.1:${PORT}`);
});
