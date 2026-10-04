(function () {
  const state = {
    cameras: [],
    mics: [],
    meterValue: -100,
    stream: null,
    rawStream: null,
    canvasStream: null,
    drawHandle: null,
    audioContext: null,
    analyser: null,
    silentWarning: false,
    orientation: 'landscape',
    phoneNote: '',
    micDelay: null,
    usingPhone: false,
    split: false,
    rotate: false,
    cutSeconds: 1.5,
    cutStartedAt: 0,
    extraStreams: [],
    extraVideos: [],
  };
  window.__reel = state;

  // The physical webcam decides what resolution it actually hands back for a
  // requested width/height, and that choice is not reliable across devices
  // (one webcam handed back a 1:1 crop for a requested 1080x1920). Always
  // asking the camera for its native landscape frame and then cropping and
  // scaling it on a canvas guarantees the exact published resolution below,
  // regardless of what the driver decides to do with an odd request.
  const ORIENTATIONS = {
    landscape: { ratio: 16 / 9, width: 1920, height: 1080 },
    square: { ratio: 1, width: 1080, height: 1080 },
    vertical: { ratio: 9 / 16, width: 1080, height: 1920 },
  };

  const cameraSelect = document.getElementById('camera-select');
  const micSelect = document.getElementById('mic-select');
  const preview = document.getElementById('preview');
  const rawCam = document.getElementById('raw-cam');
  const canvas = document.getElementById('frame-canvas');
  const ctx = canvas.getContext('2d');
  const meterBar = document.getElementById('meter-bar');
  const readiness = document.getElementById('readiness');
  const splitBtn = document.getElementById('split-cameras');
  const rotateBtn = document.getElementById('rotate-cameras');
  const cutSecondsInput = document.getElementById('cut-seconds');
  const cutSecondsWrap = document.getElementById('cut-seconds-wrap');
  let previewToken = 0;
  let devicesReady = false;

  function multiActive() {
    return !!(state.split || state.rotate);
  }

  function cutIntervalMs() {
    const value = Number(state.cutSeconds);
    if (!Number.isFinite(value)) return 1500;
    return Math.max(300, Math.min(30000, Math.round(value * 1000)));
  }

  function resetCutClock() {
    state.cutStartedAt = performance.now();
  }
  state.resetCutClock = resetCutClock;

  const orientationButtons = {
    landscape: document.getElementById('orientation-landscape'),
    square: document.getElementById('orientation-square'),
    vertical: document.getElementById('orientation-vertical'),
  };

  function loadStoredId(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (e) {
      return '';
    }
  }

  function storeId(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // localStorage might be unavailable, the picker still works this session
    }
  }

  async function fetchPreferredNames() {
    try {
      const res = await fetch('/api/devices-config');
      return await res.json();
    } catch (e) {
      return { preferredCamera: '', preferredMic: '' };
    }
  }

  function fillSelect(select, devices, preferredName, storedId) {
    select.innerHTML = '';
    devices.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || 'دستگاه بدون اسم';
      select.appendChild(opt);
    });
    let pick = '';
    if (storedId && devices.some((d) => d.deviceId === storedId)) {
      pick = storedId;
    } else if (preferredName) {
      const match = devices.find((d) => d.label.includes(preferredName));
      if (match) pick = match.deviceId;
    }
    if (!pick && devices.length) pick = devices[0].deviceId;
    select.value = pick;
    return pick;
  }

  function renderCameraSelect(preferredName) {
    const previous = cameraSelect.value;
    const storedId = loadStoredId('reel.cameraId');
    cameraSelect.innerHTML = '';
    state.cameras.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || 'دستگاه بدون اسم';
      cameraSelect.appendChild(opt);
    });
    if (window.__reelPhone && window.__reelPhone.cameras) {
      window.__reelPhone.cameras().forEach((phone) => {
        const phoneOpt = document.createElement('option');
        phoneOpt.value = 'phone:' + phone.id;
        phoneOpt.textContent = phone.label || 'دوربین موبایل';
        cameraSelect.appendChild(phoneOpt);
      });
    }
    const ids = Array.from(cameraSelect.options).map((opt) => opt.value);
    let pick = '';
    if (previous && ids.includes(previous)) pick = previous;
    else if (storedId && ids.includes(storedId)) pick = storedId;
    else if (preferredName) {
      const match = state.cameras.find((d) => d.label.includes(preferredName));
      if (match) pick = match.deviceId;
    }
    if (!pick && state.cameras.length) pick = state.cameras[0].deviceId;
    if (pick) cameraSelect.value = pick;
    renderSplitPicks();
    return pick;
  }

  function isPhoneMic(id) {
    return typeof id === 'string' && id.indexOf('phone-mic:') === 0;
  }

  function phoneMicId(id) {
    return isPhoneMic(id) ? id.slice('phone-mic:'.length) : '';
  }

  function renderMicSelect(preferredName) {
    const previous = micSelect.value;
    const storedId = loadStoredId('reel.micId');
    micSelect.innerHTML = '';
    state.mics.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || 'دستگاه بدون اسم';
      micSelect.appendChild(opt);
    });
    if (window.__reelPhone && window.__reelPhone.mics) {
      window.__reelPhone.mics().forEach((mic) => {
        const opt = document.createElement('option');
        opt.value = 'phone-mic:' + mic.id;
        opt.textContent = mic.label || 'میکروفون موبایل';
        micSelect.appendChild(opt);
      });
    }
    const ids = Array.from(micSelect.options).map((opt) => opt.value);
    let pick = '';
    if (previous && ids.includes(previous)) pick = previous;
    else if (storedId && ids.includes(storedId)) pick = storedId;
    else if (preferredName) {
      const match = state.mics.find((d) => d.label.includes(preferredName));
      if (match) pick = match.deviceId;
    }
    if (!pick && state.mics.length) pick = state.mics[0].deviceId;
    if (!pick && ids.length) pick = ids[0];
    if (pick) micSelect.value = pick;
    return pick;
  }

  async function enumerate(preferredCamera, preferredMic) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.cameras = devices.filter((d) => d.kind === 'videoinput');
    state.mics = devices.filter((d) => d.kind === 'audioinput');
    const camId = renderCameraSelect(preferredCamera);
    const micId = renderMicSelect(preferredMic);
    return { camId, micId };
  }

  function stopTracks(tracks) {
    (tracks || []).forEach((track) => {
      try {
        track.stop();
      } catch (e) {
        // already ended
      }
    });
  }

  function stopStream() {
    if (state.drawHandle !== null) {
      cancelAnimationFrame(state.drawHandle);
      state.drawHandle = null;
    }
    if (state.canvasStream) {
      stopTracks(state.canvasStream.getTracks());
      state.canvasStream = null;
    }
    if (state.rawStream) {
      stopTracks(state.rawStream.getTracks());
      state.rawStream = null;
    }
    state.stream = null;
    state.micDelay = null;
    state.usingPhone = false;
    document.body.classList.remove('phone-cam-live');
    releaseExtras();
    if (state.audioContext) {
      state.audioContext.close();
      state.audioContext = null;
      state.analyser = null;
    }
  }

  function releaseExtras() {
    (state.extraStreams || []).forEach((stream) => stopTracks(stream.getTracks()));
    state.extraStreams = [];
    (state.extraVideos || []).forEach((video) => {
      video.srcObject = null;
      if (video.parentNode) video.parentNode.removeChild(video);
    });
    state.extraVideos = [];
    state.splitSlots = null;
  }

  function streamIsLive() {
    const s = state.stream;
    if (!s) return false;
    const video = s.getVideoTracks().some((t) => t.readyState === 'live');
    const audio = s.getAudioTracks().some((t) => t.readyState === 'live');
    return video && audio;
  }

  function mediaErrorText(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'دسترسی به دوربین یا میکروفون داده نشد';
    }
    if (name === 'NotReadableError') {
      return 'دوربین یا میکروفون در اختیار یه برنامهٔ دیگه‌ست';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'این دوربین یا میکروفون باز نشد';
    }
    if (err && err.message === 'no-video-size' && cameraSelect.value === 'phone') {
      return 'از گوشی تصویری نمیاد. صفحه‌ی دوربین گوشی رو باز نگه دار';
    }
    if (err && err.message === 'phone-mic') {
      return 'میکروفون گوشی هنوز آماده نیست. صفحه‌ی گوشی رو باز نگه دار و چند ثانیه صبر کن';
    }
    return 'دوربین یا میکروفون باز نشد';
  }

  async function openPhoneMicStream(micId) {
    const id = phoneMicId(micId);
    const stream = window.__reelPhone && window.__reelPhone.audioStreamFor
      ? window.__reelPhone.audioStreamFor(id)
      : null;
    const track = stream && stream.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') {
      throw new Error('phone-mic');
    }
    // Clone so stopping a preview stream never kills the shared phone mic.
    return new MediaStream([track.clone()]);
  }

  async function openDevices(camId, micId) {
    if (isPhoneMic(micId)) {
      const videoAttempts = [
        {
          video: Object.assign(
            { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
            camId && !String(camId).startsWith('phone') ? { deviceId: { ideal: camId } } : {}
          ),
          audio: false,
        },
        {
          video: camId && !String(camId).startsWith('phone') ? { deviceId: { ideal: camId } } : true,
          audio: false,
        },
      ];
      let videoStream = null;
      let lastErr;
      for (const constraints of videoAttempts) {
        try {
          videoStream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!videoStream) throw lastErr || new Error('camera');
      const audioStream = await openPhoneMicStream(micId);
      return new MediaStream(
        videoStream.getVideoTracks().concat(audioStream.getAudioTracks())
      );
    }
    const attempts = [
      {
        video: Object.assign(
          { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          camId ? { deviceId: { ideal: camId } } : {}
        ),
        audio: Object.assign(
          { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          micId ? { deviceId: { ideal: micId } } : {}
        ),
      },
      {
        video: camId ? { deviceId: { ideal: camId } } : true,
        audio: micId ? { deviceId: { ideal: micId } } : true,
      },
      { video: true, audio: true },
    ];
    let lastErr;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async function openMic(micId) {
    if (isPhoneMic(micId)) return openPhoneMicStream(micId);
    const attempts = [
      {
        audio: Object.assign(
          { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          micId ? { deviceId: { ideal: micId } } : {}
        ),
        video: false,
      },
      {
        audio: micId ? { deviceId: { ideal: micId } } : true,
        video: false,
      },
    ];
    let lastErr;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  function waitForPhoneFrame(target) {
    function ready() {
      return target && target.width > 2 && target.height > 2;
    }
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('no-video-size'));
      }, 8000);
      const interval = setInterval(() => {
        if (!window.__reelPhone || !window.__reelPhone.connected) return;
        if (ready()) {
          cleanup();
          resolve();
        }
      }, 80);
      function cleanup() {
        clearTimeout(timer);
        clearInterval(interval);
      }
    });
  }

  function waitForVideoSize(videoEl) {
    if (videoEl.videoWidth && videoEl.videoHeight) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no-video-size')), 4000);
      videoEl.addEventListener(
        'loadedmetadata',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }

  // Cover fit: crop the source frame to the target ratio (centered), so the
  // canvas draw below is a plain crop plus uniform scale, never a squeeze.
  function computeCropRect(srcW, srcH, targetRatio) {
    const srcRatio = srcW / srcH;
    if (srcRatio > targetRatio) {
      const sh = srcH;
      const sw = srcH * targetRatio;
      return { sx: (srcW - sw) / 2, sy: 0, sw, sh };
    }
    const sw = srcW;
    const sh = srcW / targetRatio;
    return { sx: 0, sy: (srcH - sh) / 2, sw, sh };
  }

  async function startPreview(camId, micId) {
    const token = ++previewToken;
    if (multiActive()) return startSplitPreview(micId, token);
    if (camId === 'phone' || (typeof camId === 'string' && camId.indexOf('phone:') === 0)) {
      return startPhonePreview(micId, camId);
    }
    // Open the new camera before stopping the old one. Chrome's "only this
    // time" permission is revoked as soon as every track from that grant is
    // stopped, so a probe that stops first makes the real request fail.
    const stream = await openDevices(camId, micId);
    const previous = {
      drawHandle: state.drawHandle,
      canvasStream: state.canvasStream,
      rawStream: state.rawStream,
      audioContext: state.audioContext,
      analyser: state.analyser,
      micDelay: state.micDelay,
      usingPhone: state.usingPhone,
    };
    state.drawHandle = null;
    state.canvasStream = null;
    state.rawStream = stream;
    state.audioContext = null;
    state.analyser = null;
    state.micDelay = null;
    state.usingPhone = false;
    document.body.classList.remove('phone-cam-live');

    rawCam.srcObject = stream;
    try {
      await rawCam.play().catch(() => {});
      await waitForVideoSize(rawCam);
    } catch (err) {
      stopTracks(stream.getTracks());
      state.rawStream = previous.rawStream;
      state.drawHandle = previous.drawHandle;
      state.canvasStream = previous.canvasStream;
      state.audioContext = previous.audioContext;
      state.analyser = previous.analyser;
      state.micDelay = previous.micDelay;
      state.usingPhone = previous.usingPhone;
      rawCam.srcObject = previous.rawStream;
      throw err;
    }

    if (previous.drawHandle !== null) cancelAnimationFrame(previous.drawHandle);
    if (previous.canvasStream) stopTracks(previous.canvasStream.getTracks());
    if (previous.rawStream) stopTracks(previous.rawStream.getTracks());
    if (previous.audioContext) previous.audioContext.close();
    releaseExtras();

    const target = ORIENTATIONS[state.orientation] || ORIENTATIONS.landscape;
    canvas.width = target.width;
    canvas.height = target.height;

    function drawFrame() {
      const { sx, sy, sw, sh } = computeCropRect(rawCam.videoWidth, rawCam.videoHeight, target.ratio);
      ctx.drawImage(rawCam, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      state.drawHandle = requestAnimationFrame(drawFrame);
    }
    drawFrame();

    const canvasStream = canvas.captureStream(30);
    state.canvasStream = canvasStream;
    const audioTrack = stream.getAudioTracks()[0];
    const combined = canvasStream.getVideoTracks().concat(audioTrack ? [audioTrack] : []);
    state.stream = new MediaStream(combined);
    preview.srcObject = state.stream;

    const videoTrack = stream.getVideoTracks()[0];
    readiness.dataset.camera = videoTrack ? videoTrack.label : 'بدون دوربین';
    readiness.dataset.mic = audioTrack ? audioTrack.label : 'بدون میکروفون';
    readiness.dataset.resolution = `${canvas.width}x${canvas.height}`;

    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 2048;
    source.connect(state.analyser);
    // An AnalyserNode with no path to the destination is never pulled by the
    // audio graph, so it never updates. Route it through a silent gain node
    // instead of playing the microphone back out loud.
    const silentSink = state.audioContext.createGain();
    silentSink.gain.value = 0;
    state.analyser.connect(silentSink);
    silentSink.connect(state.audioContext.destination);

    if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});
    state.phoneNote = '';
    renderReadiness();
    tickMeter();
  }

  async function startPhonePreview(micId, camId) {
    const phoneKey = camId && camId.indexOf('phone:') === 0 ? camId.slice(6) : '';
    const phoneCanvas = phoneKey && window.__reelPhone.canvasFor
      ? window.__reelPhone.canvasFor(phoneKey)
      : window.__reelPhone && window.__reelPhone.canvas;
    if (!window.__reelPhone || !window.__reelPhone.connected || !phoneCanvas) {
      throw Object.assign(new Error('no-phone'), { name: 'NotFoundError' });
    }
    const stream = await openMic(micId);
    try {
      await waitForPhoneFrame(phoneCanvas);
    } catch (err) {
      stopTracks(stream.getTracks());
      throw err;
    }

    const previous = {
      drawHandle: state.drawHandle,
      canvasStream: state.canvasStream,
      rawStream: state.rawStream,
      audioContext: state.audioContext,
      analyser: state.analyser,
    };
    state.drawHandle = null;
    state.canvasStream = null;
    state.rawStream = stream;
    state.audioContext = null;
    state.analyser = null;
    state.micDelay = null;
    state.usingPhone = true;

    if (previous.drawHandle !== null) cancelAnimationFrame(previous.drawHandle);
    if (previous.canvasStream) stopTracks(previous.canvasStream.getTracks());
    if (previous.rawStream) stopTracks(previous.rawStream.getTracks());
    if (previous.audioContext) previous.audioContext.close();
    releaseExtras();
    rawCam.srcObject = null;

    const corner = document.getElementById('tp-phone-view');
    const cornerCtx = corner ? corner.getContext('2d') : null;
    const target = ORIENTATIONS[state.orientation] || ORIENTATIONS.landscape;
    canvas.width = target.width;
    canvas.height = target.height;
    if (corner) {
      corner.width = 360;
      corner.height = Math.max(2, Math.round(360 * target.height / target.width));
    }

    function drawFrame() {
      if (state.micDelay && state.audioContext) {
        const seconds = Math.max(0, Math.min(0.8, (window.__reelPhone.lagMs || 0) / 1000));
        if (Math.abs(state.micDelay.delayTime.value - seconds) > 0.03) {
          state.micDelay.delayTime.value = seconds;
        }
      }
      if (phoneCanvas.width > 2 && phoneCanvas.height > 2) {
        const crop = computeCropRect(phoneCanvas.width, phoneCanvas.height, target.ratio);
        ctx.drawImage(phoneCanvas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
        if (cornerCtx) {
          cornerCtx.drawImage(canvas, 0, 0, corner.width, corner.height);
        }
      }
      state.drawHandle = requestAnimationFrame(drawFrame);
    }
    drawFrame();

    const canvasStream = canvas.captureStream(30);
    state.canvasStream = canvasStream;
    const audioTrack = stream.getAudioTracks()[0];
    let recordedAudio = audioTrack;
    if (audioTrack) {
      state.audioContext = new AudioContext();
      const source = state.audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      const delay = state.audioContext.createDelay(1.2);
      delay.delayTime.value = 0;
      state.micDelay = delay;
      const dest = state.audioContext.createMediaStreamDestination();
      source.connect(delay);
      delay.connect(dest);
      recordedAudio = dest.stream.getAudioTracks()[0] || audioTrack;
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 2048;
      source.connect(state.analyser);
      const silentSink = state.audioContext.createGain();
      silentSink.gain.value = 0;
      state.analyser.connect(silentSink);
      silentSink.connect(state.audioContext.destination);
      if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});
    }
    const combined = canvasStream.getVideoTracks().concat(recordedAudio ? [recordedAudio] : []);
    state.stream = new MediaStream(combined);
    preview.srcObject = state.stream;
    readiness.dataset.camera = 'دوربین موبایل';
    readiness.dataset.mic = audioTrack ? audioTrack.label : 'بدون میکروفون';
    readiness.dataset.resolution = `${canvas.width}x${canvas.height}`;
    state.phoneNote = '';
    document.body.classList.add('phone-cam-live');
    renderReadiness();
    tickMeter();
  }

  async function openVideoOnly(deviceId) {
    const attempts = [
      {
        video: {
          deviceId: { ideal: deviceId },
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
      {
        video: {
          deviceId: { ideal: deviceId },
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
      { video: { deviceId: { ideal: deviceId } }, audio: false },
    ];
    let lastErr;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  function bandBox(index, count, width, height) {
    const y0 = Math.round((index * height) / count);
    const y1 = Math.round(((index + 1) * height) / count);
    return { y: y0, h: y1 - y0, w: width };
  }

  function drawCover(source, destX, destY, destW, destH) {
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    if (!sw || !sh || destH < 1 || destW < 1) {
      ctx.fillStyle = '#000';
      ctx.fillRect(destX, destY, destW, destH);
      return;
    }
    const crop = computeCropRect(sw, sh, destW / destH);
    ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, destX, destY, destW, destH);
  }

  function readList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return Array.isArray(value) ? value : null;
    } catch (e) {
      return null;
    }
  }

  function writeList(key, list) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) {
      // localStorage might be unavailable
    }
  }

  function faDigits(n) {
    return String(n).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[digit]);
  }

  function cameraChoices() {
    const list = state.cameras.map((cam) => ({
      id: cam.deviceId,
      label: cam.label || 'دوربین',
    }));
    if (window.__reelPhone && window.__reelPhone.cameras) {
      window.__reelPhone.cameras().forEach((phone) => {
        list.push({ id: 'phone:' + phone.id, label: phone.label || 'دوربین موبایل' });
      });
    }
    return list;
  }

  function syncSplitLists() {
    const choices = cameraChoices();
    const ids = choices.map((item) => item.id);
    let order = readList('reel.splitOrder') || [];
    let enabled = readList('reel.splitOn');
    const seen = readList('reel.splitSeen') || [];
    ids.forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });
    order = order.filter((id) => ids.includes(id));
    if (!enabled) {
      enabled = order.slice();
    } else {
      ids.forEach((id) => {
        if (!seen.includes(id) && !enabled.includes(id)) enabled.push(id);
      });
      enabled = order.filter((id) => enabled.includes(id));
    }
    if (!enabled.length && order.length) enabled = [order[0]];
    writeList('reel.splitOrder', order);
    writeList('reel.splitOn', enabled);
    writeList('reel.splitSeen', ids);
    state.splitOrder = order;
    state.splitOn = enabled;
    return choices;
  }

  function applySplitOrder() {
    if (!state.splitSlots) return;
    const byId = {};
    state.splitSlots.forEach((slot) => {
      byId[slot.id] = slot;
    });
    const next = [];
    state.splitOrder.forEach((id) => {
      if (state.splitOn.includes(id) && byId[id]) next.push(byId[id]);
    });
    state.splitSlots = next;
  }

  async function startSplitPreview(micId, token) {
    const stream = await openMic(micId);
    const opened = [];
    let committed = false;
    function discardOpened() {
      stopTracks(stream.getTracks());
      opened.forEach((item) => {
        stopTracks(item.stream.getTracks());
        item.video.srcObject = null;
        if (item.video.parentNode) item.video.parentNode.removeChild(item.video);
      });
    }
    try {
      if (state.rawStream) {
        state.rawStream.getVideoTracks().forEach((track) => track.stop());
      }
      releaseExtras();
      syncSplitLists();
      const wanted = state.splitOrder.filter((id) => state.splitOn.includes(id));
      const localWanted = wanted.filter((id) => id.indexOf('phone:') !== 0);
      let missed = 0;
      for (let i = 0; i < localWanted.length; i++) {
        if (token !== previewToken) {
          discardOpened();
          return;
        }
        const id = localWanted[i];
        try {
          const videoStream = await openVideoOnly(id);
          const video = document.createElement('video');
          video.className = 'split-src';
          video.muted = true;
          video.autoplay = true;
          video.playsInline = true;
          video.srcObject = videoStream;
          document.body.appendChild(video);
          await video.play().catch(() => {});
          await waitForVideoSize(video).catch(() => {});
          opened.push({ id: id, stream: videoStream, video: video });
        } catch (err) {
          missed += 1;
        }
      }
      if (token !== previewToken) {
        discardOpened();
        return;
      }
      const slots = [];
      wanted.forEach((id) => {
        if (id.indexOf('phone:') === 0) {
          const phoneId = id.slice(6);
          const phoneView = window.__reelPhone && window.__reelPhone.canvasFor
            ? window.__reelPhone.canvasFor(phoneId)
            : null;
          if (phoneView) {
            slots.push({ id: id, kind: 'phone', phoneId: phoneId });
          } else {
            missed += 1;
          }
          return;
        }
        const found = opened.find((item) => item.id === id);
        if (found) slots.push({ id: id, kind: 'local', video: found.video });
      });
      if (!slots.length) {
        discardOpened();
        throw Object.assign(new Error('no-phone'), { name: 'NotFoundError' });
      }

      const previous = {
        drawHandle: state.drawHandle,
        canvasStream: state.canvasStream,
        rawStream: state.rawStream,
        audioContext: state.audioContext,
        analyser: state.analyser,
      };
      state.drawHandle = null;
      state.canvasStream = null;
      state.rawStream = stream;
      state.audioContext = null;
      state.analyser = null;
      state.micDelay = null;
      state.usingPhone = !!slots.some((slot) => slot.kind === 'phone');
      if (previous.drawHandle !== null) cancelAnimationFrame(previous.drawHandle);
      if (previous.canvasStream) stopTracks(previous.canvasStream.getTracks());
      if (previous.rawStream) stopTracks(previous.rawStream.getTracks());
      if (previous.audioContext) previous.audioContext.close();
      releaseExtras();
      committed = true;
      rawCam.srcObject = null;
      state.extraStreams = opened.map((item) => item.stream);
      state.extraVideos = opened.map((item) => item.video);
      state.splitSlots = slots;

      const target = state.split
        ? ORIENTATIONS.vertical
        : ORIENTATIONS[state.orientation] || ORIENTATIONS.landscape;
      canvas.width = target.width;
      canvas.height = target.height;
      const corner = document.getElementById('tp-phone-view');
      const cornerCtx = corner ? corner.getContext('2d') : null;
      if (corner) {
        corner.width = 360;
        corner.height = Math.max(2, Math.round((360 * target.height) / target.width));
      }
      if (!state.cutStartedAt) resetCutClock();
      function sourceForSlot(slot) {
        if (slot.kind === 'phone') {
          return window.__reelPhone.canvasFor(slot.phoneId) || { width: 0, height: 0 };
        }
        return slot.video;
      }
      function drawFrame() {
        const slotsNow = state.splitSlots || [];
        const count = slotsNow.length || 1;
        if (state.rotate) {
          const interval = cutIntervalMs();
          const index = Math.floor((performance.now() - state.cutStartedAt) / interval) % count;
          const slot = slotsNow[index] || slotsNow[0];
          if (slot) drawCover(sourceForSlot(slot), 0, 0, canvas.width, canvas.height);
        } else {
          for (let i = 0; i < slotsNow.length; i++) {
            const box = bandBox(i, count, canvas.width, canvas.height);
            drawCover(sourceForSlot(slotsNow[i]), 0, box.y, box.w, box.h);
          }
        }
        if (cornerCtx) cornerCtx.drawImage(canvas, 0, 0, corner.width, corner.height);
        state.drawHandle = requestAnimationFrame(drawFrame);
      }
      drawFrame();

      const canvasStream = canvas.captureStream(30);
      state.canvasStream = canvasStream;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        state.audioContext = new AudioContext();
        const source = state.audioContext.createMediaStreamSource(stream);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 2048;
        source.connect(state.analyser);
        const silentSink = state.audioContext.createGain();
        silentSink.gain.value = 0;
        state.analyser.connect(silentSink);
        silentSink.connect(state.audioContext.destination);
        if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});
      }
      const combined = canvasStream.getVideoTracks().concat(audioTrack ? [audioTrack] : []);
      state.stream = new MediaStream(combined);
      preview.srcObject = state.stream;
      readiness.dataset.camera = state.rotate
        ? 'برش ' + faDigits(slots.length) + ' دوربین'
        : faDigits(slots.length) + ' دوربین';
      readiness.dataset.mic = audioTrack ? audioTrack.label : 'بدون میکروفون';
      readiness.dataset.resolution = `${canvas.width}x${canvas.height}`;
      state.phoneNote = missed ? 'بعضی دوربین‌ها باز نشدن' : '';
      document.body.classList.add('phone-cam-live');
      renderReadiness();
      tickMeter();
    } catch (err) {
      if (!committed) discardOpened();
      throw err;
    }
  }

  function trackDeviceId(stream, kind) {
    if (!stream) return '';
    const track = stream.getTracks().find((t) => t.kind === kind);
    if (!track || !track.getSettings) return '';
    return track.getSettings().deviceId || '';
  }

  async function ensureStream() {
    if (streamIsLive()) {
      if (state.audioContext && state.audioContext.state === 'suspended') {
        await state.audioContext.resume().catch(() => {});
      }
      if (rawCam.paused) rawCam.play().catch(() => {});
      return state.stream;
    }
    await startPreview(cameraSelect.value, micSelect.value);
    if (state.audioContext && state.audioContext.state === 'suspended') {
      await state.audioContext.resume().catch(() => {});
    }
    return state.stream;
  }

  function renderReadiness() {
    const d = readiness.dataset;
    const level = Math.round(state.meterValue);
    let text = `دوربین: ${d.camera || ''} (${d.resolution || ''})، میکروفون: ${d.mic || ''}، سطح: ${level} dBFS`;
    if (state.silentWarning) text += '، صدایی نمیاد';
    if (state.phoneNote) text += '، ' + state.phoneNote;
    readiness.textContent = text;
    readiness.classList.toggle('clip-warning', state.meterValue > -3);
    readiness.classList.toggle('silent-warning', !!state.silentWarning);
  }

  let silenceStart = null;
  let meterGen = 0;
  function tickMeter() {
    const gen = ++meterGen;
    function step() {
      if (gen !== meterGen || !state.analyser) return;
      const buffer = new Float32Array(state.analyser.fftSize);
      state.analyser.getFloatTimeDomainData(buffer);
      let peak = 0;
      for (let i = 0; i < buffer.length; i++) {
        const abs = Math.abs(buffer[i]);
        if (abs > peak) peak = abs;
      }
      const dbfs = peak > 0 ? 20 * Math.log10(peak) : -100;
      state.meterValue = dbfs;

      const pct = Math.max(0, Math.min(100, (dbfs + 60) * (100 / 60)));
      meterBar.style.width = pct + '%';
      meterBar.classList.toggle('clip', dbfs > -3);

      const now = performance.now();
      if (dbfs < -45) {
        if (silenceStart === null) silenceStart = now;
        state.silentWarning = now - silenceStart > 3000;
      } else {
        silenceStart = null;
        state.silentWarning = false;
      }

      renderReadiness();
      requestAnimationFrame(step);
    }
    step();
  }

  function renderOrientationButtons() {
    Object.keys(orientationButtons).forEach((key) => {
      orientationButtons[key].classList.toggle('on', state.orientation === key);
      orientationButtons[key].disabled = !!state.split;
    });
  }

  function renderSplitPicks() {
    const box = document.getElementById('split-picks');
    if (!box) return;
    if (cutSecondsWrap) cutSecondsWrap.hidden = !state.rotate;
    if (!multiActive()) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const choices = syncSplitLists();
    const byId = {};
    choices.forEach((item) => {
      byId[item.id] = item;
    });
    box.hidden = false;
    box.replaceChildren();
    state.splitOrder.forEach((id, index) => {
      const item = byId[id];
      if (!item) return;
      const row = document.createElement('div');
      row.className = 'split-pick';
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.splitOn.includes(id);
      input.disabled = captureBusy();
      input.addEventListener('change', () => {
        toggleSplitId(id, input.checked);
      });
      const name = document.createElement('span');
      name.textContent = item.label;
      label.appendChild(input);
      label.appendChild(name);
      row.appendChild(label);
      const order = document.createElement('div');
      order.className = 'split-order';
      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '▲';
      up.title = 'بالا';
      up.disabled = captureBusy() || index === 0;
      up.addEventListener('click', () => moveSplit(id, -1));
      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = '▼';
      down.title = 'پایین';
      down.disabled = captureBusy() || index >= state.splitOrder.length - 1;
      down.addEventListener('click', () => moveSplit(id, 1));
      order.appendChild(up);
      order.appendChild(down);
      row.appendChild(order);
      box.appendChild(row);
    });
  }

  async function toggleSplitId(id, on) {
    if (captureBusy()) {
      state.phoneNote = 'وسط ضبط عوضش نکن';
      renderReadiness();
      renderSplitPicks();
      return;
    }
    syncSplitLists();
    let enabled = state.splitOn.filter((item) => item !== id);
    if (on) enabled = state.splitOrder.filter((item) => item === id || enabled.includes(item));
    if (!enabled.length) {
      state.phoneNote = 'حداقل یه دوربین باید روشن باشه';
      renderReadiness();
      renderSplitPicks();
      return;
    }
    state.splitOn = enabled;
    writeList('reel.splitOn', enabled);
    renderSplitPicks();
    if (!multiActive()) return;
    try {
      await startPreview(cameraSelect.value, micSelect.value);
    } catch (err) {
      if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
    }
  }

  function moveSplit(id, delta) {
    if (captureBusy()) return;
    syncSplitLists();
    const order = state.splitOrder.slice();
    const index = order.indexOf(id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= order.length) return;
    const swap = order[index];
    order[index] = order[next];
    order[next] = swap;
    state.splitOrder = order;
    writeList('reel.splitOrder', order);
    applySplitOrder();
    renderSplitPicks();
  }

  function renderSplitButton() {
    if (splitBtn) splitBtn.classList.toggle('on', !!state.split);
    if (rotateBtn) rotateBtn.classList.toggle('on', !!state.rotate);
    if (cutSecondsInput) cutSecondsInput.value = String(state.cutSeconds);
    renderSplitPicks();
  }

  async function setMultiMode(mode) {
    if (captureBusy()) {
      state.phoneNote = 'وسط ضبط عوضش نکن';
      renderReadiness();
      return;
    }
    const nextSplit = mode === 'split';
    const nextRotate = mode === 'rotate';
    const turningOff = (state.split && nextSplit) || (state.rotate && nextRotate);
    if (turningOff) {
      state.split = false;
      state.rotate = false;
      if (state.savedOrientation && ORIENTATIONS[state.savedOrientation]) {
        state.orientation = state.savedOrientation;
      }
    } else {
      if (nextSplit && !state.split) {
        state.savedOrientation = state.orientation;
        state.orientation = 'vertical';
      }
      if (nextRotate && state.split) {
        if (state.savedOrientation && ORIENTATIONS[state.savedOrientation]) {
          state.orientation = state.savedOrientation;
        }
      }
      if (nextSplit && state.rotate) state.rotate = false;
      if (nextRotate && state.split) state.split = false;
      state.split = nextSplit;
      state.rotate = nextRotate;
      if (nextRotate) resetCutClock();
    }
    storeId('reel.split', state.split ? '1' : '');
    storeId('reel.rotate', state.rotate ? '1' : '');
    renderSplitButton();
    renderOrientationButtons();
    try {
      await startPreview(cameraSelect.value, micSelect.value);
    } catch (err) {
      if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
    }
  }

  function captureBusy() {
    const phase = window.__reelCapture && window.__reelCapture.phase;
    return phase === 'recording' || phase === 'countdown';
  }

  async function setOrientation(orientation) {
    if (state.split) return;
    if (state.orientation === orientation) return;
    state.orientation = orientation;
    storeId('reel.orientation', orientation);
    renderOrientationButtons();
    try {
      await startPreview(cameraSelect.value, micSelect.value);
    } catch (err) {
      if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
    }
  }

  async function initDevices() {
    const stored = loadStoredId('reel.orientation');
    state.orientation = ORIENTATIONS[stored] ? stored : 'landscape';
    state.split = loadStoredId('reel.split') === '1';
    state.rotate = !state.split && loadStoredId('reel.rotate') === '1';
    const storedCut = Number(loadStoredId('reel.cutSeconds'));
    state.cutSeconds = Number.isFinite(storedCut) && storedCut > 0 ? storedCut : 1.5;
    if (state.split) state.orientation = 'vertical';
    renderSplitButton();
    renderOrientationButtons();
    Object.keys(orientationButtons).forEach((key) => {
      orientationButtons[key].addEventListener('click', () => setOrientation(key));
    });

    const { preferredCamera, preferredMic } = await fetchPreferredNames();
    await enumerate(preferredCamera, preferredMic);

    cameraSelect.addEventListener('change', async () => {
      storeId('reel.cameraId', cameraSelect.value);
      if (multiActive()) return;
      try {
        await startPreview(cameraSelect.value, micSelect.value);
      } catch (err) {
        if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
      }
    });
    micSelect.addEventListener('change', async () => {
      storeId('reel.micId', micSelect.value);
      try {
        await startPreview(cameraSelect.value, micSelect.value);
      } catch (err) {
        if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
      }
    });

    navigator.mediaDevices.addEventListener('devicechange', () => {
      enumerate(preferredCamera, preferredMic).then(() => {
        if (!devicesReady || !multiActive() || captureBusy()) return;
        startPreview(cameraSelect.value, micSelect.value).catch((err) => {
          if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
        });
      });
    });

    if (window.__reelPhone) {
      window.__reelPhone.onStatus = (connected) => {
        const before = cameraSelect.value;
        const micBefore = micSelect.value;
        renderCameraSelect(preferredCamera);
        renderMicSelect(preferredMic);
        if (!devicesReady) return;
        if (isPhoneMic(micBefore) && micSelect.value !== micBefore && !captureBusy()) {
          startPreview(cameraSelect.value, micSelect.value).catch((err) => {
            if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
          });
        }
        if (multiActive()) {
          if (!connected) state.phoneNote = 'دوربین موبایل قطع شد';
          renderReadiness();
          if (captureBusy()) return;
          startPreview(cameraSelect.value, micSelect.value).catch((err) => {
            if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
          });
          return;
        }
        const chosenGone = (before === 'phone' || (typeof before === 'string' && before.indexOf('phone:') === 0)) && cameraSelect.value !== before;
        if (chosenGone && !captureBusy()) {
          startPreview(cameraSelect.value, micSelect.value).catch((err) => {
            if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
          });
          return;
        }
        if (connected) {
          state.phoneNote = '';
          if (readiness.dataset.camera) renderReadiness();
          return;
        }
        if (before !== 'phone') return;
        state.phoneNote = 'دوربین موبایل قطع شد';
        renderReadiness();
        if (captureBusy()) return;
        if (!cameraSelect.value || cameraSelect.value === 'phone') return;
        storeId('reel.cameraId', cameraSelect.value);
        startPreview(cameraSelect.value, micSelect.value).catch((err) => {
          if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
        });
      };
    }

    if (splitBtn) {
      splitBtn.addEventListener('click', () => setMultiMode('split'));
    }
    if (rotateBtn) {
      rotateBtn.addEventListener('click', () => setMultiMode('rotate'));
    }
    if (cutSecondsInput) {
      const saveCut = () => {
        let value = Number(String(cutSecondsInput.value).replace(',', '.'));
        if (!Number.isFinite(value)) value = 1.5;
        value = Math.max(0.3, Math.min(30, Math.round(value * 10) / 10));
        state.cutSeconds = value;
        cutSecondsInput.value = String(value);
        storeId('reel.cutSeconds', String(value));
        if (state.rotate) resetCutClock();
      };
      cutSecondsInput.addEventListener('change', saveCut);
      cutSecondsInput.addEventListener('blur', saveCut);
    }

    devicesReady = true;
    try {
      await startPreview(cameraSelect.value, micSelect.value);
    } catch (err) {
      readiness.textContent = mediaErrorText(err);
      return;
    }

    await enumerate(preferredCamera, preferredMic);
    const camNow = trackDeviceId(state.rawStream, 'video');
    const micNow = trackDeviceId(state.rawStream, 'audio');
    const camWanted = cameraSelect.value;
    const micWanted = micSelect.value;
    if (!multiActive() && ((camWanted && camWanted !== camNow) || (micWanted && micWanted !== micNow))) {
      try {
        await startPreview(camWanted, micWanted);
      } catch (err) {
        if (!streamIsLive()) readiness.textContent = mediaErrorText(err);
      }
    }
    storeId('reel.cameraId', cameraSelect.value);
    storeId('reel.micId', micSelect.value);
  }

  state.ensureStream = ensureStream;
  initDevices();
})();
