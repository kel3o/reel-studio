(function () {
  const state = {
    slug: null,
    paragraphs: [],
    current: 0,
    phase: 'idle', // idle | ready | countdown | recording | review | done
    mediaRecorder: null,
    chunks: [],
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
  const speedReadout = document.getElementById('tp-speed');
  const sizeReadout = document.getElementById('tp-size');
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
  const veilGoBtn = document.getElementById('tp-go');
  const recordBtn = document.getElementById('tp-record');
  const retakeBtn = document.getElementById('tp-retake');
  const acceptBtn = document.getElementById('tp-accept');

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function faNum(n) {
    return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // The pause mark (⏸) stays in paragraph.text for the performer, but the
  // emphasis[] and pauses[] indices only count spoken words. Rebuilding the
  // rich markup here (bold words, a "مکث" pill) keeps that contract intact
  // instead of pushing it back into the parser.
  function paragraphHtml(p) {
    const tokens = p.text.split(/\s+/).filter(Boolean);
    let wordIndex = -1;
    return tokens
      .map((token) => {
        if (token === '⏸') return '<span class="pz">مکث</span>';
        wordIndex += 1;
        const text = escapeHtml(token);
        return p.emphasis.includes(wordIndex) ? `<b>${text}</b>` : text;
      })
      .join(' ');
  }

  let speed = 3;
  let fontSize = 46;
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

  function updateRecordButton() {
    recordBtn.hidden = state.phase === 'review' || state.phase === 'done' || state.phase === 'idle';
    retakeBtn.hidden = state.phase !== 'review';
    acceptBtn.hidden = state.phase !== 'review';

    if (state.phase === 'ready') {
      recordBtn.textContent = 'ضبط';
      recordBtn.disabled = false;
      recordBtn.classList.remove('on');
    } else if (state.phase === 'recording') {
      recordBtn.textContent = 'توقف';
      recordBtn.disabled = false;
      recordBtn.classList.add('on');
    } else if (state.phase === 'countdown') {
      recordBtn.disabled = true;
      recordBtn.classList.remove('on');
    }
  }

  function setSpeed(v) {
    speed = Math.max(1, Math.min(12, v));
    speedReadout.textContent = faNum(speed);
  }

  function setFontSize(v) {
    fontSize = Math.max(24, Math.min(90, v));
    panel.style.setProperty('--tp-size', fontSize + 'px');
    sizeReadout.textContent = faNum(fontSize);
  }

  function renderTeleprompter() {
    textEl.innerHTML = '';
    state.paragraphs.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'tp-paragraph' + (i === state.current ? ' tp-current' : '');
      div.innerHTML = paragraphHtml(p);
      textEl.appendChild(div);
    });
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

  function startCountdown() {
    state.phase = 'countdown';
    updateRecordButton();
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

  function beginRecording() {
    const stream = window.__reel && window.__reel.stream;
    if (!stream) {
      setStatus('دوربین یا میکروفون آماده نیست');
      state.phase = 'ready';
      updateRecordButton();
      return;
    }
    if (liveCam.srcObject !== stream) liveCam.srcObject = stream;
    state.phase = 'recording';
    updateRecordButton();
    setStatus('در حال ضبط، فاصله رو بزن که تموم بشه');
    scrollPos = stage.scrollTop;
    lastFrameTs = 0;
    recordStartTs = performance.now();
    clockSeconds = 0;
    state.chunks = [];
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };
    recorder.onstop = onRecordingStopped;
    state.mediaRecorder = recorder;
    recorder.start();
  }

  function stopRecording() {
    if (state.mediaRecorder && state.phase === 'recording') {
      state.mediaRecorder.stop();
    }
  }

  async function uploadClip(blob, paragraphIndex, take) {
    const nn = String(paragraphIndex + 1).padStart(2, '0');
    const res = await fetch(
      `/api/clip?slug=${encodeURIComponent(state.slug)}&paragraph=${nn}&take=${take}`,
      { method: 'POST', body: blob }
    );
    const data = await res.json();
    return data.file;
  }

  async function onRecordingStopped() {
    const blob = new Blob(state.chunks, { type: 'video/webm' });
    const p = state.paragraphs[state.current];
    const take = p.takes.length + 1;

    const fileName = await uploadClip(blob, p.index, take);
    p.takes.push(fileName);

    reviewVideo.src = URL.createObjectURL(blob);
    reviewVideo.hidden = false;
    liveCam.hidden = true;
    reviewVideo.currentTime = 0;
    reviewVideo.play().catch(() => {});

    state.phase = 'review';
    updateRecordButton();
    setStatus('پخش دوباره، Enter برای قبول، R برای دوباره‌ضبط');
    renderProgress();
  }

  async function saveSession() {
    const body = {
      script: state.slug,
      paragraphs: state.paragraphs.map((p) => ({
        index: p.index,
        text: p.text,
        takes: p.takes,
        accepted: p.accepted,
      })),
    };
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

  function acceptTake() {
    const p = state.paragraphs[state.current];
    p.accepted = p.takes[p.takes.length - 1];
    reviewVideo.hidden = true;
    liveCam.hidden = false;
    reviewVideo.pause();
    saveSession();

    if (state.current < state.paragraphs.length - 1) {
      state.current += 1;
      state.phase = 'ready';
      setStatus('آماده');
    } else {
      state.phase = 'done';
      setStatus('همه‌ی پاراگراف‌ها ضبط شد');
    }
    updateRecordButton();
    renderTeleprompter();
    renderProgress();
  }

  function retake() {
    reviewVideo.hidden = true;
    liveCam.hidden = false;
    reviewVideo.pause();
    state.phase = 'ready';
    updateRecordButton();
    setStatus('آماده، دوباره ضبط کن');
  }

  function dismissVeil() {
    veil.classList.add('tp-veil-hidden');
  }

  function toggleRecording() {
    const veilVisible = !veil.classList.contains('tp-veil-hidden');
    if (veilVisible) {
      dismissVeil();
      if (state.phase === 'ready') startCountdown();
      return;
    }
    if (state.phase === 'ready') startCountdown();
    else if (state.phase === 'recording') stopRecording();
  }

  function handleKey(e) {
    if (state.phase === 'idle' || state.phase === 'done') return;
    if (e.code === 'Space') {
      e.preventDefault();
      toggleRecording();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSpeed(speed + 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSpeed(speed - 1);
    } else if (e.key === 'r' || e.key === 'R') {
      if (state.phase === 'review') retake();
    } else if (e.key === 'Enter') {
      if (state.phase === 'review') acceptTake();
    }
  }
  document.addEventListener('keydown', handleKey);

  closeBtn.addEventListener('click', () => {
    const isFull = panel.classList.toggle('fullscreen');
    closeBtn.textContent = isFull ? 'بستن' : 'تمام‌صفحه';
  });
  slowerBtn.addEventListener('click', () => setSpeed(speed - 1));
  fasterBtn.addEventListener('click', () => setSpeed(speed + 1));
  smallerBtn.addEventListener('click', () => setFontSize(fontSize - 4));
  biggerBtn.addEventListener('click', () => setFontSize(fontSize + 4));
  restartBtn.addEventListener('click', () => {
    scrollPos = 0;
    stage.scrollTop = 0;
  });
  mirrorBtn.addEventListener('click', () => {
    const on = panel.classList.toggle('mirror');
    mirrorBtn.classList.toggle('on', on);
  });
  veilGoBtn.addEventListener('click', () => {
    dismissVeil();
    if (state.phase === 'ready') startCountdown();
  });
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

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

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
    const existing = await loadExistingSession(slug);
    state.slug = slug;
    state.paragraphs = paragraphs.map((p, i) => {
      const prior = existing && existing.paragraphs && existing.paragraphs[i];
      return {
        index: i,
        text: p.text,
        emphasis: p.emphasis || [],
        takes: prior ? prior.takes || [] : [],
        accepted: prior ? prior.accepted || null : null,
      };
    });
    const firstUnaccepted = state.paragraphs.findIndex((p) => !p.accepted);
    state.current = firstUnaccepted === -1 ? state.paragraphs.length - 1 : firstUnaccepted;
    state.phase = firstUnaccepted === -1 ? 'done' : 'ready';

    panel.hidden = false;
    panel.classList.add('fullscreen');
    closeBtn.textContent = 'بستن';
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
    updateRecordButton();
    renderTeleprompter();
    renderProgress();
  };
})();
