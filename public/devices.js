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
    screenStream: null,
    screenVideo: null,
  };
  window.__reel = state;
  const SCREEN_ID = 'screen';
  const SCREEN_LABEL = 'صفحه نمایش';

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
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const meterBar = document.getElementById('meter-bar');
  const readiness = document.getElementById('readiness');
  const splitBtn = document.getElementById('split-cameras');
  const rotateBtn = document.getElementById('rotate-cameras');
  const cutSecondsInput = document.getElementById('cut-seconds');
  const cutSecondsWrap = document.getElementById('cut-seconds-wrap');
  let previewToken = 0;
  let devicesReady = false;

  function pickMode() {
    return !!(state.split || state.rotate);
  }

  function screenLive() {
    return !!(state.screenStream && state.screenStream.getVideoTracks().some((t) => t.readyState === 'live'));
  }

  // Screen share alone (no multi camera mode) still needs the composed
  // canvas: the chosen camera and the screen side by side.
  function multiActive() {
    return pickMode() || screenLive();
  }

  function wantedIds() {
    const order = state.splitOrder || [];
    if (!pickMode()) {
      const cam = cameraSelect.value;
      const pick = order.filter((id) => id === cam || id === SCREEN_ID);
      if (!pick.includes(cam) && cam) pick.unshift(cam);
      return pick;
    }
    const on = state.splitOn || [];
    return order.filter((id) => on.includes(id));
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

  function orientationButtons() {
    return document.querySelectorAll('[data-orientation]');
  }

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
    cameraChoices().forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.label || 'دستگاه بدون اسم';
      cameraSelect.appendChild(opt);
    });
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

  function micPickRank(label) {
    const text = String(label || '');
    if (/^Default\s-/i.test(text)) return 1;
    if (/^Communications\s-/i.test(text)) return 2;
    return 3;
  }

  function dedupeMics(mics) {
    const byGroup = new Map();
    mics.forEach((device) => {
      const group = device.groupId || device.deviceId;
      const rank = micPickRank(device.label);
      const prev = byGroup.get(group);
      if (!prev || rank > prev.rank) byGroup.set(group, { device: device, rank: rank });
    });
    return Array.from(byGroup.values()).map((row) => row.device);
  }

  async function enumerate(preferredCamera, preferredMic) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.cameras = devices.filter((d) => d.kind === 'videoinput');
    state.mics = dedupeMics(devices.filter((d) => d.kind === 'audioinput'));
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
    if (err && err.message === 'mic-mismatch') {
      return 'میکروفون انتخاب‌شده باز نشد. دوباره از تنظیمات انتخابش کن';
    }
    return 'دوربین یا میکروفون باز نشد';
  }

  async function openPhoneMicStream(micId) {
    const id = phoneMicId(micId);
    if (window.__reelPhone && window.__reelPhone.requestAudio) {
      window.__reelPhone.requestAudio(id);
    }
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const stream = window.__reelPhone && window.__reelPhone.audioStreamFor
        ? window.__reelPhone.audioStreamFor(id)
        : null;
      const track = stream && stream.getAudioTracks()[0];
      if (track && track.readyState !== 'ended') {
        return new MediaStream([track.clone()]);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error('phone-mic');
  }

  function assertMicDevice(stream, micId) {
    if (!micId || isPhoneMic(micId)) return stream;
    const track = stream && stream.getAudioTracks()[0];
    if (!track || !track.getSettings) {
      throw Object.assign(new Error('mic-mismatch'), { name: 'OverconstrainedError' });
    }
    const got = track.getSettings().deviceId || '';
    if (got && got !== micId) {
      stopTracks(stream.getTracks());
      throw Object.assign(new Error('mic-mismatch'), { name: 'OverconstrainedError' });
    }
    return stream;
  }

  async function openDevices(camId, micId) {
    // Open camera and mic as separate grants so a camera constraint failure
    // never falls back to the Windows default microphone.
    let videoStream;
    if (camId && !String(camId).startsWith('phone')) {
      videoStream = await openVideoOnly(camId);
    } else {
      const attempts = [
        {
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          audio: false,
        },
        { video: true, audio: false },
      ];
      let lastErr;
      for (const constraints of attempts) {
        try {
          videoStream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!videoStream) throw lastErr || new Error('camera');
    }
    let audioStream;
    try {
      audioStream = await openMic(micId);
    } catch (err) {
      stopTracks(videoStream.getTracks());
      throw err;
    }
    return new MediaStream(videoStream.getVideoTracks().concat(audioStream.getAudioTracks()));
  }

  async function openMic(micId) {
    if (isPhoneMic(micId)) return openPhoneMicStream(micId);
    const attempts = [];
    if (micId) {
      attempts.push({
        audio: {
          deviceId: { exact: micId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      attempts.push({
        audio: { deviceId: { exact: micId } },
        video: false,
      });
    } else {
      attempts.push({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      attempts.push({ audio: true, video: false });
    }
    let lastErr;
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        return assertMicDevice(stream, micId);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  function mediaSize(source) {
    if (!source) return { w: 0, h: 0 };
    return {
      w: source.videoWidth || source.displayWidth || source.width || 0,
      h: source.videoHeight || source.displayHeight || source.height || 0,
    };
  }

  function waitForPhoneFrame(target) {
    function ready() {
      const size = mediaSize(target);
      return size.w > 2 && size.h > 2;
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
    // Record the raw mic track. Routing through AudioContext destination can
    // leave MediaRecorder with silence even when the meter moves.
    if (audioTrack) {
      state.audioContext = new AudioContext();
      const source = state.audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
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
    }
    const combined = canvasStream.getVideoTracks().concat(audioTrack ? [audioTrack] : []);
    state.stream = new MediaStream(combined);
    preview.srcObject = state.stream;

    const videoTrack = stream.getVideoTracks()[0];
    readiness.dataset.camera = videoTrack ? videoTrack.label : 'بدون دوربین';
    readiness.dataset.mic = audioTrack ? audioTrack.label : 'بدون میکروفون';
    readiness.dataset.resolution = `${canvas.width}x${canvas.height}`;

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
    const portrait = height > width;
    const grid = !portrait && count === 4;
    if (grid) {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x0 = Math.round((col * width) / 2);
      const x1 = Math.round(((col + 1) * width) / 2);
      const y0 = Math.round((row * height) / 2);
      const y1 = Math.round(((row + 1) * height) / 2);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (portrait) {
      const y0 = Math.round((index * height) / count);
      const y1 = Math.round(((index + 1) * height) / count);
      return { x: 0, y: y0, w: width, h: y1 - y0 };
    }
    const x0 = Math.round((index * width) / count);
    const x1 = Math.round(((index + 1) * width) / count);
    return { x: x0, y: 0, w: x1 - x0, h: height };
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

  function drawContain(source, destX, destY, destW, destH) {
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(destX, destY, destW, destH);
    if (!sw || !sh || destH < 1 || destW < 1) return;
    const scale = Math.min(destW / sw, destH / sh);
    const w = sw * scale;
    const h = sh * scale;
    ctx.drawImage(source, 0, 0, sw, sh, destX + (destW - w) / 2, destY + (destH - h) / 2, w, h);
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
    if (screenLive()) list.push({ id: SCREEN_ID, label: SCREEN_LABEL });
    return list;
  }

  function syncSplitLists() {
    const choices = cameraChoices();
    const ids = choices.map((item) => item.id);
    const idSet = new Set(ids);
    let order = readList('reel.splitOrder') || [];
    let enabled = readList('reel.splitOn');
    const seen = readList('reel.splitSeen') || [];
    ids.forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });
    order = order.filter((id) => idSet.has(id));
    const seenLive = seen.filter((id) => (id.indexOf('phone:') !== 0 && id !== SCREEN_ID) || idSet.has(id));
    if (!enabled) {
      enabled = order.slice();
    } else {
      const prevEnabled = enabled.slice();
      ids.forEach((id) => {
        if (!seenLive.includes(id) && !prevEnabled.includes(id)) prevEnabled.push(id);
      });
      enabled = order.filter((id) => prevEnabled.includes(id));
    }
    if (!enabled.length && order.length) enabled = [order[0]];
    writeList('reel.splitOrder', order);
    writeList('reel.splitOn', enabled);
    writeList('reel.splitSeen', Array.from(new Set(seenLive.concat(ids))));
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
    wantedIds().forEach((id) => {
      if (byId[id]) next.push(byId[id]);
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
      const wanted = wantedIds();
      const localWanted = wanted.filter((id) => id.indexOf('phone:') !== 0 && id !== SCREEN_ID);
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
        if (id === SCREEN_ID) {
          if (screenLive() && state.screenVideo) slots.push({ id: id, kind: 'screen', video: state.screenVideo });
          else missed += 1;
          return;
        }
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

      const target = ORIENTATIONS[state.orientation] || ORIENTATIONS.landscape;
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
      // Screen text must stay whole, so the screen is letterboxed, not cropped.
      function drawSlot(slot, x, y, w, h) {
        if (slot.kind === 'screen') drawContain(sourceForSlot(slot), x, y, w, h);
        else drawCover(sourceForSlot(slot), x, y, w, h);
      }
      function drawFrame() {
        const slotsNow = state.splitSlots || [];
        const count = slotsNow.length || 1;
        if (state.rotate) {
          const interval = cutIntervalMs();
          const index = Math.floor((performance.now() - state.cutStartedAt) / interval) % count;
          const slot = slotsNow[index] || slotsNow[0];
          if (slot) drawSlot(slot, 0, 0, canvas.width, canvas.height);
        } else {
          for (let i = 0; i < slotsNow.length; i++) {
            const box = bandBox(i, count, canvas.width, canvas.height);
            drawSlot(slotsNow[i], box.x, box.y, box.w, box.h);
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
        const source = state.audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
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
    if (!readiness) return;
    readiness.textContent = 'وضعیت میکروفون';
    readiness.classList.add('mic-status');
    readiness.classList.remove('is-error');
    readiness.classList.toggle('clip-warning', state.meterValue > -3);
    readiness.classList.toggle('silent-warning', !!state.silentWarning);
  }

  function showMediaError(err) {
    if (!readiness) return;
    readiness.textContent = mediaErrorText(err);
    readiness.classList.remove('mic-status', 'clip-warning', 'silent-warning');
    readiness.classList.add('is-error');
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
    orientationButtons().forEach((btn) => {
      const key = btn.getAttribute('data-orientation');
      btn.classList.toggle('on', state.orientation === key);
      btn.disabled = false;
    });
    const home = document.getElementById('stage-home');
    if (home) {
      home.classList.toggle('is-landscape', state.orientation === 'landscape');
      home.classList.toggle('is-square', state.orientation === 'square');
      home.classList.toggle('is-vertical', state.orientation === 'vertical');
    }
  }

  function renderSplitPicks() {
    const box = document.getElementById('split-picks');
    if (!box) return;
    if (cutSecondsWrap) cutSecondsWrap.hidden = !state.rotate;
    if (!pickMode()) {
      box.hidden = true;
      box.replaceChildren();
      state.splitPickSig = '';
      return;
    }
    const choices = syncSplitLists();
    const byId = {};
    choices.forEach((item) => {
      byId[item.id] = item;
    });
    const signature = state.splitOrder
      .map((id) => id + ':' + (byId[id] ? byId[id].label : '') + ':' + (state.splitOn.includes(id) ? '1' : '0'))
      .join('|');
    if (signature && signature === state.splitPickSig && box.childElementCount) {
      box.hidden = false;
      return;
    }
    state.splitPickSig = signature;
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
      if (!streamIsLive()) showMediaError(err);
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
    } else {
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
      if (!streamIsLive()) showMediaError(err);
    }
  }

  function captureBusy() {
    const phase = window.__reelCapture && window.__reelCapture.phase;
    return phase === 'recording' || phase === 'countdown';
  }

  const shareBox = document.getElementById('share-screen');
  const shareHint = document.getElementById('share-screen-hint');

  function renderShareBox() {
    const on = screenLive();
    if (shareBox) {
      shareBox.checked = on;
      shareBox.disabled = captureBusy();
      const wrap = shareBox.closest('label');
      if (wrap) wrap.classList.toggle('on', on);
    }
    document.body.classList.toggle('screen-live', on);
  }

  function setShareHint(text) {
    if (!shareHint) return;
    shareHint.textContent = text || '';
    shareHint.hidden = !text;
  }

  async function restartAfterShare() {
    renderShareBox();
    renderSplitPicks();
    try {
      await startPreview(cameraSelect.value, micSelect.value);
    } catch (err) {
      if (!streamIsLive()) showMediaError(err);
    }
  }

  async function startScreenShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setShareHint('این مرورگر اشتراک صفحه نداره. کروم یا اج رو باز کن.');
      renderShareBox();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor', frameRate: { ideal: 30 } },
        audio: false,
        monitorTypeSurfaces: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
      });
    } catch (err) {
      setShareHint(err && err.name === 'NotAllowedError' ? 'اشتراک صفحه لغو شد' : 'صفحه به اشتراک گذاشته نشد');
      renderShareBox();
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopTracks(stream.getTracks());
      renderShareBox();
      return;
    }
    const video = document.createElement('video');
    video.className = 'split-src';
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    document.body.appendChild(video);
    await video.play().catch(() => {});
    await waitForVideoSize(video).catch(() => {});
    state.screenStream = stream;
    state.screenVideo = video;
    track.addEventListener('ended', () => stopScreenShare());
    syncSplitLists();
    if (!state.splitOn.includes(SCREEN_ID)) {
      state.splitOn = state.splitOrder.filter((id) => id === SCREEN_ID || state.splitOn.includes(id));
      writeList('reel.splitOn', state.splitOn);
    }
    setShareHint('');
    await restartAfterShare();
  }

  let shareStopWait = 0;
  function stopScreenShare() {
    if (!state.screenStream) return;
    // Swapping the composed stream mid take would break the recorder, so the
    // screen band stays (frozen) until the take ends.
    if (captureBusy()) {
      if (!shareStopWait) {
        shareStopWait = setInterval(() => {
          if (captureBusy()) return;
          clearInterval(shareStopWait);
          shareStopWait = 0;
          stopScreenShare();
        }, 500);
      }
      return;
    }
    stopTracks(state.screenStream.getTracks());
    state.screenStream = null;
    if (state.screenVideo) {
      state.screenVideo.srcObject = null;
      if (state.screenVideo.parentNode) state.screenVideo.parentNode.removeChild(state.screenVideo);
    }
    state.screenVideo = null;
    restartAfterShare();
  }

  if (shareBox) {
    shareBox.addEventListener('change', () => {
      if (captureBusy()) {
        shareBox.checked = screenLive();
        state.phoneNote = 'وسط ضبط عوضش نکن';
        renderReadiness();
        return;
      }
      if (shareBox.checked) startScreenShare();
      else stopScreenShare();
    });
  }
  setInterval(renderShareBox, 700);

  async function setOrientation(orientation) {
    if (state.orientation === orientation) return;
    state.orientation = orientation;
    storeId('reel.orientation', orientation);
    renderOrientationButtons();
    try {
      await startPreview(cameraSelect.value, micSelect.value);
    } catch (err) {
      if (!streamIsLive()) showMediaError(err);
    }
  }

  async function initDevices() {
    const stored = loadStoredId('reel.orientation');
    state.orientation = ORIENTATIONS[stored] ? stored : 'landscape';
    state.split = loadStoredId('reel.split') === '1';
    state.rotate = !state.split && loadStoredId('reel.rotate') === '1';
    const storedCut = Number(loadStoredId('reel.cutSeconds'));
    state.cutSeconds = Number.isFinite(storedCut) && storedCut > 0 ? storedCut : 1.5;
    renderSplitButton();
    renderOrientationButtons();
    orientationButtons().forEach((btn) => {
      btn.addEventListener('click', () => setOrientation(btn.getAttribute('data-orientation')));
    });

    const { preferredCamera, preferredMic } = await fetchPreferredNames();
    await enumerate(preferredCamera, preferredMic);

    cameraSelect.addEventListener('change', async () => {
      storeId('reel.cameraId', cameraSelect.value);
      if (pickMode()) return;
      try {
        await startPreview(cameraSelect.value, micSelect.value);
      } catch (err) {
        if (!streamIsLive()) showMediaError(err);
      }
    });
    micSelect.addEventListener('change', async () => {
      storeId('reel.micId', micSelect.value);
      if (!isPhoneMic(micSelect.value) && window.__reelPhone && window.__reelPhone.stopAudio) {
        window.__reelPhone.stopAudio();
      }
      try {
        await startPreview(cameraSelect.value, micSelect.value);
      } catch (err) {
        if (!streamIsLive()) showMediaError(err);
      }
    });

    navigator.mediaDevices.addEventListener('devicechange', () => {
      enumerate(preferredCamera, preferredMic).then(() => {
        if (!devicesReady || !multiActive() || captureBusy()) return;
        startPreview(cameraSelect.value, micSelect.value).catch((err) => {
          if (!streamIsLive()) showMediaError(err);
        });
      });
    });

    if (window.__reelPhone) {
      let phoneStatusTimer = 0;
      window.__reelPhone.onStatus = (connected) => {
        if (phoneStatusTimer) clearTimeout(phoneStatusTimer);
        phoneStatusTimer = setTimeout(() => {
          phoneStatusTimer = 0;
          const before = cameraSelect.value;
          const micBefore = micSelect.value;
          renderCameraSelect(preferredCamera);
          renderMicSelect(preferredMic);
          if (!devicesReady) return;
          // Prefer keeping the current phone selection if it is still listed.
          if (before && Array.from(cameraSelect.options).some((opt) => opt.value === before)) {
            cameraSelect.value = before;
          }
          if (micBefore && Array.from(micSelect.options).some((opt) => opt.value === micBefore)) {
            micSelect.value = micBefore;
          }
          if (isPhoneMic(micBefore) && micSelect.value !== micBefore && !captureBusy()) {
            startPreview(cameraSelect.value, micSelect.value).catch((err) => {
              if (!streamIsLive()) showMediaError(err);
            });
          }
          if (multiActive()) {
            renderReadiness();
            renderSplitPicks();
            if (!captureBusy()) {
              startPreview(cameraSelect.value, micSelect.value).catch((err) => {
                if (!streamIsLive()) showMediaError(err);
              });
            }
            return;
          }
          const chosenGone =
            (before === 'phone' || (typeof before === 'string' && before.indexOf('phone:') === 0)) &&
            cameraSelect.value !== before;
          if (chosenGone && !captureBusy()) {
            startPreview(cameraSelect.value, micSelect.value).catch((err) => {
              if (!streamIsLive()) showMediaError(err);
            });
            return;
          }
          if (connected) {
            state.phoneNote = '';
            if (readiness.dataset.camera) renderReadiness();
            return;
          }
          if (!(before === 'phone' || (typeof before === 'string' && before.indexOf('phone:') === 0))) return;
          state.phoneNote = 'دوربین موبایل قطع شد';
          renderReadiness();
          if (captureBusy()) return;
          if (!cameraSelect.value || cameraSelect.value === 'phone') return;
          storeId('reel.cameraId', cameraSelect.value);
          startPreview(cameraSelect.value, micSelect.value).catch((err) => {
            if (!streamIsLive()) showMediaError(err);
          });
        }, 40);
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
      showMediaError(err);
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
        if (!streamIsLive()) showMediaError(err);
      }
    }
    storeId('reel.cameraId', cameraSelect.value);
    storeId('reel.micId', micSelect.value);
  }

  state.ensureStream = ensureStream;
  state.cameraLabels = function () {
    if (!multiActive()) return [];
    const labels = [];
    const ids = state.splitSlots && state.splitSlots.length ? state.splitSlots.map((slot) => slot.id) : wantedIds();
    ids.forEach((id) => {
      if (id === SCREEN_ID) {
        labels.push(SCREEN_LABEL);
        return;
      }
      const phoneId = id.indexOf('phone:') === 0 ? id.slice(6) : id;
      const cam = (state.cameras || []).find((item) => item.deviceId === id);
      const phone =
        window.__reelPhone && window.__reelPhone.cameras
          ? window.__reelPhone.cameras().find((item) => item.id === phoneId || item.deviceId === id)
          : null;
      labels.push((cam && cam.label) || (phone && phone.label) || id);
    });
    return labels;
  };
  window.__reelDevices = state;
  initDevices();
})();
