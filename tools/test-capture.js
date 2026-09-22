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
const CDP_PORT = 9334;
const APP_PORT = 7181;
const SLUG = 'sample-script';

function dispatchKey(cdp, code, key) {
  return cdp.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', {code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, bubbles: true}))`
  );
}

async function recordAndReview(cdp) {
  await dispatchKey(cdp, 'Space', ' ');
  await pollUntil(async () => (await cdp.evaluate('window.__reelCapture.phase')) === 'recording', 8000, 200);
  await wait(600);
  await dispatchKey(cdp, 'Space', ' ');
  await pollUntil(async () => (await cdp.evaluate('window.__reelCapture.phase')) === 'review', 8000, 200);
}

async function main() {
  const appUrl = `http://127.0.0.1:${APP_PORT}/`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-studio-capture-'));
  const takesDir = path.join(tempRoot, 'takes');
  const userDataDir = path.join(tempRoot, 'chrome');
  fs.mkdirSync(userDataDir, { recursive: true });
  const fakeAudioPath = path.join(tempRoot, 'fake-mic.wav');
  generateFakeAudioFile(fakeAudioPath, 30);

  const configPath = path.join(tempRoot, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      port: APP_PORT,
      scriptsDir: path.join(ROOT, 'tools', 'fixtures'),
      takesDir,
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

    await pollUntil(
      async () => (await cdp.evaluate('window.__reel ? window.__reel.cameras.length : 0')) >= 1,
      15000,
      300
    );

    await pollUntil(
      async () => (await cdp.evaluate('document.querySelectorAll("#script-list button").length')) >= 1,
      10000,
      300
    );
    await cdp.evaluate('document.querySelector("#script-list button").click()');

    await pollUntil(
      async () => (await cdp.evaluate('window.__reelCapture ? window.__reelCapture.paragraphs.length : 0')) === 3,
      10000,
      300
    );
    await pollUntil(async () => (await cdp.evaluate('window.__reelCapture.phase')) === 'ready', 5000, 200);

    // Paragraph 1: record and accept straight away.
    await recordAndReview(cdp);
    await dispatchKey(cdp, 'Enter', 'Enter');
    await pollUntil(async () => (await cdp.evaluate('window.__reelCapture.current')) === 1, 5000, 200);

    // Paragraph 2: record, retake, then record again and accept. This is
    // the case the self test cares about: the accepted take must be the
    // later file, and the first (discarded) take must still be on disk.
    await recordAndReview(cdp);
    await dispatchKey(cdp, 'r', 'r');
    await pollUntil(async () => (await cdp.evaluate('window.__reelCapture.phase')) === 'ready', 5000, 200);
    await recordAndReview(cdp);
    await dispatchKey(cdp, 'Enter', 'Enter');
    await pollUntil(async () => (await cdp.evaluate('window.__reelCapture.current')) === 2, 5000, 200);

    // Paragraph 3: record and accept, finishing the session.
    await recordAndReview(cdp);
    await dispatchKey(cdp, 'Enter', 'Enter');
    await pollUntil(async () => (await cdp.evaluate('window.__reelCapture.phase')) === 'done', 5000, 200);

    await wait(300); // let the last session.json write land on disk

    const clipDir = path.join(takesDir, SLUG);
    const files = fs.readdirSync(clipDir).filter((f) => f.endsWith('.webm'));
    console.log('clip files:', files);
    assert.ok(files.length >= 4, `expected at least 4 clip files, got ${files.length}`);
    for (const f of files) {
      const size = fs.statSync(path.join(clipDir, f)).size;
      assert.ok(size > 0, `clip ${f} is empty`);
    }

    const session = JSON.parse(fs.readFileSync(path.join(clipDir, 'session.json'), 'utf8'));
    const accepted = session.paragraphs.filter((p) => p.accepted);
    console.log('session paragraphs:', JSON.stringify(session.paragraphs));
    assert.strictEqual(accepted.length, 3, `expected exactly 3 accepted takes, got ${accepted.length}`);

    const retaken = session.paragraphs[1];
    assert.strictEqual(retaken.takes.length, 2, `expected 2 takes for the retaken paragraph, got ${retaken.takes.length}`);
    assert.strictEqual(
      retaken.accepted,
      retaken.takes[retaken.takes.length - 1],
      'accepted take for the retaken paragraph is not the later file'
    );

    console.log('OK: phase 3 self test passed');
  } finally {
    if (chromeProc) chromeProc.kill();
    serverProc.kill();
    await wait(500);
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
