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
  buildAss,
  concatFilter,
  stackFilter,
  evenDim,
  resolveFont,
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
const ATTACH_FILE_RE = /^attach-[a-f0-9]{12}\.(webm|mp4|mov|mp3|wav|m4a|aac|ogg)$/;
function isClipFile(name) {
  const value = String(name || '');
  return TAKE_FILE_RE.test(value) || TAKE_AUDIO_FILE_RE.test(value) || ATTACH_FILE_RE.test(value);
}

function isAudioOnlyExt(ext) {
  return ext === 'mp3' || ext === 'wav' || ext === 'm4a' || ext === 'aac' || ext === 'ogg';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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

function probeMedia(filePath) {
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

function ensureAudioLane(lanes) {
  const list = Array.isArray(lanes) ? lanes.slice() : [];
  if (list.some((lane) => lane && lane.kind === 'audio')) return list;
  list.push({ id: 'audio', label: 'صدا', kind: 'audio', band: 0, bands: 1, file: '' });
  return list;
}

function videoLaneCount(lanes) {
  const list = Array.isArray(lanes) ? lanes : [];
  const count = list.filter((lane) => lane && lane.kind !== 'audio').length;
  return Math.max(1, count);
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

function renderPathFor(slug) {
  return path.join(OUT_DIR, slug + '-caption.mp4');
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
    }));
  }
  return [{ id: 'main', label: 'ویدیو', kind: 'full', band: 0, bands: 1, file: '' }];
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
  const existingKey =
    existing && Array.isArray(existing.clips)
      ? existing.clips
          .filter((clip) => TAKE_FILE_RE.test(String(clip.file || '')))
          .map((clip) => clip.paragraph + ':' + clip.file)
          .join('|')
      : '';
  const hasAudioLane =
    existing && Array.isArray(existing.lanes) && existing.lanes.some((lane) => lane && lane.kind === 'audio');
  if (existing && existingKey === key && !force && hasAudioLane) {
    if (!existing.title) existing.title = titleForSlug(slug, session);
    return existing;
  }
  if (existing && existingKey === key && !force && !hasAudioLane) {
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
    existing.updatedAt = new Date().toISOString();
    if (!existing.title) existing.title = titleForSlug(slug, session);
    writeCaptions(slug, existing);
    return existing;
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
    lanes,
    clips: videoClips.concat(audioClips),
    words: buildWordsForClips(wordSource),
    updatedAt: new Date().toISOString(),
  };
  writeCaptions(slug, doc);
  return doc;
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
    if (!ATTACH_FILE_RE.test(file) && !TAKE_AUDIO_FILE_RE.test(file)) return;
    const full = path.resolve(TAKES_DIR, slug, file);
    if (isInsideDir(path.join(TAKES_DIR, slug), full) && fs.existsSync(full)) extraFiles.push(file);
  });
  const clips = normalizeSavedClips(existing.clips, body.clips, extraFiles);
  const words = sanitizeWords(body.words, clips);
  if (!words.length) throw fail(400, 'کلمه‌ای برای زیرنویس نمانده');
  const doc = {
    slug,
    title: existing.title || titleForSlug(slug, null),
    style: clampStyle(body.style || {}),
    cameras: Array.isArray(existing.cameras) ? existing.cameras.slice() : [],
    lanes,
    clips,
    words,
    updatedAt: new Date().toISOString(),
  };
  writeCaptions(slug, doc);
  return doc;
}

function listArchive() {
  if (!fs.existsSync(TAKES_DIR)) return [];
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
        updatedAt: fs.statSync(sessionPath).mtimeMs,
        acceptedCount: accepted.length,
        paragraphCount: paragraphs.length,
        duration,
        hasRender: fs.existsSync(renderPathFor(slug)),
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
  const rendered = path.resolve(renderPathFor(slug));
  if (isInsideDir(OUT_DIR, rendered) && fs.existsSync(rendered)) fs.rmSync(rendered, { force: true });
}

async function burnCaptions(slug, metrics) {
  if (!slug || !SLUG_RE.test(slug)) throw fail(400, 'اسم سناریو لازم است');
  const doc = readCaptions(slug);
  if (!doc || !Array.isArray(doc.clips) || !doc.clips.length || !Array.isArray(doc.words) || !doc.words.length) {
    throw fail(404, 'اول زیرنویس را ذخیره کن');
  }
  const style = clampStyle(doc.style);
  const font = resolveFont(style.font, PUBLIC_DIR) || resolveFont('vazir', PUBLIC_DIR);
  if (!font) throw fail(500, 'فونت زیرنویس پیدا نشد');
  const metas = [];
  for (let i = 0; i < doc.clips.length; i++) {
    const clip = doc.clips[i];
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
    const lanes = Array.isArray(doc.lanes) ? doc.lanes : [];
    const videoLanes = lanes.filter((item) => item && item.kind !== 'audio');
    const lane = lanes.find((item) => item.id === clip.lane) || null;
    const isAudioLane = !!(lane && lane.kind === 'audio');
    const videoLaneIndex = isAudioLane
      ? -1
      : Math.max(
          0,
          videoLanes.findIndex((item) => item.id === (lane ? lane.id : videoLanes[0] && videoLanes[0].id))
        );
    metas.push({
      filePath,
      duration: Number(clip.duration) || info.duration,
      audio: info.audio,
      video: info.video,
      info,
      srcIn,
      srcSpan,
      speed,
      volume: isAudioLane ? volume : 0,
      start: Number(clip.start) || 0,
      laneIndex: videoLaneIndex,
      cropBands: lane && lane.kind === 'band' ? lane.bands : 0,
      cropBand: lane && lane.kind === 'band' ? lane.band : 0,
      useAudio: isAudioLane,
      audioOnly: isAudioLane || (!info.video && !!info.audio),
    });
  }
  const visualMetas = metas.filter((meta) => !meta.audioOnly && meta.video !== false && Number(meta.laneIndex) >= 0);
  const sizeSource = visualMetas[0] || metas.find((meta) => meta.info && meta.info.width) || metas[0];
  const width = evenDim(sizeSource.info.width);
  const height = evenDim(sizeSource.info.height);
  if (width < 2 || height < 2) throw fail(500, 'اندازه‌ی ویدیو خوانده نشد');
  const assPath = path.join(TAKES_DIR, slug, 'captions.ass');
  fs.writeFileSync(assPath, '\uFEFF' + buildAss(doc, width, height, font.name, metrics), 'utf8');
  const fontDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-font-'));
  try {
    fs.copyFileSync(font.file, path.join(fontDir, path.basename(font.file)));
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outFile = renderPathFor(slug);
    const args = ['-y', '-hide_banner'];
    metas.forEach((meta) => {
      args.push('-i', meta.filePath);
    });
    const lanes = Array.isArray(doc.lanes) ? doc.lanes : [];
    const vCount = videoLaneCount(lanes);
    const filter =
      vCount > 1
        ? stackFilter(metas, width, height, vCount, assPath, fontDir)
        : concatFilter(metas, width, height, assPath, fontDir);
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
    fs.rmSync(fontDir, { recursive: true, force: true });
  }
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
    if (!slug || !SLUG_RE.test(slug) || !NUMBER_RE.test(paragraph || '') || !NUMBER_RE.test(take || '')) {
      sendJson(res, 400, { error: 'اسم سناریو، شماره پاراگراف و شماره ضبط لازم است' });
      return;
    }
    readRawBody(req)
      .then((buffer) => {
        const dir = path.join(TAKES_DIR, slug);
        fs.mkdirSync(dir, { recursive: true });
        const fileName = kind === 'audio' ? `${paragraph}-${take}-a.webm` : `${paragraph}-${take}.webm`;
        fs.writeFileSync(path.join(dir, fileName), buffer);
        sendJson(res, 200, { file: fileName });
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
    const filePath = path.resolve(renderPathFor(slug));
    if (!isInsideDir(OUT_DIR, filePath) || !fs.existsSync(filePath)) {
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
    sendJson(res, 200, Object.assign({}, doc, { hasRender: fs.existsSync(renderPathFor(slug)) }));
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
        if (buffer.length) {
          try {
            const body = JSON.parse(buffer.toString('utf8'));
            if (body && (Array.isArray(body.widths) || Number(body.space) > 0)) metrics = body;
          } catch (err) {
            metrics = null;
          }
        }
        return burnCaptions(slug, metrics);
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
    const filePath = path.resolve(renderPathFor(slug));
    if (!isInsideDir(OUT_DIR, filePath)) {
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
          const audioFile = 'attach-' + crypto.randomBytes(6).toString('hex') + '.m4a';
          const audioFull = path.join(dir, audioFile);
          try {
            await runProcess(FFMPEG, [
              '-y',
              '-hide_banner',
              '-i',
              full,
              '-vn',
              '-c:a',
              'aac',
              '-b:a',
              '160k',
              audioFull,
            ]);
            let audioDuration = duration;
            try {
              const audioInfo = await probeMedia(audioFull);
              audioDuration = audioInfo.duration || duration;
            } catch (err) {}
            payload.audioFile = audioFile;
            payload.audioDuration = audioDuration;
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
