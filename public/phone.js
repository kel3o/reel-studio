(function () {
  const view = document.getElementById('view');
  const statusEl = document.getElementById('status');
  const goBtn = document.getElementById('go');
  const flipBtn = document.getElementById('flip');
  const tpLayer = document.getElementById('tp-layer');
  const tpStage = document.getElementById('tp-stage');
  const tpText = document.getElementById('tp-text');
  const tpChrome = document.getElementById('tp-chrome');
  const tpToggle = document.getElementById('tp-toggle');
  const tpRecord = document.getElementById('tp-record');
  const tpSpeedEl = document.getElementById('tp-speed');

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function faNum(n) {
    return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
  }

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
  let audioWanted = false;
  let audioCtx = null;
  let audioNode = null;
  let audioSource = null;
  let audioStream = null;

  let tpWanted = false;
  let tpUserOn = true;
  let tpScrolling = false;
  let tpSpeed = 3;
  let tpFont = 46;
  let tpLead = 1.75;
  let tpHtml = '';
  let tpPhase = '';
  let tpBasePos = 0;
  let tpBaseAt = 0;
  let tpYellow = false;
  let tpYellowIndex = -1;

  function renderTpUi() {
    const show = tpWanted && tpUserOn;
    tpLayer.hidden = !show;
    tpChrome.hidden = !tpWanted;
    tpToggle.hidden = !tpWanted;
    tpToggle.classList.toggle('on', tpUserOn);
    tpToggle.textContent = tpUserOn ? 'پنهان' : 'متن';
    if (!tpRecord) return;
    const recording = tpPhase === 'recording';
    tpRecord.textContent = recording ? 'توقف' : 'ضبط';
    tpRecord.classList.toggle('on', recording);
    tpRecord.disabled = tpPhase === 'countdown' || tpPhase === 'review' || tpPhase === 'done';
  }

  function markPhoneLine() {
    tpText.querySelectorAll('.tp-w.tp-line-on').forEach((el) => el.classList.remove('tp-line-on'));
    tpText.querySelectorAll('.tp-w.tp-word-on').forEach((el) => el.classList.remove('tp-word-on'));
    if (tpLayer.hidden || !tpYellow) return;
    const words = tpText.querySelectorAll('.tp-w');
    if (!words.length) return;
    if (tpYellowIndex >= 0 && tpYellowIndex < words.length) {
      words[tpYellowIndex].classList.add('tp-word-on');
      return;
    }
    const stageRect = tpStage.getBoundingClientRect();
    const eyeY = stageRect.top + stageRect.height * 0.22;
    let best = null;
    let bestDist = Infinity;
    words.forEach((word) => {
      const rect = word.getBoundingClientRect();
      if (rect.bottom < stageRect.top || rect.top > stageRect.bottom) return;
      const mid = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(mid - eyeY);
      if (dist < bestDist) {
        bestDist = dist;
        best = word;
      }
    });
    if (best) best.classList.add('tp-word-on');
  }

  function applyTeleprompter(msg) {
    if (!msg || msg.type !== 'teleprompter') return;
    if (typeof msg.html === 'string' && msg.html !== tpHtml) {
      tpHtml = msg.html;
      tpText.innerHTML = msg.html;
    }
    if (typeof msg.speed === 'number' && msg.speed > 0) {
      tpSpeed = Math.max(1, Math.min(12, msg.speed));
      tpSpeedEl.textContent = faNum(tpSpeed);
    }
    if (typeof msg.fontSize === 'number' && msg.fontSize > 0) {
      tpFont = Math.max(24, Math.min(90, msg.fontSize));
    }
    if (typeof msg.lineHeight === 'number' && msg.lineHeight > 0) {
      tpLead = Math.max(1.2, Math.min(2.8, msg.lineHeight));
    }
    tpText.style.fontSize = tpFont + 'px';
    tpText.style.lineHeight = String(tpLead);
    tpText.style.paddingTop = 'calc(26vh + ' + 2 * tpFont * tpLead + 'px)';
    if (typeof msg.phase === 'string') tpPhase = msg.phase;
    if (typeof msg.scrollPos === 'number') {
      tpBasePos = msg.scrollPos;
      tpBaseAt = performance.now();
    } else if (msg.resetScroll) {
      tpBasePos = 0;
      tpBaseAt = performance.now();
    }
    if (typeof msg.visible === 'boolean') tpWanted = msg.visible;
    if (typeof msg.scrolling === 'boolean') tpScrolling = msg.scrolling;
    if (typeof msg.yellowWords === 'boolean') tpYellow = msg.yellowWords;
    if (typeof msg.yellowIndex === 'number') tpYellowIndex = msg.yellowIndex;
    if (!tpWanted) tpScrolling = false;
    renderTpUi();
    markPhoneLine();
  }

  function tpOffset() {
    if (!(tpScrolling && tpWanted && tpSpeed > 0)) return tpBasePos;
    const elapsed = (performance.now() - tpBaseAt) / 1000;
    return tpBasePos + tpSpeed * 11 * elapsed;
  }

  function tpFrame() {
    if (tpUserOn) tpText.style.transform = 'translateY(' + -tpOffset() + 'px)';
    if (tpWanted && tpUserOn) markPhoneLine();
    requestAnimationFrame(tpFrame);
  }
  tpSpeedEl.textContent = faNum(tpSpeed);
  requestAnimationFrame(tpFrame);

  tpToggle.addEventListener('click', function () {
    tpUserOn = !tpUserOn;
    renderTpUi();
  });
  if (tpRecord) {
    tpRecord.addEventListener('click', function () {
      sendJson({ type: 'capture', action: 'toggle' });
    });
  }

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
    // A tight limit here dropped the frames right after each keyframe and
    // made the picture freeze for a fraction of a second, about once a second.
    if (ws.bufferedAmount > 1500000) return false;
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
      if (msg.type === 'rtc-restart') requestDirect();
      if (msg.type === 'want-audio') {
        audioWanted = true;
        if (running) startAudio(session);
      }
      if (msg.type === 'stop-audio') {
        audioWanted = false;
        stopAudio();
      }
      if (msg.type === 'teleprompter') applyTeleprompter(msg);
      if (msg.type === 'rtc-answer') acceptRtcAnswer(msg);
      if (msg.type === 'rtc-ice') acceptRtcIce(msg);
    };
    ws.onclose = function () {
      hello = false;
      if (running) setTimeout(connectSocket, 1000);
    };
  }

  function stopAudio() {
    if (audioNode) {
      try {
        audioNode.disconnect();
      } catch (err) {
        // already closed
      }
      audioNode.onaudioprocess = null;
      audioNode = null;
    }
    if (audioSource) {
      try {
        audioSource.disconnect();
      } catch (err) {
        // already closed
      }
      audioSource = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(function () {});
      audioCtx = null;
    }
    if (audioStream) {
      audioStream.getTracks().forEach(function (track) {
        try {
          track.stop();
        } catch (err) {
          // already ended
        }
      });
      audioStream = null;
    }
  }

  async function startAudio(id) {
    if (!audioWanted || id !== session) return;
    stopAudio();
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (id !== session || !audioWanted) {
        stopAudio();
        return;
      }
      const track = audioStream.getAudioTracks()[0];
      if (!track) {
        stopAudio();
        return;
      }
      audioCtx = new AudioContext();
      audioSource = audioCtx.createMediaStreamSource(new MediaStream([track]));
      const rate = audioCtx.sampleRate || 48000;
      audioNode = audioCtx.createScriptProcessor(4096, 1, 1);
      audioNode.onaudioprocess = function (ev) {
        if (id !== session || !hello || !audioWanted) return;
        if (ws && ws.bufferedAmount > 60000) return;
        const input = ev.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const payload = new Uint8Array(2 + pcm.byteLength);
        payload[0] = rate & 0xff;
        payload[1] = (rate >> 8) & 0xff;
        payload.set(new Uint8Array(pcm.buffer), 2);
        sendPacket(4, payload, Date.now());
      };
      const mute = audioCtx.createGain();
      mute.gain.value = 0;
      audioSource.connect(audioNode);
      audioNode.connect(mute);
      mute.connect(audioCtx.destination);
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
    } catch (err) {
      stopAudio();
    }
  }

  let fallbackToken = 0;

  function stopFallback() {
    fallbackToken += 1;
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
  }

  function stopMedia() {
    session += 1;
    stopFallback();
    closeRtc();
    stopAudio();
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
    // Video only. Phone mic starts only when the studio asks for it.
    const attempts = [
      {
        facingMode: { ideal: facing },
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 1280 },
        frameRate: { ideal: 30, max: 30 },
      },
      {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    ];
    let lastErr;
    for (let i = 0; i < attempts.length; i++) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: attempts[i] });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
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
    const candidates = ['avc1.42001f', 'avc1.4d001f', 'vp8'];
    const accelerations = ['prefer-hardware', 'no-preference', 'prefer-software'];
    for (let a = 0; a < accelerations.length; a++) {
      for (let i = 0; i < candidates.length; i++) {
        const config = {
          codec: candidates[i],
          width: width,
          height: height,
          bitrate: accelerations[a] === 'prefer-software' ? 1200000 : 2500000,
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
    // TCP JPEG is the one-second hitch. Never start it. SESSIONS.md, 5 October 2026.
    return;
    if (jpegMode || id !== session) return;
    const token = fallbackToken;
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
      if (token !== fallbackToken || id !== session || !jpegMode) return;
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
    // TCP WebCodecs is the one-second hitch. Never start it. SESSIONS.md, 5 October 2026.
    return;
    const token = fallbackToken;
    if (typeof VideoEncoder === 'undefined' || typeof MediaStreamTrackProcessor === 'undefined') {
      throw new Error('no-webcodecs');
    }
    const track = localStream.getVideoTracks()[0];
    const processor = new MediaStreamTrackProcessor({ track: track });
    reader = processor.readable.getReader();
    const first = await reader.read();
    if (token !== fallbackToken || id !== session) {
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
        const kind = chunk.type === 'key' ? 1 : 2;
        if (!sendPacket(kind, data, capturedAt) && kind === 1) forceKey = true;
      },
      error: function () {
        if (token !== fallbackToken || id !== session || jpegMode) return;
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
      // Shed only when the encoder or the socket is actually seconds behind.
      // Dropping on a small buffer, then forcing a keyframe, was the stutter.
      if (encoder.encodeQueueSize > 4 || (ws && ws.bufferedAmount > 1500000)) {
        fitted.close();
        return true;
      }
      const key = !!forceKey;
      captureTimes.push(Date.now());
      forceKey = false;
      encoder.encode(fitted, { keyFrame: key });
      fitted.close();
      return true;
    }
    setStatus('داره فرستاده می‌شه. این صفحه رو نبند.');
    if (take(frame) === false) return;
    while (token === fallbackToken && id === session && !jpegMode) {
      const next = await reader.read();
      if (next.done || id !== session) {
        if (next.value) next.value.close();
        break;
      }
      if (take(next.value) === false) break;
    }
  }

  let pc = null;
  let iceQueue = [];
  let offerTimer = 0;
  let rtcGen = 0;
  let rtcReadyGen = 0;
  let dropTimer = 0;
  let directEver = false;
  let directMisses = 0;

  function stunUrl() {
    const port = (Number(location.port) || 443) + 1;
    return 'stun:' + location.hostname + ':' + port;
  }

  function sendJson(obj) {
    if (!ws || ws.readyState !== 1 || !hello) return;
    ws.send(JSON.stringify(obj));
  }

  function closeRtc() {
    rtcReadyGen = 0;
    if (dropTimer) {
      clearTimeout(dropTimer);
      dropTimer = 0;
    }
    if (offerTimer) {
      clearInterval(offerTimer);
      offerTimer = 0;
    }
    iceQueue = [];
    if (pc) {
      try {
        pc.close();
      } catch (err) {
        // already closed
      }
      pc = null;
    }
  }

  function noteRtcDrop(gen) {
    if (gen !== rtcGen || gen !== rtcReadyGen) return;
    if (dropTimer) return;
    dropTimer = setTimeout(function () {
      dropTimer = 0;
      if (gen !== rtcGen || gen !== rtcReadyGen || !running || !stream || !pc) return;
      const ice = pc.iceConnectionState;
      const conn = pc.connectionState;
      // "disconnected" on Wi-Fi comes back by itself. Tearing the link down
      // here dropped the phone onto the TCP video path, which hitches.
      const down = ice === 'failed' || ice === 'closed' || conn === 'failed' || conn === 'closed';
      if (!down) return;
      openDirect();
    }, 800);
  }

  // The studio page asks for this whenever its socket is new: refresh, or a
  // return from another page. The old link stays "up" on the phone otherwise,
  // and the new page has nothing to paint.
  let directHold = 0;

  // A burst of restarts, about twice a second, tore the direct link down and
  // the status flipped. One restart still has to go through: a new dashboard
  // page has nothing to paint until the phone offers again.
  function requestDirect() {
    if (directHold) return;
    directHold = setTimeout(function () {
      directHold = 0;
    }, 1200);
    openDirect();
  }

  function openDirect() {
    if (!running || !stream) return Promise.resolve(false);
    const id = session;
    const gen = ++rtcGen;
    stopFallback();
    if (!directEver) setStatus('دارم تصویر را مستقیم می‌فرستم');
    return startRtc(stream, id, gen).then(function (ok) {
      if (gen !== rtcGen || id !== session) return false;
      if (ok) {
        directEver = true;
        directMisses = 0;
        setStatus('داره مستقیم فرستاده می‌شه. این صفحه رو نبند.');
        return true;
      }
      // WebCodecs and JPEG on the websocket are the one-second hitch.
      // See SESSIONS.md, 5 October 2026. Never leave the direct path.
      setTimeout(function () {
        if (!running || id !== session || rtcGen !== gen) return;
        openDirect();
      }, 800);
      return false;
    });
  }

  function acceptRtcAnswer(msg) {
    if (!pc || !msg || !msg.sdp || pc.remoteDescription) return;
    pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
      .then(function () {
        const queued = iceQueue;
        iceQueue = [];
        queued.forEach(function (candidate) {
          pc.addIceCandidate(candidate).catch(function () {});
        });
      })
      .catch(function () {});
  }

  function acceptRtcIce(msg) {
    if (!pc || !msg || !msg.candidate) return;
    if (!pc.remoteDescription) {
      iceQueue.push(msg.candidate);
      return;
    }
    pc.addIceCandidate(msg.candidate).catch(function () {});
  }

  function waitHello(id) {
    return new Promise(function (resolve) {
      const started = Date.now();
      const timer = setInterval(function () {
        if (id !== session || hello || Date.now() - started > 2500) {
          clearInterval(timer);
          resolve(!!hello && id === session);
        }
      }, 40);
    });
  }

  function tuneSender() {
    if (!pc) return;
    const sender = pc.getSenders().find(function (item) {
      return item.track && item.track.kind === 'video';
    });
    if (!sender || !sender.getParameters) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = 4000000;
      params.encodings[0].maxFramerate = 30;
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';
      params.degradationPreference = 'maintain-framerate';
      sender.setParameters(params).catch(function () {});
    } catch (err) {
      // the browser kept its own bitrate
    }
  }

  function rtcUp() {
    if (!pc) return false;
    const ice = pc.iceConnectionState;
    return ice === 'connected' || ice === 'completed' || pc.connectionState === 'connected';
  }

  // Live picture goes phone browser to studio browser (UDP), not through the
  // websocket. A big keyframe on that TCP socket freezes every later frame for
  // a fraction of a second, about once a second. The laptop webcam never uses
  // this socket, so only phones hitch. See SESSIONS.md, 5 October 2026.
  // If this returns false, retry the same direct link. Do not start WebCodecs
  // or JPEG. The phone status must say it is sending directly when this path is up.
  function startRtc(localStream, id, gen) {
    closeRtc();
    if (typeof RTCPeerConnection === 'undefined') return Promise.resolve(false);
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return Promise.resolve(false);
    try {
      videoTrack.contentHint = 'motion';
    } catch (err) {
      // older browsers ignore contentHint
    }
    pc = new RTCPeerConnection({
      iceServers: [{ urls: stunUrl() }],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    pc.addTransceiver(videoTrack, {
      direction: 'sendonly',
      sendEncodings: [{ maxBitrate: 4000000, maxFramerate: 30 }],
    });
    pc.onicecandidate = function (ev) {
      if (!ev.candidate) return;
      const candidate = ev.candidate.toJSON ? ev.candidate.toJSON() : {
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex,
      };
      sendJson({ type: 'rtc-ice', candidate: candidate });
    };
    return new Promise(function (resolve) {
      let settled = false;
      let arm = 0;
      let giveUp = 0;
      function finish(ok) {
        if (settled) return;
        settled = true;
        clearTimeout(arm);
        clearTimeout(giveUp);
        if (ok && gen === rtcGen) rtcReadyGen = gen;
        if (offerTimer) {
          clearInterval(offerTimer);
          offerTimer = 0;
        }
        resolve(ok && gen === rtcGen);
      }
      arm = setTimeout(function () {
        if (gen !== rtcGen || !pc) return;
        if (rtcUp()) {
          finish(true);
          return;
        }
        const ice = pc.iceConnectionState;
        if (ice === 'checking' || ice === 'connected' || ice === 'completed') return;
        finish(false);
      }, 8000);
      giveUp = setTimeout(function () {
        if (gen !== rtcGen) return;
        if (rtcUp()) finish(true);
        else finish(false);
      }, 20000);
      pc.oniceconnectionstatechange = function () {
        if (gen !== rtcGen || !pc) return;
        if (rtcUp()) {
          tuneSender();
          finish(true);
          return;
        }
        const ice = pc.iceConnectionState;
        if (gen === rtcReadyGen && (ice === 'failed' || ice === 'closed')) {
          noteRtcDrop(gen);
        }
      };
      pc.onconnectionstatechange = function () {
        if (gen !== rtcGen || !pc) return;
        if (pc.connectionState === 'connected') {
          tuneSender();
          finish(true);
          return;
        }
        if (pc.connectionState === 'failed' && !settled) {
          finish(false);
          return;
        }
        if (
          gen === rtcReadyGen &&
          (pc.connectionState === 'failed' || pc.connectionState === 'closed')
        ) {
          noteRtcDrop(gen);
        }
      };
      waitHello(id).then(function (ready) {
        if (!ready || id !== session || !pc) {
          finish(false);
          return;
        }
        pc.createOffer()
          .then(function (offer) {
            return pc.setLocalDescription(offer);
          })
          .then(function () {
            if (gen !== rtcGen || id !== session || !pc || !pc.localDescription) return;
            sendJson({ type: 'rtc-offer', sdp: pc.localDescription.sdp, offerId: gen });
            offerTimer = setInterval(function () {
              if (gen !== rtcGen || !pc || !pc.localDescription || id !== session) return;
              if (rtcUp()) return;
              sendJson({ type: 'rtc-offer', sdp: pc.localDescription.sdp, offerId: gen });
            }, 1200);
          })
          .catch(function () {
            finish(false);
          });
      });
    });
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
      document.body.classList.add('streaming');
      if (audioWanted) startAudio(id);
      await openDirect();
    } catch (err) {
      if (id !== session) return;
      document.body.classList.remove('streaming');
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
