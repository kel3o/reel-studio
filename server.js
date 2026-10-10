'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { parseScript, extractTitle, extractEditableBody } = require('./lib/parse-script');
const { startPhoneBridge, getPhoneLink } = require('./lib/phone-bridge');
const {
  defaultStyle,
  clampStyle,
  buildWordsForClips,
  sanitizeWords,
  pickDuration,
  normalizeSavedClips,
  sanitizeLanes,
  cutIntervalSeconds,
  isCameraTakeName,
  programTakeName,
  applyCutCameraFiles,
  expandCutClips,
  expandLookClips,
  sanitizeLookCuts,
  buildAss,
  concatFilter,
  stackFilter,
  evenDim,
  resolveFont,
  readFontFace,
  uniqueRenderName,
} = require('./lib/captions');

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
const OUT_DIR = resolveFromRoot(config.outDir || './out');
function toolPath(name) {
  const configured = name === 'ffmpeg' ? config.ffmpeg || 'ffmpeg' : '';
  if (configured && configured !== 'ffmpeg') {
    if (fs.existsSync(configured)) {
      if (name === 'ffmpeg') return configured;
      const sibling = path.join(path.dirname(configured), name + '.exe');
      if (fs.existsSync(sibling)) return sibling;
    }
  }
  const vendored = path.join(ROOT, 'vendor', 'ffmpeg', name + '.exe');
  if (fs.existsSync(vendored)) return vendored;
  return name === 'ffmpeg' ? configured || 'ffmpeg' : name;
}

const FFMPEG = toolPath('ffmpeg');
const FFPROBE = toolPath('ffprobe');
const MANUAL_DIR = path.join(ROOT, 'manual');
const TAKE_FILE_RE = /^[0-9]{2}-[0-9]{1,4}\.webm$/;
const TAKE_AUDIO_FILE_RE = /^[0-9]{2}-[0-9]{1,4}-a\.(webm|m4a|ogg)$/;
const CAMERA_TAKE_RE = /^[0-9]{2}-[0-9]{1,4}-c[0-9]\.webm$/i;
const ATTACH_FILE_RE = /^attach-[a-f0-9]{12}\.(webm|mp4|mov|mp3|wav|m4a|aac|ogg)$/;
function isClipFile(name) {
  const value = String(name || '');
  return TAKE_FILE_RE.test(value) || TAKE_AUDIO_FILE_RE.test(value) || CAMERA_TAKE_RE.test(value) || ATTACH_FILE_RE.test(value);
}

function isAudioOnlyExt(ext) {
  return ext === 'mp3' || ext === 'wav' || ext === 'm4a' || ext === 'aac' || ext === 'ogg';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
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
        text: paragraphs.map((p) => p.text).join(' ').slice(0, 20000),
        mtime: stat.mtimeMs,
      };
    });
}

function listScripts() {
  const items = scriptsFromDir(config.scriptsDir, 'file').concat(scriptsFromDir(MANUAL_DIR, 'manual'));
  const archived = readArchived();
  const shelf = new Set(archived.scenarios.map((p) => path.resolve(p).toLowerCase()));
  items.forEach((item) => {
    item.archived = shelf.has(path.resolve(item.path).toLowerCase());
  });
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

const ARCHIVED_PATH = path.join(ROOT, 'archived.json');

function readArchived() {
  let data = null;
  try {
    if (fs.existsSync(ARCHIVED_PATH)) data = JSON.parse(fs.readFileSync(ARCHIVED_PATH, 'utf8'));
  } catch (err) {
    data = null;
  }
  const clean = (list) => (Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v) : []);
  return {
    scenarios: clean(data && data.scenarios),
    recordings: clean(data && data.recordings),
  };
}

function writeArchived(data) {
  fs.writeFileSync(ARCHIVED_PATH, JSON.stringify(data, null, 2));
}

function setArchived(type, id, archived) {
  const data = readArchived();
  const key = type === 'scenario' ? 'scenarios' : 'recordings';
  const norm = (v) => (type === 'scenario' ? path.resolve(v).toLowerCase() : v);
  const target = norm(id);
  const rest = data[key].filter((v) => norm(v) !== target);
  if (archived) rest.push(type === 'scenario' ? path.resolve(id) : id);
  data[key] = rest;
  writeArchived(data);
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

function revealFile(filePath) {
  const opener = spawn('explorer.exe', ['/select,' + filePath]);
  opener.on('error', () => {});
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => {
      err.push(chunk);
      if (Buffer.concat(err).length > 200000) err.shift();
    });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') reject(fail(500, cmd + ' پیدا نشد'));
      else reject(error);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(err).toString('utf8').trim().split(/\r?\n/).slice(-6).join(' ');
        console.error(cmd + ' failed', detail);
        const base = path.basename(String(cmd)).toLowerCase();
        reject(fail(500, base.indexOf('ffprobe') === 0 ? 'مدت ویدیو خوانده نشد' : 'ساخت ویدیو نشد'));
      } else {
        resolve(Buffer.concat(out).toString('utf8'));
      }
    });
  });
}

function probeWithFfmpeg(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-nostats', '-progress', 'pipe:2', '-i', filePath, '-map', '0', '-c', 'copy', '-f', 'null', '-']);
    const err = [];
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', () => reject(fail(500, 'مدت ویدیو خوانده نشد')));
    child.on('close', () => {
      const text = Buffer.concat(err).toString('utf8');
      let duration = 0;
      const header = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
      if (header) duration = Number(header[1]) * 3600 + Number(header[2]) * 60 + Number(header[3]);
      const progress = [...text.matchAll(/out_time_us=(\d+)/g)];
      if (progress.length) duration = Math.max(duration, Number(progress[progress.length - 1][1]) / 1e6);
      const size = /Stream #[^\n]*Video:[^\n]*?\s(\d{2,5})x(\d{2,5})/.exec(text);
      if (!(duration > 0)) {
        reject(fail(500, 'مدت ویدیو خوانده نشد'));
        return;
      }
      resolve({
        duration,
        width: size ? Number(size[1]) : 0,
        height: size ? Number(size[2]) : 0,
        video: /Stream #[^\n]*Video:/.test(text),
        audio: /Stream #[^\n]*Audio:/.test(text),
      });
    });
  });
}

function probeMedia(filePath) {
  if (FFPROBE === 'ffprobe' && FFMPEG !== 'ffmpeg') return probeWithFfmpeg(filePath);
  return runProbe(filePath).catch(() => probeWithFfmpeg(filePath));
}

function runProbe(filePath) {
  return runProcess(FFPROBE, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-show_entries',
    'stream=width,height,codec_type',
    '-of',
    'json',
    filePath,
  ]).then((raw) => {
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch (err) {
      throw fail(500, 'مدت ویدیو خوانده نشد');
    }
    const duration = Number(data.format && data.format.duration);
    const streams = data.streams || [];
    const video = streams.find((stream) => stream.codec_type === 'video') || {};
    if (!(duration > 0)) throw fail(500, 'مدت ویدیو خوانده نشد');
    return {
      duration,
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      video: streams.some((stream) => stream.codec_type === 'video'),
      audio: streams.some((stream) => stream.codec_type === 'audio'),
    };
  });
}

function audioCompanionName(videoFile) {
  const match = /^([0-9]{2}-[0-9]{1,4})\.webm$/i.exec(String(videoFile || ''));
  if (!match) return '';
  return match[1] + '-a.webm';
}

async function extractAudioFile(srcPath, destPath) {
  await runProcess(FFMPEG, [
    '-y',
    '-hide_banner',
    '-i',
    srcPath,
    '-vn',
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    destPath,
  ]);
}

const WAVE_RATE = 50;
const waveMemo = new Map();

async function wavePeaksFor(filePath) {
  const stat = fs.statSync(filePath);
  const key = filePath + ':' + stat.size + ':' + stat.mtimeMs;
  if (waveMemo.has(key)) return waveMemo.get(key);
  const tmp = path.join(os.tmpdir(), 'reel-wave-' + crypto.randomBytes(4).toString('hex') + '.f32');
  try {
    await runProcess(FFMPEG, [
      '-y',
      '-hide_banner',
      '-i',
      filePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      'f32le',
      tmp,
    ]);
    const raw = fs.readFileSync(tmp);
    const count = Math.floor(raw.length / 4);
    const block = 8000 / WAVE_RATE;
    const bars = Math.ceil(count / block);
    const peaks = new Array(bars);
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const end = Math.min(count, (i + 1) * block);
      for (let j = i * block; j < end; j++) {
        const value = Math.abs(raw.readFloatLE(j * 4));
        if (value > max) max = value;
      }
      peaks[i] = Math.round(Math.min(1, max) * 1000) / 1000;
    }
    const result = { rate: WAVE_RATE, peaks };
    if (waveMemo.size > 64) waveMemo.clear();
    waveMemo.set(key, result);
    return result;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function ensureAudioLane(lanes) {
  const list = Array.isArray(lanes) ? lanes.slice() : [];
  if (list.some((lane) => lane && lane.kind === 'audio')) return list;
  list.push({ id: 'audio', label: 'صدا', kind: 'audio', band: 0, bands: 1, file: '' });
  return list;
}

function videoLaneCount(lanes) {
  const list = Array.isArray(lanes) ? lanes : [];
  const count = list.filter((lane) => lane && lane.kind !== 'audio' && lane.kind !== 'text' && lane.kind !== 'shape').length;
  return Math.max(1, count);
}

function cameraLayoutOf(session, doc) {
  const raw = session && session.cameraLayout ? session.cameraLayout : doc && doc.cameraLayout;
  if (raw === 'cut' || raw === 'split' || raw === 'look') return raw;
  return '';
}

function defaultVideoGuides(layout, cameras) {
  if (layout === 'cut' || layout === 'look') return false;
  if (layout === 'split') return true;
  return Array.isArray(cameras) && cameras.length > 1;
}

function resolvedVideoGuides(doc, session) {
  if (doc && typeof doc.videoGuides === 'boolean') return doc.videoGuides;
  const cameras =
    doc && Array.isArray(doc.cameras) && doc.cameras.length
      ? doc.cameras
      : session && Array.isArray(session.cameras)
        ? session.cameras
        : [];
  return defaultVideoGuides(cameraLayoutOf(session, doc), cameras);
}

function sessionForSlug(slug) {
  try {
    const sessionPath = path.join(TAKES_DIR, slug, 'session.json');
    if (!fs.existsSync(sessionPath)) return null;
    return readJsonFile(sessionPath);
  } catch (err) {
    return null;
  }
}

function presentCaptionDoc(doc, session) {
  const layout = cameraLayoutOf(session, doc);
  const next = Object.assign({}, doc);
  if (layout) next.cameraLayout = layout;
  if (typeof next.videoGuides !== 'boolean') {
    next.videoGuides = defaultVideoGuides(layout, next.cameras || (session && session.cameras));
  }
  return next;
}

function guidesRenderLanes(lanes, guidesOn) {
  const raw = Array.isArray(lanes) ? lanes.filter((lane) => lane) : [];
  const skip = new Set();
  raw.forEach((lane) => {
    if (lane.hidden || lane.kind === 'shape') skip.add(lane.id);
  });
  const list = raw.filter((lane) => !skip.has(lane.id));
  if (guidesOn) return { lanes: list, skip };
  const bands = list.filter((lane) => lane.kind === 'band');
  const keepId = bands.length ? bands[0].id : '';
  bands.forEach((lane) => {
    if (lane.id !== keepId) skip.add(lane.id);
  });
  const next = list
    .filter((lane) => !skip.has(lane.id))
    .map((lane) => {
      if (lane.kind === 'band') return Object.assign({}, lane, { kind: 'full', band: 0, bands: 1 });
      return lane;
    });
  return { lanes: next, skip };
}

function serveFile(req, res, filePath, contentType) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('یافت نشد');
      return;
    }
    const range = req.headers.range;
    function pipeRange(startAt, endAt, status, headers) {
      res.writeHead(status, headers);
      const stream = fs.createReadStream(filePath, { start: startAt, end: endAt });
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    }
    if (!range) {
      pipeRange(0, stat.size - 1, 200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      return;
    }
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.writeHead(416);
      res.end();
      return;
    }
    const start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });
      res.end();
      return;
    }
    pipeRange(start, end, 206, {
      'Content-Type': contentType,
      'Content-Length': end - start + 1,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
  });
}

function titleForSlug(slug, session) {
  try {
    const hit = listScripts().find((item) => path.basename(item.path, path.extname(item.path)) === slug);
    if (hit && hit.title) return hit.title;
  } catch (err) {
    // the scripts folder can be missing; the session title still works
  }
  if (session && session.title) return String(session.title).replace(/[\r\n]/g, ' ').trim().slice(0, 120);
  return slug;
}

function captionsPathFor(slug) {
  return path.join(TAKES_DIR, slug, 'captions.json');
}

function renderNames(slug) {
  if (!slug || !fs.existsSync(OUT_DIR)) return [];
  const prefix = slug + '-caption';
  return fs.readdirSync(OUT_DIR).filter((name) => {
    if (!name.startsWith(prefix) || !name.toLowerCase().endsWith('.mp4')) return false;
    const rest = name.slice(prefix.length);
    return rest === '.mp4' || rest.charAt(0) === '-';
  });
}

function latestRenderPath(slug) {
  const names = renderNames(slug);
  if (!names.length) return '';
  names.sort(
    (a, b) => fs.statSync(path.join(OUT_DIR, b)).mtimeMs - fs.statSync(path.join(OUT_DIR, a)).mtimeMs
  );
  return path.join(OUT_DIR, names[0]);
}

function renderPathFor(slug, fileName) {
  if (!fileName) return latestRenderPath(slug);
  const base = path.basename(String(fileName));
  const prefix = slug + '-caption';
  if (!base.startsWith(prefix) || !base.toLowerCase().endsWith('.mp4')) return '';
  const rest = base.slice(prefix.length);
  if (rest !== '.mp4' && rest.charAt(0) !== '-') return '';
  return path.join(OUT_DIR, base);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function readCaptions(slug) {
  const filePath = captionsPathFor(slug);
  if (!fs.existsSync(filePath)) return null;
  try {
    return readJsonFile(filePath);
  } catch (err) {
    return null;
  }
}

function writeCaptions(slug, doc) {
  const dir = path.join(TAKES_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(captionsPathFor(slug), JSON.stringify(doc, null, 2));
}

async function ensureTakeAudio(slug, videoFile, preferredAudio) {
  const dir = path.join(TAKES_DIR, slug);
  const preferred = String(preferredAudio || '');
  if (preferred && TAKE_AUDIO_FILE_RE.test(preferred)) {
    const preferredPath = path.join(dir, preferred);
    if (isInsideDir(dir, preferredPath) && fs.existsSync(preferredPath)) return preferred;
  }
  const audioName = audioCompanionName(videoFile);
  if (!audioName) return '';
  const audioPath = path.join(dir, audioName);
  if (fs.existsSync(audioPath)) return audioName;
  const videoPath = path.join(dir, videoFile);
  if (!fs.existsSync(videoPath)) return '';
  try {
    const info = await probeMedia(videoPath);
    if (!info.audio) return '';
    await extractAudioFile(videoPath, audioPath);
    return audioName;
  } catch (err) {
    return '';
  }
}

function defaultVideoLanes(cameras) {
  if (Array.isArray(cameras) && cameras.length > 1) {
    return cameras.map((label, index) => ({
      id: 'cam-' + index,
      label: label || 'دوربین ' + (index + 1),
      kind: 'band',
      band: index,
      bands: cameras.length,
      file: '',
      weight: 1,
      panY: 0.5,
    }));
  }
  return [{ id: 'main', label: 'ویدیو', kind: 'full', band: 0, bands: 1, file: '', weight: 1, panY: 0.5 }];
}

function isTakeAudioFileName(file) {
  return /^[0-9]{2}-[0-9]{1,4}-a\.webm$/i.test(String(file || ''));
}

function isTakeVideoFileName(file) {
  return /^[0-9]{2}-[0-9]{1,4}\.webm$/i.test(String(file || ''));
}

function cameraFilesOnSession(session, clip) {
  if (!clip) return [];
  const program = programTakeName(clip.file);
  if (!program || !TAKE_FILE_RE.test(program)) return [];
  const paragraphs = session && Array.isArray(session.paragraphs) ? session.paragraphs : [];
  const item =
    paragraphs.find((p) => p && Number(p.index) === Number(clip.paragraph) && String(p.accepted) === program) ||
    paragraphs.find((p) => p && String(p.accepted) === program);
  const files = item && Array.isArray(item.cameraFiles) ? item.cameraFiles : [];
  return files.map((name) => {
    const text = String(name || '');
    return isCameraTakeName(text) && programTakeName(text) === program ? text : '';
  });
}

function lookCutsOnSession(session, clip) {
  const paragraphs = session && Array.isArray(session.paragraphs) ? session.paragraphs : [];
  const program = programTakeName(clip && clip.file);
  const item =
    paragraphs.find((p) => p && Number(p.index) === Number(clip.paragraph) && program && String(p.accepted) === program) ||
    paragraphs.find((p) => p && Number(p.index) === Number(clip.paragraph));
  return sanitizeLookCuts(item && item.lookCuts);
}

function lookCutMap(session) {
  const paragraphs = session && Array.isArray(session.paragraphs) ? session.paragraphs : [];
  const out = {};
  paragraphs.forEach((item) => {
    if (!item || item.index == null) return;
    const cuts = sanitizeLookCuts(item.lookCuts);
    if (!cuts.length) return;
    out[String(Number(item.index))] = cuts;
  });
  return out;
}

function repairCaptionsDocument(doc, session) {
  if (!doc || typeof doc !== 'object') return doc;
  const cameras = Array.isArray(session && session.cameras)
    ? session.cameras.slice()
    : Array.isArray(doc.cameras)
      ? doc.cameras.slice()
      : [];
  if (cameras.length) doc.cameras = cameras;
  const layout = cameraLayoutOf(session, doc);
  if (layout) doc.cameraLayout = layout;
  if (typeof doc.videoGuides !== 'boolean') doc.videoGuides = defaultVideoGuides(layout, cameras);
  const clips = Array.isArray(doc.clips) ? doc.clips : [];
  clips.forEach((clip) => {
    if (!clip || !isTakeAudioFileName(clip.file)) return;
    if (clip.lane === 'audio') return;
    clip.lane = 'audio';
    clip.camera = 'audio';
    if (clip.volume == null || Number(clip.volume) < 0.01) clip.volume = 1;
  });
  if (layout === 'look') doc.lookCuts = lookCutMap(session);
  if ((layout === 'cut' || layout === 'look') && cameras.length > 1 && !doc.lanesTouched) {
    const interval = cutIntervalSeconds(
      session && session.cutSeconds != null ? session.cutSeconds : doc.cutSeconds
    );
    const laneIds = cameras.map((_, index) => 'cam-' + index);
    const hidden = new Map();
    (Array.isArray(doc.lanes) ? doc.lanes : []).forEach((lane) => {
      if (lane && lane.hidden) hidden.set(String(lane.id), true);
    });
    const cutLanes = cameras.map((label, index) => ({
      id: 'cam-' + index,
      label: label || 'دوربین ' + (index + 1),
      kind: 'full',
      band: 0,
      bands: 1,
      file: '',
      weight: 1,
      panY: 0.5,
      hidden: !!hidden.get('cam-' + index),
    }));
    const keep = (Array.isArray(doc.lanes) ? doc.lanes : []).filter(
      (lane) => lane && (lane.kind === 'audio' || lane.kind === 'text' || lane.kind === 'file' || lane.kind === 'shape')
    );
    doc.lanes = cutLanes.concat(keep);
    const filesFor = (clip) => cameraFilesOnSession(session, clip);
    if (layout === 'look') {
      doc.clips = expandLookClips(clips, laneIds, (clip) => lookCutsOnSession(session, clip), !!doc.lookSliced, filesFor);
      doc.lookSliced = true;
    } else {
      doc.clips = expandCutClips(clips, laneIds, interval, !!doc.cutSliced, filesFor);
      doc.clips = applyCutCameraFiles(doc.clips, laneIds, filesFor);
      doc.cutSeconds = interval;
      doc.cutSliced = true;
    }
    return doc;
  }
  clips.forEach((clip) => {
    if (!clip || !isTakeAudioFileName(clip.file) || clip.lane !== 'audio') return;
    const videoName = String(clip.file).replace(/-a\.webm$/i, '.webm');
    if (!isTakeVideoFileName(videoName)) return;
    const savedBands = (Array.isArray(doc.lanes) ? doc.lanes : []).filter((lane) => lane && lane.kind === 'band');
    const bandLanes = savedBands.length
      ? savedBands
      : !doc.lanesTouched && cameras.length > 1
        ? defaultVideoLanes(cameras)
        : [];
    const targets = bandLanes.filter((lane) => lane.kind === 'band');
    targets.forEach((lane) => {
      const exists = clips.some(
        (item) =>
          item &&
          item.lane === lane.id &&
          !isTakeAudioFileName(item.file) &&
          item.file === videoName &&
          Number(item.paragraph) === Number(clip.paragraph)
      );
      if (exists) return;
      clips.push({
        file: videoName,
        paragraph: Number(clip.paragraph),
        start: Number(clip.start) || 0,
        duration: Number(clip.duration) || 0,
        srcIn: Number(clip.srcIn) || 0,
        srcSpan: Number(clip.srcSpan) > 0 ? Number(clip.srcSpan) : Number(clip.duration) || 0,
        speed: Number(clip.speed) > 0 ? Number(clip.speed) : 1,
        volume: 0,
        camera: lane.id,
        lane: lane.id,
      });
    });
  });
  if (cameras.length > 1 && !doc.lanesTouched) {
    const defaults = defaultVideoLanes(cameras);
    const lanes = Array.isArray(doc.lanes) ? doc.lanes : [];
    const keep = lanes.filter((lane) => lane && (lane.kind === 'audio' || lane.kind === 'text' || lane.kind === 'file' || lane.kind === 'shape'));
    const existingBands = lanes.filter((lane) => lane && lane.kind === 'band');
    if (!existingBands.length) {
      doc.lanes = defaults.concat(keep);
    }
    const bandIds = new Set((Array.isArray(doc.lanes) ? doc.lanes : []).filter((lane) => lane && lane.kind === 'band').map((lane) => lane.id));
    const seeds = [];
    clips.forEach((clip) => {
      if (!clip || clip.lane === 'audio' || isTakeAudioFileName(clip.file)) return;
      if (!bandIds.has(clip.lane) && clip.lane !== 'main') return;
      const key = String(clip.paragraph) + ':' + round3(Number(clip.start) || 0);
      if (!seeds.some((seed) => String(seed.paragraph) + ':' + round3(Number(seed.start) || 0) === key)) {
        seeds.push(clip);
      }
    });
    const liveBands = (Array.isArray(doc.lanes) ? doc.lanes : []).filter((lane) => lane && lane.kind === 'band');
    liveBands.forEach((lane) => {
      seeds.forEach((seed) => {
        const key = String(seed.paragraph) + ':' + round3(Number(seed.start) || 0);
        const exists = clips.some(
          (clip) =>
            clip &&
            clip.lane === lane.id &&
            !isTakeAudioFileName(clip.file) &&
            String(clip.paragraph) + ':' + round3(Number(clip.start) || 0) === key
        );
        if (exists) return;
        clips.push({
          file: seed.file,
          paragraph: Number(seed.paragraph),
          start: Number(seed.start) || 0,
          duration: Number(seed.duration) || 0,
          srcIn: Number(seed.srcIn) || 0,
          srcSpan: Number(seed.srcSpan) > 0 ? Number(seed.srcSpan) : Number(seed.duration) || 0,
          speed: Number(seed.speed) > 0 ? Number(seed.speed) : 1,
          volume: 0,
          camera: lane.id,
          lane: lane.id,
        });
      });
    });
  }
  doc.clips = clips;
  return doc;
}

async function loadOrBuildCaptions(slug, force, durationMap) {
  if (!slug || !SLUG_RE.test(slug)) throw fail(400, 'اسم سناریو لازم است');
  const sessionPath = path.join(TAKES_DIR, slug, 'session.json');
  if (!fs.existsSync(sessionPath)) throw fail(404, 'هنوز جلسه‌ای ثبت نشده');
  const session = readJsonFile(sessionPath);
  const paragraphs = Array.isArray(session.paragraphs) ? session.paragraphs : [];
  const accepted = paragraphs.filter((item) => item && item.accepted && TAKE_FILE_RE.test(String(item.accepted)));
  if (!accepted.length) throw fail(400, 'هنوز ضبط قبول‌شده‌ای نیست');
  const existing = readCaptions(slug);
  const key = accepted.map((item) => item.index + ':' + item.accepted).join('|');
  const presentTakes = new Set();
  if (existing && Array.isArray(existing.clips)) {
    existing.clips.forEach((clip) => {
      const base = programTakeName(clip && clip.file);
      if (!base) return;
      presentTakes.add(Number(clip.paragraph) + ':' + base);
    });
  }
  const existingKey = accepted
    .filter((item) => presentTakes.has(Number(item.index) + ':' + String(item.accepted)))
    .map((item) => item.index + ':' + item.accepted)
    .join('|');
  const hasAudioLane =
    existing && Array.isArray(existing.lanes) && existing.lanes.some((lane) => lane && lane.kind === 'audio');
  const audioReady =
    hasAudioLane &&
    (existing.audioMigrated || existing.clips.some((clip) => clip && clip.lane === 'audio'));
  if (existing && existingKey === key && !force && audioReady) {
    if (!existing.title) existing.title = titleForSlug(slug, session);
    const before = JSON.stringify(existing);
    const repaired = repairCaptionsDocument(existing, session);
    if (JSON.stringify(repaired) !== before) {
      repaired.updatedAt = new Date().toISOString();
      writeCaptions(slug, repaired);
    }
    return repaired;
  }
  if (existing && existingKey === key && !force) {
    const lanes = ensureAudioLane(sanitizeLanes(existing.lanes || defaultVideoLanes(session.cameras || [])));
    const clips = Array.isArray(existing.clips) ? existing.clips.slice() : [];
    for (let i = 0; i < accepted.length; i++) {
      const item = accepted[i];
      const videoClip = clips.find(
        (clip) => TAKE_FILE_RE.test(String(clip.file || '')) && Number(clip.paragraph) === Number(item.index)
      );
      if (videoClip) videoClip.volume = 0;
      const already = clips.some(
        (clip) =>
          (clip.lane === 'audio' || TAKE_AUDIO_FILE_RE.test(String(clip.file || ''))) &&
          Number(clip.paragraph) === Number(item.index)
      );
      if (already) continue;
      const audioFile = await ensureTakeAudio(slug, item.accepted, item.acceptedAudio);
      if (!audioFile || !videoClip) continue;
      clips.push({
        file: audioFile,
        paragraph: Number(item.index),
        start: Number(videoClip.start) || 0,
        duration: Number(videoClip.duration) || 0,
        volume: 1,
        camera: 'audio',
        lane: 'audio',
      });
    }
    existing.lanes = lanes;
    existing.clips = clips;
    existing.audioMigrated = clips.some((clip) => clip && clip.lane === 'audio');
    existing.updatedAt = new Date().toISOString();
    if (!existing.title) existing.title = titleForSlug(slug, session);
    const repaired = repairCaptionsDocument(existing, session);
    writeCaptions(slug, repaired);
    return repaired;
  }
  let cursor = 0;
  const videoClips = [];
  const audioClips = [];
  const wordSource = [];
  const cameras = Array.isArray(session.cameras) ? session.cameras.slice() : [];
  const videoLanes = defaultVideoLanes(cameras);
  const primaryLane = videoLanes[0] ? videoLanes[0].id : 'main';
  for (let i = 0; i < accepted.length; i++) {
    const item = accepted[i];
    const filePath = path.join(TAKES_DIR, slug, item.accepted);
    if (!isInsideDir(path.join(TAKES_DIR, slug), filePath)) throw fail(403, 'مسیر فایل مجاز نیست');
    if (!fs.existsSync(filePath)) throw fail(404, 'فایل ضبط پیدا نشد');
    let duration = pickDuration(item.duration, durationMap && durationMap[item.accepted]);
    if (!(duration > 0.05)) {
      const info = await probeMedia(filePath);
      duration = info.duration;
    }
    const start = round3(cursor);
    const dur = round3(duration);
    videoClips.push({
      file: item.accepted,
      paragraph: Number(item.index),
      start,
      duration: dur,
      volume: 0,
      camera: primaryLane,
      lane: primaryLane,
    });
    wordSource.push({
      file: item.accepted,
      paragraph: Number(item.index),
      start,
      duration: dur,
      text: String(item.text || ''),
      wordTimings: Array.isArray(item.wordTimings) ? item.wordTimings : null,
    });
    const audioFile = await ensureTakeAudio(slug, item.accepted, item.acceptedAudio);
    if (audioFile) {
      audioClips.push({
        file: audioFile,
        paragraph: Number(item.index),
        start,
        duration: dur,
        volume: 1,
        camera: 'audio',
        lane: 'audio',
      });
    }
    cursor += duration;
  }
  const lanes = ensureAudioLane(videoLanes);
  const doc = {
    slug,
    title: titleForSlug(slug, session),
    style: existing && existing.style ? clampStyle(existing.style) : defaultStyle(),
    cameras,
    cameraLayout: cameraLayoutOf(session, null),
    videoGuides: defaultVideoGuides(cameraLayoutOf(session, null), cameras),
    lanes,
    clips: videoClips.concat(audioClips),
    words: buildWordsForClips(wordSource),
    free: !!session.free,
    audioMigrated: audioClips.length > 0,
    updatedAt: new Date().toISOString(),
  };
  const repaired = repairCaptionsDocument(doc, session);
  writeCaptions(slug, repaired);
  return repaired;
}

function saveCaptionEdits(slug, body) {
  if (!slug || !SLUG_RE.test(slug)) throw fail(400, 'اسم سناریو لازم است');
  const existing = readCaptions(slug);
  if (!existing || !Array.isArray(existing.clips) || !existing.clips.length) {
    throw fail(404, 'اول زیرنویس ساخته شود');
  }
  const lanes = ensureAudioLane(sanitizeLanes(body.lanes));
  const extraFiles = [];
  (Array.isArray(body.clips) ? body.clips : []).forEach((clip) => {
    const file = String(clip && clip.file || '');
    if (!ATTACH_FILE_RE.test(file) && !TAKE_AUDIO_FILE_RE.test(file) && !CAMERA_TAKE_RE.test(file)) return;
    const full = path.resolve(TAKES_DIR, slug, file);
    if (isInsideDir(path.join(TAKES_DIR, slug), full) && fs.existsSync(full)) extraFiles.push(file);
  });
  const clips = normalizeSavedClips(existing.clips, body.clips, extraFiles);
  const words = sanitizeWords(body.words, clips);
  const textLaneVisible = body.textLaneVisible !== false;
  const session = sessionForSlug(slug);
  const layout = cameraLayoutOf(session, existing);
  const doc = {
    slug,
    title: existing.title || titleForSlug(slug, null),
    free: !!existing.free,
    style: clampStyle(body.style || {}),
    cameras: Array.isArray(existing.cameras) ? existing.cameras.slice() : [],
    cameraLayout: layout,
    videoGuides: typeof body.videoGuides === 'boolean' ? body.videoGuides : resolvedVideoGuides(existing, null),
    lanes,
    clips,
    words: textLaneVisible ? words : [],
    textLaneVisible,
    wordsHidden: typeof body.wordsHidden === 'boolean' ? body.wordsHidden : !!existing.wordsHidden,
    lanesTouched: typeof body.lanesTouched === 'boolean' ? body.lanesTouched : !!existing.lanesTouched,
    cutSeconds:
      layout === 'cut'
        ? cutIntervalSeconds(session && session.cutSeconds != null ? session.cutSeconds : existing.cutSeconds)
        : existing.cutSeconds,
    cutSliced: layout === 'cut' ? true : !!existing.cutSliced,
    lookCuts: existing.lookCuts && typeof existing.lookCuts === 'object' ? existing.lookCuts : undefined,
    lookSliced: layout === 'look' ? true : !!existing.lookSliced,
    audioMigrated: Boolean(existing.audioMigrated || clips.some((clip) => clip && clip.lane === 'audio')),
    updatedAt: new Date().toISOString(),
  };
  writeCaptions(slug, doc);
  return doc;
}

function listArchive() {
  if (!fs.existsSync(TAKES_DIR)) return [];
  const shelf = new Set(readArchived().recordings);
  const items = fs
    .readdirSync(TAKES_DIR)
    .filter((slug) => SLUG_RE.test(slug))
    .map((slug) => {
      const sessionPath = path.join(TAKES_DIR, slug, 'session.json');
      if (!fs.existsSync(sessionPath)) return null;
      let session;
      try {
        session = readJsonFile(sessionPath);
      } catch (err) {
        return null;
      }
      const paragraphs = Array.isArray(session.paragraphs) ? session.paragraphs : [];
      const accepted = paragraphs.filter((item) => item && item.accepted);
      if (!accepted.length) return null;
      const captions = readCaptions(slug);
      const duration =
        captions && Array.isArray(captions.clips)
          ? captions.clips.reduce((sum, clip) => sum + (Number(clip.duration) || 0), 0)
          : null;
      return {
        slug,
        title: titleForSlug(slug, session),
        free: !!session.free,
        archived: shelf.has(slug),
        updatedAt: fs.statSync(sessionPath).mtimeMs,
        acceptedCount: accepted.length,
        paragraphCount: paragraphs.length,
        duration,
        hasRender: renderNames(slug).length > 0,
      };
    })
    .filter(Boolean);
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

function deleteRecording(slug) {
  if (!slug || !SLUG_RE.test(slug)) throw fail(400, 'اسم سناریو لازم است');
  const dir = path.resolve(TAKES_DIR, slug);
  if (!isInsideDir(TAKES_DIR, dir)) throw fail(403, 'این مسیر مجاز نیست');
  fs.rmSync(dir, { recursive: true, force: true });
  renderNames(slug).forEach((name) => {
    const rendered = path.resolve(OUT_DIR, name);
    if (isInsideDir(OUT_DIR, rendered) && fs.existsSync(rendered)) fs.rmSync(rendered, { force: true });
  });
  if (readArchived().recordings.includes(slug)) setArchived('recording', slug, false);
}

function cleanOverlays(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (!item || typeof item.png !== 'string' || !item.png) return;
    const x = Math.round(Number(item.x));
    const y = Math.round(Number(item.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const ranges = (Array.isArray(item.ranges) ? item.ranges : [])
      .map((range) => ({ start: Number(range && range.start), end: Number(range && range.end) }))
      .filter((range) => Number.isFinite(range.start) && range.end > range.start);
    if (!ranges.length) return;
    out.push({ x, y, png: item.png, ranges });
  });
  if (out.length > 400) throw fail(400, 'زیرنویس خیلی تکه‌تکه است');
  return out;
}

function writeOverlayPng(dir, index, raw) {
  const text = String(raw).replace(/^data:image\/png;base64,/, '');
  const buf = Buffer.from(text, 'base64');
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) throw fail(400, 'تصویر زیرنویس ساخته نشد');
  if (buf.length > 8 * 1024 * 1024) throw fail(400, 'تصویر زیرنویس خیلی بزرگ است');
  const file = path.join(dir, String(index) + '.png');
  fs.writeFileSync(file, buf);
  return file;
}

async function burnCaptions(slug, metrics, overlays, skipCaptions) {
  if (!slug || !SLUG_RE.test(slug)) throw fail(400, 'اسم سناریو لازم است');
  const doc = readCaptions(slug);
  if (!doc || !Array.isArray(doc.clips) || !doc.clips.length || !Array.isArray(doc.words)) {
    throw fail(404, 'اول زیرنویس را ذخیره کن');
  }
  if (!doc.words.length && !doc.free) throw fail(404, 'اول زیرنویس را ذخیره کن');
  if (doc.wordsHidden) skipCaptions = true;
  const style = clampStyle(doc.style);
  const session = sessionForSlug(slug);
  const guidesOn = resolvedVideoGuides(doc, session);
  const layoutNow = cameraLayoutOf(session, doc);
  const cutLayout = layoutNow === 'cut' || layoutNow === 'look';
  const plan = guidesRenderLanes(doc.lanes, cutLayout ? false : guidesOn);
  const font = resolveFont(style.font, PUBLIC_DIR) || resolveFont('vazir', PUBLIC_DIR);
  if (!font) throw fail(500, 'فونت زیرنویس پیدا نشد');
  const face = readFontFace(font.file);
  const metas = [];
  for (let i = 0; i < doc.clips.length; i++) {
    const clip = doc.clips[i];
    if (clip && (clip.shape === 'circle' || clip.shape === 'rect' || clip.shape === 'arrow')) continue;
    if (plan.skip.has(String(clip.lane || ''))) continue;
    if (!isClipFile(clip.file)) throw fail(400, 'اسم فایل ضبط درست نیست');
    const filePath = path.join(TAKES_DIR, slug, clip.file);
    if (!isInsideDir(path.join(TAKES_DIR, slug), filePath) || !fs.existsSync(filePath)) {
      throw fail(404, 'فایل ضبط پیدا نشد');
    }
    const info = await probeMedia(filePath);
    const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const srcIn = Math.max(0, Number(clip.srcIn) || 0);
    const srcSpan = Number(clip.srcSpan) > 0 ? Number(clip.srcSpan) : Number(clip.duration) || info.duration;
    const volume = clip.volume == null ? 1 : Number(clip.volume);
    const lanes = plan.lanes;
    const videoLanes = lanes.filter((item) => item && item.kind !== 'audio' && item.kind !== 'text' && item.kind !== 'shape');
    const lane = lanes.find((item) => item.id === clip.lane) || null;
    const isAudioLane = !!(lane && lane.kind === 'audio');
    const isTextLane = !!(lane && lane.kind === 'text');
    const keepsSound = !!(lane && lane.kind === 'file' && lane.withAudio && info.audio);
    const videoLaneIndex =
      isAudioLane || isTextLane
        ? -1
        : Math.max(
            0,
            videoLanes.findIndex((item) => item.id === (lane ? lane.id : videoLanes[0] && videoLanes[0].id))
          );
    let panX = lane ? Number(lane.panX) : 0.5;
    if (!Number.isFinite(panX)) panX = 0.5;
    let panY = lane ? Number(lane.panY) : 0.5;
    if (!Number.isFinite(panY)) panY = 0.5;
    metas.push({
      filePath,
      duration: Number(clip.duration) || info.duration,
      audio: info.audio,
      video: info.video,
      info,
      srcIn,
      srcSpan,
      speed,
      volume: isAudioLane || keepsSound ? volume : 0,
      start: Number(clip.start) || 0,
      laneIndex: videoLaneIndex,
      cropBands: lane && lane.kind === 'band' ? lane.bands : 0,
      cropBand: lane && lane.kind === 'band' ? lane.band : 0,
      panX: Math.min(1, Math.max(0, panX)),
      panY: Math.min(1, Math.max(0, panY)),
      zoom: lane ? Math.min(6, Math.max(1, Number(lane.zoom) || 1)) : 1,
      useAudio: isAudioLane || keepsSound,
      audioOnly: isAudioLane || (!info.video && !!info.audio),
    });
  }
  // Do not unmute studio camera/band video just because no audio lane clip remains.
  const visualMetas = metas.filter((meta) => !meta.audioOnly && meta.video !== false && Number(meta.laneIndex) >= 0);
  const sizeSource = visualMetas[0] || metas.find((meta) => meta.info && meta.info.width) || metas[0];
  const width = evenDim(sizeSource.info.width);
  const height = evenDim(sizeSource.info.height);
  if (width < 2 || height < 2) throw fail(500, 'اندازه‌ی ویدیو خوانده نشد');
  const sheet = skipCaptions ? [] : cleanOverlays(overlays);
  const useSheet = sheet.length > 0;
  const useAss = !skipCaptions && !useSheet;
  const assPath = useAss ? path.join(TAKES_DIR, slug, 'captions.ass') : '';
  if (useAss) {
    fs.writeFileSync(
      assPath,
      '\uFEFF' + buildAss(doc, width, height, face.family || font.name, metrics, face.bold),
      'utf8'
    );
  }
  const fontDir = useAss ? fs.mkdtempSync(path.join(os.tmpdir(), 'reel-font-')) : '';
  const sheetDir = useSheet ? fs.mkdtempSync(path.join(os.tmpdir(), 'reel-cap-')) : '';
  try {
    const sheetFiles = useSheet ? sheet.map((item, index) => writeOverlayPng(sheetDir, index, item.png)) : [];
    if (useAss) fs.copyFileSync(font.file, path.join(fontDir, path.basename(font.file)));
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outFile = path.join(OUT_DIR, uniqueRenderName(renderNames(slug), slug, new Date()));
    if (cutLayout) {
      metas.sort((a, b) => {
        const aVisual = Number(a.laneIndex) >= 0 && !a.audioOnly;
        const bVisual = Number(b.laneIndex) >= 0 && !b.audioOnly;
        if (aVisual && bVisual) return b.laneIndex - a.laneIndex;
        if (aVisual !== bVisual) return aVisual ? 1 : -1;
        return 0;
      });
    }
    const args = ['-y', '-hide_banner'];
    metas.forEach((meta) => {
      args.push('-i', meta.filePath);
    });
    sheetFiles.forEach((file) => {
      args.push('-loop', '1', '-i', file);
    });
    const lanes = plan.lanes;
    const vCount = videoLaneCount(lanes);
    const visualLanes = lanes.filter((item) => item && item.kind !== 'audio' && item.kind !== 'text' && item.kind !== 'shape');
    const laneWeights = visualLanes.map((item) => {
      const w = Number(item.weight);
      return Number.isFinite(w) && w > 0.02 ? w : 1;
    });
    const bandCrop = guidesOn && visualLanes.some((item) => item && item.kind === 'band' && Number(item.bands) > 1);
    let filter;
    if (cutLayout) {
      metas.forEach((meta) => {
        if (Number(meta.laneIndex) >= 0) {
          meta.laneIndex = 0;
          meta.cropBands = 0;
          meta.cropBand = 0;
        }
      });
      filter = stackFilter(metas, width, height, 1, assPath, fontDir, [1], useSheet ? sheet : null, metas.length);
    } else if (vCount > 1 || bandCrop) {
      filter = stackFilter(metas, width, height, vCount, assPath, fontDir, laneWeights, useSheet ? sheet : null, metas.length);
    } else {
      filter = concatFilter(metas, width, height, assPath, fontDir, useSheet ? sheet : null, metas.length);
    }
    args.push(
      '-filter_complex',
      filter,
      '-map',
      '[vout]',
      '-map',
      '[ac]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      outFile
    );
    await runProcess(FFMPEG, args);
    return { ok: true, file: path.basename(outFile) };
  } finally {
    if (fontDir) fs.rmSync(fontDir, { recursive: true, force: true });
    if (sheetDir) fs.rmSync(sheetDir, { recursive: true, force: true });
  }
}

async function splitAttachAudio(dir, full, duration) {
  const audioFile = 'attach-' + crypto.randomBytes(6).toString('hex') + '.m4a';
  const audioFull = path.join(dir, audioFile);
  await runProcess(FFMPEG, ['-y', '-hide_banner', '-i', full, '-vn', '-c:a', 'aac', '-b:a', '160k', audioFull]);
  let audioDuration = duration;
  try {
    const audioInfo = await probeMedia(audioFull);
    audioDuration = audioInfo.duration || duration;
  } catch (err) {}
  return { audioFile, audioDuration };
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

  if (pathname === '/api/manual-script' && req.method === 'DELETE') {
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
      fs.unlinkSync(resolved);
      setArchived('scenario', resolved, false);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/clip' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    const paragraph = parsed.searchParams.get('paragraph');
    const take = parsed.searchParams.get('take');
    const kind = String(parsed.searchParams.get('kind') || '') === 'audio' ? 'audio' : 'video';
    const cameraRaw = parsed.searchParams.get('camera');
    const cameraIndex = /^[0-9]$/.test(cameraRaw || '') ? cameraRaw : '';
    if (!slug || !SLUG_RE.test(slug) || !NUMBER_RE.test(paragraph || '') || !NUMBER_RE.test(take || '')) {
      sendJson(res, 400, { error: 'اسم سناریو، شماره پاراگراف و شماره ضبط لازم است' });
      return;
    }
    readRawBody(req)
      .then(async (buffer) => {
        const dir = path.join(TAKES_DIR, slug);
        fs.mkdirSync(dir, { recursive: true });
        const fileName = cameraIndex !== ''
          ? `${paragraph}-${take}-c${cameraIndex}.webm`
          : kind === 'audio'
            ? `${paragraph}-${take}-a.webm`
            : `${paragraph}-${take}.webm`;
        const full = path.join(dir, fileName);
        fs.writeFileSync(full, buffer);
        let audioFile = '';
        if (kind !== 'audio' && cameraIndex === '') {
          const companion = audioCompanionName(fileName);
          if (companion) {
            try {
              await extractAudioFile(full, path.join(dir, companion));
              audioFile = companion;
            } catch (err) {
              audioFile = '';
            }
          }
        }
        sendJson(res, 200, { file: fileName, audioFile });
      })
      .catch((err) => sendJson(res, 500, { error: err.message }));
    return;
  }

  if (pathname === '/api/open-export' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    if (!slug || !SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: 'اسم سناریو لازم است' });
      return;
    }
    const filePath = path.resolve(renderPathFor(slug, parsed.searchParams.get('file')));
    if (!filePath || !isInsideDir(OUT_DIR, filePath) || !fs.existsSync(filePath)) {
      sendJson(res, 404, { error: 'هنوز فایلی ساخته نشده' });
      return;
    }
    revealFile(filePath);
    sendJson(res, 200, { ok: true });
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

  if (pathname === '/api/archive' && req.method === 'GET') {
    try {
      sendJson(res, 200, listArchive());
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/archive-state' && req.method === 'POST') {
    readRawBody(req)
      .then((buffer) => {
        let body;
        try {
          body = JSON.parse(buffer.toString('utf8'));
        } catch (err) {
          sendJson(res, 400, { error: 'درخواست قابل خوندن نبود' });
          return;
        }
        const type = body && body.type === 'scenario' ? 'scenario' : body && body.type === 'recording' ? 'recording' : '';
        const id = String((body && body.id) || '');
        if (!type || !id) {
          sendJson(res, 400, { error: 'نوع و شناسه لازم است' });
          return;
        }
        if (type === 'scenario') {
          const resolved = path.resolve(id);
          const allowed = isInsideDir(config.scriptsDir, resolved) || isInsideDir(MANUAL_DIR, resolved);
          if (!allowed || !resolved.toLowerCase().endsWith('.md')) {
            sendJson(res, 403, { error: 'این مسیر مجاز نیست' });
            return;
          }
        } else if (!SLUG_RE.test(id)) {
          sendJson(res, 400, { error: 'اسم ضبط درست نیست' });
          return;
        }
        setArchived(type, id, !!body.archived);
        sendJson(res, 200, { ok: true });
      })
      .catch((err) => sendJson(res, 500, { error: err.message }));
    return;
  }

  if (pathname === '/api/recording' && req.method === 'DELETE') {
    try {
      deleteRecording(parsed.searchParams.get('slug'));
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/captions' && req.method === 'GET') {
    const slug = parsed.searchParams.get('slug');
    if (!slug || !SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: 'اسم سناریو لازم است' });
      return;
    }
    const doc = readCaptions(slug);
    if (!doc) {
      sendJson(res, 404, { error: 'زیرنویسی ذخیره نشده' });
      return;
    }
    const session = sessionForSlug(slug);
    const before = JSON.stringify(doc);
    const repaired = repairCaptionsDocument(doc, session);
    if (JSON.stringify(repaired) !== before) {
      repaired.updatedAt = new Date().toISOString();
      writeCaptions(slug, repaired);
    }
    const shown = presentCaptionDoc(repaired, session);
    sendJson(res, 200, Object.assign({}, shown, { hasRender: renderNames(slug).length > 0 }));
    return;
  }

  if (pathname === '/api/captions' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    readRawBody(req)
      .then((buffer) => {
        if (buffer.length > 2000000) {
          sendJson(res, 400, { error: 'حجم زیرنویس خیلی زیاد است' });
          return;
        }
        let body;
        try {
          body = JSON.parse(buffer.toString('utf8'));
        } catch (err) {
          sendJson(res, 400, { error: 'متن قابل خوندن نبود' });
          return;
        }
        try {
          sendJson(res, 200, saveCaptionEdits(slug, body));
        } catch (err) {
          sendJson(res, err.status || 500, { error: err.message });
        }
      })
      .catch((err) => sendJson(res, 500, { error: err.message }));
    return;
  }

  if (pathname === '/api/captions/build' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    const force = parsed.searchParams.get('force') === '1';
    readRawBody(req)
      .then((buffer) => {
        let durationMap = null;
        if (buffer.length) {
          try {
            const body = JSON.parse(buffer.toString('utf8'));
            if (body && body.durations && typeof body.durations === 'object') durationMap = body.durations;
          } catch (err) {
            durationMap = null;
          }
        }
        return loadOrBuildCaptions(slug, force, durationMap);
      })
      .then((doc) => sendJson(res, 200, doc))
      .catch((err) => sendJson(res, err.status || 500, { error: err.message }));
    return;
  }

  if (pathname === '/api/captions/render' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    readRawBody(req)
      .then((buffer) => {
        let metrics = null;
        let overlays = null;
        let skipCaptions = false;
        if (buffer.length) {
          try {
            const body = JSON.parse(buffer.toString('utf8'));
            if (body && Array.isArray(body.overlays)) overlays = body.overlays;
            if (body && body.skipCaptions) skipCaptions = true;
            if (body && (Array.isArray(body.widths) || Number(body.space) > 0)) metrics = body;
          } catch (err) {
            metrics = null;
            overlays = null;
          }
        }
        return burnCaptions(slug, metrics, overlays, skipCaptions);
      })
      .then((result) => sendJson(res, 200, result))
      .catch((err) => sendJson(res, err.status || 500, { error: err.message }));
    return;
  }

  if (pathname === '/api/render' && req.method === 'GET') {
    const slug = parsed.searchParams.get('slug');
    if (!slug || !SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: 'اسم سناریو لازم است' });
      return;
    }
    const filePath = path.resolve(renderPathFor(slug, parsed.searchParams.get('file')));
    if (!filePath || !isInsideDir(OUT_DIR, filePath)) {
      sendJson(res, 403, { error: 'این مسیر مجاز نیست' });
      return;
    }
    serveFile(req, res, filePath, 'video/mp4');
    return;
  }

  if (pathname === '/api/attach' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    if (!slug || !SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: 'اسم سناریو لازم است' });
      return;
    }
    const rawExt = String(parsed.searchParams.get('ext') || 'webm').toLowerCase();
    const split = String(parsed.searchParams.get('split') || '') === '1';
    const ext =
      rawExt === 'mp4' ||
      rawExt === 'mov' ||
      rawExt === 'webm' ||
      rawExt === 'mp3' ||
      rawExt === 'wav' ||
      rawExt === 'm4a' ||
      rawExt === 'aac' ||
      rawExt === 'ogg'
        ? rawExt
        : '';
    if (!ext) {
      sendJson(res, 400, { error: 'این نوع فایل قابل قبول نیست' });
      return;
    }
    readRawBody(req)
      .then(async (buffer) => {
        if (!buffer.length || buffer.length > 250 * 1024 * 1024) {
          sendJson(res, 400, { error: 'حجم فایل مناسب نیست' });
          return;
        }
        const dir = path.join(TAKES_DIR, slug);
        if (!isInsideDir(TAKES_DIR, path.resolve(dir))) {
          sendJson(res, 403, { error: 'این مسیر مجاز نیست' });
          return;
        }
        fs.mkdirSync(dir, { recursive: true });
        const file = 'attach-' + crypto.randomBytes(6).toString('hex') + '.' + ext;
        const full = path.join(dir, file);
        fs.writeFileSync(full, buffer);
        let duration = 0;
        let info = null;
        try {
          info = await probeMedia(full);
          duration = info.duration || 0;
        } catch (err) {
          duration = 0;
        }
        const payload = {
          file,
          duration,
          hasVideo: !!(info && info.video),
          hasAudio: !!(info && info.audio),
          audioOnly: isAudioOnlyExt(ext) || !!(info && info.audio && !info.video),
        };
        if (split && info && info.video && info.audio) {
          try {
            Object.assign(payload, await splitAttachAudio(dir, full, duration));
          } catch (err) {
            sendJson(res, 500, { error: 'صدای ویدیو جدا نشد' });
            return;
          }
        }
        sendJson(res, 200, payload);
      })
      .catch((err) => sendJson(res, 500, { error: err.message }));
    return;
  }

  if (pathname === '/api/attach-split' && req.method === 'POST') {
    const slug = parsed.searchParams.get('slug');
    const file = String(parsed.searchParams.get('file') || '');
    if (!slug || !SLUG_RE.test(slug) || !ATTACH_FILE_RE.test(file)) {
      sendJson(res, 400, { error: 'فایل مشخص نیست' });
      return;
    }
    const dir = path.join(TAKES_DIR, slug);
    const full = path.resolve(dir, file);
    if (!isInsideDir(dir, full) || !fs.existsSync(full)) {
      sendJson(res, 404, { error: 'فایل پیدا نشد' });
      return;
    }
    probeMedia(full)
      .then(async (info) => {
        if (!info.audio) {
          sendJson(res, 400, { error: 'این ویدیو صدا نداره' });
          return;
        }
        sendJson(res, 200, await splitAttachAudio(dir, full, info.duration || 0));
      })
      .catch(() => sendJson(res, 500, { error: 'صدای ویدیو جدا نشد' }));
    return;
  }

  if (pathname === '/api/wave' && req.method === 'GET') {
    const slug = parsed.searchParams.get('slug');
    const file = parsed.searchParams.get('file');
    if (!slug || !SLUG_RE.test(slug) || !file || !isClipFile(file)) {
      sendJson(res, 400, { error: 'فایل صدا مشخص نیست' });
      return;
    }
    const filePath = path.resolve(TAKES_DIR, slug, file);
    if (!isInsideDir(path.join(TAKES_DIR, slug), filePath) || !fs.existsSync(filePath)) {
      sendJson(res, 404, { error: 'فایل صدا پیدا نشد' });
      return;
    }
    wavePeaksFor(filePath)
      .then((wave) => sendJson(res, 200, wave))
      .catch(() => sendJson(res, 500, { error: 'موج صدا ساخته نشد' }));
    return;
  }

  if (pathname === '/api/take' && req.method === 'GET') {
    const slug = parsed.searchParams.get('slug');
    const file = parsed.searchParams.get('file');
    if (!slug || !SLUG_RE.test(slug) || !file || !isClipFile(file)) {
      sendJson(res, 400, { error: 'فایل ضبط مشخص نیست' });
      return;
    }
    const filePath = path.resolve(TAKES_DIR, slug, file);
    if (!isInsideDir(path.join(TAKES_DIR, slug), filePath)) {
      sendJson(res, 403, { error: 'این مسیر مجاز نیست' });
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    serveFile(req, res, filePath, type);
    return;
  }

  if (pathname.startsWith('/fonts/local/')) {
    const key = pathname.slice('/fonts/local/'.length).replace(/[^a-z0-9_-]/gi, '');
    if (!key) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('فونت پیدا نشد');
      return;
    }
    const font = resolveFont(key, PUBLIC_DIR);
    if (!font) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('فونت پیدا نشد');
      return;
    }
    serveFile(req, res, font.file, 'font/ttf');
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
