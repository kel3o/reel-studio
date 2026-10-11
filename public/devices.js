(function () {
  if (window.parent && window.parent !== window) return;
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
    look: false,
    lookIndex: 0,
    lookCuts: null,
    squareSplit: 'cols',
    cutSeconds: 1,
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
  const lookBtn = document.getElementById('look-cameras');
  const lookNote = document.getElementById('look-note');
  const cutSecondsInput = document.getElementById('cut-seconds');
  let previewToken = 0;
  let devicesReady = false;

  function pickMode() {
    return !!(state.split || state.rotate || state.look);
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
    if (!Number.isFinite(value)) return 1000;
    return Math.max(300, Math.min(30000, Math.round(value * 1000)));
  }

  function resetCutClock() {
    state.cutStartedAt = performance.now();
    state.cutHold = null;
  }
  state.resetCutClock = resetCutClock;
  state.cutSecondsValue = function () {
    return cutIntervalMs() / 1000;
  };
  state.pauseCutClock = function () {
    if (state.cutHold != null) return;
    state.cutHold = performance.now() - (state.cutStartedAt || performance.now());
  };
  state.resumeCutClock = function () {
    if (state.cutHold == null) return;
    state.cutStartedAt = performance.now() - state.cutHold;
    state.cutHold = null;
  };

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

  function releaseSlotViews() {
    const views = state.slotViews || {};
    Object.keys(views).forEach((id) => {
      const view = views[id];
      if (view && view.stream) stopTracks(view.stream.getTracks());
    });
    state.slotViews = null;
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
    releaseSlotViews();
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

  function clampUnit(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0.5;
    return Math.min(1, Math.max(0, v));
  }

  function framePan() {
    if (!state.framePan) state.framePan = { x: 0.5, y: 0.5 };
    return state.framePan;
  }

  function slotPan(slot) {
    if (!state.slotPans) state.slotPans = {};
    const key = slot && slot.id ? String(slot.id) : 'single';
    if (!state.slotPans[key]) state.slotPans[key] = { x: 0.5, y: 0.5 };
    return state.slotPans[key];
  }

  // Cover fit: crop the source to the target ratio. pan 0 keeps the start edge,
  // 1 the end edge, 0.5 the center. Slack exists on only one axis.
  function computeCropRect(srcW, srcH, targetRatio, panX, panY) {
    const srcRatio = srcW / srcH;
    const px = clampUnit(panX);
    const py = clampUnit(panY);
    if (srcRatio > targetRatio) {
      const sh = srcH;
      const sw = srcH * targetRatio;
      return { sx: (srcW - sw) * px, sy: 0, sw, sh };
    }
    const sw = srcW;
    const sh = srcW / targetRatio;
    return { sx: 0, sy: (srcH - sh) * py, sw, sh };
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
      const pan = framePan();
      const { sx, sy, sw, sh } = computeCropRect(rawCam.videoWidth, rawCam.videoHeight, target.ratio, pan.x, pan.y);
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
        const pan = framePan();
        const crop = computeCropRect(phoneCanvas.width, phoneCanvas.height, target.ratio, pan.x, pan.y);
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
    const square = width === height;
    const rows = portrait || (square && state.squareSplit === 'rows');
    const grid = !portrait && !square && count === 4;
    if (grid) {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x0 = Math.round((col * width) / 2);
      const x1 = Math.round(((col + 1) * width) / 2);
      const y0 = Math.round((row * height) / 2);
      const y1 = Math.round(((row + 1) * height) / 2);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (rows) {
      const y0 = Math.round((index * height) / count);
      const y1 = Math.round(((index + 1) * height) / count);
      return { x: 0, y: y0, w: width, h: y1 - y0 };
    }
    const x0 = Math.round((index * width) / count);
    const x1 = Math.round(((index + 1) * width) / count);
    return { x: x0, y: 0, w: x1 - x0, h: height };
  }

  function drawCover(source, destX, destY, destW, destH, pan, target) {
    const g = target || ctx;
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    if (!sw || !sh || destH < 1 || destW < 1) {
      g.fillStyle = '#000';
      g.fillRect(destX, destY, destW, destH);
      return;
    }
    const point = pan || framePan();
    const crop = computeCropRect(sw, sh, destW / destH, point.x, point.y);
    g.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, destX, destY, destW, destH);
  }

  function drawContain(source, destX, destY, destW, destH, target) {
    const g = target || ctx;
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    g.fillStyle = '#000';
    g.fillRect(destX, destY, destW, destH);
    if (!sw || !sh || destH < 1 || destW < 1) return;
    const scale = Math.min(destW / sw, destH / sh);
    const w = sw * scale;
    const h = sh * scale;
    g.drawImage(source, 0, 0, sw, sh, destX + (destW - w) / 2, destY + (destH - h) / 2, w, h);
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

  function webcamLabel(index, total) {
    if (total <= 1) return 'دوربین وبکم';
    return 'دوربین وبکم ' + faDigits(index + 1);
  }

  function cameraChoices() {
    const total = state.cameras.length;
    const list = state.cameras.map((cam, index) => ({
      id: cam.deviceId,
      label: webcamLabel(index, total),
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
      function drawSlot(slot, x, y, w, h, target) {
        if (slot.kind === 'screen') drawContain(sourceForSlot(slot), x, y, w, h, target);
        else drawCover(sourceForSlot(slot), x, y, w, h, slotPan(slot), target);
      }
      // Cut mode keeps one full-frame canvas per camera. The program canvas
      // still switches. Each lane later reads its own canvas, so an edge drag
      // shows that camera and not whichever camera was on screen.
      const slotViews = {};
      if ((state.rotate || state.look) && slots.length > 1) {
        slots.forEach((slot) => {
          const own = document.createElement('canvas');
          own.width = canvas.width;
          own.height = canvas.height;
          slotViews[slot.id] = {
            canvas: own,
            ctx: own.getContext('2d', { alpha: false }),
            stream: own.captureStream(30),
          };
        });
      }
      state.slotViews = Object.keys(slotViews).length ? slotViews : null;
      function drawFrame() {
        const slotsNow = state.splitSlots || [];
        const count = slotsNow.length || 1;
        if (state.rotate || state.look) {
          let slot = slotsNow[0];
          if (state.look) {
            const index = Math.max(0, Math.min(count - 1, state.lookIndex || 0));
            slot = slotsNow[index] || slotsNow[0];
          } else {
            const interval = cutIntervalMs();
            const elapsed = state.cutHold != null ? state.cutHold : performance.now() - state.cutStartedAt;
            const index = Math.floor(elapsed / interval) % count;
            slot = slotsNow[index] || slotsNow[0];
          }
          if (slot) drawSlot(slot, 0, 0, canvas.width, canvas.height);
          if (state.slotViews) {
            slotsNow.forEach((item) => {
              const view = state.slotViews[item.id];
              if (!view) return;
              drawSlot(item, 0, 0, view.canvas.width, view.canvas.height, view.ctx);
            });
          }
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
      readiness.dataset.camera = state.look
        ? 'برش اتوماتیک'
        : state.rotate
          ? 'برش ' + faDigits(slots.length) + ' دوربین'
          : faDigits(slots.length) + ' دوربین';
      renderLookNote();
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
      if (meterBar) {
        meterBar.style.width = pct + '%';
        meterBar.classList.toggle('clip', dbfs > -3);
      }
      const waveBars = document.querySelectorAll('#mic-wave-bars i');
      if (waveBars.length) {
        const chunk = Math.floor(buffer.length / waveBars.length) || 1;
        waveBars.forEach((bar, index) => {
          let local = 0;
          const start = index * chunk;
          const end = Math.min(buffer.length, start + chunk);
          for (let j = start; j < end; j += 8) {
            const abs = Math.abs(buffer[j]);
            if (abs > local) local = abs;
          }
          const boosted = local * 1.3;
          const db = boosted > 0 ? 20 * Math.log10(boosted) : -100;
          const level = Math.max(0, Math.min(1, (db + 60) / 60));
          const h = Math.max(4, Math.min(22, Math.round(4 + level * 18)));
          bar.style.height = h + 'px';
        });
      }

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

  function hitSlot(nx, ny) {
    const slots = state.splitSlots || [];
    if (!(state.split && slots.length > 1) || state.rotate || state.look) return null;
    const target = ORIENTATIONS[state.orientation] || ORIENTATIONS.landscape;
    for (let i = 0; i < slots.length; i++) {
      const box = bandBox(i, slots.length, target.width, target.height);
      const x0 = box.x / target.width;
      const y0 = box.y / target.height;
      const x1 = (box.x + box.w) / target.width;
      const y1 = (box.y + box.h) / target.height;
      if (nx >= x0 && nx < x1 && ny >= y0 && ny < y1) return slots[i];
    }
    return slots[0] || null;
  }

  function bindFramePan() {
    const home = document.getElementById('stage-home');
    const frameEl = home && home.querySelector('.stage-frame');
    if (!frameEl || frameEl.dataset.panBound) return;
    frameEl.dataset.panBound = '1';
    frameEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = frameEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = (event.clientX - rect.left) / rect.width;
      const ny = (event.clientY - rect.top) / rect.height;
      const slot = hitSlot(nx, ny);
      const point = slot ? slotPan(slot) : framePan();
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = point.x;
      const originY = point.y;
      frameEl.classList.add('is-panning');
      try {
        frameEl.setPointerCapture(event.pointerId);
      } catch (err) {}
      function move(ev) {
        point.x = clampUnit(originX + (ev.clientX - startX) / rect.width);
        point.y = clampUnit(originY + (ev.clientY - startY) / rect.height);
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        frameEl.classList.remove('is-panning');
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      event.preventDefault();
    });
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
    renderSquareSplit();
  }

  function renderSquareSplit() {
    const wrap = document.getElementById('square-split-wrap');
    if (!wrap) return;
    wrap.hidden = !(state.split && state.orientation === 'square');
    wrap.querySelectorAll('[data-square-split]').forEach((btn) => {
      btn.classList.toggle('on', btn.getAttribute('data-square-split') === state.squareSplit);
    });
  }

  function setSquareSplit(next) {
    if (next !== 'rows' && next !== 'cols') return;
    if (captureBusy()) {
      state.phoneNote = 'وسط ضبط عوضش نکن';
      renderReadiness();
      renderSquareSplit();
      return;
    }
    state.squareSplit = next;
    storeId('reel.squareSplit', next);
    renderSquareSplit();
  }

  function renderSplitPicks() {
    const box = document.getElementById('split-picks');
    const card = document.getElementById('cam-list-card');
    if (!box) return;
    if (card) card.hidden = false;
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
      if (card) card.hidden = false;
      return;
    }
    state.splitPickSig = signature;
    box.hidden = false;
    if (card) card.hidden = false;
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

  let gazeScores = [];
  let gazeLocked = false;
  let gazeChallenger = -1;
  let gazeWins = 0;
  let gazeCursor = 0;
  let gazeBusy = false;
  let gazeCanvas = null;
  let gazeCtx = null;

  function firstFaceIndex(slots) {
    const list = slots || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].kind !== 'screen') return i;
    }
    return 0;
  }

  function slotSource(slot) {
    if (!slot) return null;
    if (slot.kind === 'phone') {
      if (!window.__reelPhone || !window.__reelPhone.canvasFor) return null;
      return window.__reelPhone.canvasFor(slot.phoneId) || null;
    }
    if (slot.kind === 'screen') return state.screenVideo;
    return slot.video || null;
  }

  function renderLookNote() {
    if (!lookNote) return;
    if (!state.look) {
      lookNote.hidden = true;
      lookNote.textContent = '';
      return;
    }
    lookNote.hidden = false;
    const slots = state.splitSlots || [];
    const faceCount = slots.filter((slot) => slot && slot.kind !== 'screen').length;
    const gaze = window.__reelGaze;
    if (faceCount < 2) {
      lookNote.textContent = 'حداقل دو دوربین روشن کن';
      return;
    }
    if (!gaze || !gaze.isReady()) {
      lookNote.textContent = gaze && gaze.isFailed() ? 'حسگر نگاه آماده نشد' : 'حسگر نگاه داره آماده می‌شه';
      return;
    }
    if (!gazeLocked) {
      lookNote.textContent = 'به لنز دوربین نگاه کن';
      return;
    }
    lookNote.textContent = 'دوربین ' + faDigits((state.lookIndex || 0) + 1);
  }

  function noteLookCut(index) {
    const cap = window.__reelCapture;
    if (!cap || !state.look) return;
    if (cap.phase !== 'recording' && cap.phase !== 'paused') return;
    const t = typeof cap.recordSeconds === 'function' ? cap.recordSeconds() : 0;
    if (!Array.isArray(state.lookCuts)) state.lookCuts = [];
    const time = Math.round(Math.max(0, t) * 1000) / 1000;
    const last = state.lookCuts[state.lookCuts.length - 1];
    if (!last) {
      state.lookCuts.push({ t: 0, camera: index });
      return;
    }
    if (last.camera === index) return;
    if (time - last.t < 0.25) {
      last.camera = index;
      return;
    }
    state.lookCuts.push({ t: time, camera: index });
  }

  function setLookIndex(index) {
    const count = (state.splitSlots || []).length || 1;
    const next = Math.max(0, Math.min(count - 1, index));
    state.lookIndex = next;
    noteLookCut(next);
    renderLookNote();
  }

  function resetLookSensor() {
    gazeScores = [];
    gazeLocked = false;
    gazeChallenger = -1;
    gazeWins = 0;
    gazeCursor = 0;
    state.lookIndex = firstFaceIndex(state.splitSlots);
    if (window.__reelGaze) window.__reelGaze.boot();
    renderLookNote();
  }

  function beginLookTake() {
    if (!state.look) {
      state.lookCuts = null;
      return;
    }
    state.lookCuts = [{ t: 0, camera: state.lookIndex || 0 }];
  }

  function grabSlotBitmap(slot) {
    const src = slotSource(slot);
    if (!src) return null;
    const sw = src.videoWidth || src.width || 0;
    const sh = src.videoHeight || src.height || 0;
    if (sw < 8 || sh < 8) return null;
    const w = 192;
    const h = Math.max(32, Math.round((w * sh) / sw));
    if (!gazeCanvas) {
      gazeCanvas = document.createElement('canvas');
      gazeCtx = gazeCanvas.getContext('2d', { alpha: false });
    }
    if (gazeCanvas.width !== w || gazeCanvas.height !== h) {
      gazeCanvas.width = w;
      gazeCanvas.height = h;
    }
    gazeCtx.drawImage(src, 0, 0, w, h);
    if (typeof createImageBitmap !== 'function') return null;
    return createImageBitmap(gazeCanvas);
  }

  async function gazeRound() {
    if (!state.look || gazeBusy) return;
    const gaze = window.__reelGaze;
    const scoreApi = window.reelGazeScore;
    if (!gaze || !scoreApi) return;
    if (!gaze.isReady()) {
      if (!gaze.isFailed()) gaze.boot().then(() => renderLookNote());
      return;
    }
    const slots = state.splitSlots || [];
    const faces = [];
    slots.forEach((slot, index) => {
      if (slot && slot.kind !== 'screen') faces.push({ slot: slot, index: index });
    });
    if (faces.length < 2) return;
    const item = faces[gazeCursor % faces.length];
    gazeCursor += 1;
    gazeBusy = true;
    try {
      const bitmap = await grabSlotBitmap(item.slot);
      let value = 0;
      if (bitmap) {
        const msg = await gaze.detect(bitmap, item.index, bitmap.width, bitmap.height);
        if (msg && msg.faces) value = scoreApi.bestFrontal(msg.faces, msg.width || bitmap.width, msg.height || bitmap.height);
      }
      gazeScores[item.index] = { value: value, at: performance.now() };
      const decision = scoreApi.decideLook({
        active: state.lookIndex || 0,
        locked: gazeLocked,
        challenger: gazeChallenger,
        wins: gazeWins,
        scores: gazeScores,
        now: performance.now(),
      });
      gazeLocked = decision.locked;
      gazeChallenger = decision.challenger;
      gazeWins = decision.wins;
      if ((state.lookIndex || 0) !== decision.active) setLookIndex(decision.active);
      else renderLookNote();
    } catch (err) {
      gazeScores[item.index] = { value: 0, at: performance.now() };
    } finally {
      gazeBusy = false;
    }
  }

  function renderSplitButton() {
    if (splitBtn) splitBtn.classList.toggle('on', !!state.split);
    if (rotateBtn) rotateBtn.classList.toggle('on', !!state.rotate);
    if (lookBtn) lookBtn.classList.toggle('on', !!state.look);
    if (cutSecondsInput) cutSecondsInput.value = String(state.cutSeconds);
    renderLookNote();
    renderSplitPicks();
  }

  async function setMultiMode(mode) {
    if (captureBusy()) {
      state.phoneNote = 'وسط ضبط عوضش نکن';
      renderReadiness();
      return;
    }
    const current = state.split ? 'split' : state.rotate ? 'rotate' : state.look ? 'look' : '';
    const next = current === mode ? '' : mode;
    state.split = next === 'split';
    state.rotate = next === 'rotate';
    state.look = next === 'look';
    if (state.rotate) resetCutClock();
    if (state.look) resetLookSensor();
    storeId('reel.split', state.split ? '1' : '');
    storeId('reel.rotate', state.rotate ? '1' : '');
    storeId('reel.look', state.look ? '1' : '');
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
    return phase === 'recording' || phase === 'paused' || phase === 'countdown';
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
    shareHint.replaceChildren();
    if (!text) {
      shareHint.hidden = true;
      return;
    }
    shareHint.hidden = false;
    shareHint.dir = 'ltr';
    const words = document.createElement('bdi');
    words.dir = 'rtl';
    words.textContent = text;
    shareHint.append('(', words, ')');
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
    state.squareSplit = loadStoredId('reel.squareSplit') === 'rows' ? 'rows' : 'cols';
    state.split = loadStoredId('reel.split') === '1';
    state.rotate = !state.split && loadStoredId('reel.rotate') === '1';
    state.look = !state.split && !state.rotate && loadStoredId('reel.look') === '1';
    if (state.look && window.__reelGaze) window.__reelGaze.boot();
    let storedCut = Number(loadStoredId('reel.cutSeconds'));
    if (loadStoredId('reel.cutDefaultV3') !== '1') {
      storedCut = 1;
      storeId('reel.cutSeconds', '1');
      storeId('reel.cutDefaultV3', '1');
    }
    state.cutSeconds = Number.isFinite(storedCut) && storedCut > 0 ? storedCut : 1;
    renderSplitButton();
    renderOrientationButtons();
    orientationButtons().forEach((btn) => {
      btn.addEventListener('click', () => setOrientation(btn.getAttribute('data-orientation')));
    });
    document.querySelectorAll('[data-square-split]').forEach((btn) => {
      btn.addEventListener('click', () => setSquareSplit(btn.getAttribute('data-square-split')));
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
      rotateBtn.addEventListener('click', () => {
        setMultiMode('rotate');
        const wrap = rotateBtn.closest('.mode-btn-wrap');
        if (wrap && window.matchMedia('(max-width: 860px)').matches) {
          wrap.classList.toggle('is-cut-open');
        }
      });
    }
    if (lookBtn) lookBtn.addEventListener('click', () => setMultiMode('look'));
    setInterval(() => {
      gazeRound().catch(() => {});
    }, 150);
    if (cutSecondsInput) {
      const saveCut = () => {
        let value = Number(String(cutSecondsInput.value).replace(',', '.'));
        if (!Number.isFinite(value)) value = 1;
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
    bindFramePan();
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
  state.beginLookTake = beginLookTake;
  state.takeLookCuts = function () {
    if (!state.look || !Array.isArray(state.lookCuts) || !state.lookCuts.length) return null;
    return state.lookCuts.map((item) => ({ t: item.t, camera: item.camera }));
  };
  state.cameraLayout = function () {
    if (state.look) return 'look';
    if (state.rotate) return 'cut';
    if (state.split) return 'split';
    return '';
  };
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
      const localCams = state.cameras || [];
      const localIndex = localCams.findIndex((item) => item.deviceId === id);
      if (localIndex >= 0) {
        labels.push(webcamLabel(localIndex, localCams.length));
        return;
      }
      const phone =
        window.__reelPhone && window.__reelPhone.cameras
          ? window.__reelPhone.cameras().find((item) => item.id === phoneId || item.deviceId === id)
          : null;
      labels.push((phone && phone.label) || id);
    });
    return labels;
  };
  window.__reelDevices = state;
  initDevices();
})();
