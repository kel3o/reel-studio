'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const {
  wait,
  waitForHttp,
  pollUntil,
  generateFakeAudioFile,
  connectCdp,
  launchBrowser,
} = require('./lib/browser-test');

const ROOT = path.join(__dirname, '..');
const CDP_PORT = 9333;

function readPort() {
  const configPath = path.join(ROOT, 'config.json');
  const examplePath = path.join(ROOT, 'config.example.json');
  const file = fs.existsSync(configPath) ? configPath : examplePath;
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  return config.port || 7180;
}

async function main() {
  const appPort = readPort();
  const appUrl = `http://127.0.0.1:${appPort}/`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-studio-chrome-'));
  const fakeAudioPath = path.join(userDataDir, 'fake-mic.wav');
  generateFakeAudioFile(fakeAudioPath, 12);

  const serverProc = spawn('node', ['server.js'], { cwd: ROOT, stdio: 'ignore' });
  let chromeProc;

  try {
    await waitForHttp(appUrl, 15000);

    chromeProc = launchBrowser({ cdpPort: CDP_PORT, userDataDir, fakeAudioPath, url: appUrl });

    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 15000);
    const cdp = await connectCdp(CDP_PORT);
    await cdp.send('Runtime.enable');

    const counts = await pollUntil(
      async () => {
        const cameras = await cdp.evaluate('window.__reel ? window.__reel.cameras.length : 0');
        const mics = await cdp.evaluate('window.__reel ? window.__reel.mics.length : 0');
        return cameras >= 1 && mics >= 1 ? { cameras, mics } : null;
      },
      15000,
      300
    );

    assert.ok(counts.cameras >= 1, `expected at least one camera, got ${counts.cameras}`);
    assert.ok(counts.mics >= 1, `expected at least one microphone, got ${counts.mics}`);

    const sample1 = await cdp.evaluate('window.__reel.meterValue');
    await wait(500);
    const sample2 = await cdp.evaluate('window.__reel.meterValue');

    console.log('cameras:', counts.cameras, 'mics:', counts.mics);
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
