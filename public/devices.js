(function () {
  const state = {
    cameras: [],
    mics: [],
    meterValue: -100,
    stream: null,
    audioContext: null,
    analyser: null,
    silentWarning: false,
    orientation: 'landscape',
  };
  window.__reel = state;

  const ORIENTATION_SIZES = {
    landscape: { width: 1920, height: 1080 },
    portrait: { width: 1080, height: 1920 },
  };

  const cameraSelect = document.getElementById('camera-select');
  const micSelect = document.getElementById('mic-select');
  const preview = document.getElementById('preview');
  const meterBar = document.getElementById('meter-bar');
  const readiness = document.getElementById('readiness');
  const orientationHorizontalBtn = document.getElementById('orientation-horizontal');
  const orientationVerticalBtn = document.getElementById('orientation-vertical');

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
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    if (state.audioContext) {
      state.audioContext.close();
      state.audioContext = null;
      state.analyser = null;
    }
  }

  async function startPreview(camId, micId) {
    stopStream();
    const size = ORIENTATION_SIZES[state.orientation] || ORIENTATION_SIZES.landscape;
    const constraints = {
      video: Object.assign(
        { width: size.width, height: size.height, frameRate: 30 },
        camId ? { deviceId: { exact: camId } } : {}
      ),
      audio: Object.assign(
        { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        micId ? { deviceId: { exact: micId } } : {}
      ),
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.stream = stream;
    preview.srcObject = stream;

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    const settings = videoTrack ? videoTrack.getSettings() : {};
    readiness.dataset.camera = videoTrack ? videoTrack.label : 'بدون دوربین';
    readiness.dataset.mic = audioTrack ? audioTrack.label : 'بدون میکروفون';
    readiness.dataset.resolution =
      settings.width && settings.height ? `${settings.width}x${settings.height}` : 'نامشخص';

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
    orientationHorizontalBtn.classList.toggle('on', state.orientation === 'landscape');
    orientationVerticalBtn.classList.toggle('on', state.orientation === 'portrait');
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
    state.orientation = stored === 'portrait' ? 'portrait' : 'landscape';
    renderOrientationButtons();
    orientationHorizontalBtn.addEventListener('click', () => setOrientation('landscape'));
    orientationVerticalBtn.addEventListener('click', () => setOrientation('portrait'));

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
