(function () {
  const LINE_MAX_WORDS = 7;
  const LINE_MAX_CHARS = 32;
  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  const params = new URLSearchParams(location.search);
  const slug = params.get('slug') || '';
  const titleEl = document.getElementById('edit-title');
  const statusEl = document.getElementById('edit-status');
  const frame = document.getElementById('edit-frame');
  const video = document.getElementById('player');
  const caption = document.getElementById('caption');
  const playBtn = document.getElementById('play-btn');
  const timeEl = document.getElementById('time-readout');
  const colorInput = document.getElementById('cap-color');
  const sizeInput = document.getElementById('cap-size');
  const sizeOut = document.getElementById('cap-size-out');
  const wordSpaceInput = document.getElementById('cap-word-space');
  const wordSpaceOut = document.getElementById('cap-word-space-out');
  const letterSpaceInput = document.getElementById('cap-letter-space');
  const letterSpaceOut = document.getElementById('cap-letter-space-out');
  const lineHeightInput = document.getElementById('cap-line-height');
  const lineHeightOut = document.getElementById('cap-line-height-out');
  const fontInput = document.getElementById('cap-font');
  const highlightInput = document.getElementById('cap-highlight');
  const highlightFields = document.getElementById('highlight-fields');
  const highlightOpacityWrap = document.getElementById('highlight-opacity-wrap');
  const highlightColor = document.getElementById('cap-highlight-color');
  const opacityInput = document.getElementById('cap-opacity');
  const opacityOut = document.getElementById('cap-opacity-out');
  const textOpacityInput = document.getElementById('cap-text-opacity');
  const textOpacityOut = document.getElementById('cap-text-opacity-out');
  const wordInput = document.getElementById('cap-word');
  const rebuildBtn = document.getElementById('rebuild-btn');
  const renderBtn = document.getElementById('render-btn');
  const renderLink = document.getElementById('render-link');
  const openExportBtn = document.getElementById('open-export');
  const exportPlayer = document.getElementById('export-player');
  const zoomInput = document.getElementById('tl-zoom');
  const tlScroll = document.getElementById('tl-scroll');
  const tlInner = document.getElementById('tl-inner');
  const tlLabels = document.getElementById('tl-labels');
  const wordLane = document.getElementById('word-lane');
  const videoLanes = document.getElementById('video-lanes');
  const videoLane = document.getElementById('video-lane');
  const playhead = document.getElementById('playhead');
  const editLabel = document.getElementById('tl-edit-label');
  const clipTools = document.getElementById('tl-clip-tools');
  const wordTools = document.getElementById('tl-word-tools');
  const splitBtn = document.getElementById('tl-split');
  const volumeInput = document.getElementById('tl-volume');
  const volumeOut = document.getElementById('tl-volume-out');
  const muteBtn = document.getElementById('tl-mute');
  const speedInput = document.getElementById('tl-speed');
  const speedOut = document.getElementById('tl-speed-out');
  const speedSpecial = document.getElementById('tl-speed-special');
  const deleteClipBtn = document.getElementById('tl-delete-clip');
  const editWordBtn = document.getElementById('tl-edit-word');
  const addWordBtn = document.getElementById('tl-add-word');
  const deleteWordBtn = document.getElementById('tl-delete-word');

  const SPECIAL_SPEEDS = [3, 4, 5, 10];

  const FONT_FAMILY = {
    vazir: 'Vazirmatn',
    yekan: 'Iran Yekan',
    titr: 'Titr',
    lalezar: 'Lalezar Local',
    nastaliq: 'Nastaliq Local',
    ordibehesht: 'Ordibehesht Local',
    dastnevis: 'Dastnevis Local',
    iransans: 'IranSans Local',
    peyda: 'Peyda Local',
    ravi: 'Ravi Local',
  };

  const FONT_CLASS = Object.keys(FONT_FAMILY);

  let clips = [];
  let words = [];
  let style = defaultStyle();
  let docCameras = [];
  let duration = 0;
  let time = 0;
  let playing = false;
  let ready = false;
  let loadToken = 0;
  let saveTimer = 0;
  let saveQueued = false;
  let saving = false;
  let draggingWord = false;
  let draggingCaption = false;
  let clockLive = true;
  let activeIndex = 0;
  let editingWord = false;
  const picked = { kind: '', index: -1 };

  function faNum(n) {
    return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
  }

  function formatSpeed(speed) {
    const n = Math.round(Number(speed) * 100) / 100;
    if (!Number.isFinite(n)) return '۱';
    if (Number.isInteger(n)) return faNum(n);
    return faNum(n.toFixed(2)).replace('.', '٫');
  }

  function clampEditSpeed(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    if (SPECIAL_SPEEDS.indexOf(n) !== -1) return n;
    return Math.round(Math.min(2, Math.max(0.5, n)) * 100) / 100;
  }

  function syncMuteIcon(muted) {
    if (!muteBtn) return;
    const onIcon = muteBtn.querySelector('.mute-icon-on');
    const offIcon = muteBtn.querySelector('.mute-icon-off');
    if (onIcon) onIcon.hidden = !!muted;
    if (offIcon) offIcon.hidden = !muted;
    muteBtn.title = muted ? 'باصدا' : 'بی‌صدا';
    muteBtn.setAttribute('aria-label', muted ? 'باصدا' : 'بی‌صدا');
    muteBtn.classList.toggle('on', !!muted);
  }

  function syncSpeedControls(speed) {
    const next = clampEditSpeed(speed);
    const special = SPECIAL_SPEEDS.indexOf(next) !== -1;
    if (speedSpecial) speedSpecial.value = special ? String(next) : '';
    if (speedInput) {
      if (special) speedInput.value = '200';
      else speedInput.value = String(Math.round(next * 100));
    }
    if (speedOut) speedOut.textContent = formatSpeed(next);
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function defaultStyle() {
    return {
      color: '#ffffff',
      size: 48,
      font: 'vazir',
      highlight: true,
      highlightColor: '#f5c542',
      highlightOpacity: 50,
      textOpacity: 100,
      wordSpacing: 0,
      letterSpacing: 0,
      lineHeight: 130,
      wordByWord: false,
      x: 50,
      y: 86,
    };
  }

  function rgba(hex, opacity) {
    const n = parseInt(String(hex || '#ffffff').slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + opacity / 100 + ')';
  }

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return faNum(m) + ':' + faNum(String(s).padStart(2, '0'));
  }

  function groupLines(list) {
    const groups = [];
    let current = [];
    let chars = 0;
    list.forEach((word) => {
      const paragraphBreak = current.length && current[0].paragraph !== word.paragraph;
      const tooLong = current.length >= LINE_MAX_WORDS || chars + word.text.length > LINE_MAX_CHARS;
      if (current.length && (paragraphBreak || tooLong)) {
        groups.push(current);
        current = [];
        chars = 0;
      }
      current.push(word);
      chars += word.text.length + 1;
    });
    if (current.length) groups.push(current);
    return groups;
  }

  function cueAt(t) {
    if (!words.length) return null;
    if (style.wordByWord) {
      const word = words.find((item) => t >= item.start && t < item.end);
      if (!word) return null;
      return [{ text: word.text, hot: true }];
    }
    const group = groupLines(words).find((items) => t >= items[0].start && t < items[items.length - 1].end);
    if (!group) return null;
    return group.map((word) => ({ text: word.text, hot: t >= word.start && t < word.end }));
  }

  function clipAt(t) {
    if (!clips.length) return null;
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if (t < clip.start + clip.duration - 0.001 || i === clips.length - 1) {
        return { clip, local: Math.max(0, Math.min(clip.duration, t - clip.start)) };
      }
    }
    return { clip: clips[0], local: 0 };
  }

  function takeUrl(file) {
    return '/api/take?slug=' + encodeURIComponent(slug) + '&file=' + encodeURIComponent(file);
  }

  function pixelsPerSecond() {
    const width = Math.max(280, tlScroll.clientWidth || 280);
    const zoom = Number(zoomInput.value) || 1;
    return ((width - 8) / Math.max(duration, 0.1)) * zoom;
  }

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  function showExport() {
    const href = '/api/render?slug=' + encodeURIComponent(slug);
    renderLink.hidden = false;
    renderLink.href = href;
    openExportBtn.hidden = false;
    exportPlayer.hidden = false;
    if (exportPlayer.getAttribute('src') !== href) exportPlayer.src = href;
  }

  function fillForm() {
    colorInput.value = style.color;
    sizeInput.value = String(style.size);
    sizeOut.textContent = faNum(style.size);
    wordSpaceInput.value = String(style.wordSpacing || 0);
    wordSpaceOut.textContent = faNum(style.wordSpacing || 0);
    letterSpaceInput.value = String(style.letterSpacing || 0);
    letterSpaceOut.textContent = faNum(style.letterSpacing || 0);
    lineHeightInput.value = String(style.lineHeight == null ? 130 : style.lineHeight);
    lineHeightOut.textContent = faNum(style.lineHeight == null ? 130 : style.lineHeight);
    fontInput.value = style.font;
    highlightInput.checked = !!style.highlight;
    highlightColor.value = style.highlightColor;
    opacityInput.value = String(style.highlightOpacity);
    opacityOut.textContent = faNum(style.highlightOpacity);
    textOpacityInput.value = String(style.textOpacity == null ? 100 : style.textOpacity);
    textOpacityOut.textContent = faNum(style.textOpacity == null ? 100 : style.textOpacity);
    wordInput.checked = !!style.wordByWord;
    syncHighlightUi();
  }

  function syncHighlightUi() {
    const on = !!highlightInput.checked;
    if (highlightFields) highlightFields.hidden = !on;
    if (highlightOpacityWrap) highlightOpacityWrap.hidden = !on;
  }

  function readForm() {
    style.color = colorInput.value;
    style.size = Number(sizeInput.value);
    style.wordSpacing = Number(wordSpaceInput.value);
    style.letterSpacing = Number(letterSpaceInput.value);
    style.lineHeight = Number(lineHeightInput.value);
    style.font = fontInput.value;
    style.highlight = highlightInput.checked;
    style.highlightColor = highlightColor.value;
    style.highlightOpacity = Number(opacityInput.value);
    style.textOpacity = Number(textOpacityInput.value);
    style.wordByWord = wordInput.checked;
    sizeOut.textContent = faNum(style.size);
    wordSpaceOut.textContent = faNum(style.wordSpacing || 0);
    letterSpaceOut.textContent = faNum(style.letterSpacing || 0);
    lineHeightOut.textContent = faNum(style.lineHeight || 130);
    opacityOut.textContent = faNum(style.highlightOpacity);
    textOpacityOut.textContent = faNum(style.textOpacity);
    syncHighlightUi();
  }

  function previewScale() {
    if (!video.clientHeight || !video.videoHeight) return 1;
    return video.clientHeight / video.videoHeight;
  }

  function renderCaption() {
    const scale = previewScale();
    const box = style.size * scale;
    const gapPx = Math.max(0, Number(style.wordSpacing) || 0) * scale;
    caption.style.color = rgba(style.color, style.textOpacity == null ? 100 : style.textOpacity);
    caption.style.fontSize = box + 'px';
    caption.style.letterSpacing = (Number(style.letterSpacing) || 0) * scale + 'px';
    caption.style.wordSpacing = '0px';
    caption.style.lineHeight = String((style.lineHeight || 130) / 100);
    caption.style.left = style.x + '%';
    caption.style.top = style.y + '%';
    caption.classList.add('is-line');
    FONT_CLASS.forEach((key) => caption.classList.remove('font-' + key));
    caption.classList.add('font-' + (style.font || 'vazir'));
    caption.replaceChildren();
    const parts = cueAt(time);
    if (!parts) {
      const hint = document.createElement('span');
      hint.className = 'cap-placeholder';
      hint.textContent = 'زیرنویس';
      caption.appendChild(hint);
      return;
    }
    parts.forEach((part, index) => {
      if (index) {
        const gap = document.createElement('span');
        gap.className = 'cap-gap';
        gap.style.width = gapPx + 'px';
        caption.appendChild(gap);
      }
      const span = document.createElement('span');
      span.className = 'cap-word';
      span.textContent = part.text;
      if (part.hot && style.highlight) {
        span.classList.add('is-hot');
        span.style.background = rgba(style.highlightColor, style.highlightOpacity);
      }
      caption.appendChild(span);
    });
  }

  function updateClock() {
    timeEl.textContent = formatClock(time) + ' / ' + formatClock(duration);
    playBtn.textContent = playing ? 'توقف' : 'پخش';
  }

  function placeTimeline() {
    const scale = pixelsPerSecond();
    const laneNames = cameraLanes();
    const laneCount = Math.max(1, laneNames.length);
    tlInner.style.width = Math.max(tlScroll.clientWidth, duration * scale + 12) + 'px';
    tlInner.style.height = 52 + 12 + laneCount * 56 + (laneCount - 1) * 8 + 'px';
    const chips = wordLane.children;
    for (let i = 0; i < chips.length; i++) {
      const word = words[i];
      if (!word) continue;
      chips[i].style.left = word.start * scale + 'px';
      chips[i].style.width = Math.max(22, (word.end - word.start) * scale - 3) + 'px';
      chips[i].classList.toggle('is-now', time >= word.start && time < word.end);
      chips[i].classList.toggle('is-picked', picked.kind === 'word' && picked.index === i);
    }
    const laneNodes = videoLanes ? videoLanes.querySelectorAll('.tl-video') : [];
    laneNodes.forEach((lane) => {
      const laneKey = lane.getAttribute('data-lane') || '0';
      const multi = Array.isArray(docCameras) && docCameras.length > 1;
      const segs = lane.children;
      let segIndex = 0;
      clips.forEach((clip, clipIndex) => {
        if (!multi && String(clipCamera(clip)) !== String(laneKey)) return;
        if (multi && String(clipCamera(clip)) !== '0' && String(clipCamera(clip)) !== String(laneKey)) return;
        const seg = segs[segIndex];
        segIndex += 1;
        if (!seg) return;
        seg.style.left = clip.start * scale + 'px';
        seg.style.width = Math.max(4, clip.duration * scale - 2) + 'px';
        seg.classList.toggle('is-picked', picked.kind === 'clip' && picked.index === clipIndex);
        seg.dataset.clipIndex = String(clipIndex);
      });
    });
    playhead.style.left = time * scale + 'px';
    updateClock();
  }

  function followPlayhead() {
    const scale = pixelsPerSecond();
    const x = time * scale;
    const left = tlScroll.scrollLeft;
    const right = left + tlScroll.clientWidth;
    if (x < left + 48 || x > right - 48) {
      tlScroll.scrollLeft = Math.max(0, x - tlScroll.clientWidth * 0.35);
    }
  }

  function renderWordLane() {
    if (editingWord) return;
    wordLane.replaceChildren();
    words.forEach((word, index) => {
      const chip = document.createElement('div');
      chip.className = 'tl-word';
      chip.dir = 'rtl';
      chip.textContent = word.text;
      chip.addEventListener('pointerdown', (event) => onWordPointerDown(event, index));
      chip.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginEditWord(index);
      });
      wordLane.appendChild(chip);
    });
    placeTimeline();
  }

  function clipTag(clip) {
    const bits = [];
    const speed = clip.speed || 1;
    if (Math.abs(speed - 1) > 0.01) bits.push('سرعت ' + formatSpeed(speed));
    const vol = Math.round((clip.volume == null ? 1 : clip.volume) * 100);
    if (vol !== 100) bits.push('صدا ' + faNum(vol));
    return bits.join(' ');
  }

  function clipCamera(clip) {
    if (clip && clip.camera != null && clip.camera !== '') return clip.camera;
    return '0';
  }

  function cameraLanes() {
    if (Array.isArray(docCameras) && docCameras.length > 1) {
      return docCameras.map((_, index) => String(index));
    }
    const names = [];
    const seen = new Set();
    clips.forEach((clip) => {
      const key = String(clipCamera(clip));
      if (seen.has(key)) return;
      seen.add(key);
      names.push(key);
    });
    if (!names.length) names.push('0');
    return names;
  }

  function laneLabel(key) {
    const index = Number(key);
    if (Array.isArray(docCameras) && docCameras[index]) return docCameras[index];
    if (key === '0' || key === '') return 'ویدیو';
    if (Number.isFinite(index) && String(index) === String(key)) return 'دوربین ' + faNum(index + 1);
    return String(key);
  }

  function bindVideoLane(lane) {
    lane.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const originX = event.clientX;
      let moved = false;
      scrubFromEvent(event);
      try {
        lane.setPointerCapture(event.pointerId);
      } catch (err) {}
      function move(ev) {
        if (Math.abs(ev.clientX - originX) > 4) moved = true;
        scrubFromEvent(ev);
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!moved) {
          const located = clipAt(time);
          if (located) pickClip(clips.indexOf(located.clip));
        }
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function renderVideoLane() {
    const lanes = cameraLanes();
    if (tlLabels) {
      tlLabels.replaceChildren();
      const wordLabel = document.createElement('span');
      wordLabel.textContent = 'کلمه‌ها';
      tlLabels.appendChild(wordLabel);
      lanes.forEach((key) => {
        const label = document.createElement('span');
        label.textContent = laneLabel(key);
        tlLabels.appendChild(label);
      });
    }
    if (videoLanes) {
      videoLanes.replaceChildren();
      lanes.forEach((key, laneIndex) => {
        const lane = document.createElement('div');
        lane.className = 'tl-lane tl-video';
        if (laneIndex === 0) lane.id = 'video-lane';
        lane.setAttribute('data-lane', String(key));
        lane.style.top = 64 + laneIndex * 64 + 'px';
        clips.forEach((clip, clipIndex) => {
          const multi = Array.isArray(docCameras) && docCameras.length > 1;
          if (!multi && String(clipCamera(clip)) !== String(key)) return;
          if (multi && String(clipCamera(clip)) !== '0' && String(clipCamera(clip)) !== String(key)) return;
          const seg = document.createElement('div');
          seg.className = 'tl-seg';
          seg.dataset.clipIndex = String(clipIndex);
          const tag = document.createElement('span');
          tag.className = 'tl-seg-tag';
          tag.textContent = clipTag(clip);
          if (!tag.textContent) tag.hidden = true;
          seg.appendChild(tag);
          lane.appendChild(seg);
          attachThumb(seg, clip);
        });
        bindVideoLane(lane);
        videoLanes.appendChild(lane);
      });
    }
    placeTimeline();
  }

  function findClip(paragraph, start) {
    const list = clips.filter((clip) => clip.paragraph === Number(paragraph));
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) {
      const clip = list[i];
      if (start >= clip.start - 0.001 && start < clip.start + clip.duration - 0.001) return clip;
    }
    let best = list[0];
    let bestDist = Infinity;
    list.forEach((clip) => {
      const dist = Math.abs(start - (clip.start + clip.duration / 2));
      if (dist < bestDist) {
        bestDist = dist;
        best = clip;
      }
    });
    return best;
  }

  function recomputeEnds() {
    const groups = clips.map(() => []);
    words.forEach((word) => {
      const clip = findClip(word.paragraph, word.start);
      if (!clip) return;
      const index = clips.indexOf(clip);
      if (index >= 0) groups[index].push(word);
    });
    groups.forEach((list, index) => {
      if (!list.length) return;
      list.sort((a, b) => a.start - b.start);
      const clip = clips[index];
      const clipEnd = clip.start + clip.duration;
      for (let i = 0; i < list.length; i++) {
        const next = list[i + 1];
        list[i].end = next ? next.start : clipEnd;
        if (list[i].end < list[i].start + 0.04) list[i].end = list[i].start + 0.04;
      }
    });
  }

  function refreshDuration() {
    duration = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
  }

  function applyWordStart(word, proposed) {
    const clip = findClip(word.paragraph, word.start);
    if (!clip) return;
    const same = words
      .filter((item) => findClip(item.paragraph, item.start) === clip)
      .sort((a, b) => a.start - b.start);
    const index = same.indexOf(word);
    const prev = same[index - 1];
    const next = same[index + 1];
    const min = prev ? prev.start + 0.08 : clip.start;
    const max = next ? next.start - 0.08 : clip.start + clip.duration - 0.08;
    if (max < min) return;
    word.start = round3(Math.min(max, Math.max(min, proposed)));
    recomputeEnds();
  }

  function onWordPointerDown(event, index) {
    if (event.button !== 0) return;
    if (event.target && event.target.tagName === 'INPUT') return;
    const word = words[index];
    const originX = event.clientX;
    const originStart = word.start;
    let moved = false;
    draggingWord = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (err) {}
    function move(ev) {
      const dx = ev.clientX - originX;
      if (Math.abs(dx) < 4) return;
      moved = true;
      applyWordStart(word, originStart + dx / pixelsPerSecond());
      placeTimeline();
      renderCaption();
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      draggingWord = false;
      if (moved) scheduleSave();
      else {
        pickWord(index);
        seekTo(originStart, playing);
      }
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    event.preventDefault();
  }

  function decorateClip(clip) {
    const duration = Number(clip.duration) || 0;
    const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const srcIn = Number(clip.srcIn) > 0 ? Number(clip.srcIn) : 0;
    const srcSpan = Number(clip.srcSpan) > 0 ? Number(clip.srcSpan) : duration * speed;
    const volume = clip.volume == null || clip.volume === '' ? 1 : Number(clip.volume);
    return {
      file: clip.file,
      paragraph: Number(clip.paragraph),
      start: Number(clip.start) || 0,
      duration,
      srcIn,
      srcSpan,
      speed,
      volume: Number.isFinite(volume) ? volume : 1,
      camera: clip.camera == null || clip.camera === '' ? '0' : clip.camera,
    };
  }

  function clipPayload() {
    return clips.map((clip) => ({
      file: clip.file,
      paragraph: clip.paragraph,
      duration: clip.duration,
      srcIn: clip.srcIn || 0,
      srcSpan: clip.srcSpan || clip.duration * (clip.speed || 1),
      speed: clip.speed || 1,
      volume: clip.volume == null ? 1 : clip.volume,
      camera: clipCamera(clip),
    }));
  }

  function showPicked() {
    if (picked.kind === 'clip' && clips[picked.index]) {
      const clip = clips[picked.index];
      editLabel.textContent = 'تکه ' + faNum(picked.index + 1);
      clipTools.hidden = false;
      wordTools.hidden = true;
      volumeInput.value = String(Math.round((clip.volume == null ? 1 : clip.volume) * 100));
      volumeOut.textContent = faNum(volumeInput.value);
      const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
      syncSpeedControls(speed);
      syncMuteIcon((clip.volume || 0) < 0.01);
    } else if (picked.kind === 'word' && words[picked.index]) {
      editLabel.textContent = words[picked.index].text;
      clipTools.hidden = true;
      wordTools.hidden = false;
    } else {
      editLabel.textContent = 'روی خط ویدیو یا یه کلمه بزن.';
      clipTools.hidden = true;
      wordTools.hidden = true;
    }
    placeTimeline();
  }

  function pickClip(index) {
    if (!clips[index]) return;
    picked.kind = 'clip';
    picked.index = index;
    showPicked();
  }

  function pickWord(index) {
    if (!words[index]) return;
    picked.kind = 'word';
    picked.index = index;
    showPicked();
  }

  function applyPlayback(clip) {
    const speed = clip.speed || 1;
    const volume = clip.volume == null ? 1 : clip.volume;
    try {
      video.playbackRate = speed;
    } catch (err) {}
    video.volume = Math.max(0, Math.min(1, volume));
  }

  function sourceTimeOf(clip, local) {
    return (clip.srcIn || 0) + Math.max(0, local) * (clip.speed || 1);
  }

  function splitClip(index) {
    const clip = clips[index];
    if (!clip) return;
    if (time <= clip.start + 0.12 || time >= clip.start + clip.duration - 0.12) {
      setStatus('نشانگر باید وسط همین تکه باشه');
      return;
    }
    const local = time - clip.start;
    const speed = clip.speed || 1;
    const srcCut = (clip.srcIn || 0) + local * speed;
    const leftSpan = local * speed;
    const rightSpan = (clip.srcSpan || clip.duration * speed) - leftSpan;
    const right = {
      file: clip.file,
      paragraph: clip.paragraph,
      start: round3(time),
      duration: round3(clip.duration - local),
      srcIn: round3(srcCut),
      srcSpan: round3(Math.max(0.05, rightSpan)),
      speed,
      volume: clip.volume == null ? 1 : clip.volume,
    };
    clip.duration = round3(local);
    clip.srcSpan = round3(Math.max(0.05, leftSpan));
    clips.splice(index + 1, 0, right);
    recomputeEnds();
    refreshDuration();
    picked.kind = 'clip';
    picked.index = index + 1;
    renderVideoLane();
    renderWordLane();
    showPicked();
    scheduleSave();
    setStatus('تکه برش خورد');
  }

  function setClipSpeed(index, speed) {
    const clip = clips[index];
    if (!clip) return;
    const nextSpeed = clampEditSpeed(speed);
    const oldSpeed = clip.speed || 1;
    if (Math.abs(nextSpeed - oldSpeed) < 0.0005) {
      syncSpeedControls(nextSpeed);
      return;
    }
    const oldDur = clip.duration;
    const srcSpan = clip.srcSpan || oldDur * oldSpeed;
    const newDur = srcSpan / nextSpeed;
    const end = clip.start + oldDur;
    const delta = newDur - oldDur;
    words.forEach((word) => {
      if (word.start >= clip.start - 0.001 && word.start < end - 0.001) {
        const rel = oldDur > 0 ? (word.start - clip.start) / oldDur : 0;
        word.start = round3(clip.start + rel * newDur);
      } else if (word.start >= end - 0.001) {
        word.start = round3(word.start + delta);
      }
    });
    clips.forEach((item) => {
      if (item !== clip && item.start >= end - 0.001) item.start = round3(item.start + delta);
    });
    clip.speed = nextSpeed;
    clip.duration = round3(newDur);
    clip.srcSpan = round3(srcSpan);
    syncSpeedControls(nextSpeed);
    recomputeEnds();
    refreshDuration();
    renderWordLane();
    renderVideoLane();
    showPicked();
    if (activeIndex === index) applyPlayback(clip);
    scheduleSave();
  }

  function refreshClipTag(index) {
    const clip = clips[index];
    if (!clip || !videoLanes) return;
    const seg = videoLanes.querySelector('.tl-seg[data-clip-index="' + index + '"]');
    if (!seg) return;
    const tag = seg.querySelector('.tl-seg-tag');
    if (!tag) return;
    tag.hidden = !clipTag(clip);
    tag.textContent = clipTag(clip);
  }

  function deleteClip(index) {
    if (clips.length < 2) {
      setStatus('حداقل یه تکه باید بمونه');
      return;
    }
    const clip = clips[index];
    const start = clip.start;
    const end = start + clip.duration;
    const survivors = words.filter((word) => !(word.start >= start - 0.001 && word.start < end - 0.001));
    if (!survivors.length) {
      setStatus('این حذف همه کلمه‌ها رو می‌بره');
      return;
    }
    if (!window.confirm('این تکه از خط زمان حذف بشه؟')) return;
    const span = clip.duration;
    clips.splice(index, 1);
    clips.forEach((item) => {
      if (item.start >= end - 0.001) item.start = round3(item.start - span);
    });
    words = survivors;
    words.forEach((word) => {
      if (word.start >= end - 0.001) word.start = round3(word.start - span);
    });
    recomputeEnds();
    refreshDuration();
    if (!words.length) {
      setStatus('کلمه‌ای برای زیرنویس نماند');
    }
    if (time >= duration) time = Math.max(0, duration - 0.05);
    picked.kind = 'clip';
    picked.index = Math.min(index, clips.length - 1);
    renderWordLane();
    renderVideoLane();
    showPicked();
    seekTo(Math.min(time, clips[picked.index].start + 0.01), false);
    scheduleSave();
  }

  function beginEditWord(index) {
    const word = words[index];
    const chip = wordLane.children[index];
    if (!word || !chip || editingWord) return;
    editingWord = true;
    pickWord(index);
    const input = document.createElement('input');
    input.className = 'tl-word-input';
    input.value = word.text;
    input.setAttribute('aria-label', 'متن کلمه');
    chip.replaceChildren(input);
    input.focus();
    input.select();
    let closed = false;
    function done(commit) {
      if (closed) return;
      closed = true;
      editingWord = false;
      if (commit) {
        const text = input.value.replace(/\s+/g, ' ').trim();
        if (text) word.text = text;
        else setStatus('متن کلمه خالی نمی‌مونه');
      }
      renderWordLane();
      renderCaption();
      showPicked();
      if (commit) scheduleSave();
    }
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        done(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        done(false);
      }
    });
    input.addEventListener('blur', () => done(true));
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  function addWord(index) {
    const base = words[index];
    if (!base) return;
    const clip = findClip(base.paragraph, base.start);
    if (!clip) return;
    const next = words
      .filter((word) => word !== base && word.paragraph === base.paragraph && word.start > base.start && word.start < clip.start + clip.duration)
      .sort((a, b) => a.start - b.start)[0];
    const gapEnd = next ? next.start : clip.start + clip.duration;
    if (gapEnd - base.start < 0.16) {
      setStatus('جا برای کلمه جدید نیست');
      return;
    }
    const start = round3(Math.min(base.start + Math.max(0.12, (gapEnd - base.start) / 2), gapEnd - 0.08));
    words.push({ text: 'کلمه', start, end: start + 0.12, paragraph: base.paragraph });
    words.sort((a, b) => a.start - b.start || a.paragraph - b.paragraph);
    recomputeEnds();
    const newIndex = words.findIndex((word) => word.text === 'کلمه' && Math.abs(word.start - start) < 0.001);
    renderWordLane();
    renderCaption();
    if (newIndex >= 0) {
      pickWord(newIndex);
      beginEditWord(newIndex);
    }
    scheduleSave();
  }

  function deleteWord(index) {
    if (words.length < 2) {
      setStatus('حداقل یه کلمه باید بمونه');
      return;
    }
    words.splice(index, 1);
    recomputeEnds();
    picked.kind = 'word';
    picked.index = Math.min(index, words.length - 1);
    renderWordLane();
    renderCaption();
    showPicked();
    scheduleSave();
  }

  function seekTo(t, shouldPlay) {
    if (!clips.length) return;
    time = Math.min(Math.max(0, t), Math.max(0, duration - 0.01));
    playing = !!shouldPlay;
    const located = clipAt(time);
    if (!located) return;
    activeIndex = clips.indexOf(located.clip);
    const token = ++loadToken;
    const same = video.dataset.file === located.clip.file && video.readyState >= 1;
    clockLive = same;
    function applyLocal() {
      if (token !== loadToken) return;
      applyPlayback(located.clip);
      const source = sourceTimeOf(located.clip, located.local);
      const known = Number.isFinite(video.duration) ? video.duration : source + 1;
      const at = Math.min(Math.max(0, source), Math.max(0, known - 0.02));
      if (Math.abs((video.currentTime || 0) - at) > 0.08) video.currentTime = at;
      if (playing) video.play().catch(() => {});
      else video.pause();
      clockLive = true;
    }
    if (!same) {
      video.dataset.file = located.clip.file;
      video.src = takeUrl(located.clip.file);
      video.onloadedmetadata = () => {
        applyLocal();
        renderCaption();
      };
    } else {
      applyLocal();
    }
    renderCaption();
    placeTimeline();
    if (playing) followPlayhead();
  }

  function togglePlay() {
    if (!clips.length) return;
    if (playing) {
      playing = false;
      video.pause();
      updateClock();
      return;
    }
    if (time >= duration - 0.05) time = 0;
    seekTo(time, true);
  }

  function scrubFromEvent(event) {
    const rect = tlInner.getBoundingClientRect();
    const x = event.clientX - rect.left;
    seekTo(x / pixelsPerSecond(), playing);
  }

  function scheduleSave() {
    if (!ready) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 350);
  }

  async function flushSave() {
    if (!ready) return;
    if (saving) {
      saveQueued = true;
      return;
    }
    saving = true;
    const payload = {
      style,
      words,
      clips: clipPayload(),
    };
    try {
      const res = await fetch('/api/captions?slug=' + encodeURIComponent(slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setStatus(data.error || 'ذخیره نشد');
      else {
        syncFromServer(data);
        if (!draggingWord && !draggingCaption) setStatus('ذخیره شد');
      }
    } catch (err) {
      setStatus('ذخیره نشد');
    } finally {
      saving = false;
      if (saveQueued) {
        saveQueued = false;
        flushSave();
      }
    }
  }

  function adopt(doc) {
    clips = (doc.clips || []).map(decorateClip);
    words = (doc.words || []).map((word) => ({
      text: word.text,
      start: Number(word.start) || 0,
      end: Number(word.end) || 0,
      paragraph: Number(word.paragraph),
    }));
    style = Object.assign(defaultStyle(), doc.style || {});
    docCameras = Array.isArray(doc.cameras) ? doc.cameras.slice() : [];
    duration = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
    titleEl.textContent = doc.title || 'زیرنویس';
    document.title = (doc.title || 'زیرنویس') + ' | Reel Studio';
    if (doc.hasRender) showExport();
    fillForm();
    renderWordLane();
    renderVideoLane();
    time = 0;
    playing = false;
    video.dataset.file = '';
    if (clips.length) seekTo(0, false);
    else {
      renderCaption();
      updateClock();
    }
  }

  function measureFile(file) {
    return new Promise((resolve) => {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.playsInline = true;
      probe.src = takeUrl(file);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        probe.onloadedmetadata = null;
        probe.onerror = null;
        probe.removeAttribute('src');
        probe.load();
        resolve(value);
      };
      probe.onloadedmetadata = () => {
        let value = probe.duration;
        if (!Number.isFinite(value) && probe.seekable && probe.seekable.length) {
          value = probe.seekable.end(probe.seekable.length - 1);
        }
        finish(Number.isFinite(value) ? value : 0);
      };
      probe.onerror = () => finish(0);
      setTimeout(() => finish(0), 8000);
    });
  }

  function rescaleToMeasured(measured) {
    let changed = false;
    const previous = clips.map((clip) => decorateClip(clip));
    const next = [];
    let cursor = 0;
    previous.forEach((clip) => {
      const plain = clip.srcIn < 0.001 && Math.abs(clip.speed - 1) < 0.001;
      let nextDuration = clip.duration;
      let srcSpan = clip.srcSpan;
      if (plain) {
        const seen = Number(measured[clip.file]);
        if (seen > 0.05 && Math.abs(seen - clip.duration) > Math.max(0.2, clip.duration * 0.08)) {
          nextDuration = seen;
          srcSpan = seen;
          changed = true;
        }
      }
      next.push(Object.assign({}, clip, { start: cursor, duration: nextDuration, srcSpan }));
      cursor += nextDuration;
    });
    if (!changed) return false;
    const used = new Set();
    next.forEach((clip, index) => {
      const old = previous[index];
      const scale = old.duration > 0 ? clip.duration / old.duration : 1;
      words.forEach((word, wordIndex) => {
        if (used.has(wordIndex)) return;
        const end = old.start + old.duration;
        if (word.start < old.start - 0.001 || word.start > end + 0.001) return;
        if (word.start >= end - 0.001 && index < next.length - 1) return;
        used.add(wordIndex);
        word.start = round3(clip.start + (word.start - old.start) * scale);
      });
    });
    clips = next;
    duration = cursor;
    recomputeEnds();
    return true;
  }

  function syncFromServer(data) {
    if (!data || draggingWord || draggingCaption || editingWord) return;
    if (data.style) {
      style = Object.assign(defaultStyle(), data.style);
      fillForm();
    }
    if (Array.isArray(data.words)) {
      words = data.words.map((word) => ({
        text: word.text,
        start: Number(word.start) || 0,
        end: Number(word.end) || 0,
        paragraph: Number(word.paragraph),
      }));
    }
    if (Array.isArray(data.clips)) {
      const next = data.clips.map(decorateClip);
      const same =
        next.length === clips.length && next.every((clip, index) => clip.file === clips[index].file && clip.paragraph === clips[index].paragraph);
      if (same) {
        next.forEach((clip, index) => {
          clips[index].file = clip.file;
          clips[index].paragraph = clip.paragraph;
          clips[index].start = clip.start;
          clips[index].duration = clip.duration;
          clips[index].srcIn = clip.srcIn;
          clips[index].srcSpan = clip.srcSpan;
          clips[index].speed = clip.speed;
          clips[index].volume = clip.volume;
        });
      } else {
        clips = next;
        if (picked.kind === 'clip') picked.index = Math.min(picked.index, Math.max(0, clips.length - 1));
        renderVideoLane();
      }
    }
    duration = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
    renderWordLane();
    placeTimeline();
    renderCaption();
  }

  async function measureMetrics() {
    const family = FONT_FAMILY[style.font] || 'Vazirmatn';
    const spec = style.size + 'px "' + family + '"';
    try {
      await document.fonts.load(spec);
    } catch (err) {}
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = spec;
    return {
      // Gap between words is style.wordSpacing itself (0 = stuck).
      space: Math.max(0, Number(style.wordSpacing) || 0),
      widths: words.map((word) => ctx.measureText(word.text).width),
    };
  }

  function attachThumb(seg, clip) {
    const probe = document.createElement('video');
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = 'auto';
    probe.src = takeUrl(clip.file);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      probe.removeAttribute('src');
      probe.load();
    };
    const draw = () => {
      if (settled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        canvas.getContext('2d').drawImage(probe, 0, 0, canvas.width, canvas.height);
        seg.style.backgroundImage = 'url("' + canvas.toDataURL('image/jpeg', 0.72) + '")';
      } catch (err) {}
      finish();
    };
    probe.addEventListener('loadeddata', () => {
      const at = Math.min(0.35, Math.max(0, (probe.duration || 0.2) * 0.2));
      if (Math.abs((probe.currentTime || 0) - at) < 0.05) draw();
      else {
        const onSeek = () => {
          probe.removeEventListener('seeked', onSeek);
          draw();
        };
        probe.addEventListener('seeked', onSeek);
        probe.currentTime = at;
      }
    });
    probe.addEventListener('error', finish);
    setTimeout(finish, 8000);
  }

async function measureDurations() {
  const res = await fetch('/api/session?slug=' + encodeURIComponent(slug));
  if (!res.ok) return null;
  const session = await res.json();
  const durations = {};
  const paragraphs = Array.isArray(session.paragraphs) ? session.paragraphs : [];
  for (let i = 0; i < paragraphs.length; i++) {
    const file = paragraphs[i] && paragraphs[i].accepted;
    if (!file) continue;
    const stored = Number(paragraphs[i].duration);
    durations[file] = stored > 0.05 ? stored : await measureFile(file);
  }
  return durations;
}

  async function loadDoc(force) {
    setStatus(force ? 'داره زمان‌بندی رو از نو می‌چینه' : 'داره زیرنویس رو می‌خونه');
    let res = await fetch('/api/captions?slug=' + encodeURIComponent(slug));
    if (force || res.status === 404) {
      const durations = await measureDurations();
      res = await fetch('/api/captions/build?slug=' + encodeURIComponent(slug) + (force ? '&force=1' : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ durations: durations || {} }),
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || 'زیرنویس باز نشد');
      return;
    }
    const clipList = Array.isArray(data.clips) ? data.clips : [];
    const measured = {};
    if (!force) {
      setStatus('داره مدت ویدیو را می‌خواند');
      for (let i = 0; i < clipList.length; i++) {
        const file = clipList[i] && clipList[i].file;
        if (file) measured[file] = await measureFile(file);
      }
    }
    ready = false;
    adopt(data);
    const fixed = !force && rescaleToMeasured(measured);
    if (fixed) {
      renderWordLane();
      renderVideoLane();
      seekTo(0, false);
    }
    ready = true;
    if (fixed) {
      scheduleSave();
      setStatus('زمان ویدیو با زیرنویس یکی نبود. روی مدت واقعی از نو چیده شد.');
    } else {
      setStatus('زیرنویس رو بکش، یا کلمه‌ها رو روی خط زمان جابه‌جا کن.');
    }
  }

  if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    setStatus('ضبطی انتخاب نشده');
    playBtn.disabled = true;
    return;
  }

  colorInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  sizeInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  wordSpaceInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  letterSpaceInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  lineHeightInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  fontInput.addEventListener('change', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  highlightInput.addEventListener('change', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  highlightColor.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  opacityInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  textOpacityInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  wordInput.addEventListener('change', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  zoomInput.addEventListener('input', placeTimeline);
  playBtn.addEventListener('click', togglePlay);
  rebuildBtn.addEventListener('click', () => {
    if (!window.confirm('زمان کلمه‌ها و برش ویدیو از نو چیده می‌شه. رنگ و فونت می‌مونه.')) return;
    ready = false;
    loadDoc(true).catch(() => setStatus('زمان‌بندی دوباره نشد'));
  });
  openExportBtn.addEventListener('click', () => {
    fetch('/api/open-export?slug=' + encodeURIComponent(slug), { method: 'POST' }).catch(() => {
      setStatus('پوشه باز نشد');
    });
  });
  renderBtn.addEventListener('click', async () => {
    renderBtn.disabled = true;
    setStatus('داره زیرنویس رو روی ویدیو می‌نویسه');
    try {
      clearTimeout(saveTimer);
      await flushSave();
      const metrics = await measureMetrics();
      const res = await fetch('/api/captions/render?slug=' + encodeURIComponent(slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(metrics),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || 'ساخت ویدیو نشد');
        return;
      }
      showExport();
      fetch('/api/open-export?slug=' + encodeURIComponent(slug), { method: 'POST' }).catch(() => {});
      setStatus('فایل ساخته شد. پوشه‌اش باز شد و پایین صفحه هم پخش می‌شود.');
    } catch (err) {
      setStatus('ساخت ویدیو نشد');
    } finally {
      renderBtn.disabled = false;
    }
  });

  video.addEventListener('timeupdate', () => {
    if (!playing || !clockLive) return;
    const current = clips[activeIndex];
    if (!current || video.dataset.file !== current.file) return;
    const speed = current.speed || 1;
    const local = (video.currentTime - (current.srcIn || 0)) / speed;
    if (local >= current.duration - 0.04) {
      if (activeIndex < clips.length - 1) {
        seekTo(clips[activeIndex + 1].start + 0.02, true);
        return;
      }
      playing = false;
      video.pause();
      time = Math.max(0, duration - 0.01);
      renderCaption();
      placeTimeline();
      updateClock();
      return;
    }
    time = current.start + Math.max(0, local);
    renderCaption();
    placeTimeline();
    followPlayhead();
  });
  video.addEventListener('ended', () => {
    if (playing && activeIndex >= 0 && activeIndex < clips.length - 1) {
      seekTo(clips[activeIndex + 1].start + 0.02, true);
      return;
    }
    playing = false;
    updateClock();
  });

  splitBtn.addEventListener('click', () => {
    if (picked.kind === 'clip') splitClip(picked.index);
  });
  volumeInput.addEventListener('input', () => {
    if (picked.kind !== 'clip' || !clips[picked.index]) return;
    const clip = clips[picked.index];
    clip.volume = Number(volumeInput.value) / 100;
    volumeOut.textContent = faNum(volumeInput.value);
    syncMuteIcon(clip.volume < 0.01);
    if (activeIndex === picked.index) video.volume = Math.min(1, clip.volume);
    refreshClipTag(picked.index);
    scheduleSave();
  });
  muteBtn.addEventListener('click', () => {
    if (picked.kind !== 'clip' || !clips[picked.index]) return;
    const clip = clips[picked.index];
    clip.volume = (clip.volume || 0) < 0.01 ? 1 : 0;
    showPicked();
    if (activeIndex === picked.index) applyPlayback(clip);
    refreshClipTag(picked.index);
    scheduleSave();
  });
  speedInput.addEventListener('input', () => {
    if (picked.kind !== 'clip') return;
    const raw = Number(speedInput.value) / 100;
    if (speedSpecial) speedSpecial.value = '';
    if (speedOut) speedOut.textContent = formatSpeed(raw);
    setClipSpeed(picked.index, raw);
  });
  if (speedSpecial) {
    speedSpecial.addEventListener('change', () => {
      if (picked.kind !== 'clip') return;
      const raw = Number(speedSpecial.value);
      if (!raw) {
        setClipSpeed(picked.index, Number(speedInput.value) / 100 || 1);
        return;
      }
      setClipSpeed(picked.index, raw);
    });
  }
  deleteClipBtn.addEventListener('click', () => {
    if (picked.kind === 'clip') deleteClip(picked.index);
  });
  editWordBtn.addEventListener('click', () => {
    if (picked.kind === 'word') beginEditWord(picked.index);
  });
  addWordBtn.addEventListener('click', () => {
    if (picked.kind === 'word') addWord(picked.index);
  });
  deleteWordBtn.addEventListener('click', () => {
    if (picked.kind === 'word') deleteWord(picked.index);
  });

  caption.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    draggingCaption = true;
    try {
      caption.setPointerCapture(event.pointerId);
    } catch (err) {}
    function move(ev) {
      const rect = frame.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = ((ev.clientX - rect.left) / rect.width) * 100;
      const y = ((ev.clientY - rect.top) / rect.height) * 100;
      style.x = round3(Math.min(96, Math.max(4, x)));
      style.y = round3(Math.min(96, Math.max(4, y)));
      renderCaption();
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      draggingCaption = false;
      scheduleSave();
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    event.preventDefault();
  });

  document.addEventListener('keydown', (event) => {
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && picked.kind === 'word' && words[picked.index]) {
      event.preventDefault();
      deleteWord(picked.index);
      return;
    }
    if (event.code !== 'Space') return;
    if (tag === 'BUTTON' || tag === 'A') return;
    event.preventDefault();
    togglePlay();
  });

  window.addEventListener('resize', () => {
    placeTimeline();
    renderCaption();
  });

  loadDoc(false).catch(() => setStatus('زیرنویس باز نشد'));
})();
