'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseScript, extractTitle, extractEditableBody } = require('./lib/parse-script');
const { startPhoneBridge, getPhoneLink } = require('./lib/phone-bridge');

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
const MANUAL_DIR = path.join(ROOT, 'manual');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
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
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function isInsideDir(root, file) {
  if (!root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function scriptsFromDir(dir, source) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((file) => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      const content = fs.readFileSync(full, 'utf8');
      const { title, paragraphs } = parseScript(content);
      return {
        path: full,
        file,
        source,
        title: title || file,
        paragraphCount: paragraphs.length,
        mtime: stat.mtimeMs,
      };
    });
}

function listScripts() {
  const items = scriptsFromDir(config.scriptsDir, 'file').concat(scriptsFromDir(MANUAL_DIR, 'manual'));
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

function makeManualSlug(title) {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const ascii = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const base = ascii ? `manual-${ascii}-${stamp}` : `manual-${stamp}`;
  let slug = base;
  let n = 2;
  while (fs.existsSync(path.join(MANUAL_DIR, `${slug}.md`))) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

function buildManualMarkdown(title, text) {
  const body = String(text).replace(/\r\n/g, '\n').trim();
  if (/^##\s*متن\s*$/m.test(body)) {
    const content = /^#\s+\S/m.test(body) ? body : `# ${title}\n\n${body}`;
    return content.endsWith('\n') ? content : `${content}\n`;
  }
  return `# ${title}\n\n## متن\n\n${body}\n`;
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://127.0.0.1');
  const pathname = parsed.pathname;

  if (pathname === '/api/phone-link') {
    sendJson(res, 200, getPhoneLink());
    return;
  }

  if (pathname === '/phone') {
    serveStatic(res, '/phone.html');
    return;
  }

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
    const resolved = path.resolve(scriptPath);
    const allowed = isInsideDir(config.scriptsDir, resolved) || isInsideDir(MANUAL_DIR, resolved);
    if (!allowed || !resolved.toLowerCase().endsWith('.md')) {
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

  if (pathname === '/api/manual-script' && req.method === 'GET') {
    const scriptPath = parsed.searchParams.get('path');
    const fileName = parsed.searchParams.get('file');
    let resolved = '';
    if (fileName) {
      if (!/^[A-Za-z0-9._-]+\.md$/i.test(fileName)) {
        sendJson(res, 400, { error: 'اسم فایل درست نیست' });
        return;
      }
      resolved = path.join(MANUAL_DIR, fileName);
    } else if (scriptPath) {
      resolved = path.resolve(scriptPath);
    } else {
      sendJson(res, 400, { error: 'مسیر فایل لازم است' });
      return;
    }
    if (!isInsideDir(MANUAL_DIR, resolved) || !resolved.toLowerCase().endsWith('.md')) {
      sendJson(res, 403, { error: 'این مسیر مجاز نیست' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      sendJson(res, 404, { error: 'فایل پیدا نشد' });
      return;
    }
    try {
      const content = fs.readFileSync(resolved, 'utf8');
      const title = extractTitle(content) || path.basename(resolved, '.md');
      sendJson(res, 200, {
        path: resolved,
        file: path.basename(resolved),
        title,
        text: extractEditableBody(content),
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/manual-script' && req.method === 'POST') {
    readRawBody(req)
      .then((buffer) => {
        let body;
        try {
          body = JSON.parse(buffer.toString('utf8'));
        } catch (err) {
          sendJson(res, 400, { error: 'متن قابل خوندن نبود' });
          return;
        }
        const title = String(body.title || '')
          .replace(/[\r\n#]/g, ' ')
          .trim()
          .slice(0, 80);
        const text = String(body.text || '');
        if (!title) {
          sendJson(res, 400, { error: 'یه عنوان بذار' });
          return;
        }
        if (!text.trim()) {
          sendJson(res, 400, { error: 'متنی ننوشتی' });
          return;
        }
        if (text.length > 100000) {
          sendJson(res, 400, { error: 'متن خیلی طولانی است' });
          return;
        }
        const markdown = buildManualMarkdown(title, text);
        const parsedScript = parseScript(markdown);
        if (!parsedScript.paragraphs.length) {
          sendJson(res, 400, { error: 'پاراگرافی پیدا نشد' });
          return;
        }
        fs.mkdirSync(MANUAL_DIR, { recursive: true });
        let full;
        const editPath = body.path ? path.resolve(String(body.path)) : '';
        if (editPath) {
          if (!isInsideDir(MANUAL_DIR, editPath) || !editPath.toLowerCase().endsWith('.md')) {
            sendJson(res, 403, { error: 'این مسیر مجاز نیست' });
            return;
          }
          if (!fs.existsSync(editPath)) {
            sendJson(res, 404, { error: 'فایل پیدا نشد' });
            return;
          }
          full = editPath;
        } else {
          const slug = makeManualSlug(title);
          full = path.join(MANUAL_DIR, `${slug}.md`);
        }
        fs.writeFileSync(full, markdown, 'utf8');
        sendJson(res, 200, {
          path: full,
          slug: path.basename(full, '.md'),
          title: parsedScript.title || title,
          paragraphCount: parsedScript.paragraphs.length,
          source: 'manual',
        });
      })
      .catch((err) => sendJson(res, 500, { error: err.message }));
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

const phonePort = Number(config.phonePort) > 0 ? Number(config.phonePort) : PORT + 1;
startPhoneBridge({
  httpServer: server,
  phonePort: phonePort === PORT ? PORT + 1 : phonePort,
  publicDir: PUBLIC_DIR,
  root: ROOT,
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`reel-studio روی http://127.0.0.1:${PORT}`);
});
