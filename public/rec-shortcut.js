(function () {
  if (window.parent && window.parent !== window) return;

  const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function faNum(value) {
    return String(value == null ? '' : value).replace(/\d/g, (digit) => FA[digit] || digit);
  }

  function floatMarkup() {
    return (
      '<div class="rec-float-stage">' +
      '<canvas id="rec-float-preview" class="rec-float-preview" width="160" height="214"></canvas>' +
      '<div id="rec-float-count" class="rec-float-count" hidden></div>' +
      '</div>' +
      '<div class="rec-float-actions">' +
      '<button id="rec-float-start" type="button">شروع ضبط</button>' +
      '<button id="rec-float-stop" type="button" hidden>توقف</button>' +
      '<button id="rec-float-pause" type="button" hidden>توقف کوتاه</button>' +
      '<button id="rec-float-resume" type="button" hidden>شروع مجدد</button>' +
      '</div>'
    );
  }

  if (!document.getElementById('rec-float')) {
    const box = document.createElement('div');
    box.id = 'rec-float';
    box.className = 'rec-float';
    box.innerHTML = floatMarkup();
    document.body.appendChild(box);
  }

  const box = document.getElementById('rec-float');
  if (!box) return;
  if (!document.getElementById('rec-float-count') && document.getElementById('rec-float-preview')) {
    const stage = document.createElement('div');
    stage.className = 'rec-float-stage';
    const preview = document.getElementById('rec-float-preview');
    preview.parentNode.insertBefore(stage, preview);
    stage.appendChild(preview);
    const count = document.createElement('div');
    count.id = 'rec-float-count';
    count.className = 'rec-float-count';
    count.hidden = true;
    stage.appendChild(count);
  }
  const staleNote = document.getElementById('rec-float-note');
  if (staleNote) staleNote.remove();

  try {
    const saved = JSON.parse(localStorage.getItem('reel.floatPos') || '');
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      box.style.left = saved.left + 'px';
      box.style.top = saved.top + 'px';
      box.style.bottom = 'auto';
    }
  } catch (err) {}

  const grip = document.getElementById('rec-float-preview');
  if (grip) {
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      const ox = event.clientX - rect.left;
      const oy = event.clientY - rect.top;
      box.classList.add('is-dragging');
      function move(ev) {
        const maxX = Math.max(0, window.innerWidth - box.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - box.offsetHeight);
        const left = Math.min(maxX, Math.max(0, ev.clientX - ox));
        const top = Math.min(maxY, Math.max(0, ev.clientY - oy));
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.bottom = 'auto';
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        box.classList.remove('is-dragging');
        try {
          localStorage.setItem(
            'reel.floatPos',
            JSON.stringify({ left: parseFloat(box.style.left), top: parseFloat(box.style.top) })
          );
        } catch (err) {}
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  if (document.getElementById('tp-record')) return;

  const ORIENT = {
    landscape: { ratio: 16 / 9, width: 1920, height: 1080 },
    square: { ratio: 1, width: 1080, height: 1080 },
    vertical: { ratio: 9 / 16, width: 1080, height: 1920 },
  };

  const startBtn = document.getElementById('rec-float-start');
  const stopBtn = document.getElementById('rec-float-stop');
  const pauseBtn = document.getElementById('rec-float-pause');
  const resumeBtn = document.getElementById('rec-float-resume');
  const countEl = document.getElementById('rec-float-count');
  const preview = document.getElementById('rec-float-preview');
  const previewCtx = preview && preview.getContext ? preview.getContext('2d') : null;

  const frame = document.createElement('canvas');
  const frameCtx = frame.getContext('2d', { alpha: false });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;

  let camId = '';
  let micId = '';
  let orientKey = 'landscape';
  let rawStream = null;
  let phase = 'idle';
  let countTimer = 0;
  let clockTimer = 0;
  let recorder = null;
  let chunks = [];
  let recordStart = 0;
  let clockSeconds = 0;
  let drawHandle = 0;
  let opening = false;

  function stored(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (err) {
      return '';
    }
  }

  function readChoice() {
    camId = stored('reel.cameraId');
    micId = stored('reel.micId');
    const saved = stored('reel.orientation');
    orientKey = ORIENT[saved] ? saved : 'landscape';
  }

  let heldMessage = '';

  function setNote(text) {
    const status = !text || text.indexOf('در حال ضبط') === 0 || text.indexOf('توقف کوتاه ') === 0;
    if ((phase === 'recording' || phase === 'paused') && status) return;
    heldMessage = text || '';
    if (!heldMessage) return;
    if (phase === 'recording' || phase === 'paused' || phase === 'countdown') return;
    paintMessage(heldMessage);
  }

  function showCount(n) {
    if (!countEl) return;
    countEl.hidden = false;
    countEl.textContent = faNum(n);
  }

  function hideCount() {
    if (!countEl) return;
    countEl.hidden = true;
    countEl.textContent = '';
  }

  function syncButtons() {
    const recording = phase === 'recording';
    const paused = phase === 'paused';
    const counting = phase === 'countdown';
    const busy = phase === 'saving' || counting;
    box.classList.toggle('is-recording', recording);
    box.classList.toggle('is-paused', paused);
    if (startBtn) {
      startBtn.hidden = recording || paused || counting || phase === 'saving';
      startBtn.disabled = busy || opening;
    }
    if (stopBtn) stopBtn.hidden = !recording && !paused;
    if (pauseBtn) pauseBtn.hidden = !recording;
    if (resumeBtn) resumeBtn.hidden = !paused;
  }

  function stopTracks(tracks) {
    (tracks || []).forEach((track) => {
      try {
        track.stop();
      } catch (err) {}
    });
  }

  function releaseStream() {
    if (rawStream) stopTracks(rawStream.getTracks());
    rawStream = null;
    video.srcObject = null;
  }

  function cropRect(srcW, srcH, ratio) {
    const srcRatio = srcW / srcH;
    if (srcRatio > ratio) {
      const sh = srcH;
      const sw = srcH * ratio;
      return { sx: (srcW - sw) / 2, sy: 0, sw: sw, sh: sh };
    }
    const sw = srcW;
    const sh = srcW / ratio;
    return { sx: 0, sy: (srcH - sh) / 2, sw: sw, sh: sh };
  }

  function paintMessage(text) {
    heldMessage = text || '';
    if (!previewCtx || !heldMessage) return;
    const w = preview.width;
    const h = preview.height;
    previewCtx.fillStyle = '#000';
    previewCtx.fillRect(0, 0, w, h);
    previewCtx.fillStyle = '#f2f2f2';
    previewCtx.font = '14px Vazirmatn, Tahoma, sans-serif';
    previewCtx.textAlign = 'center';
    previewCtx.textBaseline = 'middle';
    const words = String(text || '').split(' ');
    const lines = [];
    let line = '';
    words.forEach((word) => {
      const next = line ? line + ' ' + word : word;
      if (previewCtx.measureText(next).width > w - 16 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    });
    if (line) lines.push(line);
    const startY = h / 2 - ((lines.length - 1) * 18) / 2;
    lines.forEach((row, index) => {
      previewCtx.fillText(row, w / 2, startY + index * 18);
    });
  }

  function paintFrame() {
    const target = ORIENT[orientKey] || ORIENT.landscape;
    if (frame.width !== target.width) frame.width = target.width;
    if (frame.height !== target.height) frame.height = target.height;
    const ready = video.readyState >= 2 && video.videoWidth && video.videoHeight;
    if (heldMessage && phase !== 'recording' && phase !== 'paused' && phase !== 'countdown') {
      paintMessage(heldMessage);
    } else if (ready) {
      const crop = cropRect(video.videoWidth, video.videoHeight, target.ratio);
      frameCtx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, frame.width, frame.height);
      if (previewCtx) {
        const w = preview.width;
        const h = preview.height;
        previewCtx.fillStyle = '#000';
        previewCtx.fillRect(0, 0, w, h);
        const scale = Math.min(w / frame.width, h / frame.height);
        const dw = frame.width * scale;
        const dh = frame.height * scale;
        previewCtx.drawImage(frame, (w - dw) / 2, (h - dh) / 2, dw, dh);
        if (heldMessage && (phase === 'recording' || phase === 'paused')) {
          previewCtx.fillStyle = 'rgba(0,0,0,0.62)';
          previewCtx.fillRect(8, h - 34, w - 16, 26);
          previewCtx.fillStyle = '#fff';
          previewCtx.font = '12px Tahoma, sans-serif';
          previewCtx.textAlign = 'center';
          previewCtx.textBaseline = 'middle';
          previewCtx.fillText(heldMessage, w / 2, h - 21);
        }
      }
    }
    drawHandle = requestAnimationFrame(paintFrame);
  }

  function liveVideo() {
    return !!(rawStream && rawStream.getVideoTracks().some((track) => track.readyState === 'live'));
  }

  async function openMic(id) {
    if (!id || String(id).indexOf('phone') === 0) {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: id },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
    } catch (err) {
      return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } }, video: false });
    }
  }

  async function openVideo(id) {
    const attempts = [];
    if (id && id !== 'screen' && id.indexOf('phone') !== 0) {
      attempts.push({
        video: { deviceId: { ideal: id }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      attempts.push({ video: { deviceId: { ideal: id } }, audio: false });
    }
    attempts.push({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    attempts.push({ video: true, audio: false });
    let lastErr;
    for (let i = 0; i < attempts.length; i++) {
      try {
        return await navigator.mediaDevices.getUserMedia(attempts[i]);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('camera');
  }

  function mediaNote(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'اجازه دوربین یا میکروفون داده نشد';
    if (name === 'NotReadableError') return 'دوربین یا میکروفون جای دیگری باز است';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'دوربین انتخاب‌شده باز نشد';
    return 'دوربین یا میکروفون باز نشد';
  }

  async function openWebcam() {
    if (liveVideo() && camId !== 'screen') return true;
    opening = true;
    syncButtons();
    releaseStream();
    try {
      const videoStream = await openVideo(camId);
      let audioStream;
      try {
        audioStream = await openMic(micId);
      } catch (err) {
        stopTracks(videoStream.getTracks());
        throw err;
      }
      rawStream = new MediaStream(videoStream.getVideoTracks().concat(audioStream.getAudioTracks()));
      video.srcObject = rawStream;
      await video.play().catch(() => {});
      setNote('');
      opening = false;
      syncButtons();
      return true;
    } catch (err) {
      opening = false;
      syncButtons();
      const text = mediaNote(err);
      setNote(text);
      paintMessage(text);
      return false;
    }
  }

  async function openScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setNote('این مرورگر اشتراک صفحه ندارد');
      paintMessage('اشتراک صفحه نیست');
      return false;
    }
    opening = true;
    syncButtons();
    releaseStream();
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (err) {
      opening = false;
      syncButtons();
      const text = err && err.name === 'NotAllowedError' ? 'اشتراک صفحه لغو شد' : 'صفحه باز نشد';
      setNote(text);
      paintMessage(text);
      return false;
    }
    let audioStream;
    try {
      audioStream = await openMic(micId);
    } catch (err) {
      stopTracks(display.getTracks());
      opening = false;
      syncButtons();
      setNote(mediaNote(err));
      return false;
    }
    rawStream = new MediaStream(display.getVideoTracks().concat(audioStream.getAudioTracks()));
    const track = display.getVideoTracks()[0];
    if (track) {
      track.addEventListener('ended', () => {
        if (phase === 'recording' || phase === 'paused') stopAndSave();
      });
    }
    video.srcObject = rawStream;
    await video.play().catch(() => {});
    setNote('');
    opening = false;
    syncButtons();
    return true;
  }

  function pickMime() {
    const list = ['video/webm;codecs=vp8,opus', 'video/webm'];
    for (let i = 0; i < list.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }

  function clockText() {
    const mm = Math.floor(clockSeconds / 60);
    const ss = Math.floor(clockSeconds % 60);
    return faNum(mm) + ':' + faNum(ss < 10 ? '0' + ss : ss);
  }

  function tickClock() {
    if (phase !== 'recording') return;
    clockSeconds = Math.max(0, (performance.now() - recordStart) / 1000);
    setNote('در حال ضبط ' + clockText());
  }

  function beginRecording() {
    if (!liveVideo()) {
      phase = 'idle';
      syncButtons();
      setNote('تصویر برای ضبط آماده نیست');
      return;
    }
    const canvasStream = frame.captureStream(30);
    const audio = rawStream.getAudioTracks().filter((track) => track.readyState === 'live');
    const stream = new MediaStream(canvasStream.getVideoTracks().concat(audio));
    const mime = pickMime();
    let rec;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (err) {
      phase = 'idle';
      syncButtons();
      setNote('ضبط شروع نشد');
      return;
    }
    chunks = [];
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    try {
      rec.start(250);
    } catch (err) {
      phase = 'idle';
      syncButtons();
      setNote('ضبط شروع نشد');
      return;
    }
    recorder = rec;
    phase = 'recording';
    recordStart = performance.now();
    clockSeconds = 0;
    hideCount();
    syncButtons();
    tickClock();
    clockTimer = setInterval(tickClock, 250);
  }

  function beginCountdown() {
    phase = 'countdown';
    hideCount();
    syncButtons();
    let n = 3;
    showCount(n);
    setNote('');
    countTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countTimer);
        countTimer = 0;
        hideCount();
        beginRecording();
      } else showCount(n);
    }, 1000);
  }

  function stamp() {
    const d = new Date();
    const two = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() +
      two(d.getMonth() + 1) +
      two(d.getDate()) +
      two(d.getHours()) +
      two(d.getMinutes()) +
      two(d.getSeconds())
    );
  }

  async function stopAndSave() {
    if (phase !== 'recording' && phase !== 'paused') return;
    const rec = recorder;
    phase = 'saving';
    clearInterval(clockTimer);
    clockTimer = 0;
    syncButtons();
    setNote('داره ذخیره می‌شه');
    const seconds = clockSeconds > 0.05 ? Math.round(clockSeconds * 1000) / 1000 : 0.2;
    if (rec && rec.state !== 'inactive') {
      await new Promise((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true });
        try {
          rec.stop();
        } catch (err) {
          resolve();
        }
      });
    }
    recorder = null;
    const blob = new Blob(chunks, { type: 'video/webm' });
    chunks = [];
    if (!blob.size) {
      phase = 'idle';
      syncButtons();
      setNote('فایل ضبط خالی شد');
      return;
    }
    const slug = 'free-' + stamp();
    let date = '';
    try {
      date = faNum(new Date().toLocaleDateString('fa-IR'));
    } catch (err) {}
    try {
      const uploaded = await fetch(
        '/api/clip?slug=' + encodeURIComponent(slug) + '&paragraph=01&take=1',
        { method: 'POST', body: blob }
      );
      const data = await uploaded.json().catch(() => ({}));
      if (!uploaded.ok || !data.file) throw new Error(data.error || 'ذخیره نشد');
      const paragraph = {
        index: 0,
        text: '',
        takes: [data.file],
        accepted: data.file,
        acceptedAudio: data.audioFile || null,
        duration: seconds,
      };
      const session = await fetch('/api/session?slug=' + encodeURIComponent(slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: slug,
          title: date ? 'ضبط آزاد ' + date : 'ضبط آزاد',
          free: true,
          paragraphs: [paragraph],
        }),
      });
      if (!session.ok) throw new Error('نشست ذخیره نشد');
      const durations = {};
      durations[data.file] = seconds;
      await fetch('/api/captions/build?slug=' + encodeURIComponent(slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ durations: durations }),
      });
      location.href = '/edit.html?slug=' + encodeURIComponent(slug);
    } catch (err) {
      phase = 'idle';
      syncButtons();
      setNote(err && err.message ? err.message : 'ذخیره نشد');
    }
  }

  function pauseRecording() {
    if (phase !== 'recording' || !recorder || recorder.state !== 'recording' || typeof recorder.pause !== 'function') {
      setNote('توقف کوتاه نشد');
      return;
    }
    try {
      recorder.pause();
    } catch (err) {
      setNote('توقف کوتاه نشد');
      return;
    }
    clockSeconds = Math.max(0, (performance.now() - recordStart) / 1000);
    clearInterval(clockTimer);
    phase = 'paused';
    syncButtons();
    setNote('توقف کوتاه ' + clockText());
  }

  function resumeRecording() {
    if (phase !== 'paused' || !recorder || recorder.state !== 'paused' || typeof recorder.resume !== 'function') return;
    try {
      recorder.resume();
    } catch (err) {
      setNote('شروع مجدد نشد');
      return;
    }
    recordStart = performance.now() - clockSeconds * 1000;
    phase = 'recording';
    syncButtons();
    clockTimer = setInterval(tickClock, 250);
    tickClock();
  }

  async function onStart() {
    if (phase !== 'idle' || opening) return;
    readChoice();
    if (camId.indexOf('phone') === 0) {
      setNote('دوربین گوشی از این صفحه وصل نمی‌شود');
      paintMessage('گوشی از این صفحه وصل نیست');
      return;
    }
    const ready = camId === 'screen' ? await openScreen() : await openWebcam();
    if (!ready || phase !== 'idle') return;
    beginCountdown();
  }

  if (startBtn) startBtn.addEventListener('click', () => onStart());
  if (stopBtn) {
    stopBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      stopAndSave();
    });
  }
  if (pauseBtn) {
    pauseBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      pauseRecording();
    });
  }
  if (resumeBtn) {
    resumeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      resumeRecording();
    });
  }

  window.addEventListener('beforeunload', (event) => {
    if (phase !== 'recording' && phase !== 'paused') return;
    event.preventDefault();
    event.returnValue = '';
  });

  readChoice();
  syncButtons();
  paintFrame();
  if (camId.indexOf('phone') === 0) {
    setNote('دوربین گوشی از این صفحه وصل نمی‌شود');
    paintMessage('گوشی از این صفحه وصل نیست');
  } else if (camId === 'screen') {
    setNote('برای دیدن صفحه، شروع ضبط را بزن');
    paintMessage('صفحه با شروع ضبط وصل می‌شود');
  } else {
    openWebcam();
  }
})();
