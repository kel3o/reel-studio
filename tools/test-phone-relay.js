'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 7195;

function clientFrame(opcode, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
  const header = Buffer.alloc(2);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | payload.length;
  return Buffer.concat([header, mask, masked]);
}

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/phone-ws',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.on('error', () => {});
      const messages = [];
      let buffer = Buffer.alloc(0);
      let waiter = null;
      function poke() {
        if (waiter && messages.length) {
          const done = waiter;
          waiter = null;
          done(messages.shift());
        }
      }
      function consume() {
        while (buffer.length >= 2) {
          const opcode = buffer[0] & 0x0f;
          let len = buffer[1] & 0x7f;
          let offset = 2;
          if (len === 126) {
            if (buffer.length < 4) return;
            len = buffer.readUInt16BE(2);
            offset = 4;
          }
          if (buffer.length < offset + len) return;
          const payload = buffer.subarray(offset, offset + len);
          buffer = buffer.subarray(offset + len);
          if (opcode === 0x1 || opcode === 0x2) {
            messages.push({ binary: opcode === 0x2, data: Buffer.from(payload) });
            poke();
          }
        }
      }
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        consume();
      });
      resolve({
        sendText(text) {
          socket.write(clientFrame(0x1, Buffer.from(text)));
        },
        sendBinary(buf) {
          socket.write(clientFrame(0x2, buf));
        },
        next() {
          if (messages.length) return Promise.resolve(messages.shift());
          return new Promise((done) => {
            waiter = done;
          });
        },
        end() {
          socket.end();
        },
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path: pathname }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        });
      })
      .on('error', reject);
  });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-phone-'));
  const configPath = path.join(tempRoot, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      port: PORT,
      phonePort: PORT + 1,
      scriptsDir: path.join(ROOT, 'tools', 'fixtures'),
      takesDir: path.join(tempRoot, 'takes'),
      outDir: path.join(tempRoot, 'out'),
      assetsDir: path.join(tempRoot, 'assets'),
    })
  );
  const serverProc = spawn('node', ['server.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { REEL_CONFIG_PATH: configPath }),
  });

  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await getJson(PORT, '/api/phone-link');
        if (res.status === 200) {
          const link = JSON.parse(res.body);
          assert.strictEqual(typeof link.connected, 'boolean');
          assert.strictEqual(typeof link.url, 'string');
          up = true;
          break;
        }
      } catch (err) {
        // server still booting
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(up, 'phone link endpoint did not come up');

    const page = await getJson(PORT, '/phone');
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('دوربین موبایل'));

    function withTimeout(promise, label) {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout ' + label)), 8000)),
      ]);
    }

    const phoneA = await withTimeout(connectClient(PORT), 'phoneA connect');
    const phoneB = await withTimeout(connectClient(PORT), 'phoneB connect');
    const studio = await withTimeout(connectClient(PORT), 'studio connect');
    phoneA.sendText(JSON.stringify({ role: 'phone', id: 'phonea1' }));
    phoneB.sendText(JSON.stringify({ role: 'phone', id: 'phoneb2' }));
    const helloA = JSON.parse((await withTimeout(phoneA.next(), 'helloA')).data.toString());
    const helloB = JSON.parse((await withTimeout(phoneB.next(), 'helloB')).data.toString());
    assert.strictEqual(helloA.type, 'hello');
    assert.strictEqual(helloB.type, 'hello');
    assert.notStrictEqual(helloA.id, helloB.id);

    studio.sendText(JSON.stringify({ role: 'studio' }));
    let status;
    for (let i = 0; i < 6; i++) {
      const msg = JSON.parse((await withTimeout(studio.next(), 'studio msg ' + i)).data.toString());
      if (msg.type === 'phone-status') status = msg;
      if (status && status.phones && status.phones.length >= 2) break;
    }
    assert.ok(status && status.connected);
    assert.ok(status.phones.length >= 2, 'expected two live phones');

    async function nextType(client, type, label) {
      for (let i = 0; i < 6; i++) {
        const msg = JSON.parse((await withTimeout(client.next(), label + ' ' + i)).data.toString());
        if (msg.type === type) return msg;
      }
      throw new Error('no ' + type + ' for ' + label);
    }
    const restartA = await nextType(phoneA, 'rtc-restart', 'restartA');
    const restartB = await nextType(phoneB, 'rtc-restart', 'restartB');
    assert.strictEqual(restartA.type, 'rtc-restart');
    assert.strictEqual(restartB.type, 'rtc-restart');

    const frame = Buffer.concat([Buffer.from([3]), Buffer.alloc(8), Buffer.from('jpeg-bytes')]);
    phoneA.sendBinary(frame);
    const got = await withTimeout(studio.next(), 'frame');
    assert.ok(got.binary);
    const idLen = got.data[0];
    const frameId = got.data.subarray(1, 1 + idLen).toString();
    assert.strictEqual(frameId, helloA.id);
    assert.ok(got.data.subarray(1 + idLen).equals(frame));

    studio.sendText(
      JSON.stringify({
        type: 'teleprompter',
        visible: true,
        scrolling: true,
        html: '<span class="tp-w">سلام</span>',
        resetScroll: true,
      })
    );
    async function nextTeleprompter(client, label) {
      for (let i = 0; i < 8; i++) {
        const msg = JSON.parse((await withTimeout(client.next(), label + ' ' + i)).data.toString());
        if (msg.type === 'teleprompter') return msg;
      }
      throw new Error('no teleprompter for ' + label);
    }
    const tpA = await nextTeleprompter(phoneA, 'tpA');
    const tpB = await nextTeleprompter(phoneB, 'tpB');
    assert.strictEqual(tpA.type, 'teleprompter');
    assert.strictEqual(tpB.type, 'teleprompter');
    assert.strictEqual(tpA.visible, true);
    assert.ok(String(tpA.html).includes('سلام'));

    studio.sendText(JSON.stringify({ type: 'teleprompter', readAt: 4, scrolling: true }));
    const lightA = await nextTeleprompter(phoneA, 'lightA');
    assert.strictEqual(lightA.readAt, 4);
    assert.strictEqual(lightA.scrolling, true);

    const phoneC = await withTimeout(connectClient(PORT), 'phoneC connect');
    phoneC.sendText(JSON.stringify({ role: 'phone', id: 'phonec3' }));
    const helloC = JSON.parse((await withTimeout(phoneC.next(), 'helloC')).data.toString());
    assert.strictEqual(helloC.type, 'hello');
    const stored = await nextTeleprompter(phoneC, 'stored');
    assert.ok(String(stored.html).includes('سلام'));
    assert.strictEqual(stored.readAt, 4);
    assert.strictEqual(stored.scrolling, true);

    phoneA.end();
    phoneC.end();
    phoneB.end();
    studio.end();
    console.log('phone relay ok');
  } finally {
    serverProc.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
