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
  killHard,
} = require('./lib/browser-test');

const ROOT = path.join(__dirname, '..');
const CDP_PORT = 9333;
const APP_PORT = 7182;

async function main() {
  const appUrl = `http://127.0.0.1:${APP_PORT}/`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-studio-devices-'));
  const userDataDir = path.join(tempRoot, 'chrome');
  fs.mkdirSync(userDataDir, { recursive: true });
  const fakeAudioPath = path.join(tempRoot, 'fake-mic.wav');
  generateFakeAudioFile(fakeAudioPath, 12);

  // An isolated port and config, so this never collides with a real
  // reel-studio instance the owner might already have open (it did once).
  const configPath = path.join(tempRoot, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      port: APP_PORT,
      scriptsDir: path.join(ROOT, 'tools', 'fixtures'),
      takesDir: path.join(tempRoot, 'takes'),
      outDir: path.join(tempRoot, 'out'),
      assetsDir: path.join(tempRoot, 'assets'),
    })
  );

  const serverProc = spawn('node', ['server.js'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { REEL_CONFIG_PATH: configPath }),
  });
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

    // The audio graph needs a moment to start producing real samples after
    // getUserMedia resolves; sampling immediately can catch it still at its
    // silent startup value and make the "the meter changes" assertion flaky.
    await wait(500);
    const sample1 = await cdp.evaluate('window.__reel.meterValue');
    await wait(500);
    const sample2 = await cdp.evaluate('window.__reel.meterValue');

    console.log('cameras:', counts.cameras, 'mics:', counts.mics);
    console.log('meter sample 1:', sample1, 'meter sample 2:', sample2);

    assert.notStrictEqual(sample1, sample2, 'meter value did not change across two samples 500ms apart');

    console.log('OK: phase 2 self test passed');
  } finally {
    killHard(chromeProc);
    killHard(serverProc);
    await wait(300);
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
