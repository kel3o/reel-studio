(function () {
  const emptyCanvas = document.createElement('canvas');
  emptyCanvas.width = 0;
  emptyCanvas.height = 0;

  const phones = new Map();
  const api = {
    id: 'phone',
    canvas: emptyCanvas,
    connected: false,
    hasFrame: false,
    lagMs: 0,
    cameras: function () {
      const list = [];
      phones.forEach(function (phone) {
        list.push({ id: phone.id, label: phone.label, canvas: phone.canvas, hasFrame: phone.hasFrame });
      });
      return list;
    },
    mics: function () {
      const list = [];
      phones.forEach(function (phone) {
        if (!phone.audioTrack || phone.audioTrack.readyState === 'ended') return;
        list.push({
          id: phone.id,
          label: String(phone.label || 'دوربین موبایل').replace(/^دوربین/, 'میکروفون'),
          track: phone.audioTrack,
        });
      });
      return list;
    },
    audioStreamFor: function (id) {
      const phone = phones.get(id);
      if (!phone || !phone.audioTrack || phone.audioTrack.readyState === 'ended') return null;
      return new MediaStream([phone.audioTrack]);
    },
    canvasFor: function (id) {
      const phone = phones.get(id);
      return phone ? phone.canvas : null;
    },
  };
  window.__reelPhone = api;

  let ws = null;
  let linkUrl = '';
  let linkKnown = false;
  let statusHandler = null;
  let lastAsk = 0;
  let listSig = '';

  function syncHead() {
    const first = phones.values().next().value;
    api.canvas = first ? first.canvas : emptyCanvas;
    api.hasFrame = first ? first.hasFrame : false;
    api.connected = phones.size > 0;
  }

  function publish() {
    syncHead();
    const signature = api
      .cameras()
      .map(function (phone) {
        return phone.id + ':' + phone.label;
      })
      .concat(
        api.mics().map(function (mic) {
          return 'm:' + mic.id;
        })
      )
      .join('|');
    const changed = signature !== listSig;
    listSig = signature;
    renderHint();
    if (changed && statusHandler) statusHandler(api.connected);
  }

  function stopPhoneAudio(phone) {
    if (!phone) return;
    if (phone.audioTrack) {
      try {
        phone.audioTrack.stop();
      } catch (err) {
        // already ended
      }
      phone.audioTrack = null;
    }
    if (phone.audioCtx) {
      phone.audioCtx.close().catch(function () {});
      phone.audioCtx = null;
    }
    phone.audioNext = 0;
  }

  function ensurePhoneAudio(phone, sampleRate) {
    const rate = sampleRate > 0 ? sampleRate : 48000;
    if (phone.audioCtx && phone.audioTrack && phone.audioTrack.readyState !== 'ended') {
      return phone.audioCtx;
    }
    stopPhoneAudio(phone);
    phone.audioCtx = new AudioContext({ sampleRate: rate });
    phone.audioDest = phone.audioCtx.createMediaStreamDestination();
    phone.audioTrack = phone.audioDest.stream.getAudioTracks()[0] || null;
    phone.audioNext = 0;
    if (phone.audioCtx.state === 'suspended') phone.audioCtx.resume().catch(function () {});
    return phone.audioCtx;
  }

  function pushPhoneAudio(phone, payload) {
    if (!payload || payload.length < 4) return;
    const sampleRate = payload[0] | (payload[1] << 8);
    const pcmBytes = payload.subarray(2);
    if (pcmBytes.byteLength < 2 || pcmBytes.byteLength % 2) return;
    const ctx = ensurePhoneAudio(phone, sampleRate || 48000);
    if (!ctx || !phone.audioDest) return;
    const samples = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 32768;
    const rate = sampleRate || ctx.sampleRate || 48000;
    const buffer = ctx.createBuffer(1, floats.length, rate);
    buffer.copyToChannel(floats, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(phone.audioDest);
    const now = ctx.currentTime;
    if (!phone.audioNext || phone.audioNext < now) phone.audioNext = now + 0.04;
    src.start(phone.audioNext);
    phone.audioNext += buffer.duration;
    if (!phone.audioListed) {
      phone.audioListed = true;
      publish();
    }
  }

  function dropPhone(id) {
    const phone = phones.get(id);
    if (!phone) return;
    if (phone.decoder && phone.decoder.state !== 'closed') {
      try {
        phone.decoder.close();
      } catch (err) {
        // already closed
      }
    }
    stopPhoneAudio(phone);
    phones.delete(id);
  }

  function ensurePhone(id, label) {
    let phone = phones.get(id);
    if (!phone) {
      const canvas = document.createElement('canvas');
      canvas.width = 0;
      canvas.height = 0;
      phone = {
        id: id,
        label: label || 'دوربین موبایل',
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        decoder: null,
        configSig: '',
        waitingKey: true,
        pts: 0,
        mode: 'video',
        paintGen: 0,
        hasFrame: false,
        audioCtx: null,
        audioDest: null,
        audioTrack: null,
        audioNext: 0,
        audioListed: false,
      };
      phones.set(id, phone);
    } else if (label) {
      phone.label = label;
    }
    return phone;
  }

  function setPhoneList(list) {
    const ids = {};
    (list || []).forEach(function (item) {
      if (!item || !item.id) return;
      ids[item.id] = true;
      ensurePhone(item.id, item.label);
    });
    Array.from(phones.keys()).forEach(function (id) {
      if (!ids[id]) dropPhone(id);
    });
    publish();
  }

  Object.defineProperty(api, 'onStatus', {
    set: function (fn) {
      statusHandler = fn;
      if (fn) fn(api.connected);
    },
  });

  function noteLag(sentAt) {
    if (!sentAt) return;
    const lag = Date.now() - sentAt;
    if (lag < 0 || lag > 1500) return;
    api.lagMs = api.lagMs === 0 ? lag : api.lagMs * 0.55 + lag * 0.45;
  }

  function paintSource(phone, source) {
    const width = source.displayWidth || source.width;
    const height = source.displayHeight || source.height;
    if (!width || !height) return;
    if (phone.canvas.width !== width || phone.canvas.height !== height) {
      phone.canvas.width = width;
      phone.canvas.height = height;
    }
    phone.ctx.drawImage(source, 0, 0, width, height);
    phone.hasFrame = true;
    syncHead();
  }

  function paintJpeg(phone, payload) {
    const gen = ++phone.paintGen;
    const blob = new Blob([payload], { type: 'image/jpeg' });
    createImageBitmap(blob)
      .then(function (bmp) {
        if (gen !== phone.paintGen) {
          bmp.close();
          return;
        }
        paintSource(phone, bmp);
        bmp.close();
      })
      .catch(function () {});
  }

  function askKey(id) {
    const now = Date.now();
    if (now - lastAsk < 200) return;
    lastAsk = now;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'need-key', id: id || '' }));
  }

  api.sendTeleprompter = function (payload) {
    if (!ws || ws.readyState !== 1) return;
    const msg = Object.assign({ type: 'teleprompter' }, payload || {});
    ws.send(JSON.stringify(msg));
  };

  function b64ToU8(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function openDecoder(phone, msg) {
    if (typeof VideoDecoder === 'undefined') return;
    if (phone.decoder && phone.decoder.state !== 'closed') {
      try {
        phone.decoder.close();
      } catch (err) {
        // already closed
      }
    }
    phone.decoder = new VideoDecoder({
      output: function (frame) {
        paintSource(phone, frame);
        frame.close();
      },
      error: function () {
        phone.waitingKey = true;
        askKey(phone.id);
      },
    });
    const config = {
      codec: msg.codec,
      optimizeForLatency: true,
    };
    if (msg.codedWidth && msg.codedHeight) {
      config.codedWidth = msg.codedWidth;
      config.codedHeight = msg.codedHeight;
    }
    if (msg.description) config.description = b64ToU8(msg.description);
    phone.decoder.configure(config);
  }

  function applyConfig(msg) {
    if (!msg || !msg.codec || !msg.id) return;
    const phone = ensurePhone(msg.id, msg.label);
    if (msg.codec === 'image/jpeg') {
      phone.mode = 'jpeg';
      phone.waitingKey = false;
      publish();
      return;
    }
    phone.mode = 'video';
    const sig = [msg.codec, msg.codedWidth, msg.codedHeight, msg.description || ''].join('|');
    if (sig === phone.configSig && phone.decoder && phone.decoder.state === 'configured') return;
    phone.configSig = sig;
    phone.waitingKey = true;
    phone.pts = 0;
    openDecoder(phone, msg);
    publish();
  }

  function onBinary(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.length < 10) return;
    const idLen = bytes[0];
    if (bytes.length < 1 + idLen + 9) return;
    const id = new TextDecoder().decode(bytes.subarray(1, 1 + idLen));
    const body = bytes.subarray(1 + idLen);
    const phone = phones.get(id) || ensurePhone(id);
    const kind = body[0];
    let sent = 0;
    try {
      sent = Number(new DataView(body.buffer, body.byteOffset, body.byteLength).getBigUint64(1));
    } catch (err) {
      sent = 0;
    }
    noteLag(sent);
    const payload = body.subarray(9);
    if (kind === 4) {
      pushPhoneAudio(phone, payload);
      return;
    }
    if (kind === 3) {
      paintJpeg(phone, payload);
      return;
    }
    if (phone.mode === 'jpeg') return;
    if (!phone.decoder || phone.decoder.state !== 'configured') return;
    if (phone.decoder.decodeQueueSize > 1) {
      phone.waitingKey = true;
      try {
        phone.decoder.reset();
      } catch (err) {
        askKey(phone.id);
        return;
      }
      askKey(phone.id);
      return;
    }
    if (kind === 2 && phone.waitingKey) return;
    if (kind === 1) phone.waitingKey = false;
    try {
      phone.pts += 33333;
      phone.decoder.decode(
        new EncodedVideoChunk({
          type: kind === 1 ? 'key' : 'delta',
          timestamp: phone.pts,
          data: payload,
        })
      );
    } catch (err) {
      phone.waitingKey = true;
      askKey(phone.id);
    }
  }

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/api/phone-ws');
    ws.binaryType = 'arraybuffer';
    ws.onopen = function () {
      ws.send(JSON.stringify({ role: 'studio' }));
    };
    ws.onmessage = function (ev) {
      if (typeof ev.data === 'string') {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (err) {
          return;
        }
        if (msg.type === 'phone-status') setPhoneList(msg.phones || []);
        if (msg.type === 'video-config') applyConfig(msg);
        return;
      }
      onBinary(ev.data);
    };
    ws.onclose = function () {
      Array.from(phones.keys()).forEach(dropPhone);
      publish();
      setTimeout(connect, 1000);
    };
  }

  function copyText(url, button) {
    function done(ok) {
      button.textContent = ok ? 'کپی شد' : 'کپی نشد';
      setTimeout(function () {
        button.textContent = 'کپی آدرس';
      }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () {
          done(true);
        },
        function () {
          done(false);
        }
      );
      return;
    }
    done(false);
  }

  function renderHint() {
    const el = document.getElementById('phone-hint');
    if (!el) return;
    el.classList.toggle('on', api.connected);
    el.replaceChildren();
    if (api.connected) {
      const count = api.cameras().length;
      const countText = String(count).replace(/\d/g, function (digit) {
        return '۰۱۲۳۴۵۶۷۸۹'[digit];
      });
      if (count > 1) {
        const names = api.cameras().map(function (phone) {
          return phone.label;
        }).join('، ');
        el.textContent =
          countText +
          ' تا گوشی وصل شد (' +
          names +
          '). توی چند دوربین هر کدوم تیک جدا داره و باند خودش رو می‌گیره. صفحه‌های گوشی رو باز نگه دار.';
      } else {
        el.textContent =
          'گوشی وصل شد. توی چند دوربین تیک «' +
          (api.cameras()[0] && api.cameras()[0].label) +
          '» رو بزن و صفحه‌ی گوشی رو باز نگه دار.';
      }
      return;
    }
    if (!linkUrl) {
      el.textContent = linkKnown
        ? 'برای دوربین گوشی، لپ‌تاپ رو به وای‌فای وصل کن. آدرس همین‌جا میاد.'
        : 'آدرس گوشی داره آماده می‌شه.';
      return;
    }
    const lead = document.createElement('span');
    lead.textContent = 'برای فیلم از گوشی، هر دو رو به یه وای‌فای وصل کن و این آدرس رو توی کروم گوشی باز کن: ';
    const url = document.createElement('span');
    url.className = 'phone-link';
    url.textContent = linkUrl;
    const tail = document.createElement('span');
    tail.textContent =
      ' اگه هشدار امنیتی اومد، ادامه رو بزن و شروع رو بزن. بعدش دوربین موبایل توی لیست دوربین میاد. صدا همون میکروفون لپ‌تاپه.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'کپی آدرس';
    button.addEventListener('click', function () {
      copyText(linkUrl, button);
    });
    el.append(lead, url, tail, document.createElement('br'), button);
  }

  function refreshLink() {
    fetch('/api/phone-link')
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        linkKnown = true;
        linkUrl = data && data.url ? data.url : '';
        renderHint();
      })
      .catch(function () {
        linkKnown = true;
        renderHint();
      });
  }

  connect();
  refreshLink();
  setInterval(refreshLink, 5000);
  renderHint();
})();
