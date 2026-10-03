(function () {
  const view = document.getElementById('view');
  const statusEl = document.getElementById('status');
  const goBtn = document.getElementById('go');
  const flipBtn = document.getElementById('flip');

  let facing = 'user';
  let session = 0;
  let stream = null;
  let reader = null;
  let encoder = null;
  let ws = null;
  let hello = false;
  let running = false;
  let lastConfig = '';
  let forceKey = true;
  let jpegMode = false;
  let scratch = null;
  let scratchCtx = null;
  let phoneId = '';
  let phoneLabel = '';

  function setStatus(text) {
    statusEl.textContent = phoneLabel ? phoneLabel + '، ' + text : text;
  }

  function makePhoneId() {
    const bytes = new Uint8Array(8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
    return out;
  }

  function loadPhoneId() {
    try {
      let id = sessionStorage.getItem('reel.phoneId') || '';
      if (!/^[a-z0-9]{6,16}$/i.test(id)) {
        id = makePhoneId();
        sessionStorage.setItem('reel.phoneId', id);
      }
      return id;
    } catch (err) {
      return makePhoneId();
    }
  }

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function sendPacket(kind, payload, capturedAt) {
    if (!ws || ws.readyState !== 1 || !hello) return false;
    const limit = kind === 1 ? 280000 : 80000;
    if (ws.bufferedAmount > limit) return false;
    const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const packet = new Uint8Array(9 + body.length);
    packet[0] = kind;
    new DataView(packet.buffer).setBigUint64(1, BigInt(capturedAt || Date.now()));
    packet.set(body, 9);
    ws.send(packet);
    return true;
  }

  function rememberConfig(msg) {
    lastConfig = JSON.stringify(msg);
    if (ws && ws.readyState === 1 && hello) ws.send(lastConfig);
  }

  function connectSocket() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/api/phone-ws');
    ws.binaryType = 'arraybuffer';
    hello = false;
    ws.onopen = function () {
      phoneId = loadPhoneId();
      ws.send(JSON.stringify({ role: 'phone', id: phoneId }));
    };
    ws.onmessage = function (ev) {
      if (typeof ev.data !== 'string') return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (err) {
        return;
      }
      if (msg.type === 'hello') {
        hello = true;
        forceKey = true;
        if (msg.id) {
          phoneId = msg.id;
          try {
            sessionStorage.setItem('reel.phoneId', phoneId);
          } catch (err) {
            // sessionStorage might be unavailable
          }
        }
        if (msg.label) {
          phoneLabel = msg.label;
          document.title = msg.label;
        }
        if (lastConfig && ws.readyState === 1) ws.send(lastConfig);
      }
      if (msg.type === 'need-key') {
        forceKey = true;
        if (lastConfig && ws.readyState === 1) ws.send(lastConfig);
      }
    };
    ws.onclose = function () {
      hello = false;
      if (running) setTimeout(connectSocket, 1000);
    };
  }

  function stopMedia() {
    session += 1;
    jpegMode = false;
    if (reader) {
      reader.cancel().catch(function () {});
      reader = null;
    }
    if (encoder && encoder.state !== 'closed') {
      try {
        encoder.close();
      } catch (err) {
        // already closed
      }
    }
    encoder = null;
    if (stream) {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      stream = null;
    }
    view.srcObject = null;
  }

  function cameraError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'اجازه‌ی دوربین داده نشد';
    if (name === 'NotReadableError') return 'دوربین گوشی دست یه برنامه‌ی دیگه‌ست';
    if (name === 'NotFoundError') return 'این دوربین روی گوشی پیدا نشد';
    return 'دوربین گوشی باز نشد';
  }

  async function openCamera() {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
  }

  function evenFrame(frame) {
    let width = frame.displayWidth & ~1;
    let height = frame.displayHeight & ~1;
    const longEdge = Math.max(width, height);
    if (longEdge > 1280) {
      const scale = 1280 / longEdge;
      width = Math.max(2, Math.round((frame.displayWidth * scale) / 2) * 2);
      height = Math.max(2, Math.round((frame.displayHeight * scale) / 2) * 2);
    }
    if (!width || !height) {
      frame.close();
      return null;
    }
    if (width === frame.displayWidth && height === frame.displayHeight) return frame;
    if (!scratch) {
      scratch = document.createElement('canvas');
      scratchCtx = scratch.getContext('2d');
    }
    if (scratch.width !== width) scratch.width = width;
    if (scratch.height !== height) scratch.height = height;
    scratchCtx.drawImage(frame, 0, 0, width, height);
    const next = new VideoFrame(scratch, { timestamp: frame.timestamp || 0 });
    frame.close();
    return next;
  }

  async function pickCodec(width, height) {
    const candidates = ['avc1.42001f', 'vp8', 'avc1.4d001f'];
    const accelerations = ['prefer-software', 'no-preference'];
    for (let a = 0; a < accelerations.length; a++) {
      for (let i = 0; i < candidates.length; i++) {
        const config = {
          codec: candidates[i],
          width: width,
          height: height,
          bitrate: 2500000,
          framerate: 30,
          latencyMode: 'realtime',
          hardwareAcceleration: accelerations[a],
        };
        try {
          const support = await VideoEncoder.isConfigSupported(config);
          if (support.supported) return support.config || config;
        } catch (err) {
          // try the next codec
        }
      }
    }
    return null;
  }

  function startJpeg(localStream, id) {
    if (jpegMode || id !== session) return;
    jpegMode = true;
    if (reader) {
      reader.cancel().catch(function () {});
      reader = null;
    }
    if (encoder && encoder.state !== 'closed') {
      try {
        encoder.close();
      } catch (err) {
        // already closed
      }
    }
    encoder = null;
    const videoTrack = localStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
    let width = settings.width || view.videoWidth || 720;
    let height = settings.height || view.videoHeight || 1280;
    const longEdge = Math.max(width, height);
    if (longEdge > 1280) {
      const scale = 1280 / longEdge;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    width &= ~1;
    height &= ~1;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    rememberConfig({
      type: 'video-config',
      codec: 'image/jpeg',
      codedWidth: width,
      codedHeight: height,
      description: '',
    });
    let busy = false;
    let lastShot = 0;
    function tick(now) {
      if (id !== session || !jpegMode) return;
      requestAnimationFrame(tick);
      if (busy || now - lastShot < 50) return;
      if (ws && ws.bufferedAmount > 80000) return;
      lastShot = now;
      const capturedAt = Date.now();
      ctx.drawImage(view, 0, 0, width, height);
      busy = true;
      canvas.toBlob(
        function (blob) {
          busy = false;
          if (!blob || id !== session) return;
          blob.arrayBuffer().then(function (buf) {
            sendPacket(3, new Uint8Array(buf), capturedAt);
          });
        },
        'image/jpeg',
        0.62
      );
    }
    requestAnimationFrame(tick);
    setStatus('داره فرستاده می‌شه. این صفحه رو نبند.');
  }

  async function startWebCodecs(localStream, id) {
    if (typeof VideoEncoder === 'undefined' || typeof MediaStreamTrackProcessor === 'undefined') {
      throw new Error('no-webcodecs');
    }
    const track = localStream.getVideoTracks()[0];
    const processor = new MediaStreamTrackProcessor({ track: track });
    reader = processor.readable.getReader();
    const first = await reader.read();
    if (id !== session) {
      if (first.value) first.value.close();
      return;
    }
    if (first.done || !first.value) throw new Error('no-frame');
    let frame = evenFrame(first.value);
    if (!frame) throw new Error('no-frame');
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    const config = await pickCodec(width, height);
    if (!config) {
      frame.close();
      throw new Error('no-codec');
    }
    const captureTimes = [];
    encoder = new VideoEncoder({
      output: function (chunk, meta) {
        const capturedAt = captureTimes.length ? captureTimes.shift() : Date.now();
        if (meta && meta.decoderConfig) {
          const description = meta.decoderConfig.description ? bufToB64(meta.decoderConfig.description) : '';
          rememberConfig({
            type: 'video-config',
            codec: meta.decoderConfig.codec || config.codec,
            codedWidth: meta.decoderConfig.codedWidth || width,
            codedHeight: meta.decoderConfig.codedHeight || height,
            description: description,
          });
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        if (!sendPacket(chunk.type === 'key' ? 1 : 2, data, capturedAt)) forceKey = true;
      },
      error: function () {
        if (id !== session || jpegMode) return;
        if (reader) reader.cancel().catch(function () {});
        reader = null;
        startJpeg(localStream, id);
      },
    });
    encoder.configure(config);
    function take(next) {
      const fitted = evenFrame(next);
      if (!fitted) return;
      if (fitted.displayWidth !== width || fitted.displayHeight !== height) {
        fitted.close();
        startJpeg(localStream, id);
        return false;
      }
      const key = !!forceKey;
      const limit = key ? 280000 : 80000;
      if ((ws && ws.bufferedAmount > limit) || encoder.encodeQueueSize > 0) {
        fitted.close();
        forceKey = true;
        return true;
      }
      captureTimes.push(Date.now());
      forceKey = false;
      encoder.encode(fitted, { keyFrame: key });
      fitted.close();
      return true;
    }
    encoder.configure(config);
    setStatus('داره فرستاده می‌شه. این صفحه رو نبند.');
    if (take(frame) === false) return;
    while (id === session && !jpegMode) {
      const next = await reader.read();
      if (next.done || id !== session) {
        if (next.value) next.value.close();
        break;
      }
      if (take(next.value) === false) break;
    }
  }

  async function startFacing(nextFacing) {
    facing = nextFacing;
    const id = session + 1;
    stopMedia();
    session = id;
    running = true;
    connectSocket();
    setStatus('دارم دوربین رو باز می‌کنم');
    try {
      if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {});
      stream = await openCamera();
      if (id !== session) return;
      view.srcObject = stream;
      view.classList.toggle('mirror', facing === 'user');
      await view.play().catch(function () {});
      goBtn.hidden = true;
      flipBtn.hidden = false;
      flipBtn.textContent = facing === 'user' ? 'دوربین پشت' : 'دوربین جلو';
      try {
        await startWebCodecs(stream, id);
      } catch (err) {
        if (id !== session) return;
        if (reader) {
          reader.cancel().catch(function () {});
          reader = null;
        }
        startJpeg(stream, id);
      }
    } catch (err) {
      if (id !== session) return;
      setStatus(cameraError(err));
    }
  }

  goBtn.addEventListener('click', function () {
    startFacing(facing);
  });
  flipBtn.addEventListener('click', function () {
    startFacing(facing === 'user' ? 'environment' : 'user');
  });
})();
