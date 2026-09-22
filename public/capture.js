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
  const teleprompter = document.getElementById('teleprompter');
  const statusEl = document.getElementById('capture-status');
  const reviewVideo = document.getElementById('review-video');
  const progressStrip = document.getElementById('progress-strip');
  const scrollSpeedInput = document.getElementById('scroll-speed');
  const fontSizeInput = document.getElementById('font-size');

  // The known bug: adding a sub pixel delta straight to scrollTop truncates
  // to zero every frame at slow speeds, because scrollTop always reads back
  // an integer. Accumulate the real position here instead, and only assign.
  let scrollPos = 0;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function applyFontSize() {
    teleprompter.style.fontSize = fontSizeInput.value + 'px';
  }

  function renderTeleprompter() {
    teleprompter.innerHTML = '';
    state.paragraphs.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'tp-paragraph' + (i === state.current ? ' tp-current' : '');
      div.textContent = p.text;
      teleprompter.appendChild(div);
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
    let n = 3;
    setStatus(`شروع تا ${n} ثانیه دیگه`);
    const interval = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(interval);
        beginRecording();
      } else {
        setStatus(`شروع تا ${n} ثانیه دیگه`);
      }
    }, 1000);
  }

  function beginRecording() {
    const stream = window.__reel && window.__reel.stream;
    if (!stream) {
      setStatus('دوربین یا میکروفون آماده نیست');
      state.phase = 'ready';
      return;
    }
    state.phase = 'recording';
    setStatus('در حال ضبط، فاصله رو بزن که تموم بشه');
    scrollPos = teleprompter.scrollTop;
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
    reviewVideo.currentTime = 0;
    reviewVideo.play().catch(() => {});

    state.phase = 'review';
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
    renderTeleprompter();
    renderProgress();
  }

  function retake() {
    reviewVideo.hidden = true;
    reviewVideo.pause();
    state.phase = 'ready';
    setStatus('آماده، دوباره ضبط کن');
  }

  function handleKey(e) {
    if (state.phase === 'idle' || state.phase === 'done') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.phase === 'ready') startCountdown();
      else if (state.phase === 'recording') stopRecording();
    } else if (e.key === 'r' || e.key === 'R') {
      if (state.phase === 'review') retake();
    } else if (e.key === 'Enter') {
      if (state.phase === 'review') acceptTake();
    }
  }
  document.addEventListener('keydown', handleKey);

  function scrollStep() {
    const speed = Number(scrollSpeedInput.value);
    if (speed > 0 && state.phase === 'recording') {
      scrollPos += speed * 0.02;
      teleprompter.scrollTop = scrollPos;
    }
    requestAnimationFrame(scrollStep);
  }
  requestAnimationFrame(scrollStep);

  fontSizeInput.addEventListener('input', applyFontSize);

  async function loadExistingSession(slug) {
    try {
      const res = await fetch(`/api/session?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  window.startCaptureSession = async function (slug, paragraphs) {
    const existing = await loadExistingSession(slug);
    state.slug = slug;
    state.paragraphs = paragraphs.map((p, i) => {
      const prior = existing && existing.paragraphs && existing.paragraphs[i];
      return {
        index: i,
        text: p.text,
        takes: prior ? prior.takes || [] : [],
        accepted: prior ? prior.accepted || null : null,
      };
    });
    const firstUnaccepted = state.paragraphs.findIndex((p) => !p.accepted);
    state.current = firstUnaccepted === -1 ? state.paragraphs.length - 1 : firstUnaccepted;
    state.phase = firstUnaccepted === -1 ? 'done' : 'ready';
    panel.hidden = false;
    setStatus(state.phase === 'done' ? 'همه‌ی پاراگراف‌ها ضبط شد' : 'آماده');
    applyFontSize();
    renderTeleprompter();
    renderProgress();
  };
})();
