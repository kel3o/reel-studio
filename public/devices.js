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

  async function enumerate(preferredCamera, preferredMic) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.cameras = devices.filter((d) => d.kind === 'videoinput');
    state.mics = devices.filter((d) => d.kind === 'audioinput');
    const camId = fillSelect(cameraSelect, state.cameras, preferredCamera, loadStoredId('reel.cameraId'));
    const micId = fillSelect(micSelect, state.mics, preferredMic, loadStoredId('reel.micId'));
    return { camId, micId };
  }

  function stopStream() {
    if (state.drawHandle !== null) {
      cancelAnimationFrame(state.drawHandle);
      state.drawHandle = null;
    }
    if (state.canvasStream) {
      state.canvasStream.getTracks().forEach((t) => t.stop());
      state.canvasStream = null;
    }
    if (state.rawStream) {
      state.rawStream.getTracks().forEach((t) => t.stop());
      state.rawStream = null;
    }
    state.stream = null;
    if (state.audioContext) {
      state.audioContext.close();
      state.audioContext = null;
      state.analyser = null;
    }
  }

  function waitForVideoSize(videoEl) {
    if (videoEl.videoWidth && videoEl.videoHeight) return Promise.resolve();
    return new Promise((resolve) => {
      videoEl.addEventListener('loadedmetadata', () => resolve(), { once: true });
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
    stopStream();
    const constraints = {
      video: Object.assign(
        { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: 30 },
        camId ? { deviceId: { exact: camId } } : {}
      ),
      audio: Object.assign(
        { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        micId ? { deviceId: { exact: micId } } : {}
      ),
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.rawStream = stream;
    rawCam.srcObject = stream;
    await rawCam.play().catch(() => {});
    await waitForVideoSize(rawCam);

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

    renderReadiness();
    tickMeter();
  }

  function renderReadiness() {
    const d = readiness.dataset;
    const level = Math.round(state.meterValue);
    let text = `دوربین: ${d.camera || ''} (${d.resolution || ''})، میکروفون: ${d.mic || ''}، سطح: ${level} dBFS`;
    if (state.silentWarning) text += '، صدایی نمیاد';
    readiness.textContent = text;
    readiness.classList.toggle('clip-warning', state.meterValue > -3);
    readiness.classList.toggle('silent-warning', !!state.silentWarning);
  }

  let silenceStart = null;
  function tickMeter() {
    if (!state.analyser) return;
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
    requestAnimationFrame(tickMeter);
  }

  function renderOrientationButtons() {
    Object.keys(orientationButtons).forEach((key) => {
      orientationButtons[key].classList.toggle('on', state.orientation === key);
    });
  }

  async function setOrientation(orientation) {
    if (state.orientation === orientation) return;
    state.orientation = orientation;
    storeId('reel.orientation', orientation);
    renderOrientationButtons();
    await startPreview(cameraSelect.value, micSelect.value);
  }

  async function initDevices() {
    const stored = loadStoredId('reel.orientation');
    state.orientation = ORIENTATIONS[stored] ? stored : 'landscape';
    renderOrientationButtons();
    Object.keys(orientationButtons).forEach((key) => {
      orientationButtons[key].addEventListener('click', () => setOrientation(key));
    });

    const { preferredCamera, preferredMic } = await fetchPreferredNames();
    try {
      const permStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      permStream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      readiness.textContent = 'دسترسی به دوربین یا میکروفون داده نشد';
      return;
    }

    const { camId, micId } = await enumerate(preferredCamera, preferredMic);
    storeId('reel.cameraId', camId);
    storeId('reel.micId', micId);
    await startPreview(camId, micId);

    cameraSelect.addEventListener('change', async () => {
      storeId('reel.cameraId', cameraSelect.value);
      await startPreview(cameraSelect.value, micSelect.value);
    });
    micSelect.addEventListener('change', async () => {
      storeId('reel.micId', micSelect.value);
      await startPreview(cameraSelect.value, micSelect.value);
    });

    navigator.mediaDevices.addEventListener('devicechange', () => {
      enumerate(preferredCamera, preferredMic);
    });
  }

  initDevices();
})();
