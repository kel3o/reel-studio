(function () {
  const state = {
    slug: null,
    title: '',
    paragraphs: [],
    current: 0,
    phase: 'idle', // idle | ready | countdown | recording | paused | review | done
    mediaRecorder: null,
    audioRecorder: null,
    chunks: [],
    audioChunks: [],
    pendingAudioFile: null,
    free: false,
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
  const floatBox = document.getElementById('rec-float');
  const floatPreview = document.getElementById('rec-float-preview');
  const floatStartBtn = document.getElementById('rec-float-start');
  const floatStopBtn = document.getElementById('rec-float-stop');
  const floatPauseBtn = document.getElementById('rec-float-pause');
  const floatResumeBtn = document.getElementById('rec-float-resume');
  const browseLayer = document.getElementById('rec-browse');
  const browseFrame = document.getElementById('rec-browse-frame');
  const retakeBtn = document.getElementById('tp-retake');
  const acceptBtn = document.getElementById('tp-accept');
  const captionLink = document.getElementById('tp-captions');
  const yellowBtn = document.getElementById('tp-yellow');
  let captionBuildKey = '';
  let accepting = false;
  let yellowWords = false;
  let yellowIndex = -1;
  let yellowSchedule = [];
  let recordedWordTimings = [];

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function faDigits(value) {
    return String(value == null ? '' : value).replace(/[0-9\u0660-\u0669]/g, (ch) => {
      const n = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 0x0660;
      return FA_DIGITS[n] || ch;
    });
  }

  function faNum(n) {
    return faDigits(n);
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
        const text = escapeHtml(faDigits(token).replace(/\[([1-6])\]/g, ''));
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

  function spokenTokenList(p) {
    const source = String((p && p.text) || '').replace(/\r\n/g, '\n');
    const out = [];
    source.split(/\s+/).forEach((token) => {
      if (!token || token === '⏸') return;
      out.push(token.replace(/^\[([1-6])\]/, ''));
    });
    return out;
  }

  function buildYellowSchedule(p, pace) {
    const tokens = spokenTokenList(p);
    const charSec = 0.055 / Math.max(0.5, pace / 3);
    let t = 0;
    return tokens.map((text) => {
      const dur = Math.max(0.08, Math.max(1, text.length) * charSec);
      const start = t;
      t += dur;
      return { text, start, end: t };
    });
  }

  function setYellowWords(on) {
    yellowWords = !!on;
    if (yellowBtn) {
      yellowBtn.classList.toggle('on', yellowWords);
      yellowBtn.setAttribute('aria-pressed', yellowWords ? 'true' : 'false');
      yellowBtn.title = yellowWords ? 'کلمه زرد روشن' : 'کلمه زرد خاموش';
    }
    try {
      localStorage.setItem('reel.tpWord', yellowWords ? '1' : '0');
    } catch (err) {}
    if (!yellowWords) {
      textEl.querySelectorAll('.tp-w.tp-word-on').forEach((el) => el.classList.remove('tp-word-on'));
      yellowIndex = -1;
    }
    pushTeleprompter({ yellowWords: yellowWords, yellowIndex: yellowIndex });
  }

  function markYellowWord(index) {
    const current = textEl.querySelector('.tp-paragraph.tp-current');
    clearReadingMarks();
    textEl.querySelectorAll('.tp-w.tp-word-on').forEach((el) => el.classList.remove('tp-word-on'));
    if (!current || !yellowWords) return null;
    const words = current.querySelectorAll('.tp-w');
    if (!words.length || index < 0 || index >= words.length) return null;
    const word = words[index];
    word.classList.add('tp-word-on');
    return word;
  }

  function followYellowWord(word) {
    if (!word || !stage) return;
    const stageRect = stage.getBoundingClientRect();
    const eyeY = stageRect.top + stageRect.height * 0.22;
    const rect = word.getBoundingClientRect();
    const mid = (rect.top + rect.bottom) / 2;
    const delta = mid - eyeY;
    if (Math.abs(delta) < 4) return;
    scrollPos = Math.max(0, scrollPos + delta);
    stage.scrollTop = scrollPos;
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
        yellowWords: yellowWords,
        yellowIndex: yellowIndex,
      },
      extra || {}
    );
    if (state.free) {
      payload.visible = false;
      payload.scrolling = false;
      payload.html = '';
    }
    api.sendTeleprompter(payload);
  }

  function clearReadingMarks() {
    textEl.querySelectorAll('.tp-w.tp-line-on').forEach((el) => el.classList.remove('tp-line-on'));
  }

  function wordAtEye() {
    const current = textEl.querySelector('.tp-paragraph.tp-current');
    if (!current) return null;
    const words = current.querySelectorAll('.tp-w');
    if (!words.length) return null;
    const stageRect = stage.getBoundingClientRect();
    const eyeY = stageRect.top + stageRect.height * 0.22;
    let best = null;
    let bestDist = Infinity;
    words.forEach((word) => {
      const rect = word.getBoundingClientRect();
      if (rect.bottom < stageRect.top - 8 || rect.top > stageRect.bottom + 8) return;
      const mid = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(mid - eyeY);
      if (dist < bestDist) {
        bestDist = dist;
        best = word;
      }
    });
    return best;
  }

  function markActiveLine() {
    clearReadingMarks();
    if (!yellowWords) {
      textEl.querySelectorAll('.tp-w.tp-word-on').forEach((el) => el.classList.remove('tp-word-on'));
      return;
    }
    if (state.phase === 'recording') return;
    const best = wordAtEye();
    textEl.querySelectorAll('.tp-w.tp-word-on').forEach((el) => el.classList.remove('tp-word-on'));
    if (best) best.classList.add('tp-word-on');
  }

  function tickYellowWords(elapsed) {
    clearReadingMarks();
    if (!yellowWords || state.phase !== 'recording') return;
    if (!yellowSchedule.length) return;
    let next = yellowSchedule.length - 1;
    for (let i = 0; i < yellowSchedule.length; i++) {
      if (elapsed < yellowSchedule[i].end) {
        next = i;
        break;
      }
    }
    if (next !== yellowIndex) {
      yellowIndex = next;
      const word = markYellowWord(yellowIndex);
      followYellowWord(word);
      pushTeleprompter({ yellowIndex: yellowIndex, yellowWords: true });
    } else {
      markYellowWord(yellowIndex);
    }
  }

  let speed = 3;
  let fontSize = 38;
  let lineHeight = 1.75;
  // The known bug: adding a sub pixel delta straight to scrollTop truncates
  // to zero every frame at slow speeds, because scrollTop always reads back
  // an integer. Accumulate the real position here instead, and only assign.
  let scrollPos = 0;
  let lastFrameTs = 0;
  let recordStartTs = 0;
  let clockSeconds = 0;
  let finishToEditor = false;
  let browseOpen = false;
  let historyHeld = false;

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
    } else if (state.phase === 'paused') {
      setRecordLabel('ادامه');
      recordBtn.disabled = false;
      recordBtn.classList.add('on');
    } else if (state.phase === 'countdown') {
      recordBtn.disabled = true;
      recordBtn.classList.remove('on');
    }
    const lastTake = state.free || !state.paragraphs.length || state.current >= state.paragraphs.length - 1;
    acceptBtn.title = lastTake ? 'قبول و رفتن به ادیت' : 'قبول و بعدی';
    syncCaptionLink();
    syncFloat();
  }

  function recordingLive() {
    return state.phase === 'recording' || state.phase === 'paused';
  }

  function holdHistory() {
    if (historyHeld) return;
    historyHeld = true;
    history.pushState({ reelHold: 1 }, '');
  }

  function syncFloat() {
    if (!floatBox) return;
    const recording = state.phase === 'recording';
    const paused = state.phase === 'paused';
    const counting = state.phase === 'countdown';
    floatBox.classList.toggle('is-paused', paused);
    if (floatStartBtn) {
      floatStartBtn.hidden = recording || paused;
      floatStartBtn.disabled = counting;
      if (!counting) floatStartBtn.textContent = 'شروع ضبط';
    }
    if (floatStopBtn) floatStopBtn.hidden = !recording && !paused;
    if (floatPauseBtn) floatPauseBtn.hidden = !recording;
    if (floatResumeBtn) floatResumeBtn.hidden = !paused;
  }

  function setFloatCount(n) {
    if (!floatStartBtn) return;
    floatStartBtn.hidden = false;
    floatStartBtn.disabled = true;
    floatStartBtn.textContent = faNum(n);
  }

  function paintFloatPreview() {
    const canvas = floatPreview;
    const src = document.getElementById('preview');
    if (canvas && canvas.getContext && src && src.readyState >= 2 && src.videoWidth && src.videoHeight) {
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      const scale = Math.min(w / src.videoWidth, h / src.videoHeight);
      const dw = src.videoWidth * scale;
      const dh = src.videoHeight * scale;
      ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    requestAnimationFrame(paintFloatPreview);
  }

  function closeBrowse() {
    browseOpen = false;
    if (browseLayer) browseLayer.hidden = true;
    if (browseFrame) browseFrame.src = 'about:blank';
    syncFloat();
  }

  function openBrowse(path) {
    if (!browseFrame || !browseLayer) return;
    browseFrame.src = path;
    browseLayer.hidden = false;
    browseOpen = true;
    syncFloat();
    history.pushState({ reelBrowse: path }, '', path);
  }

  function appPath(href) {
    let url;
    try {
      url = new URL(href, location.href);
    } catch (err) {
      return '';
    }
    if (url.origin !== location.origin) return '';
    const path = url.pathname;
    if (path === '/' || path.endsWith('/index.html')) {
      return url.searchParams.get('settings') === '1' ? 'settings' : 'home';
    }
    const pages = ['/scenarios.html', '/archive.html', '/help.html', '/script.html', '/edit.html', '/phone.html'];
    if (pages.indexOf(path) === -1) return '';
    return path + url.search;
  }

  function showDashboard() {
    panel.hidden = true;
    document.body.classList.remove('tp-open');
    syncFloat();
  }

  function showTeleprompter() {
    if (browseOpen) {
      if (history.state && history.state.reelBrowse) history.back();
      else closeBrowse();
    }
    panel.hidden = false;
    document.body.classList.add('tp-open');
    syncFloat();
  }

  function syncCaptionLink() {
    if (!captionLink) return;
    const show = state.phase === 'done' && !!state.slug && !state.free;
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
      li.textContent = faNum(i + 1);
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
    setFloatCount(n);
    const interval = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(interval);
        beginRecording();
      } else {
        setStatus(`شروع تا ${faNum(n)} ثانیه دیگه`);
        recordBtn.textContent = faNum(n);
        setFloatCount(n);
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
    holdHistory();
    updateRecordButton();
    setStatus('در حال ضبط. می‌تونی بری صفحه‌های دیگه');
    scrollPos = stage.scrollTop;
    lastFrameTs = 0;
    recordStartTs = performance.now();
    clockSeconds = 0;
    yellowSchedule = yellowWords ? buildYellowSchedule(state.paragraphs[state.current], speed) : [];
    yellowIndex = -1;
    recordedWordTimings = [];
    if (yellowSchedule.length) {
      yellowIndex = 0;
      markYellowWord(0);
    }
    state.chunks = [];
    state.audioChunks = [];
    state.pendingAudioFile = null;
    state.audioRecorder = null;
    const liveVideo = stream.getVideoTracks().filter((t) => t.readyState === 'live');
    if (!liveVideo.length) {
      setStatus('تصویر دوربین برای ضبط آماده نیست');
      state.phase = 'ready';
      updateRecordButton();
      return;
    }
    // Record the live preview stream itself. Cloning a canvas capture track
    // yields a black picture, and a second recorder can drop that video.
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };
    recorder.onstop = onRecordingStopped;
    state.mediaRecorder = recorder;
    recorder.start(250);
    pushTeleprompter({ visible: true, scrolling: true, resetScroll: true });
  }

  function pauseRecording() {
    const rec = state.mediaRecorder;
    if (state.phase !== 'recording' || !rec || rec.state !== 'recording' || typeof rec.pause !== 'function') {
      setStatus('توقف کوتاه نشد');
      return;
    }
    try {
      rec.pause();
    } catch (err) {
      setStatus('توقف کوتاه نشد');
      return;
    }
    clockSeconds = Math.max(0, (performance.now() - recordStartTs) / 1000);
    state.phase = 'paused';
    updateRecordButton();
    setStatus('توقف کوتاه');
    pushTeleprompter({ scrolling: false });
  }

  function resumeRecording() {
    const rec = state.mediaRecorder;
    if (state.phase !== 'paused' || !rec || rec.state !== 'paused' || typeof rec.resume !== 'function') return;
    try {
      rec.resume();
    } catch (err) {
      setStatus('شروع مجدد نشد');
      return;
    }
    recordStartTs = performance.now() - clockSeconds * 1000;
    state.phase = 'recording';
    updateRecordButton();
    setStatus('ادامه ضبط');
    pushTeleprompter({ scrolling: true });
  }

  function stopRecording(toEditor) {
    if (!recordingLive() || !state.mediaRecorder) return;
    finishToEditor = !!toEditor;
    const rec = state.mediaRecorder;
    try {
      if (rec.state === 'recording' || rec.state === 'paused') rec.stop();
    } catch (err) {}
  }

  async function uploadClip(blob, paragraphIndex, take) {
    const nn = String(paragraphIndex + 1).padStart(2, '0');
    const query = `/api/clip?slug=${encodeURIComponent(state.slug)}&paragraph=${nn}&take=${take}`;
    const res = await fetch(query, { method: 'POST', body: blob });
    const data = await res.json();
    return data;
  }

  async function onRecordingStopped() {
    const toEditor = finishToEditor;
    finishToEditor = false;
    const blob = new Blob(state.chunks, { type: 'video/webm' });
    const p = state.paragraphs[state.current];
    const take = p.takes.length + 1;
    if (yellowWords && yellowSchedule.length) {
      const endAt = Math.max(clockSeconds, yellowSchedule[yellowSchedule.length - 1].end);
      recordedWordTimings = yellowSchedule.map((item) => ({
        text: item.text,
        start: Math.round(Math.min(item.start, endAt) * 1000) / 1000,
        end: Math.round(Math.min(item.end, endAt) * 1000) / 1000,
      }));
    } else {
      recordedWordTimings = [];
    }

    const uploaded = await uploadClip(blob, p.index, take);
    const fileName = uploaded.file;
    p.takes.push(fileName);
    p.pendingWordTimings = recordedWordTimings.slice();
    state.pendingAudioFile = uploaded.audioFile || null;

    if (toEditor) {
      p.accepted = fileName;
      p.acceptedAudio = state.pendingAudioFile || null;
      state.pendingAudioFile = null;
      if (recordedWordTimings.length) p.wordTimings = recordedWordTimings.slice();
      p.pendingWordTimings = null;
      p.duration = clockSeconds > 0.05 ? Math.round(clockSeconds * 1000) / 1000 : null;
      state.phase = 'done';
      closeBrowse();
      updateRecordButton();
      await saveSession();
      try {
        const durations = {};
        if (p.accepted && p.duration) durations[p.accepted] = p.duration;
        await fetch('/api/captions/build?slug=' + encodeURIComponent(state.slug), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ durations }),
        });
      } catch (err) {}
      location.href = '/edit.html?slug=' + encodeURIComponent(state.slug);
      return;
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
      free: state.free || undefined,
      paragraphs: state.paragraphs.map((p) => ({
        index: p.index,
        text: p.text,
        takes: p.takes,
        accepted: p.accepted,
        acceptedAudio: p.acceptedAudio || null,
        duration: p.duration || null,
        wordTimings: Array.isArray(p.wordTimings) ? p.wordTimings : undefined,
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
    if (Array.isArray(p.pendingWordTimings) && p.pendingWordTimings.length) {
      p.wordTimings = p.pendingWordTimings.slice();
    }
    p.pendingWordTimings = null;
    try {
      p.duration = await reviewDuration();
    } catch (err) {
      p.duration = null;
    }
    reviewVideo.hidden = true;
    liveCam.hidden = false;
    reviewVideo.pause();
    await saveSession();

    const last = state.free || state.current >= state.paragraphs.length - 1;
    if (last) {
      await openInEditor();
      accepting = false;
      return;
    }

    state.current += 1;
    state.phase = 'ready';
    setStatus('آماده');
    scrollPos = 0;
    stage.scrollTop = 0;
    updateRecordButton();
    renderTeleprompter();
    renderProgress();
    accepting = false;
  }

  async function openInEditor() {
    const slug = state.slug;
    state.phase = 'done';
    updateRecordButton();
    setStatus('داره ادیتور باز می‌شه');
    const durations = {};
    state.paragraphs.forEach((paragraph) => {
      if (paragraph.accepted && Number(paragraph.duration) > 0.05) {
        durations[paragraph.accepted] = Number(paragraph.duration);
      }
    });
    try {
      await fetch('/api/captions/build?slug=' + encodeURIComponent(slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ durations }),
      });
    } catch (err) {
      // the editor builds the timeline itself when this did not land
    }
    location.href = '/edit.html?slug=' + encodeURIComponent(slug);
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
      stopRecording(false);
      return;
    }
    if (state.phase === 'paused') {
      resumeRecording();
      return;
    }
    if (state.phase === 'ready') armRecording();
  }
  state.toggle = toggleRecording;

  function exitCapture() {
    if (state.phase === 'idle') return;
    if (state.phase === 'recording' || state.phase === 'paused' || state.phase === 'countdown') {
      try {
        if (state.audioRecorder && state.audioRecorder.state === 'recording') state.audioRecorder.stop();
      } catch (err) {}
      try {
        const rec = state.mediaRecorder;
        if (rec) {
          rec.onstop = null;
          rec.ondataavailable = null;
          if (rec.state === 'recording' || rec.state === 'paused') rec.stop();
        }
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
    state.free = false;
    panel.hidden = true;
    panel.classList.remove('fullscreen', 'mirror', 'tp-free');
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
      if (recordingLive()) {
        if (browseOpen) showTeleprompter();
        else showDashboard();
        return;
      }
      exitCapture();
      return;
    }
    if (state.phase === 'done' && veil && !veil.classList.contains('tp-veil-hidden')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      toggleRecording();
    } else if (state.free && e.key.indexOf('Arrow') === 0) {
      // free recording has no text to scroll or resize
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

  closeBtn.addEventListener('click', () => {
    if (recordingLive()) showDashboard();
    else exitCapture();
  });
  if (veilCloseBtn) {
    veilCloseBtn.addEventListener('click', () => {
      if (recordingLive()) showDashboard();
      else exitCapture();
    });
  }
  if (floatStopBtn) {
    floatStopBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      stopRecording(true);
    });
  }
  if (floatPauseBtn) {
    floatPauseBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      pauseRecording();
    });
  }
  if (floatResumeBtn) {
    floatResumeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      resumeRecording();
    });
  }
  if (floatStartBtn) {
    floatStartBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      shortcutStart();
    });
  }
  document.addEventListener('click', (event) => {
    if (!recordingLive()) return;
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const dest = appPath(link.href);
    if (!dest) return;
    event.preventDefault();
    event.stopPropagation();
    if (dest === 'home') {
      if (window.__reelShell) window.__reelShell.closeSettings();
      showDashboard();
      if (browseOpen) {
        if (history.state && history.state.reelBrowse) history.back();
        else closeBrowse();
      }
      return;
    }
    if (dest === 'settings') {
      if (browseOpen) {
        if (history.state && history.state.reelBrowse) history.back();
        else closeBrowse();
      }
      showDashboard();
      if (window.__reelShell) window.__reelShell.openSettings();
      return;
    }
    openBrowse(dest);
  }, true);
  window.addEventListener('popstate', () => {
    if (!recordingLive()) return;
    if (browseOpen) closeBrowse();
    else history.pushState({ reelHold: 1 }, '');
  });
  window.addEventListener('beforeunload', (event) => {
    if (!recordingLive()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    if (!event.data || event.data.reel !== 'close-browse') return;
    if (!recordingLive()) return;
    if (window.__reelShell) window.__reelShell.closeSettings();
    showDashboard();
    if (browseOpen) {
      if (history.state && history.state.reelBrowse) history.back();
      else closeBrowse();
    }
  });
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
      clockSeconds = (performance.now() - recordStartTs) / 1000;
      if (yellowWords) {
        tickYellowWords(clockSeconds);
      } else {
        scrollPos += speed * 11 * dt;
        stage.scrollTop = scrollPos;
      }
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

  if (yellowBtn) {
    try {
      yellowWords = localStorage.getItem('reel.tpWord') !== '0';
    } catch (err) {
      yellowWords = true;
    }
    setYellowWords(yellowWords);
    yellowBtn.addEventListener('click', () => setYellowWords(!yellowWords));
  }
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
    state.free = false;
    panel.classList.remove('tp-free');
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
        wordTimings: prior && Array.isArray(prior.wordTimings) ? prior.wordTimings : null,
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
    setFontSize(38);
    setLineHeight(lineHeight);
    updateRecordButton();
    renderTeleprompter();
    renderProgress();
  };

  function freeStamp() {
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

  function prepareQuietFree() {
    let date = '';
    try {
      date = faDigits(new Date().toLocaleDateString('fa-IR'));
    } catch (err) {}
    state.free = true;
    state.slug = 'free-' + freeStamp();
    state.title = date ? 'ضبط آزاد ' + date : 'ضبط آزاد';
    state.paragraphs = [
      { index: 0, text: '', emphasis: [], emphasisColors: {}, takes: [], accepted: null, acceptedAudio: null, duration: null },
    ];
    state.current = 0;
    state.phase = 'ready';
    state.pendingAudioFile = null;
    panel.classList.add('tp-free');
    panel.hidden = true;
    document.body.classList.remove('tp-open');
    veil.classList.add('tp-veil-hidden');
    updateRecordButton();
  }

  async function shortcutStart() {
    if (state.phase === 'recording' || state.phase === 'paused' || state.phase === 'countdown') return;
    if (state.phase !== 'ready' || !state.slug) prepareQuietFree();
    panel.hidden = true;
    document.body.classList.remove('tp-open');
    veil.classList.add('tp-veil-hidden');
    syncFloat();
    await armRecording();
  }

  window.startFreeSession = function () {
    let date = '';
    try {
      date = faDigits(new Date().toLocaleDateString('fa-IR'));
    } catch (err) {}
    state.free = true;
    state.slug = 'free-' + freeStamp();
    state.title = date ? 'ضبط آزاد ' + date : 'ضبط آزاد';
    state.paragraphs = [
      { index: 0, text: '', emphasis: [], emphasisColors: {}, takes: [], accepted: null, acceptedAudio: null, duration: null },
    ];
    state.current = 0;
    state.phase = 'ready';

    panel.hidden = false;
    panel.classList.add('fullscreen', 'tp-free');
    panel.classList.remove('mirror');
    document.body.classList.add('tp-open');
    if (window.__reel && window.__reel.stream) {
      liveCam.srcObject = window.__reel.stream;
    }
    veil.classList.remove('tp-veil-hidden');
    veilTitle.textContent = 'ضبط آزاد';
    scrollPos = 0;
    stage.scrollTop = 0;
    clockSeconds = 0;
    setStatus('آماده');
    updateRecordButton();
    renderTeleprompter();
    renderProgress();
  };

  paintFloatPreview();
  syncFloat();
  if (new URLSearchParams(location.search).get('shortcut') === '1') {
    history.replaceState(null, '', '/');
    shortcutStart();
  }
})();
