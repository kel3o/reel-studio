(function () {
  const state = {
    slug: null,
    title: '',
    paragraphs: [],
    current: 0,
    phase: 'idle', // idle | ready | countdown | recording | review | done
    mediaRecorder: null,
    audioRecorder: null,
    chunks: [],
    audioChunks: [],
    pendingAudioFile: null,
  };
  window.__reelCapture = state;

  const panel = document.getElementById('capture-panel');
  const closeBtn = document.getElementById('tp-close');
  const slowerBtn = document.getElementById('tp-slower');
  const fasterBtn = document.getElementById('tp-faster');
  const smallerBtn = document.getElementById('tp-smaller');
  const biggerBtn = document.getElementById('tp-bigger');
  const restartBtn = document.getElementById('tp-restart');
  const mirrorBtn = document.getElementById('tp-mirror');
  const openFolderBtn = document.getElementById('tp-open-folder');
  const speedReadout = document.getElementById('tp-speed');
  const sizeReadout = document.getElementById('tp-size');
  const leadInput = document.getElementById('tp-lead');
  const leadReadout = document.getElementById('tp-lead-out');
  const clockEl = document.getElementById('tp-clock');
  const stage = document.getElementById('teleprompter');
  const textEl = document.getElementById('tp-text');
  const bar = document.getElementById('tp-bar');
  const statusEl = document.getElementById('capture-status');
  const reviewVideo = document.getElementById('review-video');
  const liveCam = document.getElementById('tp-live-cam');
  const progressStrip = document.getElementById('progress-strip');
  const veil = document.getElementById('tp-veil');
  const veilTitle = document.getElementById('tp-veil-title');
  const veilCloseBtn = document.getElementById('tp-veil-close');
  const veilGoBtn = document.getElementById('tp-go');
  const recordBtn = document.getElementById('tp-record');
  const retakeBtn = document.getElementById('tp-retake');
  const acceptBtn = document.getElementById('tp-accept');
  const captionLink = document.getElementById('tp-captions');
  let captionBuildKey = '';
  let accepting = false;

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function faNum(n) {
    return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // The pause mark (⏸) stays in paragraph.text for the performer, but the
  // emphasis[] and pauses[] indices only count spoken words. Soft line breaks
  // from the script stay as <br>. Color tags like [2] never reach the screen.
  function paragraphHtml(p) {
    const source = String((p && p.text) || '').replace(/\r\n/g, '\n');
    const emphasis = p && Array.isArray(p.emphasis) ? p.emphasis : [];
    const colors = (p && p.emphasisColors) || {};
    let wordIndex = -1;
    const parts = [];
    source.split('\n').forEach((line, lineIndex) => {
      if (lineIndex) parts.push('<br>');
      const tokens = line.split(/\s+/).filter(Boolean);
      tokens.forEach((token, tokenIndex) => {
        if (tokenIndex) parts.push(' ');
        if (token === '⏸') {
          parts.push('<span class="pz">مکث</span>');
          return;
        }
        wordIndex += 1;
        const text = escapeHtml(token);
        if (emphasis.includes(wordIndex)) {
          const color = colors[wordIndex] || 1;
          parts.push('<b class="tp-w tp-em tp-em-' + color + '">' + text + '</b>');
          return;
        }
        parts.push('<span class="tp-w">' + text + '</span>');
      });
    });
    return parts.join('');
  }

  function currentParagraphHtml() {
    const p = state.paragraphs[state.current];
    return p ? paragraphHtml(p) : '';
  }

  function pushTeleprompter(extra) {
    const api = window.__reelPhone;
    if (!api || !api.sendTeleprompter) return;
    const payload = Object.assign(
      {
        visible: state.phase !== 'idle' && state.phase !== 'done',
        scrolling: state.phase === 'recording',
        html: currentParagraphHtml(),
        index: state.current,
        total: state.paragraphs.length,
        speed: speed,
        fontSize: fontSize,
        lineHeight: lineHeight,
        scrollPos: scrollPos,
        phase: state.phase,
      },
      extra || {}
    );
    api.sendTeleprompter(payload);
  }

  function markActiveLine() {
    const current = textEl.querySelector('.tp-paragraph.tp-current');
    textEl.querySelectorAll('.tp-w.tp-line-on').forEach((el) => el.classList.remove('tp-line-on'));
    if (!current) return;
    const words = current.querySelectorAll('.tp-w');
    if (!words.length) return;
    const stageRect = stage.getBoundingClientRect();
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
    if (!best) return;
    const lineTop = best.offsetTop;
    words.forEach((word) => {
      if (Math.abs(word.offsetTop - lineTop) <= 1) word.classList.add('tp-line-on');
    });
  }

  let speed = 3;
  let fontSize = 46;
  let lineHeight = 1.75;
  // The known bug: adding a sub pixel delta straight to scrollTop truncates
  // to zero every frame at slow speeds, because scrollTop always reads back
  // an integer. Accumulate the real position here instead, and only assign.
  let scrollPos = 0;
  let lastFrameTs = 0;
  let recordStartTs = 0;
  let clockSeconds = 0;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function setRecordLabel(text) {
    const label = recordBtn.querySelector('.tp-rec-label');
    if (label) label.textContent = text;
    else recordBtn.textContent = text;
  }

  function updateRecordButton() {
    recordBtn.hidden = state.phase === 'review' || state.phase === 'done' || state.phase === 'idle';
    retakeBtn.hidden = state.phase !== 'review';
    acceptBtn.hidden = state.phase !== 'review';

    if (state.phase === 'ready') {
      setRecordLabel('ضبط');
      recordBtn.disabled = false;
      recordBtn.classList.remove('on');
    } else if (state.phase === 'recording') {
      setRecordLabel('توقف');
      recordBtn.disabled = false;
      recordBtn.classList.add('on');
    } else if (state.phase === 'countdown') {
      recordBtn.disabled = true;
      recordBtn.classList.remove('on');
    }
    syncCaptionLink();
  }

  function syncCaptionLink() {
    if (!captionLink) return;
    const show = state.phase === 'done' && !!state.slug;
    captionLink.hidden = !show;
    if (!show) {
      captionBuildKey = '';
      return;
    }
    captionLink.href = '/edit.html?slug=' + encodeURIComponent(state.slug);
    if (captionBuildKey === state.slug) return;
    captionBuildKey = state.slug;
    const durations = {};
    state.paragraphs.forEach((paragraph) => {
      if (paragraph.accepted && Number(paragraph.duration) > 0.05) {
        durations[paragraph.accepted] = Number(paragraph.duration);
      }
    });
    fetch('/api/captions/build?slug=' + encodeURIComponent(state.slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ durations }),
    }).catch(() => {});
  }

  function setSpeed(v) {
    speed = Math.max(1, Math.min(12, v));
    speedReadout.textContent = faNum(speed);
    pushTeleprompter();
  }

  function setFontSize(v) {
    fontSize = Math.max(24, Math.min(90, v));
    panel.style.setProperty('--tp-size', fontSize + 'px');
    if (sizeReadout) sizeReadout.textContent = faNum(fontSize);
    pushTeleprompter();
  }

  function setLineHeight(v) {
    lineHeight = Math.max(1.2, Math.min(2.8, Number(v) || 1.75));
    panel.style.setProperty('--tp-lead', String(lineHeight));
    if (leadInput) leadInput.value = String(Math.round(lineHeight * 100));
    if (leadReadout) leadReadout.textContent = faNum(lineHeight.toFixed(2)).replace('.', '٫');
    pushTeleprompter();
  }

  function renderTeleprompter() {
    textEl.innerHTML = '';
    state.paragraphs.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'tp-paragraph' + (i === state.current ? ' tp-current' : '');
      div.innerHTML = paragraphHtml(p);
      textEl.appendChild(div);
    });
    markActiveLine();
    pushTeleprompter();
  }

  function renderProgress() {
    progressStrip.innerHTML = '';
    state.paragraphs.forEach((p, i) => {
      const li = document.createElement('li');
      li.className =
        'progress-chip' + (p.accepted ? ' accepted' : '') + (i === state.current ? ' current' : '');
      li.textContent = String(i + 1);
      li.addEventListener('click', () => {
        if (state.phase === 'ready' || state.phase === 'idle' || state.phase === 'done') {
          state.current = i;
          state.phase = 'ready';
          updateRecordButton();
          renderTeleprompter();
          renderProgress();
          setStatus('آماده');
        }
      });
      progressStrip.appendChild(li);
    });
  }

  function pickMimeType() {
    const candidates = ['video/webm;codecs=vp8,opus', 'video/webm'];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  function pickAudioMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'video/webm;codecs=opus', 'video/webm'];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  function waitRecorderStop(recorder) {
    if (!recorder || recorder.state === 'inactive') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        recorder.removeEventListener('stop', done);
        resolve();
      };
      recorder.addEventListener('stop', done);
      try {
        if (recorder.state === 'recording') recorder.stop();
        else resolve();
      } catch (err) {
        resolve();
      }
    });
  }

  function startCountdown() {
    state.phase = 'countdown';
    scrollPos = 0;
    stage.scrollTop = 0;
    updateRecordButton();
    pushTeleprompter({ visible: true, scrolling: false, resetScroll: true, scrollPos: 0 });
    let n = 3;
    setStatus(`شروع تا ${faNum(n)} ثانیه دیگه`);
    recordBtn.textContent = faNum(n);
    const interval = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(interval);
        beginRecording();
      } else {
        setStatus(`شروع تا ${faNum(n)} ثانیه دیگه`);
        recordBtn.textContent = faNum(n);
      }
    }, 1000);
  }

  async function ensureReady() {
    try {
      if (window.__reel && window.__reel.ensureStream) await window.__reel.ensureStream();
    } catch (err) {
      setStatus('دوربین یا میکروفون آماده نیست');
      return false;
    }
    const stream = window.__reel && window.__reel.stream;
    if (!stream) {
      setStatus('دوربین یا میکروفون آماده نیست');
      return false;
    }
    if (liveCam.srcObject !== stream) liveCam.srcObject = stream;
    return true;
  }

  let arming = false;
  async function armRecording() {
    if (state.phase !== 'ready' || arming) return;
    arming = true;
    dismissVeil();
    const ok = await ensureReady();
    arming = false;
    if (!ok || state.phase !== 'ready') return;
    startCountdown();
  }

  function beginRecording() {
    const stream = window.__reel && window.__reel.stream;
    if (!stream) {
      setStatus('دوربین یا میکروفون آماده نیست');
      state.phase = 'ready';
      updateRecordButton();
      return;
    }
    if (liveCam.srcObject !== stream) liveCam.srcObject = stream;
    if (window.__reel && window.__reel.resetCutClock) window.__reel.resetCutClock();
    state.phase = 'recording';
    updateRecordButton();
    setStatus('در حال ضبط، فاصله رو بزن که تموم بشه');
    scrollPos = stage.scrollTop;
    lastFrameTs = 0;
    recordStartTs = performance.now();
    clockSeconds = 0;
    state.chunks = [];
    state.audioChunks = [];
    state.pendingAudioFile = null;
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };
    recorder.onstop = onRecordingStopped;
    state.mediaRecorder = recorder;
    recorder.start();

    const audioTracks = stream.getAudioTracks().filter((t) => t.readyState === 'live');
    state.audioRecorder = null;
    if (audioTracks.length) {
      const audioStream = new MediaStream(audioTracks);
      const audioMime = pickAudioMimeType();
      try {
        const audioRecorder = audioMime
          ? new MediaRecorder(audioStream, { mimeType: audioMime })
          : new MediaRecorder(audioStream);
        audioRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) state.audioChunks.push(e.data);
        };
        state.audioRecorder = audioRecorder;
        audioRecorder.start();
      } catch (err) {
        state.audioRecorder = null;
      }
    }
    pushTeleprompter({ visible: true, scrolling: true, resetScroll: true });
  }

  function stopRecording() {
    if (state.mediaRecorder && state.phase === 'recording') {
      try {
        if (state.audioRecorder && state.audioRecorder.state === 'recording') state.audioRecorder.stop();
      } catch (err) {}
      state.mediaRecorder.stop();
    }
  }

  async function uploadClip(blob, paragraphIndex, take, kind) {
    const nn = String(paragraphIndex + 1).padStart(2, '0');
    const query =
      `/api/clip?slug=${encodeURIComponent(state.slug)}&paragraph=${nn}&take=${take}` +
      (kind === 'audio' ? '&kind=audio' : '');
    const res = await fetch(query, { method: 'POST', body: blob });
    const data = await res.json();
    return data.file;
  }

  async function onRecordingStopped() {
    await waitRecorderStop(state.audioRecorder);
    const blob = new Blob(state.chunks, { type: 'video/webm' });
    const p = state.paragraphs[state.current];
    const take = p.takes.length + 1;

    const fileName = await uploadClip(blob, p.index, take);
    p.takes.push(fileName);
    state.pendingAudioFile = null;
    if (state.audioChunks.length) {
      try {
        const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
        state.pendingAudioFile = await uploadClip(audioBlob, p.index, take, 'audio');
      } catch (err) {
        state.pendingAudioFile = null;
      }
    }

    reviewVideo.src = URL.createObjectURL(blob);
    reviewVideo.hidden = false;
    liveCam.hidden = true;
    reviewVideo.currentTime = 0;
    reviewVideo.play().catch(() => {});

    state.phase = 'review';
    updateRecordButton();
    setStatus('پخش دوباره، Enter برای قبول، R برای دوباره‌ضبط');
    renderProgress();
    pushTeleprompter({ scrolling: false });
  }

  async function saveSession() {
    const body = {
      script: state.slug,
      title: state.title || '',
      paragraphs: state.paragraphs.map((p) => ({
        index: p.index,
        text: p.text,
        takes: p.takes,
        accepted: p.accepted,
        acceptedAudio: p.acceptedAudio || null,
        duration: p.duration || null,
      })),
    };
    try {
      const devices = window.__reelDevices;
      if (devices && typeof devices.cameraLabels === 'function') {
        const labels = devices.cameraLabels();
        if (Array.isArray(labels) && labels.length > 1) body.cameras = labels;
      }
    } catch (err) {}
    try {
      await fetch(`/api/session?slug=${encodeURIComponent(state.slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // the in memory state still holds the truth for the rest of this run
    }
  }

  function reviewDuration() {
    const known = reviewVideo.duration;
    if (Number.isFinite(known) && known > 0) return Promise.resolve(known);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        reviewVideo.removeEventListener('loadedmetadata', finish);
        const value = reviewVideo.duration;
        resolve(Number.isFinite(value) && value > 0 ? value : null);
      };
      reviewVideo.addEventListener('loadedmetadata', finish);
      setTimeout(finish, 1200);
    });
  }

  async function acceptTake() {
    if (accepting || state.phase !== 'review') return;
    accepting = true;
    const p = state.paragraphs[state.current];
    p.accepted = p.takes[p.takes.length - 1];
    p.acceptedAudio = state.pendingAudioFile || null;
    state.pendingAudioFile = null;
    try {
      p.duration = await reviewDuration();
    } catch (err) {
      p.duration = null;
    }
    reviewVideo.hidden = true;
    liveCam.hidden = false;
    reviewVideo.pause();
    await saveSession();

    if (state.current < state.paragraphs.length - 1) {
      state.current += 1;
      state.phase = 'ready';
      setStatus('آماده');
      scrollPos = 0;
      stage.scrollTop = 0;
    } else {
      state.phase = 'done';
      setStatus('همه‌ی پاراگراف‌ها ضبط شد');
    }
    updateRecordButton();
    renderTeleprompter();
    renderProgress();
    if (state.phase === 'done') pushTeleprompter({ visible: false, scrolling: false });
    accepting = false;
  }

  function retake() {
    reviewVideo.hidden = true;
    liveCam.hidden = false;
    reviewVideo.pause();
    state.pendingAudioFile = null;
    state.phase = 'ready';
    updateRecordButton();
    setStatus('آماده، دوباره ضبط کن');
    pushTeleprompter({ scrolling: false, resetScroll: true });
  }

  function dismissVeil() {
    veil.classList.add('tp-veil-hidden');
  }

  function toggleRecording() {
    if (state.phase === 'recording') {
      stopRecording();
      return;
    }
    if (state.phase === 'ready') armRecording();
  }
  state.toggle = toggleRecording;

  function exitCapture() {
    if (state.phase === 'idle') return;
    if (state.phase === 'recording' || state.phase === 'countdown') {
      try {
        if (state.audioRecorder && state.audioRecorder.state === 'recording') state.audioRecorder.stop();
      } catch (err) {}
      try {
        if (state.mediaRecorder && state.mediaRecorder.state === 'recording') state.mediaRecorder.stop();
      } catch (err) {}
      state.mediaRecorder = null;
      state.audioRecorder = null;
      state.chunks = [];
      state.audioChunks = [];
      state.pendingAudioFile = null;
    }
    if (reviewVideo) {
      try {
        reviewVideo.pause();
        reviewVideo.removeAttribute('src');
        reviewVideo.load();
      } catch (err) {}
      reviewVideo.hidden = true;
    }
    if (liveCam) liveCam.hidden = false;
    state.phase = 'idle';
    state.slug = null;
    state.title = '';
    state.paragraphs = [];
    state.current = 0;
    panel.hidden = true;
    panel.classList.remove('fullscreen', 'mirror');
    document.body.classList.remove('tp-open');
    veil.classList.remove('tp-veil-hidden');
    updateRecordButton();
    pushTeleprompter({ visible: false, scrolling: false });
    setStatus('آماده');
  }

  function handleKey(e) {
    if (panel.hidden || state.phase === 'idle') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      exitCapture();
      return;
    }
    if (state.phase === 'done' && veil && !veil.classList.contains('tp-veil-hidden')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      toggleRecording();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSpeed(speed + 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSpeed(speed - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFontSize(fontSize + 4);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFontSize(fontSize - 4);
    } else if (e.key === 'r' || e.key === 'R') {
      if (state.phase === 'review') retake();
    } else if (e.key === 'Enter') {
      if (state.phase === 'review') acceptTake();
    }
  }
  document.addEventListener('keydown', handleKey);

  closeBtn.addEventListener('click', exitCapture);
  if (veilCloseBtn) veilCloseBtn.addEventListener('click', exitCapture);
  if (slowerBtn) slowerBtn.addEventListener('click', () => setSpeed(speed - 1));
  if (fasterBtn) fasterBtn.addEventListener('click', () => setSpeed(speed + 1));
  if (smallerBtn) smallerBtn.addEventListener('click', () => setFontSize(fontSize - 4));
  if (biggerBtn) biggerBtn.addEventListener('click', () => setFontSize(fontSize + 4));
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      scrollPos = 0;
      stage.scrollTop = 0;
      pushTeleprompter({ resetScroll: true, scrollPos: 0 });
    });
  }
  if (mirrorBtn) {
    mirrorBtn.addEventListener('click', () => {
      const on = panel.classList.toggle('mirror');
      mirrorBtn.classList.toggle('on', on);
    });
  }
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      if (!state.slug) return;
      fetch(`/api/open-folder?slug=${encodeURIComponent(state.slug)}`, { method: 'POST' }).catch(() => {});
    });
  }
  if (leadInput) {
    leadInput.addEventListener('input', () => {
      setLineHeight(Number(leadInput.value) / 100);
    });
  }
  function openFromVeil() {
    if (!state.paragraphs.length) {
      dismissVeil();
      setStatus('پاراگرافی برای ضبط نیست');
      return;
    }
    // A finished scenario used to ignore this button, because armRecording
    // only runs while phase is ready.
    if (state.phase === 'done') {
      state.current = 0;
      state.phase = 'ready';
      scrollPos = 0;
      stage.scrollTop = 0;
      updateRecordButton();
      renderTeleprompter();
      renderProgress();
      setStatus('آماده');
    }
    if (state.phase === 'ready') {
      armRecording();
      return;
    }
    dismissVeil();
  }

  veilGoBtn.addEventListener('click', openFromVeil);
  recordBtn.addEventListener('click', toggleRecording);
  retakeBtn.addEventListener('click', retake);
  acceptBtn.addEventListener('click', acceptTake);

  function frame(ts) {
    if (!lastFrameTs) lastFrameTs = ts;
    const dt = (ts - lastFrameTs) / 1000;
    lastFrameTs = ts;

    if (speed > 0 && state.phase === 'recording') {
      scrollPos += speed * 11 * dt;
      stage.scrollTop = scrollPos;
      clockSeconds = (performance.now() - recordStartTs) / 1000;
    }

    const mm = Math.floor(clockSeconds / 60);
    const ss = Math.floor(clockSeconds % 60);
    clockEl.textContent = faNum(mm) + ':' + faNum(ss < 10 ? '0' + ss : ss);

    const max = stage.scrollHeight - stage.clientHeight;
    bar.style.width = (max > 0 ? (stage.scrollTop / max) * 100 : 0) + '%';
    markActiveLine();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => {
    if (panel.hidden || state.phase !== 'recording') return;
    pushTeleprompter();
  }, 400);

  async function loadExistingSession(slug) {
    try {
      const res = await fetch(`/api/session?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  window.startCaptureSession = async function (slug, paragraphs, title) {
    const list = Array.isArray(paragraphs) ? paragraphs : [];
    if (!list.length) {
      panel.hidden = true;
      document.body.classList.remove('tp-open');
      return;
    }
    const existing = await loadExistingSession(slug);
    state.slug = slug;
    state.title = title || '';
    state.paragraphs = list.map((p, i) => {
      const prior = existing && existing.paragraphs && existing.paragraphs[i];
      return {
        index: i,
        text: p.text,
        emphasis: p.emphasis || [],
        emphasisColors: p.emphasisColors || {},
        takes: prior ? prior.takes || [] : [],
        accepted: prior ? prior.accepted || null : null,
        acceptedAudio: prior ? prior.acceptedAudio || null : null,
        duration: prior && Number(prior.duration) > 0 ? Number(prior.duration) : null,
      };
    });
    const firstUnaccepted = state.paragraphs.findIndex((p) => !p.accepted);
    state.current = firstUnaccepted === -1 ? state.paragraphs.length - 1 : firstUnaccepted;
    state.phase = firstUnaccepted === -1 ? 'done' : 'ready';

    panel.hidden = false;
    panel.classList.add('fullscreen');
    document.body.classList.add('tp-open');
    if (window.__reel && window.__reel.stream) {
      liveCam.srcObject = window.__reel.stream;
    }
    veil.classList.remove('tp-veil-hidden');
    veilTitle.textContent = title || 'تله‌پرامپتر';
    scrollPos = 0;
    stage.scrollTop = 0;
    setStatus(state.phase === 'done' ? 'همه‌ی پاراگراف‌ها ضبط شد' : 'آماده');
    setSpeed(speed);
    setFontSize(fontSize);
    setLineHeight(lineHeight);
    updateRecordButton();
    renderTeleprompter();
    renderProgress();
  };
})();
