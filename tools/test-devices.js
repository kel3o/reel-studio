'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const CDP_PORT = 9333;

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

function readPort() {
  const configPath = path.join(ROOT, 'config.json');
  const examplePath = path.join(ROOT, 'config.example.json');
  const file = fs.existsSync(configPath) ? configPath : examplePath;
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  return config.port || 7180;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateFakeAudioFile(destPath) {
  // Chrome's fake audio device is silent by default (constant zero
  // amplitude), which the level meter would read as a flat -100 dBFS
  // forever. A slow amplitude envelope gives it something real to move
  // against, which is what the self test needs to prove the meter is alive.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'sine=frequency=1000:sample_rate=48000:duration=12',
      '-af', 'volume=eval=frame:volume=0.4+0.35*sin(2*PI*t/6)',
      '-ac', '1',
      '-ar', '48000',
      '-c:a', 'pcm_s16le',
      destPath,
    ],
    { stdio: 'ignore' }
  );
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      return res;
    } catch (err) {
      lastErr = err;
    }
    await wait(200);
  }
  throw lastErr || new Error(`timeout waiting for ${url}`);
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

async function main() {
  const browser = findBrowser();
  const appPort = readPort();
  const appUrl = `http://127.0.0.1:${appPort}/`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-studio-chrome-'));
  const fakeAudioPath = path.join(userDataDir, 'fake-mic.wav');
  generateFakeAudioFile(fakeAudioPath);

  const serverProc = spawn('node', ['server.js'], { cwd: ROOT, stdio: 'ignore' });
  let chromeProc;

  try {
    await waitForHttp(appUrl, 15000);

    chromeProc = spawn(
      browser,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--headless=new',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${fakeAudioPath}`,
        '--autoplay-policy=no-user-gesture-required',
        '--no-first-run',
        '--no-default-browser-check',
        appUrl,
      ],
      { stdio: 'ignore' }
    );

    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 15000);
    const cdp = await connectCdp(CDP_PORT);
    await cdp.send('Runtime.enable');

    const deadline = Date.now() + 15000;
    let cameras = 0;
    let mics = 0;
    while (Date.now() < deadline) {
      cameras = await cdp.evaluate('window.__reel ? window.__reel.cameras.length : 0');
      mics = await cdp.evaluate('window.__reel ? window.__reel.mics.length : 0');
      if (cameras >= 1 && mics >= 1) break;
      await wait(300);
    }

    assert.ok(cameras >= 1, `expected at least one camera, got ${cameras}`);
    assert.ok(mics >= 1, `expected at least one microphone, got ${mics}`);

    const sample1 = await cdp.evaluate('window.__reel.meterValue');
    await wait(500);
    const sample2 = await cdp.evaluate('window.__reel.meterValue');

    console.log('cameras:', cameras, 'mics:', mics);
    console.log('meter sample 1:', sample1, 'meter sample 2:', sample2);

    assert.notStrictEqual(sample1, sample2, 'meter value did not change across two samples 500ms apart');

    console.log('OK: phase 2 self test passed');
  } finally {
    if (chromeProc) chromeProc.kill();
    serverProc.kill();
    await wait(500);
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
