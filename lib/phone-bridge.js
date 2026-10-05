'use strict';

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
    // Keep a phone visible while its reconnect grace window is open so the
    // studio list does not flicker empty for a hundred milliseconds.
    if (!entry.ws && !entry.holding) return;
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
  // 0 connecting, 1 open
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
    if (studioSocket && studioSocket !== ws) studioSocket.close();
    studioSocket = ws;
    lastStatusPayload = '';
    notifyStudio();
    phones.forEach((entry) => {
      if (entry.config && entry.ws) studioSocket.sendText(entry.config);
      if (entry.ws) entry.ws.sendText(JSON.stringify({ type: 'need-key' }));
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
    if (ws === studioSocket && msg.type === 'teleprompter') {
      lastTeleprompter = JSON.stringify(msg);
      sendToPhones(lastTeleprompter);
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
  entry.holding = true;
  clearHoldTimer(entry);
  // Hold the slot briefly so a fast reconnect keeps the same id and label
  // instead of minting "دوربین موبایل ۲" and flickering the picker.
  entry.holdTimer = setTimeout(() => {
    entry.holdTimer = null;
    if (entry.ws) {
      entry.holding = false;
      return;
    }
    entry.holding = false;
    phones.delete(entry.id);
    lastStatusPayload = '';
    notifyStudio();
  }, 30000);
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

function startPhoneBridge(options) {
  phonePort = options.phonePort;
  publicDir = options.publicDir;
  certDir = path.join(options.root, 'certs');
  options.httpServer.on('upgrade', handleUpgrade);
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
    connected: livePhones().length > 0,
  };
}

module.exports = {
  startPhoneBridge,
  getPhoneLink,
  handleUpgrade,
};
