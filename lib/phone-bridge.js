'use strict';

const dgram = require('dgram');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { accept } = require('./mini-ws');

const PASSPHRASE = 'reel-studio-local';
const PHONE_FILES = {
  '/': 'phone.html',
  '/phone': 'phone.html',
  '/phone.html': 'phone.html',
  '/phone.js': 'phone.js',
  '/phone.css': 'phone.css',
  '/fonts/Vazirmatn-Regular.woff2': path.join('fonts', 'Vazirmatn-Regular.woff2'),
  '/fonts/Vazirmatn-Bold.woff2': path.join('fonts', 'Vazirmatn-Bold.woff2'),
};

let phonePort = 0;
let stunPort = 0;
let stunSocket = null;
let publicDir = '';
let certDir = '';
let httpsServer = null;
let httpsReady = false;
let studioSocket = null;
const phones = new Map();
let nextPhoneNumber = 1;
let nextAnon = 1;
let certSig = '';
let bootInFlight = false;
let bootAgain = false;
let lastTeleprompter = '';
let lastStatusPayload = '';
let preferredHost = '';

function isIpv4(ip) {
  const bits = String(ip).split('.');
  if (bits.length !== 4) return false;
  return bits.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function privateIpv4s() {
  const nets = os.networkInterfaces();
  const skip = /virtual|vethernet|wsl|hyper-v|docker|vbox|bluetooth|loopback|vpn|tailscale|zerotier|vmware/i;
  const prefer = /wi-?fi|wlan|wireless|ethernet|eth/i;
  const found = [];
  Object.keys(nets).forEach((name) => {
    if (skip.test(name)) return;
    (nets[name] || []).forEach((entry) => {
      const v4 = entry.family === 'IPv4' || entry.family === 4;
      if (!v4 || entry.internal) return;
      if (!isIpv4(entry.address)) return;
      if (entry.address.startsWith('169.254.')) return;
      found.push({
        address: entry.address,
        preferred: prefer.test(name),
      });
    });
  });
  found.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  const seen = new Set();
  const ips = [];
  found.forEach((item) => {
    if (seen.has(item.address)) return;
    seen.add(item.address);
    ips.push(item.address);
  });
  return ips;
}

function bestHost() {
  const ips = privateIpv4s();
  return ips.length ? ips[0] : '';
}

function sanText(ips) {
  const parts = ['DNS=localhost', 'DNS=reel-studio', 'IPAddress=127.0.0.1'];
  ips.forEach((ip) => {
    if (isIpv4(ip)) parts.push('IPAddress=' + ip);
  });
  return '2.5.29.17={text}' + parts.join('&');
}

function ensureCert(ips) {
  const sig = ips.slice().sort().join(',');
  const pfxPath = path.join(certDir, 'phone.pfx');
  const metaPath = path.join(certDir, 'phone-ips.txt');
  if (sig === certSig && fs.existsSync(pfxPath)) return;
  if (fs.existsSync(metaPath) && fs.existsSync(pfxPath) && fs.readFileSync(metaPath, 'utf8') === sig) {
    certSig = sig;
    return;
  }
  fs.mkdirSync(certDir, { recursive: true });
  const scriptPath = path.join(certDir, 'make-phone-cert.ps1');
  const ext = sanText(ips).replace(/'/g, '');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$cert = New-SelfSignedCertificate -Subject 'CN=reel-studio' -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(5) -TextExtension @('" +
      ext +
      "')",
    "$pass = ConvertTo-SecureString -String '" + PASSPHRASE + "' -Force -AsPlainText",
    "Export-PfxCertificate -Cert $cert -FilePath '" + pfxPath.replace(/'/g, "''") + "' -Password $pass | Out-Null",
    "Get-ChildItem -Path ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint) | Remove-Item",
  ].join('\r\n');
  fs.writeFileSync(scriptPath, script, 'utf8');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { windowsHide: true, timeout: 40000 }
  );
  if (result.status !== 0 || !fs.existsSync(pfxPath)) {
    const detail = (result.stderr || result.stdout || '').toString().trim();
    throw new Error(detail || 'ساخت گواهی دوربین گوشی شکست خورد');
  }
  fs.writeFileSync(metaPath, sig);
  certSig = sig;
}

function mimeFor(file) {
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.woff')) return 'font/woff';
  return 'text/html; charset=utf-8';
}

function servePhone(req, res) {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const file = PHONE_FILES[pathname];
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('یافت نشد');
    return;
  }
  fs.readFile(path.join(publicDir, file), (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('یافت نشد');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeFor(file),
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function phoneLabel(n) {
  const digits = String(n).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[digit]);
  return 'دوربین موبایل ' + digits;
}

function livePhones() {
  const list = [];
  phones.forEach((entry) => {
    if (!entry.ws || !socketStillLive(entry.ws)) return;
    list.push({ id: entry.id, label: entry.label, n: entry.n });
  });
  list.sort((a, b) => a.n - b.n);
  return list;
}

function notifyStudio() {
  if (!studioSocket) return;
  const list = livePhones();
  const payload = JSON.stringify({
    type: 'phone-status',
    connected: list.length > 0,
    phones: list,
  });
  if (payload === lastStatusPayload) return;
  lastStatusPayload = payload;
  studioSocket.sendText(payload);
}

function phoneBySocket(ws) {
  let found = null;
  phones.forEach((entry) => {
    if (entry.ws === ws) found = entry;
  });
  return found;
}

function sendToPhones(text) {
  phones.forEach((entry) => {
    if (entry.ws) entry.ws.sendText(text);
  });
}

function clearHoldTimer(entry) {
  if (!entry || !entry.holdTimer) return;
  clearTimeout(entry.holdTimer);
  entry.holdTimer = null;
}

function socketStillLive(sock) {
  if (!sock) return false;
  // The wrapper only grows a readyState after the handshake. Until close()
  // it is open. Treating a missing readyState as dead removed the phone
  // from the list a moment after it appeared.
  if (typeof sock.readyState !== 'number') return true;
  return sock.readyState === 0 || sock.readyState === 1;
}

function adoptPhone(ws, id) {
  let key = id && /^[a-z0-9_-]{4,40}$/i.test(String(id)) ? String(id).slice(0, 40) : '';
  let entry = key ? phones.get(key) : null;
  // Two live phones must never share one id. If the claimed id is already
  // taken by another open socket, mint a fresh slot for the newcomer.
  // A closing/stale socket is not a conflict: take the slot back.
  if (entry && entry.ws && entry.ws !== ws) {
    if (socketStillLive(entry.ws)) {
      key = '';
      entry = null;
    } else {
      try {
        entry.ws.close();
      } catch (err) {
        // already dead
      }
      entry.ws = null;
    }
  }
  if (!key) {
    key = 'p' + nextAnon++;
  }
  if (!entry) {
    const n = nextPhoneNumber++;
    entry = { id: key, n: n, label: phoneLabel(n), config: '', ws: null, holding: false, holdTimer: null };
    phones.set(key, entry);
  }
  clearHoldTimer(entry);
  entry.holding = false;
  entry.ws = ws;
  ws.sendText(JSON.stringify({ type: 'hello', id: entry.id, label: entry.label }));
  if (lastTeleprompter) ws.sendText(lastTeleprompter);
  notifyStudio();
}

function adopt(ws, role, id) {
  if (role === 'studio') {
    if (studioSocket && studioSocket !== ws) {
      const old = studioSocket;
      studioSocket = ws;
      // Two dashboard tabs otherwise close each other and reconnect every
      // half second. Each reconnect told the phone to rebuild the picture,
      // so the status flipped and the image hitched. The old tab must stop.
      try {
        old.sendText(JSON.stringify({ type: 'studio-replaced' }));
      } catch (err) {
        // already gone
      }
      old.close();
    } else {
      studioSocket = ws;
    }
    lastStatusPayload = '';
    notifyStudio();
    phones.forEach((entry) => {
      if (entry.config && entry.ws) studioSocket.sendText(entry.config);
      if (!entry.ws) return;
      entry.ws.sendText(JSON.stringify({ type: 'need-key' }));
      // The dashboard socket dies on refresh and on every other page.
      // The phone would keep the dead video link and the new page stays black.
      entry.ws.sendText(JSON.stringify({ type: 'rtc-restart' }));
    });
    return;
  }
  adoptPhone(ws, id);
}

function onSocketMessage(ws, isBinary, data) {
  if (!isBinary) {
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch (err) {
      return;
    }
    if (msg.role === 'studio' || msg.role === 'phone') {
      adopt(ws, msg.role, msg.id);
      return;
    }
    const entry = phoneBySocket(ws);
    if (entry && msg.type === 'video-config') {
      const tagged = Object.assign({}, msg, { id: entry.id });
      entry.config = JSON.stringify(tagged);
      if (studioSocket) studioSocket.sendText(entry.config);
      return;
    }
    if (ws === studioSocket && msg.type === 'need-key') {
      const target = msg.id ? phones.get(msg.id) : null;
      if (target && target.ws) {
        target.ws.sendText(JSON.stringify({ type: 'need-key' }));
      } else {
        phones.forEach((item) => {
          if (item.ws) item.ws.sendText(JSON.stringify({ type: 'need-key' }));
        });
      }
      return;
    }
    if (ws === studioSocket && (msg.type === 'want-audio' || msg.type === 'stop-audio')) {
      const target = msg.id ? phones.get(msg.id) : null;
      const payload = JSON.stringify({ type: msg.type });
      if (target && target.ws) {
        target.ws.sendText(payload);
      } else {
        phones.forEach((item) => {
          if (item.ws) item.ws.sendText(payload);
        });
      }
      return;
    }
    if (ws === studioSocket && msg.type === 'teleprompter') {
      let stored = msg;
      if (msg.html == null && lastTeleprompter) {
        try {
          stored = Object.assign(JSON.parse(lastTeleprompter), msg);
        } catch (err) {
          stored = msg;
        }
      }
      lastTeleprompter = JSON.stringify(stored);
      sendToPhones(JSON.stringify(msg));
      return;
    }
    if (entry && (msg.type === 'rtc-offer' || msg.type === 'rtc-ice')) {
      if (!studioSocket) return;
      studioSocket.sendText(JSON.stringify(Object.assign({}, msg, { id: entry.id })));
      return;
    }
    if (entry && msg.type === 'capture' && msg.action === 'toggle') {
      if (!studioSocket) return;
      studioSocket.sendText(JSON.stringify({ type: 'capture', action: 'toggle', id: entry.id }));
      return;
    }
    if (ws === studioSocket && (msg.type === 'rtc-answer' || msg.type === 'rtc-ice')) {
      const target = msg.id ? phones.get(msg.id) : null;
      if (target && target.ws) target.ws.sendText(JSON.stringify(msg));
      return;
    }
    return;
  }
  const entry = phoneBySocket(ws);
  if (entry && studioSocket) {
    const idBuf = Buffer.from(entry.id);
    const wrapped = Buffer.alloc(1 + idBuf.length + data.length);
    wrapped[0] = idBuf.length;
    idBuf.copy(wrapped, 1);
    data.copy(wrapped, 1 + idBuf.length);
    studioSocket.sendBinary(wrapped);
  }
}

function dropSocket(ws) {
  if (studioSocket === ws) {
    studioSocket = null;
    lastStatusPayload = '';
  }
  const entry = phoneBySocket(ws);
  if (!entry) return;
  if (entry.ws === ws) entry.ws = null;
  entry.config = '';
  entry.holding = false;
  clearHoldTimer(entry);
  // Drop the row now. Keep the id and label so the same phone, if it opens
  // again, is still «دوربین موبایل ۱» and not a new number.
  notifyStudio();
}

function handleUpgrade(req, socket, head) {
  let pathname = '';
  try {
    pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  } catch (err) {
    socket.destroy();
    return;
  }
  if (pathname !== '/api/phone-ws') {
    socket.destroy();
    return;
  }
  const ws = accept(req, socket, head);
  if (!ws) return;
  ws.on('message', (isBinary, data) => onSocketMessage(ws, isBinary, data));
  ws.on('close', () => dropSocket(ws));
}

function closeHttps() {
  const current = httpsServer;
  httpsServer = null;
  httpsReady = false;
  if (!current) return Promise.resolve();
  return new Promise((resolve) => {
    current.close(() => resolve());
    setTimeout(resolve, 1000);
  });
}

function listenHttps() {
  const pfxPath = path.join(certDir, 'phone.pfx');
  const server = https.createServer(
    {
      pfx: fs.readFileSync(pfxPath),
      passphrase: PASSPHRASE,
    },
    servePhone
  );
  server.on('upgrade', handleUpgrade);
  return new Promise((resolve) => {
    let settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      resolve();
    }
    server.on('error', (err) => {
      httpsReady = false;
      if (httpsServer === server) httpsServer = null;
      if (err.code === 'EADDRINUSE') {
        console.warn(
          'پورت دوربین گوشی ' +
            phonePort +
            ' شلوغه. توی config.json مقدار phonePort رو عوض کن.'
        );
      } else {
        console.warn('دوربین گوشی بالا نیومد: ' + err.message);
      }
      finish();
    });
    server.listen(phonePort, '0.0.0.0', () => {
      httpsServer = server;
      httpsReady = true;
      const host = bestHost();
      if (host) {
        console.log('دوربین گوشی: https://' + host + ':' + phonePort + '/phone');
        console.log('اگه ویندوز پرسید به این برنامه اجازه شبکه بدی، اجازه بده تا گوشی بتونه وصل بشه.');
      } else {
        console.log('دوربین گوشی آماده است، ولی لپ‌تاپ هنوز آی‌پی وای‌فای ندارد.');
      }
      finish();
    });
  });
}

async function boot() {
  const ips = privateIpv4s();
  preferredHost = ips.length ? ips[0] : '';
  await closeHttps();
  ensureCert(ips);
  await listenHttps();
}

function scheduleBoot() {
  if (bootInFlight) {
    bootAgain = true;
    return;
  }
  bootInFlight = true;
  bootAgain = false;
  boot()
    .catch((err) => {
      httpsReady = false;
      console.warn('دوربین گوشی بالا نیومد: ' + err.message);
    })
    .then(() => {
      bootInFlight = false;
      if (bootAgain) scheduleBoot();
    });
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function stunResponse(request, rinfo) {
  if (!request || request.length < 20) return null;
  if (request.readUInt16BE(0) !== 0x0001) return null;
  const parts = String(rinfo.address || '').split('.');
  if (parts.length !== 4) return null;
  const ip = parts.map((part) => Number(part));
  if (ip.some((n) => !Number.isFinite(n) || n > 255)) return null;
  const value = Buffer.alloc(8);
  value[1] = 0x01;
  value.writeUInt16BE((rinfo.port ^ 0x2112) & 0xffff, 2);
  value[4] = ip[0] ^ 0x21;
  value[5] = ip[1] ^ 0x12;
  value[6] = ip[2] ^ 0xa4;
  value[7] = ip[3] ^ 0x42;
  const msg = Buffer.alloc(40);
  msg.writeUInt16BE(0x0101, 0);
  msg.writeUInt16BE(20, 2);
  msg.writeUInt32BE(0x2112a442, 4);
  request.copy(msg, 8, 8, 20);
  msg.writeUInt16BE(0x0020, 20);
  msg.writeUInt16BE(8, 22);
  value.copy(msg, 24);
  msg.writeUInt16BE(0x8028, 32);
  msg.writeUInt16BE(4, 34);
  const stamp = (crc32(msg.subarray(0, 32)) ^ 0x5354554e) >>> 0;
  msg.writeUInt32BE(stamp, 36);
  return msg;
}

// Local STUN only, on UDP phonePort+1. Phones cannot be trusted to resolve
// the mDNS names Chrome puts in host ICE candidates. Do not point this at a
// public STUN server. Video itself does not pass through this process.
// See SESSIONS.md, 5 October 2026.
function startStun() {
  if (stunSocket || !phonePort) return;
  const port = phonePort + 1;
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', (err) => {
    console.warn('مسیر مستقیم دوربین بالا نیومد: ' + err.message);
    if (stunSocket === socket) {
      stunSocket = null;
      stunPort = 0;
    }
  });
  socket.on('message', (msg, rinfo) => {
    const reply = stunResponse(msg, rinfo);
    if (!reply) return;
    socket.send(reply, rinfo.port, rinfo.address);
  });
  socket.bind(port, '0.0.0.0', () => {
    stunSocket = socket;
    stunPort = port;
    console.log('مسیر مستقیم دوربین: UDP ' + port);
  });
}

function startPhoneBridge(options) {
  phonePort = options.phonePort;
  publicDir = options.publicDir;
  certDir = path.join(options.root, 'certs');
  options.httpServer.on('upgrade', handleUpgrade);
  startStun();
  scheduleBoot();
  setInterval(() => {
    const ips = privateIpv4s();
    const sig = ips.slice().sort().join(',');
    if (sig === certSig) return;
    const host = ips.length ? ips[0] : '';
    // Do not bounce the HTTPS listener (and every phone socket) when a new
    // virtual adapter appears. Only restart when the preferred Wi-Fi host that
    // phones actually open is gone from the address list.
    if (httpsReady && preferredHost && ips.indexOf(preferredHost) !== -1) {
      certSig = sig;
      preferredHost = host || preferredHost;
      try {
        fs.writeFileSync(path.join(certDir, 'phone-ips.txt'), sig, 'utf8');
      } catch (err) {
        // meta is best-effort
      }
      return;
    }
    scheduleBoot();
  }, 15000);
}

function getPhoneLink() {
  const host = bestHost();
  return {
    url: host && httpsReady ? 'https://' + host + ':' + phonePort + '/phone' : '',
    host: host || '',
    port: phonePort,
    stunPort: stunPort,
    stun: host && stunPort ? 'stun:' + host + ':' + stunPort : '',
    connected: livePhones().length > 0,
  };
}

module.exports = {
  startPhoneBridge,
  getPhoneLink,
  handleUpgrade,
};
