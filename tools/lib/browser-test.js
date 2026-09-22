'use strict';

const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowser() {
  const found = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error('نه کروم پیدا شد نه اج، این تست بدون یکی از این دو اجرا نمی‌شود');
  return found;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (err) {
      lastErr = err;
    }
    await wait(200);
  }
  throw lastErr || new Error(`timeout waiting for ${url}`);
}

async function pollUntil(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await wait(intervalMs || 250);
  }
  throw new Error('timeout waiting for condition');
}

function generateFakeAudioFile(destPath, durationSeconds) {
  // Chrome's fake audio device is silent by default (constant zero
  // amplitude). A slow amplitude envelope gives any level meter something
  // real to move against.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', `sine=frequency=1000:sample_rate=48000:duration=${durationSeconds || 12}`,
      '-af', 'volume=eval=frame:volume=0.4+0.35*sin(2*PI*t/6)',
      '-ac', '1',
      '-ar', '48000',
      '-c:a', 'pcm_s16le',
      destPath,
    ],
    { stdio: 'ignore' }
  );
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluate failed');
    }
    return result.result.value;
  }
}

async function connectCdp(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('page target پیدا نشد');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new CdpClient(ws);
}

// A plain child.kill() has occasionally left a fully bound, healthy node
// server running after a test failed and cleanup should have removed it
// (seen once in practice, cause not fully pinned down). taskkill /F /T is
// the reliable way to actually end a process tree on Windows, so tests use
// it instead of trusting the softer Node API to hold up under a failure.
function killHard(proc) {
  if (!proc || proc.pid == null) return;
  try {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/F', '/T'], { stdio: 'ignore' });
  } catch (e) {
    // best effort, the process may already be gone
  }
}

function launchBrowser({ cdpPort, userDataDir, fakeAudioPath, url }) {
  const browser = findBrowser();
  return spawn(
    browser,
    [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--headless=new',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeAudioPath}`,
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ],
    { stdio: 'ignore' }
  );
}

module.exports = {
  findBrowser,
  wait,
  waitForHttp,
  pollUntil,
  generateFakeAudioFile,
  CdpClient,
  connectCdp,
  launchBrowser,
  killHard,
};
