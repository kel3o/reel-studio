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
  const mix = document.getElementById('mix-view');
  const addLineBtn = document.getElementById('tl-add-line');
  const deleteLineBtn = document.getElementById('tl-delete-line');
  const attachInput = document.getElementById('tl-attach-file');
  const capLayer = document.getElementById('cap-layer');
  const caption = document.getElementById('caption');
  const previewZoomInput = document.getElementById('preview-zoom');
  const previewZoomOut = document.getElementById('preview-zoom-out');
  const playBtn = document.getElementById('play-btn');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
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
  const addPauseBtn = document.getElementById('tl-add-pause');
  const addBlankBtn = document.getElementById('tl-add-blank');
  const deleteWordBtn = document.getElementById('tl-delete-word');
  const addMenu = document.getElementById('tl-add-menu');
  const LANE_LIMIT = 5;

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
  let lanes = [];
  let words = [];
  let style = defaultStyle();
  let docCameras = [];
  const laneVideos = new Map();
  let mixClock = 0;
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
  let selectedLaneId = '';
  let textLaneVisible = true;
  let lanesTouched = false;
  let previewZoom = 1;
  let bandUiLock = false;
  const picked = { kind: '', index: -1 };
  const HISTORY_MAX = 80;
  let undoStack = [];
  let redoStack = [];
  let historyLocked = false;
  let preSnapshot = '';
  let coalesceKey = '';
  let coalesceAt = 0;
  let coalesceTimer = 0;

  function faDigits(value) {
    return String(value == null ? '' : value).replace(/[0-9\u0660-\u0669]/g, (ch) => {
      const n = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 0x0660;
      return FA_DIGITS[n] || ch;
    });
  }

  function faNum(n) {
    return faDigits(n);
  }

  function captionText(value) {
    return faDigits(String(value || '').replace(/\[([1-6])\]/g, '').replace(/\*\*/g, ''));
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
    const total = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(total / 60);
    const whole = Math.floor(total % 60);
    const cent = Math.floor((total - Math.floor(total)) * 100);
    return (
      faNum(m) +
      ':' +
      faNum(String(whole).padStart(2, '0')) +
      '.' +
      faNum(String(cent).padStart(2, '0'))
    );
  }

  function spokenWordsOnly(list) {
    return (Array.isArray(list) ? list : []).filter(
      (word) => word && !word.pause && !word.blank && String(word.text || '').trim()
    );
  }

  function blankAt(t) {
    return words.find((word) => word && word.blank && t >= word.start && t < word.end) || null;
  }

  function gapPauseAt(t) {
    return (
      words.find((word) => word && word.pause && !word.blank && t >= word.start && t < word.end) || null
    );
  }

  function holdCueFromSpoken(spoken, beforeT) {
    if (!spoken.length) return null;
    let prev = null;
    for (let i = 0; i < spoken.length; i++) {
      if (spoken[i].start > beforeT + 0.001) break;
      prev = spoken[i];
    }
    if (!prev) return null;
    if (style.wordByWord) return [{ text: prev.text, hot: false }];
    const group = groupLines(spoken).find((items) => items.some((item) => item === prev));
    if (!group) return [{ text: prev.text, hot: false }];
    return group.map((word) => ({ text: word.text, hot: false }));
  }

  function groupLines(list) {
    const groups = [];
    let current = [];
    let chars = 0;
    spokenWordsOnly(list).forEach((word) => {
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
    if (blankAt(t)) return null;
    const spoken = spokenWordsOnly(words);
    if (!spoken.length) return null;
    if (style.wordByWord) {
      const word = spoken.find((item) => t >= item.start && t < item.end);
      if (word) return [{ text: word.text, hot: true }];
      const gap = gapPauseAt(t);
      if (gap) return holdCueFromSpoken(spoken, gap.start);
      return null;
    }
    const group = groupLines(spoken).find((items) => t >= items[0].start && t < items[items.length - 1].end);
    if (group) return group.map((word) => ({ text: word.text, hot: t >= word.start && t < word.end }));
    const gap = gapPauseAt(t);
    if (gap) return holdCueFromSpoken(spoken, gap.start);
    return null;
  }

  function clipAt(t) {
    const list = clips.filter((clip) => !isAudioClip(clip));
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) {
      const clip = list[i];
      if (t < clip.start + clip.duration - 0.001 || i === list.length - 1) {
        return { clip, local: Math.max(0, Math.min(clip.duration, t - clip.start)) };
      }
    }
    return { clip: list[0], local: 0 };
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

  function showExport(file) {
    const href =
      '/api/render?slug=' +
      encodeURIComponent(slug) +
      (file ? '&file=' + encodeURIComponent(file) : '');
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
    const el = multiView() && mix && !mix.hidden ? mix : video;
    const srcH = el === mix ? mix.height || 0 : video.videoHeight || 0;
    if (!el.clientHeight || !srcH) return 1;
    return el.clientHeight / srcH;
  }

  function applyPreviewZoom() {
    const z = previewZoom;
    const baseH = Math.max(180, Math.round(window.innerHeight * 0.52));
    const el = multiView() && mix ? mix : video;
    const srcW = el === mix ? mix.width || video.videoWidth || 9 : video.videoWidth || 9;
    const srcH = el === mix ? mix.height || video.videoHeight || 16 : video.videoHeight || 16;
    const h = Math.max(120, Math.round(baseH * z));
    const w = Math.max(68, Math.round(h * (srcW / Math.max(1, srcH))));
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.maxWidth = 'none';
    el.style.maxHeight = 'none';
    if (frame) frame.classList.toggle('is-zoomed', z > 1.001);
    if (previewZoomOut) previewZoomOut.textContent = faNum(Math.round(z * 100));
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
    if (capLayer) {
      capLayer.style.left = style.x + '%';
      capLayer.style.top = style.y + '%';
    }
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
      span.textContent = captionText(part.text);
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
    const wordH = textLaneVisible ? 52 + 12 : 8;
    tlInner.style.height = wordH + laneCount * 48 + (laneCount - 1) * 8 + 'px';
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
      const segs = lane.children;
      let segIndex = 0;
      clips.forEach((clip, clipIndex) => {
        if (String(clip.lane || 'main') !== String(laneKey)) return;
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
    wordLane.hidden = !textLaneVisible;
    if (tlLabels) {
      const wordLabel = tlLabels.querySelector('[data-lane="__words__"]');
      if (wordLabel) wordLabel.hidden = !textLaneVisible;
    }
    if (!textLaneVisible) {
      placeTimeline();
      return;
    }
    words.forEach((word, index) => {
      const chip = document.createElement('div');
      const blank = !!word.blank;
      const pause = !blank && !!(word.pause || !String(word.text || '').trim());
      chip.className =
        'tl-word' + (blank ? ' tl-word-blank' : '') + (pause ? ' tl-word-pause' : '');
      chip.dir = 'rtl';
      chip.textContent = blank || pause ? '' : captionText(word.text);
      if (blank) chip.title = 'متن بدون زیرنویس';
      else if (pause) chip.title = 'مکث بین زیرنویس';
      chip.addEventListener('pointerdown', (event) => onWordPointerDown(event, index));
      chip.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!pause && !blank) beginEditWord(index);
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

  function ensureAudioLanePresent() {
    if (!lanes.some((lane) => lane && lane.kind === 'audio')) {
      lanes.push({ id: 'audio', label: 'صدا', kind: 'audio', band: 0, bands: 1, file: '' });
    }
  }

  function videoLaneList() {
    ensureLaneClips();
    return lanes.filter((lane) => lane.kind !== 'audio' && lane.kind !== 'text');
  }

  function audioLane() {
    ensureLaneClips();
    return lanes.find((lane) => lane.kind === 'audio') || null;
  }

  function cameraLanes() {
    ensureLaneClips();
    return lanes.map((lane) => lane.id);
  }

  function laneById(id) {
    return lanes.find((lane) => lane.id === id) || null;
  }

  function isAudioLaneId(id) {
    const lane = laneById(id);
    return !!(lane && lane.kind === 'audio');
  }

  function isTakeAudioFile(file) {
    return /^[0-9]{2}-[0-9]{1,4}-a\.webm$/i.test(String(file || ''));
  }

  function isTakeVideoFile(file) {
    const name = String(file || '');
    return /^[0-9]{2}-[0-9]{1,4}\.webm$/i.test(name);
  }

  function isAudioClip(clip) {
    if (!clip) return false;
    if (isTakeAudioFile(clip.file)) return true;
    if (clip.lane === 'audio') return true;
    return isAudioLaneId(clip.lane);
  }

  function laneHasSound(lane) {
    return !!(lane && (lane.kind === 'audio' || (lane.kind === 'file' && lane.withAudio)));
  }

  function clipHasSound(clip) {
    if (!clip) return false;
    return isAudioClip(clip) || laneHasSound(laneById(clip.lane));
  }

  function laneLabel(key) {
    const lane = laneById(key);
    if (lane && lane.label) return lane.label;
    if (key === 'audio') return 'صدا';
    return 'ویدیو';
  }

  function multiView() {
    const visual = videoLaneList();
    if (visual.length > 1) return true;
    return visual.some((lane) => lane.kind === 'band' && Number(lane.bands) > 1);
  }

  function defaultBandLanesFromCameras() {
    if (!Array.isArray(docCameras) || docCameras.length <= 1) return null;
    return docCameras.map((label, index) => ({
      id: 'cam-' + index,
      label: label || 'دوربین ' + faNum(index + 1),
      kind: 'band',
      band: index,
      bands: docCameras.length,
      file: '',
      weight: 1,
      panY: 0.5,
    }));
  }

  function clipSeedKey(clip) {
    return String(clip.paragraph) + ':' + round3(Number(clip.start) || 0);
  }

  function repairTimeline() {
    const defaults = defaultBandLanesFromCameras();
    const hasBand = lanes.some((lane) => lane.kind === 'band');
    if (defaults && !hasBand && !lanesTouched) {
      const keep = lanes.filter((lane) => lane.kind === 'audio' || lane.kind === 'text' || lane.kind === 'file');
      lanes = defaults.concat(keep);
    }

    clips.forEach((clip) => {
      if (!isTakeAudioFile(clip.file)) return;
      if (clip.lane === 'audio' || isAudioLaneId(clip.lane)) return;
      clip.lane = 'audio';
      clip.camera = 'audio';
      if (clip.volume == null || clip.volume < 0.01) clip.volume = 1;
    });

    clips.forEach((clip) => {
      if (!isTakeAudioFile(clip.file) || clip.lane !== 'audio') return;
      const videoName = String(clip.file).replace(/-a\.webm$/i, '.webm');
      if (!isTakeVideoFile(videoName)) return;
      const bandLanes = lanes.filter((lane) => lane.kind === 'band');
      const targets = bandLanes.length ? bandLanes : videoLaneList();
      targets.forEach((lane) => {
        const exists = clips.some(
          (item) =>
            !isAudioClip(item) &&
            item.lane === lane.id &&
            item.file === videoName &&
            Number(item.paragraph) === Number(clip.paragraph)
        );
        if (exists) return;
        clips.push({
          file: videoName,
          paragraph: Number(clip.paragraph),
          start: Number(clip.start) || 0,
          duration: Number(clip.duration) || 0,
          srcIn: Number(clip.srcIn) || 0,
          srcSpan: Number(clip.srcSpan) > 0 ? Number(clip.srcSpan) : Number(clip.duration) || 0,
          speed: Number(clip.speed) > 0 ? Number(clip.speed) : 1,
          volume: 0,
          camera: lane.id,
          lane: lane.id,
        });
      });
    });

    const visual = lanes.filter((lane) => lane.kind !== 'audio' && lane.kind !== 'text');
    const bandLanes = visual.filter((lane) => lane.kind === 'band');
    if (bandLanes.length > 1) {
      const bandIds = new Set(bandLanes.map((lane) => lane.id));
      const seeds = [];
      clips.forEach((clip) => {
        if (isAudioClip(clip)) return;
        if (!bandIds.has(clip.lane) && clip.lane !== 'main') return;
        const key = clipSeedKey(clip);
        if (!seeds.some((seed) => clipSeedKey(seed) === key)) seeds.push(clip);
      });
      bandLanes.forEach((lane) => {
        seeds.forEach((seed) => {
          const exists = clips.some(
            (clip) =>
              !isAudioClip(clip) &&
              clip.lane === lane.id &&
              clipSeedKey(clip) === clipSeedKey(seed)
          );
          if (exists) return;
          clips.push(
            Object.assign({}, seed, {
              lane: lane.id,
              camera: lane.id,
              volume: 0,
            })
          );
        });
      });
    }
    ensureAudioLanePresent();
  }

  function updateHistoryButtons() {
    if (undoBtn) undoBtn.disabled = !undoStack.length || historyLocked || !ready;
    if (redoBtn) redoBtn.disabled = !redoStack.length || historyLocked || !ready;
  }

  function ensureLaneClips() {
    if (!lanes.length) {
      if (Array.isArray(docCameras) && docCameras.length > 1) {
        lanes = docCameras.map((label, index) => ({
          id: 'cam-' + index,
          label: label || 'دوربین ' + faNum(index + 1),
          kind: 'band',
          band: index,
          bands: docCameras.length,
          file: '',
          weight: 1,
          panY: 0.5,
        }));
      } else {
        lanes = [{ id: 'main', label: 'ویدیو', kind: 'full', band: 0, bands: 1, file: '', weight: 1, panY: 0.5 }];
      }
    }
    ensureAudioLanePresent();
    const known = new Set(lanes.map((lane) => lane.id));
    const unlabeled = clips.filter((clip) => !clip.lane || !known.has(clip.lane));
    const labeled = clips.filter((clip) => clip.lane && known.has(clip.lane));
    if (!unlabeled.length) return;
    const visual = lanes.filter((lane) => lane.kind !== 'audio' && lane.kind !== 'file');
    if (visual.length <= 1) {
      const target = visual[0] || lanes.find((lane) => lane.kind !== 'audio') || lanes[0];
      unlabeled.forEach((clip) => {
        clip.lane = target.id;
        if (!isAudioClip(clip)) clip.volume = 0;
      });
      clips = labeled.concat(unlabeled);
      return;
    }
    const expanded = labeled.slice();
    unlabeled.forEach((clip) => {
      visual.forEach((lane) => {
        expanded.push(Object.assign({}, clip, { lane: lane.id, camera: lane.id, volume: 0 }));
      });
    });
    clips = expanded;
  }

  function bindLaneDrag(label, laneId) {
    label.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (laneId === '__words__') {
        selectLane('__words__');
        return;
      }
      const originY = event.clientY;
      let dragging = false;
      function move(ev) {
        if (Math.abs(ev.clientY - originY) < 8) return;
        dragging = true;
      }
      function up(ev) {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!dragging) {
          selectLane(laneId);
          return;
        }
        if (lanes.length < 2) return;
        const nodes = Array.from(tlLabels.querySelectorAll('[data-lane]')).filter(
          (node) => node.getAttribute('data-lane') !== '__words__'
        );
        let target = nodes.length - 1;
        for (let i = 0; i < nodes.length; i++) {
          const rect = nodes[i].getBoundingClientRect();
          if (ev.clientY < rect.top + rect.height / 2) {
            target = i;
            break;
          }
        }
        const from = lanes.findIndex((lane) => lane.id === laneId);
        if (from < 0 || target === from) return;
        const [item] = lanes.splice(from, 1);
        lanes.splice(target, 0, item);
        selectedLaneId = laneId;
        renderVideoLane();
        paintMix();
        scheduleSave();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function clipOnLane(laneId, t) {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if ((clip.lane || 'main') !== laneId) continue;
      if (t >= clip.start - 0.001 && t < clip.start + clip.duration - 0.001) return clip;
    }
    return null;
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
          const laneId = lane.getAttribute('data-lane') || '';
          const clip = clipOnLane(laneId, time);
          if (clip) pickClip(clips.indexOf(clip));
          else selectLane(laneId);
        }
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function laneKindOf(key) {
    const lane = laneById(key);
    if (!lane) return 'full';
    return lane.kind || 'full';
  }

  function laneIconSvg(kind) {
    if (kind === 'audio') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';
    }
    if (kind === 'text') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 4v3h5v13h4V7h5V4H5z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 10.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5l4 4v-11l-4 4z"/></svg>';
  }

  function speakerIconSvg(on) {
    if (on) {
      return '<svg class="tl-speaker" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm11.5 3a3.5 3.5 0 0 0-1.9-3.1v6.2A3.5 3.5 0 0 0 15.5 12z"/></svg>';
    }
    return '<svg class="tl-speaker tl-speaker-off" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 12a3.5 3.5 0 0 0-1.9-3.1v2.2l1.8 1.8c.07-.3.1-.6.1-.9zM4.3 3 3 4.3 7.7 9H4v6h4l5 4v-6.7l4.7 4.7.8-.5L4.3 3zM14 5l-1.9 1.5L14 8.4V5z"/></svg>';
  }

  function countLanesByKind(kind) {
    if (kind === 'video') {
      return lanes.filter((lane) => lane.kind !== 'audio' && lane.kind !== 'text').length;
    }
    return lanes.filter((lane) => lane.kind === kind).length;
  }

  function renderVideoLane() {
    const laneIds = cameraLanes();
    if (tlLabels) {
      tlLabels.replaceChildren();
      if (textLaneVisible) {
        const wordLabel = document.createElement('span');
        wordLabel.className = 'tl-label-icon';
        wordLabel.dataset.lane = '__words__';
        wordLabel.title = 'لاین متن';
        wordLabel.innerHTML = laneIconSvg('text');
        bindLaneDrag(wordLabel, '__words__');
        tlLabels.appendChild(wordLabel);
      }
      laneIds.forEach((key) => {
        const kind = laneKindOf(key);
        const lane = laneById(key);
        const label = document.createElement('span');
        label.className = 'tl-label-icon' + (kind === 'audio' ? ' tl-label-audio' : '');
        label.dataset.lane = String(key);
        label.title =
          kind === 'audio'
            ? 'لاین صدا؛ فایل صوتی یا ویدیو را اینجا رها کن'
            : kind === 'text'
              ? 'لاین متن'
              : 'بکش بالا یا پایین تا جای تصویر عوض شود';
        const mainIcon = laneIconSvg(kind === 'audio' ? 'audio' : kind === 'text' ? 'text' : 'video');
        if (kind === 'audio' || kind === 'text') {
          label.innerHTML = mainIcon;
        } else {
          label.innerHTML =
            '<span class="tl-label-stack">' + mainIcon + speakerIconSvg(laneHasSound(lane)) + '</span>';
        }
        bindLaneDrag(label, key);
        tlLabels.appendChild(label);
      });
      markSelectedLane();
    }
    if (videoLanes) {
      videoLanes.replaceChildren();
      laneIds.forEach((key, laneIndex) => {
        const lane = document.createElement('div');
        const kind = laneKindOf(key);
        const audio = kind === 'audio';
        lane.className =
          'tl-lane tl-video' + (audio ? ' tl-audio' : '') + (kind === 'text' ? ' tl-text-lane' : '');
        if (laneIndex === 0 && kind !== 'audio' && kind !== 'text') lane.id = 'video-lane';
        if (audio && !document.getElementById('audio-lane')) lane.id = 'audio-lane';
        lane.setAttribute('data-lane', String(key));
        lane.style.top = (textLaneVisible ? 64 : 8) + laneIndex * 56 + 'px';
        clips.forEach((clip, clipIndex) => {
          if (String(clip.lane || 'main') !== String(key)) return;
          const seg = document.createElement('div');
          seg.className = 'tl-seg' + (audio ? ' tl-seg-audio' : '');
          seg.dataset.clipIndex = String(clipIndex);
          const tag = document.createElement('span');
          tag.className = 'tl-seg-tag';
          tag.textContent = clipTag(clip);
          if (!tag.textContent) tag.hidden = true;
          seg.appendChild(tag);
          lane.appendChild(seg);
          if (audio) attachWave(seg, clip);
          else if (kind !== 'text') attachThumb(seg, clip, laneById(key));
        });
        bindVideoLane(lane);
        if (audio) bindAudioLaneDrop(lane);
        videoLanes.appendChild(lane);
      });
    }
    placeTimeline();
  }

  function findClip(paragraph, start) {
    const list = clips.filter((clip) => clip.paragraph === Number(paragraph) && !isAudioClip(clip));
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
        const word = list[i];
        const minSpan = word.pause ? 0.2 : 0.04;
        let next = list[i + 1];
        if (next && next.start < word.start + minSpan) {
          const push = word.start + minSpan - next.start;
          for (let j = i + 1; j < list.length; j++) list[j].start = round3(list[j].start + push);
          next = list[i + 1];
        }
        if (next) word.end = next.start;
        else if (word.end > word.start + 0.04 && word.end < clipEnd - 0.02) word.end = word.end;
        else word.end = clipEnd;
        if (word.end < word.start + minSpan) word.end = word.start + minSpan;
      }
    });
  }

  function refreshDuration() {
    duration = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
  }

  function wordsOnSameClip(word) {
    const clip = findClip(word.paragraph, word.start);
    if (!clip) return [];
    return words
      .filter((item) => findClip(item.paragraph, item.start) === clip)
      .sort((a, b) => a.start - b.start);
  }

  function applyWordStart(word, proposed) {
    const clip = findClip(word.paragraph, word.start);
    if (!clip) return;
    const same = wordsOnSameClip(word);
    const index = same.indexOf(word);
    const prev = same[index - 1];
    const next = same[index + 1];
    const min = prev ? prev.start + 0.04 : clip.start;
    const max = next ? next.start - 0.04 : clip.start + clip.duration - 0.04;
    if (max < min) return;
    word.start = round3(Math.min(max, Math.max(min, proposed)));
    recomputeEnds();
  }

  function applyWordEnd(word, proposedEnd) {
    const clip = findClip(word.paragraph, word.start);
    if (!clip) return;
    const same = wordsOnSameClip(word);
    const index = same.indexOf(word);
    const next = same[index + 1];
    const minEnd = word.start + 0.04;
    const maxEnd = next
      ? (same[index + 2] ? same[index + 2].start - 0.04 : clip.start + clip.duration - 0.04)
      : clip.start + clip.duration;
    const end = round3(Math.min(Math.max(proposedEnd, minEnd), Math.max(minEnd, maxEnd)));
    if (next) {
      // Dragging the right edge moves the next word's start so it sticks.
      const nextMax = same[index + 2] ? same[index + 2].start - 0.04 : clip.start + clip.duration - 0.04;
      next.start = round3(Math.min(Math.max(end, word.start + 0.04), Math.max(word.start + 0.04, nextMax)));
    } else {
      word.end = end;
    }
    recomputeEnds();
  }

  function onWordPointerDown(event, index) {
    if (event.button !== 0) return;
    if (event.target && event.target.tagName === 'INPUT') return;
    const word = words[index];
    const chip = event.currentTarget;
    const rect = chip.getBoundingClientRect();
    const edge = Math.max(10, Math.min(18, rect.width * 0.22));
    const localX = event.clientX - rect.left;
    let mode = 'move';
    if (localX <= edge) mode = 'left';
    else if (localX >= rect.width - edge) mode = 'right';
    const originX = event.clientX;
    const originStart = word.start;
    const originEnd = word.end;
    let moved = false;
    draggingWord = true;
    try {
      chip.setPointerCapture(event.pointerId);
    } catch (err) {}
    function move(ev) {
      const dx = ev.clientX - originX;
      if (Math.abs(dx) < 3) return;
      moved = true;
      const dt = dx / pixelsPerSecond();
      if (mode === 'left') applyWordStart(word, originStart + dt);
      else if (mode === 'right') applyWordEnd(word, originEnd + dt);
      else applyWordStart(word, originStart + dt);
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
    const lane = clip.lane ? String(clip.lane) : '';
    const audio = lane === 'audio' || isTakeAudioFile(clip.file);
    const fallbackVol = audio ? 1 : 0;
    const volume = clip.volume == null || clip.volume === '' ? fallbackVol : Number(clip.volume);
    return {
      file: clip.file,
      paragraph: Number(clip.paragraph),
      start: Number(clip.start) || 0,
      duration,
      srcIn,
      srcSpan,
      speed,
      volume: Number.isFinite(volume) ? volume : fallbackVol,
      camera: clip.camera == null || clip.camera === '' ? '0' : clip.camera,
      lane,
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
      start: clip.start || 0,
      lane: clip.lane || '',
    }));
  }

  function showPicked() {
    const volumeWrap = volumeInput && volumeInput.closest ? volumeInput.closest('label') : null;
    const textLaneSelected =
      selectedLaneId === '__words__' ||
      !!(laneById(selectedLaneId) && laneById(selectedLaneId).kind === 'text');
    if (picked.kind === 'clip' && clips[picked.index]) {
      const clip = clips[picked.index];
      const audio = isAudioClip(clip);
      const sound = clipHasSound(clip);
      selectedLaneId = clip.lane || selectedLaneId;
      editLabel.textContent = (audio ? 'صدا ' : 'تکه ') + faNum(picked.index + 1);
      clipTools.hidden = false;
      wordTools.hidden = true;
      if (volumeWrap) volumeWrap.hidden = !sound;
      if (muteBtn) muteBtn.hidden = !sound;
      if (sound) {
        volumeInput.value = String(Math.round((clip.volume == null ? 1 : clip.volume) * 100));
        volumeOut.textContent = faNum(volumeInput.value);
        syncMuteIcon((clip.volume || 0) < 0.01);
      }
      const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
      syncSpeedControls(speed);
    } else if (picked.kind === 'word' && words[picked.index]) {
      const word = words[picked.index];
      const isBlank = !!word.blank;
      const isPause = !isBlank && !!(word.pause || !String(word.text || '').trim());
      editLabel.textContent = isBlank ? 'متن بدون زیرنویس' : isPause ? 'مکث بین زیرنویس' : captionText(word.text);
      clipTools.hidden = true;
      wordTools.hidden = false;
      if (editWordBtn) editWordBtn.hidden = !!(isBlank || isPause);
      if (deleteWordBtn) deleteWordBtn.hidden = false;
    } else if (textLaneSelected && textLaneVisible) {
      editLabel.textContent = words.length
        ? 'لاین متن. کلمه یا مکث اضافه کن.'
        : 'لاین متن خالی است. کلمه یا مکث اضافه کن.';
      clipTools.hidden = true;
      wordTools.hidden = false;
      if (editWordBtn) editWordBtn.hidden = true;
      if (deleteWordBtn) deleteWordBtn.hidden = true;
    } else {
      editLabel.textContent = textLaneVisible
        ? words.length
          ? 'روی خط ویدیو، صدا یا یه کلمه بزن.'
          : 'زیرنویسی نیست. با «افزودن کلمه» سر جای خط زمان یکی بساز.'
        : 'روی خط ویدیو یا صدا بزن. برای زیرنویس از «خط جدید → متن» استفاده کن.';
      clipTools.hidden = true;
      wordTools.hidden = true;
    }
    if (textLaneVisible && !words.length && picked.kind !== 'clip') {
      wordTools.hidden = false;
      if (editWordBtn) editWordBtn.hidden = true;
      if (deleteWordBtn) deleteWordBtn.hidden = true;
    }
    placeTimeline();
    markSelectedLane();
    if (!bandUiLock) syncBandOverlays();
  }

  function markSelectedLane() {
    if (!tlLabels) return;
    tlLabels.querySelectorAll('[data-lane]').forEach((node) => {
      node.classList.toggle('is-selected', node.getAttribute('data-lane') === selectedLaneId);
    });
  }

  function pickClip(index) {
    if (!clips[index]) return;
    picked.kind = 'clip';
    picked.index = index;
    selectedLaneId = clips[index].lane || '';
    showPicked();
  }

  function pickWord(index) {
    if (!words[index]) return;
    picked.kind = 'word';
    picked.index = index;
    selectedLaneId = '__words__';
    showPicked();
  }

  function activeAudioClip() {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i].kind !== 'audio') continue;
      const clip = clipOnLane(lanes[i].id, time);
      if (clip) return clip;
    }
    return null;
  }

  function applyPlayback(clip) {
    const speed = clip.speed || 1;
    try {
      video.playbackRate = speed;
    } catch (err) {}
    const audioClip = activeAudioClip();
    const audioOk = !!(audioClip && (audioClip.volume == null || audioClip.volume > 0.01));
    if (audioOk) {
      video.muted = true;
      video.volume = 0;
      return;
    }
    // Only file lanes marked withAudio may play embedded sound from #player.
    if (clipHasSound(clip) && (clip.volume == null || clip.volume > 0.01)) {
      video.muted = false;
      video.volume = Math.max(0, Math.min(1, clip.volume == null ? 1 : clip.volume));
      return;
    }
    video.muted = true;
    video.volume = 0;
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
      lane: clip.lane || '',
      camera: clip.camera,
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
    if (lanes.length < 2) {
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
    } else {
      clips.forEach((item) => {
        if (item !== clip && item.lane === clip.lane && item.start >= end - 0.001) {
          item.start = round3(item.start + delta);
        }
      });
    }
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
    scheduleSave('speed');
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

  function selectLane(laneId) {
    selectedLaneId = laneId || '';
    if (selectedLaneId === '__words__') {
      picked.kind = '';
      picked.index = -1;
      showPicked();
      return;
    }
    const lane = laneById(selectedLaneId);
    if (lane && lane.kind === 'text') {
      picked.kind = '';
      picked.index = -1;
      showPicked();
      return;
    }
    const index = clips.findIndex((clip) => clip.lane === selectedLaneId);
    if (index >= 0) pickClip(index);
    else showPicked();
  }

  function clearCaptionWords() {
    if (!window.confirm('همه‌ی زیرنویس‌ها حذف بشن؟')) return;
    words = [];
    textLaneVisible = false;
    lanes = lanes.filter((lane) => lane.kind !== 'text');
    selectedLaneId = '';
    picked.kind = '';
    picked.index = -1;
    renderWordLane();
    renderVideoLane();
    renderCaption();
    showPicked();
    scheduleSave();
    setStatus('زیرنویس‌ها حذف شد');
  }

  function deleteLane() {
    ensureLaneClips();
    let laneId = selectedLaneId;
    if (!laneId && picked.kind === 'clip' && clips[picked.index]) {
      laneId = clips[picked.index].lane || '';
    }
    if (!laneId) {
      setStatus('اول یه خط را انتخاب کن');
      return;
    }
    if (laneId === '__words__') {
      if (!window.confirm('لاین کلمه‌ها از تایم‌لاین پنهان بشه؟')) return;
      textLaneVisible = false;
      selectedLaneId = '';
      picked.kind = '';
      picked.index = -1;
      renderWordLane();
      showPicked();
      scheduleSave();
      setStatus('لاین کلمه‌ها پنهان شد');
      return;
    }
    const kind = laneKindOf(laneId);
    if (kind === 'text') {
      const lane = laneById(laneId);
      const name = lane && lane.label ? lane.label : 'این خط متن';
      if (!window.confirm(name + ' حذف بشه؟')) return;
      lanes = lanes.filter((item) => item.id !== laneId);
      if (selectedLaneId === laneId) selectedLaneId = '';
      renderVideoLane();
      showPicked();
      scheduleSave();
      setStatus('خط متن حذف شد');
      return;
    }
    const bucket = kind === 'audio' ? 'audio' : 'video';
    if (bucket === 'video' && countLanesByKind('video') < 2) {
      setStatus('آخرین خط تصویر باید بمونه');
      return;
    }
    const lane = laneById(laneId);
    const name = lane && lane.label ? lane.label : 'این خط';
    if (!window.confirm(name + ' حذف بشه؟')) return;
    lanes = lanes.filter((item) => item.id !== laneId);
    clips = clips.filter((item) => item.lane !== laneId);
    lanesTouched = true;
    ensureAudioLanePresent();
    const vid = laneVideos.get(laneId);
    if (vid) {
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
      laneVideos.delete(laneId);
    }
    selectedLaneId = '';
    refreshDuration();
    if (time >= duration) time = Math.max(0, duration - 0.05);
    picked.kind = clips.length ? 'clip' : '';
    picked.index = 0;
    renderWordLane();
    renderVideoLane();
    showPicked();
    syncMixMode();
    if (clips.length) seekTo(Math.min(time, Math.max(0, duration - 0.01)), false);
    else paintMix();
    scheduleSave();
  }

  function deleteClip(index) {
    if (clips.length < 2) {
      setStatus('حداقل یه تکه باید بمونه');
      return;
    }
    const clip = clips[index];
    if (lanes.length > 1) {
      if (!window.confirm('این تکه فقط از همین خط حذف بشه؟')) return;
      clips.splice(index, 1);
      refreshDuration();
      if (time >= duration) time = Math.max(0, duration - 0.05);
      picked.kind = 'clip';
      picked.index = Math.min(index, clips.length - 1);
      renderWordLane();
      renderVideoLane();
      showPicked();
      seekTo(Math.min(time, duration - 0.01), false);
      scheduleSave();
      return;
    }
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
    if (word.pause || word.blank) return;
    editingWord = true;
    pickWord(index);
    const input = document.createElement('input');
    input.className = 'tl-word-input';
    input.value = captionText(word.text);
    input.setAttribute('aria-label', 'متن کلمه');
    chip.replaceChildren(input);
    input.addEventListener('input', () => {
      const next = captionText(input.value);
      if (next === input.value) return;
      const pos = input.selectionStart;
      input.value = next;
      if (pos != null) input.setSelectionRange(pos, pos);
    });
    input.focus();
    input.select();
    let closed = false;
    function done(commit) {
      if (closed) return;
      closed = true;
      editingWord = false;
      if (commit) {
        const text = captionText(input.value).replace(/\s+/g, ' ').trim();
        if (text) {
          word.text = text;
          word.pause = false;
          word.blank = false;
        } else {
          word.text = '';
          word.pause = true;
          word.blank = false;
        }
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

  function insertTimelineWord(index, mode) {
    const asBlank = mode === 'blank';
    const asPause = mode === 'pause' || mode === true || asBlank;
    const base = words[index];
    if (!base) return;
    const clip = findClip(base.paragraph, base.start);
    const spanEnd = base.end > base.start + 0.04 ? base.end : clip ? clip.start + clip.duration : base.start + 0.4;
    const span = Math.max(0.08, spanEnd - base.start);
    const piece = asPause ? Math.min(0.45, Math.max(0.2, span * 0.4)) : Math.min(0.35, Math.max(0.12, span * 0.35));
    let start = round3(base.start + Math.max(0.06, (span - piece) / 2));
    if (span < piece + 0.08) {
      const push = piece + 0.08 - span;
      words.forEach((word) => {
        if (word !== base && word.start > base.start + 0.001) word.start = round3(word.start + push);
      });
      start = round3(base.start + 0.06);
    }
    const item = {
      text: asPause ? '' : 'کلمه',
      start: start,
      end: round3(start + piece),
      paragraph: base.paragraph,
      pause: !!asPause,
      blank: !!asBlank,
    };
    words.push(item);
    words.sort((a, b) => a.start - b.start || a.paragraph - b.paragraph);
    recomputeEnds();
    const newIndex = words.findIndex(
      (word) => !!word.blank === !!asBlank && !!word.pause === !!asPause && Math.abs(word.start - item.start) < 0.05
    );
    renderWordLane();
    renderCaption();
    if (newIndex >= 0) {
      pickWord(newIndex);
      if (!asPause) beginEditWord(newIndex);
    }
    scheduleSave();
  }

  function insertFirstWord(mode) {
    const asBlank = mode === 'blank';
    const asPause = mode === 'pause' || mode === true || asBlank;
    const visual = clips.filter((clip) => !isAudioClip(clip));
    if (!visual.length) return;
    const at = Math.max(0, time);
    const clip = visual.find((item) => at >= item.start && at < item.start + item.duration) || visual[0];
    const start = round3(Math.max(clip.start, Math.min(at, clip.start + clip.duration - 0.4)));
    words.push({
      text: asPause ? '' : 'کلمه',
      start: start,
      end: round3(start + 0.35),
      paragraph: clip.paragraph,
      pause: !!asPause,
      blank: !!asBlank,
    });
    recomputeEnds();
    renderWordLane();
    renderCaption();
    pickWord(0);
    if (!asPause) beginEditWord(0);
    scheduleSave();
  }

  function addWord(index) {
    if (!words.length) {
      insertFirstWord(false);
      return;
    }
    insertTimelineWord(index, false);
  }

  function addPause(index) {
    if (!words.length) {
      insertFirstWord('pause');
      return;
    }
    insertTimelineWord(index, 'pause');
  }

  function addBlank(index) {
    if (!words.length) {
      insertFirstWord('blank');
      return;
    }
    insertTimelineWord(index, 'blank');
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

  function stopMixClock() {
    if (mixClock) cancelAnimationFrame(mixClock);
    mixClock = 0;
  }

  function syncMixMode() {
    const on = multiView();
    if (mix) mix.hidden = !on;
    video.classList.toggle('is-backed', on);
    if (on) video.pause();
    else {
      const layer = document.getElementById('band-overlays');
      if (layer) {
        layer.hidden = true;
        layer.replaceChildren();
      }
    }
  }

  function laneVideo(lane, clip) {
    let el = laneVideos.get(lane.id);
    const audio = lane.kind === 'audio';
    if (!el) {
      el = document.createElement(audio ? 'audio' : 'video');
      el.muted = !audio;
      el.playsInline = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      if (audio) {
        el.style.display = 'none';
        document.body.appendChild(el);
      }
      laneVideos.set(lane.id, el);
    }
    if (el.dataset.file !== clip.file) {
      el.dataset.file = clip.file;
      el.src = takeUrl(clip.file);
      el.onloadeddata = function () {
        if (!audio && !(el.videoWidth > 0)) {
          setStatus('این ضبط تصویر ندارد. یک بار دیگر ضبط کن.');
        }
        paintMix();
      };
    }
    return el;
  }

  function laneWeight(lane) {
    const n = Number(lane && lane.weight);
    return Number.isFinite(n) && n > 0.02 ? n : 1;
  }

  function lanePanX(lane) {
    const n = Number(lane && lane.panX);
    if (!Number.isFinite(n)) return 0.5;
    return Math.min(1, Math.max(0, n));
  }

  function lanePanY(lane) {
    const n = Number(lane && lane.panY);
    if (!Number.isFinite(n)) return 0.5;
    return Math.min(1, Math.max(0, n));
  }

  function laneZoom(lane) {
    const n = Number(lane && lane.zoom);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(6, n);
  }

  function visualBandBoxes(totalH) {
    const visual = videoLaneList();
    const weights = visual.map(laneWeight);
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let y = 0;
    return visual.map((lane, index) => {
      const frac = weights[index] / sum;
      const h =
        index === visual.length - 1 ? Math.max(1, totalH - y) : Math.max(1, Math.round(frac * totalH));
      const box = { lane, y0: y, y1: y + h, h };
      y += h;
      return box;
    });
  }

  function drawBand(ctx, source, lane, dx, dy, dw, dh) {
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    if (!sw || !sh || dw < 1 || dh < 1) return;
    let sy = 0;
    let sww = sw;
    let shh = sh;
    if (lane.kind === 'band' && lane.bands > 1) {
      const y0 = Math.round((lane.band * sh) / lane.bands);
      const y1 = Math.round(((lane.band + 1) * sh) / lane.bands);
      sy = y0;
      shh = Math.max(1, y1 - y0);
    }
    const cover = Math.max(dw / sww, dh / shh);
    const scale = cover * laneZoom(lane);
    const cw = Math.max(1, dw / scale);
    const ch = Math.max(1, dh / scale);
    const maxOffX = Math.max(0, sww - cw);
    const maxOffY = Math.max(0, shh - ch);
    const srcX = maxOffX * lanePanX(lane);
    const srcY = sy + maxOffY * lanePanY(lane);
    ctx.drawImage(source, srcX, srcY, cw, ch, dx, dy, dw, dh);
  }

  function paintMix() {
    if (!mix || !multiView()) return;
    let sw = 720;
    let sh = 1280;
    laneVideos.forEach((el) => {
      if (el.videoWidth) {
        sw = el.videoWidth;
        sh = el.videoHeight || sh;
      }
    });
    if (mix.width !== sw) mix.width = sw;
    if (mix.height !== sh) mix.height = sh;
    const ctx = mix.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, mix.width, mix.height);
    const boxes = visualBandBoxes(mix.height);
    boxes.forEach((box) => {
      const clip = clipOnLane(box.lane.id, time);
      if (!clip) return;
      const el = laneVideo(box.lane, clip);
      if (el.readyState < 2) return;
      drawBand(ctx, el, box.lane, 0, box.y0, mix.width, Math.max(1, box.h));
    });
    const zoomKey = String(mix.width) + ':' + String(previewZoom);
    if (mix.dataset.zoomKey !== zoomKey) {
      mix.dataset.zoomKey = zoomKey;
      applyPreviewZoom();
    }
    if (!bandUiLock) syncBandOverlays();
  }

  function syncBandOverlays() {
    const layer = document.getElementById('band-overlays');
    if (!layer) return;
    layer.replaceChildren();
    if (!multiView()) {
      layer.hidden = true;
      return;
    }
    layer.hidden = false;
    const boxes = visualBandBoxes(1000);
    boxes.forEach((box, index) => {
      const topPct = (box.y0 / 1000) * 100;
      const hPct = (box.h / 1000) * 100;
      const zone = document.createElement('div');
      const selected = box.lane.id === selectedLaneId;
      zone.className = 'band-zone' + (selected ? ' is-selected' : '');
      zone.style.top = topPct + '%';
      zone.style.height = hPct + '%';
      zone.title = 'بکش تا تصویر جابه‌جا شود. گوشه‌ها زوم می‌کنند';
      zone.addEventListener('pointerdown', (event) => beginBandPan(event, box.lane.id));
      if (selected) {
        ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((handle) => {
          const knob = document.createElement('button');
          knob.type = 'button';
          knob.className = 'band-handle';
          knob.dataset.handle = handle;
          knob.setAttribute('aria-label', 'زوم');
          knob.addEventListener('pointerdown', (event) => beginBandZoom(event, box.lane.id));
          zone.appendChild(knob);
        });
      }
      layer.appendChild(zone);
      if (index >= boxes.length - 1) return;
      const split = document.createElement('div');
      split.className = 'band-split';
      split.style.top = ((box.y1 / 1000) * 100) + '%';
      split.title = 'بکش تا نسبت قاب عوض شود';
      split.addEventListener('pointerdown', (event) => beginBandSplit(event, index));
      layer.appendChild(split);
    });
  }

  function beginBandPan(event, laneId) {
    if (event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest('.band-handle')) return;
    event.preventDefault();
    event.stopPropagation();
    const lane = laneById(laneId);
    if (!lane) return;
    selectedLaneId = laneId;
    bandUiLock = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const startPanX = lanePanX(lane);
    const startPanY = lanePanY(lane);
    const rect = frame.getBoundingClientRect();
    let moved = false;
    function move(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      const spanX = Math.max(40, rect.width * 0.45);
      const spanY = Math.max(40, rect.height * 0.45);
      lane.panX = Math.min(1, Math.max(0, startPanX + dx / spanX));
      lane.panY = Math.min(1, Math.max(0, startPanY + dy / spanY));
      paintMix();
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      bandUiLock = false;
      syncBandOverlays();
      showPicked();
      if (moved) scheduleSave('band-pan');
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function beginBandZoom(event, laneId) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const lane = laneById(laneId);
    if (!lane) return;
    selectedLaneId = laneId;
    bandUiLock = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const startZoom = laneZoom(lane);
    const rect = event.currentTarget && event.currentTarget.getBoundingClientRect
      ? event.currentTarget.parentElement.getBoundingClientRect()
      : frame.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startDist = Math.max(12, Math.hypot(startX - cx, startY - cy));
    function move(ev) {
      const dist = Math.max(8, Math.hypot(ev.clientX - cx, ev.clientY - cy));
      lane.zoom = Math.min(6, Math.max(1, startZoom * (dist / startDist)));
      paintMix();
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      bandUiLock = false;
      syncBandOverlays();
      scheduleSave('band-zoom');
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function beginBandSplit(event, splitIndex) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const visual = videoLaneList();
    if (splitIndex < 0 || splitIndex >= visual.length - 1) return;
    const upper = visual[splitIndex];
    const lower = visual[splitIndex + 1];
    const w0 = laneWeight(upper);
    const w1 = laneWeight(lower);
    const pair = w0 + w1;
    const rect = frame.getBoundingClientRect();
    const boxes = visualBandBoxes(Math.max(1, rect.height));
    const top = boxes[splitIndex].y0;
    const bottom = boxes[splitIndex + 1].y1;
    const span = Math.max(48, bottom - top);
    function move(ev) {
      const y = Math.min(bottom - 24, Math.max(top + 24, ev.clientY - rect.top));
      const upperFrac = (y - top) / span;
      upper.weight = Math.max(0.05, upperFrac * pair);
      lower.weight = Math.max(0.05, (1 - upperFrac) * pair);
      paintMix();
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      scheduleSave('band-split');
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function lanePersist(lane) {
    return {
      id: lane.id,
      label: lane.label,
      kind: lane.kind,
      band: lane.band,
      bands: lane.bands,
      file: lane.file || '',
      withAudio: !!lane.withAudio,
      weight: laneWeight(lane),
      panX: lanePanX(lane),
      panY: lanePanY(lane),
      zoom: laneZoom(lane),
    };
  }

  function laneFromDoc(lane) {
    return {
      id: String(lane.id),
      label: lane.label || '',
      kind: lane.kind || 'full',
      band: Number(lane.band) || 0,
      bands: Number(lane.bands) || 1,
      file: lane.file || '',
      withAudio: !!lane.withAudio,
      weight: laneWeight(lane),
      panX: lanePanX(lane),
      panY: lanePanY(lane),
      zoom: laneZoom(lane),
    };
  }

  function syncLaneVideos(force) {
    lanes.forEach((lane) => {
      const clip = clipOnLane(lane.id, time);
      if (!clip) {
        const idle = laneVideos.get(lane.id);
        if (idle) idle.pause();
        return;
      }
      const vid = laneVideo(lane, clip);
      const at = sourceTimeOf(clip, Math.max(0, time - clip.start));
      if (force || Math.abs((vid.currentTime || 0) - at) > 0.35) {
        try {
          vid.currentTime = at;
        } catch (err) {}
      }
      const audible = laneHasSound(lane) && (clip.volume == null || clip.volume > 0.01);
      vid.muted = !audible;
      if (audible) {
        vid.volume = Math.max(0, Math.min(1, clip.volume == null ? 1 : clip.volume));
      } else {
        vid.volume = 0;
      }
      try {
        vid.playbackRate = clip.speed || 1;
      } catch (err) {}
      if (playing) vid.play().catch(() => {});
      else vid.pause();
    });
  }

  function syncAudioLane(force) {
    lanes.forEach((lane) => {
      if (lane.kind !== 'audio') return;
      const clip = clipOnLane(lane.id, time);
      if (!clip) {
        const idle = laneVideos.get(lane.id);
        if (idle) idle.pause();
        return;
      }
      const el = laneVideo(lane, clip);
      const at = sourceTimeOf(clip, Math.max(0, time - clip.start));
      if (force || Math.abs((el.currentTime || 0) - at) > 0.35) {
        try {
          el.currentTime = at;
        } catch (err) {}
      }
      const vol = clip.volume == null ? 1 : clip.volume;
      el.muted = vol < 0.01;
      el.volume = Math.max(0, Math.min(1, vol));
      try {
        el.playbackRate = clip.speed || 1;
      } catch (err) {}
      if (playing) el.play().catch(() => {});
      else el.pause();
    });
  }

  function pauseLaneVideos() {
    laneVideos.forEach((el) => el.pause());
  }

  function startMixClock() {
    stopMixClock();
    syncLaneVideos(true);
    let last = performance.now();
    function frame(now) {
      if (!playing || !multiView()) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      if (time >= duration - 0.02) {
        playing = false;
        time = Math.max(0, duration - 0.01);
        pauseLaneVideos();
        paintMix();
        renderCaption();
        placeTimeline();
        updateClock();
        return;
      }
      syncLaneVideos(false);
      paintMix();
      renderCaption();
      placeTimeline();
      updateClock();
      followPlayhead();
      mixClock = requestAnimationFrame(frame);
    }
    mixClock = requestAnimationFrame(frame);
  }

  function seekTo(t, shouldPlay) {
    if (!clips.length) return;
    time = Math.min(Math.max(0, t), Math.max(0, duration - 0.01));
    playing = !!shouldPlay;
    if (multiView()) {
      syncMixMode();
      if (playing) startMixClock();
      else {
        stopMixClock();
        pauseLaneVideos();
        syncLaneVideos(true);
        paintMix();
      }
      renderCaption();
      placeTimeline();
      if (playing) followPlayhead();
      return;
    }
    syncMixMode();
    applyPreviewZoom();
    const located = clipAt(time);
    if (!located) {
      syncAudioLane(true);
      return;
    }
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
      syncAudioLane(true);
      clockLive = true;
    }
    if (!same) {
      video.dataset.file = located.clip.file;
      video.src = takeUrl(located.clip.file);
      video.muted = true;
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
      stopMixClock();
      pauseLaneVideos();
      syncAudioLane(false);
      updateClock();
      return;
    }
    if (time >= duration - 0.05) time = 0;
    playing = true;
    // Start audio in this click. A later animation frame is blocked as autoplay.
    syncAudioLane(true);
    seekTo(time, true);
  }

  function scrubFromEvent(event) {
    const rect = tlInner.getBoundingClientRect();
    const x = event.clientX - rect.left;
    seekTo(x / pixelsPerSecond(), playing);
  }

  function snapshotState() {
    return JSON.stringify({
      style,
      words,
      clips: clipPayload(),
      lanes: lanes.map(lanePersist),
      textLaneVisible: textLaneVisible,
      lanesTouched: lanesTouched,
      time,
      picked: { kind: picked.kind, index: picked.index },
      selectedLaneId: selectedLaneId,
    });
  }

  function rememberBaseline() {
    clearTimeout(coalesceTimer);
    coalesceTimer = 0;
    coalesceKey = '';
    coalesceAt = 0;
    preSnapshot = snapshotState();
  }

  function noteHistory(historyKey) {
    if (!ready || historyLocked) return;
    const current = snapshotState();
    if (!preSnapshot) {
      preSnapshot = current;
      return;
    }
    if (preSnapshot === current) return;
    const now = Date.now();
    const key = historyKey || '';
    const sameBurst = key && key === coalesceKey && now - coalesceAt < 650;
    if (!sameBurst) {
      undoStack.push(preSnapshot);
      if (undoStack.length > HISTORY_MAX) undoStack.shift();
      redoStack = [];
      coalesceKey = key;
      coalesceAt = now;
      updateHistoryButtons();
    }
    if (key) {
      clearTimeout(coalesceTimer);
      coalesceTimer = setTimeout(() => {
        preSnapshot = snapshotState();
        coalesceKey = '';
        coalesceAt = 0;
        coalesceTimer = 0;
      }, 650);
    } else {
      clearTimeout(coalesceTimer);
      coalesceTimer = 0;
      coalesceKey = '';
      coalesceAt = 0;
      preSnapshot = current;
    }
  }

  function applySnapshot(raw) {
    const data = JSON.parse(raw);
    style = Object.assign(defaultStyle(), data.style || {});
    words = (data.words || []).map((word) => {
      const text = word.text == null ? '' : String(word.text);
      const blank = !!word.blank;
      const pause = !blank && !!(word.pause || !text.trim());
      return {
        text: blank || pause ? '' : text,
        start: Number(word.start) || 0,
        end: Number(word.end) || 0,
        paragraph: Number(word.paragraph),
        pause: pause || blank,
        blank: blank,
        lane: word.lane ? String(word.lane) : 'text-main',
      };
    });
    clips = (data.clips || []).map(decorateClip);
    lanes = Array.isArray(data.lanes) ? data.lanes.map(laneFromDoc) : [];
    textLaneVisible = data.textLaneVisible !== false;
    lanesTouched = !!data.lanesTouched;
    selectedLaneId = data.selectedLaneId || '';
    repairTimeline();
    ensureLaneClips();
    syncMixMode();
    duration = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
    fillForm();
    renderWordLane();
    renderVideoLane();
    renderCaption();
    const nextTime = Number(data.time);
    if (Number.isFinite(nextTime)) seekTo(Math.max(0, Math.min(duration, nextTime)), false);
    else updateClock();
    picked.kind = data.picked && data.picked.kind ? data.picked.kind : '';
    picked.index = data.picked && Number.isFinite(data.picked.index) ? data.picked.index : -1;
    showPicked();
  }

  function undoEdit() {
    if (!undoStack.length || historyLocked || !ready) return;
    clearTimeout(coalesceTimer);
    coalesceTimer = 0;
    coalesceKey = '';
    const current = snapshotState();
    redoStack.push(current);
    const prev = undoStack.pop();
    historyLocked = true;
    applySnapshot(prev);
    preSnapshot = prev;
    historyLocked = false;
    updateHistoryButtons();
    flushSave();
    setStatus('برگشت');
  }

  function redoEdit() {
    if (!redoStack.length || historyLocked || !ready) return;
    clearTimeout(coalesceTimer);
    coalesceTimer = 0;
    coalesceKey = '';
    const current = snapshotState();
    undoStack.push(current);
    const next = redoStack.pop();
    historyLocked = true;
    applySnapshot(next);
    preSnapshot = next;
    historyLocked = false;
    updateHistoryButtons();
    flushSave();
    setStatus('جلو');
  }

  function scheduleSave(historyKey) {
    if (!ready) return;
    noteHistory(historyKey);
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
      lanes: lanes.map(lanePersist),
      textLaneVisible: textLaneVisible,
      lanesTouched: lanesTouched,
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
    words = (doc.words || []).map((word) => {
      const text = word.text == null ? '' : String(word.text);
      const blank = !!word.blank;
      const pause = !blank && !!(word.pause || !text.trim());
      return {
        text: blank || pause ? '' : text,
        start: Number(word.start) || 0,
        end: Number(word.end) || 0,
        paragraph: Number(word.paragraph),
        pause: pause || blank,
        blank: blank,
        lane: word.lane ? String(word.lane) : 'text-main',
      };
    });
    style = Object.assign(defaultStyle(), doc.style || {});
    docCameras = Array.isArray(doc.cameras) ? doc.cameras.slice() : [];
    lanes = Array.isArray(doc.lanes) ? doc.lanes.map(laneFromDoc) : [];
    textLaneVisible = doc.textLaneVisible !== false;
    lanesTouched = !!doc.lanesTouched;
    repairTimeline();
    ensureLaneClips();
    syncMixMode();
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
    showPicked();
    updateHistoryButtons();
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
    const videoPrev = previous.filter((clip) => !isAudioClip(clip));
    const audioPrev = previous.filter((clip) => isAudioClip(clip));
    const nextVideo = [];
    let cursor = 0;
    videoPrev.forEach((clip) => {
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
      nextVideo.push(Object.assign({}, clip, { start: cursor, duration: nextDuration, srcSpan }));
      cursor += nextDuration;
    });
    if (!changed) return false;
    const used = new Set();
    nextVideo.forEach((clip, index) => {
      const old = videoPrev[index];
      const scale = old.duration > 0 ? clip.duration / old.duration : 1;
      words.forEach((word, wordIndex) => {
        if (used.has(wordIndex)) return;
        const end = old.start + old.duration;
        if (word.start < old.start - 0.001 || word.start > end + 0.001) return;
        if (word.start >= end - 0.001 && index < nextVideo.length - 1) return;
        used.add(wordIndex);
        word.start = round3(clip.start + (word.start - old.start) * scale);
      });
    });
    const nextAudio = audioPrev.map((clip) => {
      const match = nextVideo.find((item) => item.paragraph === clip.paragraph);
      if (!match) return clip;
      const plain = clip.srcIn < 0.001 && Math.abs(clip.speed - 1) < 0.001;
      let nextDuration = match.duration;
      let srcSpan = match.srcSpan;
      if (plain) {
        const seen = Number(measured[clip.file]);
        if (seen > 0.05) {
          nextDuration = Math.min(match.duration, seen);
          srcSpan = nextDuration;
        }
      }
      return Object.assign({}, clip, {
        start: match.start,
        duration: nextDuration,
        srcSpan,
      });
    });
    clips = nextVideo.concat(nextAudio);
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
      words = data.words.map((word) => {
        const text = word.text == null ? '' : String(word.text);
        const blank = !!word.blank;
        const pause = !blank && !!(word.pause || !text.trim() || text === '·');
        return {
          text: blank || pause ? '' : text,
          start: Number(word.start) || 0,
          end: Number(word.end) || 0,
          paragraph: Number(word.paragraph),
          pause: pause || blank,
          blank: blank,
        };
      });
    }
    if (typeof data.textLaneVisible === 'boolean') textLaneVisible = data.textLaneVisible;
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
          clips[index].lane = clip.lane || clips[index].lane || '';
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

  function evenVideoDim(n) {
    const value = Math.max(0, Math.round(Number(n) || 0));
    if (value < 2) return 0;
    return value % 2 === 0 ? value : value - 1;
  }

  function outputSize() {
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (multiView() && mix && mix.width > 2 && mix.height > 2) {
      w = mix.width;
      h = mix.height;
    }
    return { width: evenVideoDim(w), height: evenVideoDim(h) };
  }

  function shadowPixels() {
    const scale = previewScale();
    const zoom = previewZoom > 0 ? previewZoom : 1;
    const frame = scale > 0 ? scale / zoom : 1;
    const factor = frame > 0.02 ? 1 / frame : 1;
    return { y: 2 * factor, blur: 8 * factor };
  }

  function cutBlanks(start, end) {
    let pieces = [{ start: start, end: end }];
    words.forEach((word) => {
      if (!word || !word.blank) return;
      const next = [];
      pieces.forEach((piece) => {
        if (!(word.end > piece.start) || !(word.start < piece.end)) {
          next.push(piece);
          return;
        }
        if (word.start > piece.start) next.push({ start: piece.start, end: word.start });
        if (word.end < piece.end) next.push({ start: word.end, end: piece.end });
      });
      pieces = next;
    });
    return pieces.filter((piece) => piece.end > piece.start + 0.02);
  }

  function captionFrames() {
    const spoken = spokenWordsOnly(words);
    const frames = [];
    const push = (start, end, parts) => {
      cutBlanks(start, end).forEach((piece) => {
        frames.push({ start: piece.start, end: piece.end, parts: parts });
      });
    };
    if (!spoken.length) return frames;
    if (style.wordByWord) {
      spoken.forEach((word) => {
        push(word.start, word.end, [{ text: captionText(word.text), hot: !!style.highlight }]);
      });
    } else {
      groupLines(spoken).forEach((group) => {
        group.forEach((word) => {
          push(
            word.start,
            word.end,
            group.map((item) => ({
              text: captionText(item.text),
              hot: !!style.highlight && item === word,
            }))
          );
        });
      });
    }
    words.forEach((word) => {
      if (!word || !word.pause || word.blank) return;
      const held = holdCueFromSpoken(spoken, word.start);
      if (!held) return;
      push(
        word.start,
        word.end,
        held.map((part) => ({ text: captionText(part.text), hot: false }))
      );
    });
    return frames;
  }

  function paintCaption(parts, width, height) {
    const family = FONT_FAMILY[style.font] || 'Vazirmatn';
    const size = Math.max(8, Number(style.size) || 48);
    const probe = document.createElement('div');
    probe.className = 'caption is-line font-' + (style.font || 'vazir');
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    probe.style.top = '0';
    probe.style.fontSize = size + 'px';
    probe.style.letterSpacing = (Number(style.letterSpacing) || 0) + 'px';
    probe.style.lineHeight = String((style.lineHeight || 130) / 100);
    probe.style.color = rgba(style.color, style.textOpacity == null ? 100 : style.textOpacity);
    document.body.appendChild(probe);
    const spans = [];
    parts.forEach((part, index) => {
      if (index) {
        const gap = document.createElement('span');
        gap.className = 'cap-gap';
        gap.style.width = Math.max(0, Number(style.wordSpacing) || 0) + 'px';
        probe.appendChild(gap);
      }
      const span = document.createElement('span');
      span.className = 'cap-word' + (part.hot ? ' is-hot' : '');
      span.textContent = part.text;
      if (part.hot) span.style.background = rgba(style.highlightColor, style.highlightOpacity);
      probe.appendChild(span);
      spans.push(span);
    });
    const host = probe.getBoundingClientRect();
    const boxes = spans.map((span) => {
      const rect = span.getBoundingClientRect();
      return {
        text: span.textContent,
        hot: span.classList.contains('is-hot'),
        x: rect.left - host.left,
        y: rect.top - host.top,
        w: rect.width,
        h: rect.height,
      };
    });
    probe.remove();
    if (!(host.width > 1) || !boxes.length) return null;
    let minX = 0;
    let minY = 0;
    let maxX = host.width;
    let maxY = host.height;
    boxes.forEach((box) => {
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.w);
      maxY = Math.max(maxY, box.y + box.h);
    });
    const shadow = shadowPixels();
    const pad = Math.ceil(shadow.blur + Math.abs(shadow.y) + 4);
    const originX = pad - minX;
    const originY = pad - minY;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.ceil(maxX - minX + pad * 2));
    canvas.height = Math.max(2, Math.ceil(maxY - minY + pad * 2));
    const ctx = canvas.getContext('2d');
    ctx.font = size + 'px "' + family + '"';
    try {
      ctx.letterSpacing = (Number(style.letterSpacing) || 0) + 'px';
    } catch (err) {}
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const radius = Math.max(0, size * 0.22);
    const fill = rgba(style.color, style.textOpacity == null ? 100 : style.textOpacity);
    const hi = rgba(style.highlightColor, style.highlightOpacity);
    boxes.forEach((box) => {
      if (!box.hot) return;
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = hi;
      const r = Math.min(radius, box.w / 2, box.h / 2);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(originX + box.x, originY + box.y, box.w, box.h, r);
      else ctx.rect(originX + box.x, originY + box.y, box.w, box.h);
      ctx.fill();
      ctx.restore();
    });
    boxes.forEach((box) => {
      ctx.shadowColor = box.hot ? 'transparent' : 'rgba(0, 0, 0, 0.72)';
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = box.hot ? 0 : shadow.y;
      ctx.shadowBlur = box.hot ? 0 : shadow.blur;
      ctx.fillStyle = fill;
      ctx.fillText(box.text, originX + box.x + box.w / 2, originY + box.y + box.h / 2);
    });
    const hostCx = originX + host.width / 2;
    const hostCy = originY + host.height / 2;
    return {
      canvas: canvas,
      x: Math.round((Number(style.x) / 100) * width - hostCx),
      y: Math.round((Number(style.y) / 100) * height - hostCy),
    };
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const comma = text.indexOf(',');
        resolve(comma === -1 ? text : text.slice(comma + 1));
      };
      reader.onerror = () => reject(new Error('read'));
      reader.readAsDataURL(blob);
    });
  }

  async function buildCaptionSheet(width, height) {
    const groups = new Map();
    captionFrames().forEach((frame) => {
      const key = JSON.stringify(frame.parts);
      if (!groups.has(key)) groups.set(key, { parts: frame.parts, ranges: [] });
      groups.get(key).ranges.push({ start: round3(frame.start), end: round3(frame.end) });
    });
    const family = FONT_FAMILY[style.font] || 'Vazirmatn';
    try {
      await document.fonts.load(style.size + 'px "' + family + '"');
    } catch (err) {}
    const overlays = [];
    for (const group of groups.values()) {
      const painted = paintCaption(group.parts, width, height);
      if (!painted) continue;
      const blob = await new Promise((resolve) => painted.canvas.toBlob(resolve, 'image/png'));
      if (!blob) continue;
      overlays.push({
        x: painted.x,
        y: painted.y,
        png: await blobToBase64(blob),
        ranges: group.ranges,
      });
    }
    return overlays;
  }

  async function measureMetrics() {
    const family = FONT_FAMILY[style.font] || 'Vazirmatn';
    const spec = style.size + 'px "' + family + '"';
    try {
      await document.fonts.load(spec);
    } catch (err) {}
    const probe = document.createElement('div');
    probe.className = 'caption is-line font-' + (style.font || 'vazir');
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    probe.style.top = '0';
    probe.style.fontSize = style.size + 'px';
    probe.style.letterSpacing = (Number(style.letterSpacing) || 0) + 'px';
    probe.style.lineHeight = String((style.lineHeight || 130) / 100);
    probe.style.whiteSpace = 'nowrap';
    document.body.appendChild(probe);
    const widths = words.map((word) => {
      const span = document.createElement('span');
      span.className = 'cap-word';
      span.textContent = captionText(word.text || '');
      probe.replaceChildren(span);
      return span.getBoundingClientRect().width;
    });
    probe.remove();
    return {
      space: Math.max(0, Number(style.wordSpacing) || 0),
      widths,
    };
  }

  const waveCache = new Map();

  const WAVE_RATE = 50;

  function waveFromBuffer(audioBuffer) {
    const channel = audioBuffer.getChannelData(0);
    const block = Math.max(1, Math.round(audioBuffer.sampleRate / WAVE_RATE));
    const bars = Math.ceil(channel.length / block);
    const peaks = new Array(bars);
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const end = Math.min(channel.length, (i + 1) * block);
      for (let j = i * block; j < end; j += 4) {
        const value = Math.abs(channel[j]);
        if (value > max) max = value;
      }
      peaks[i] = max;
    }
    return { rate: WAVE_RATE, peaks };
  }

  async function loadWave(file) {
    if (waveCache.has(file)) return waveCache.get(file);
    const pending = (async () => {
      const res = await fetch(
        '/api/wave?slug=' + encodeURIComponent(slug) + '&file=' + encodeURIComponent(file)
      );
      const data = await res.json().catch(() => ({}));
      let wave = null;
      if (res.ok && Array.isArray(data.peaks) && data.peaks.length) {
        wave = { rate: Number(data.rate) || WAVE_RATE, peaks: data.peaks };
      } else {
        const rawRes = await fetch(takeUrl(file));
        const raw = await rawRes.arrayBuffer();
        const audioCtx = new AudioContext();
        try {
          wave = waveFromBuffer(await audioCtx.decodeAudioData(raw));
        } finally {
          audioCtx.close();
        }
      }
      let top = 0;
      wave.peaks.forEach((peak) => {
        if (peak > top) top = peak;
      });
      wave.top = top || 1;
      return wave;
    })();
    waveCache.set(file, pending);
    pending.catch(() => waveCache.delete(file));
    return pending;
  }

  function paintWave(seg, wave, clip) {
    const width = Math.max(2, Math.round(seg.clientWidth || 2));
    const height = Math.max(8, Math.round(seg.clientHeight || 40));
    const canvas = document.createElement('canvas');
    canvas.className = 'tl-wave';
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const from = clip.srcIn * wave.rate;
    const span = Math.max(1, clip.srcSpan * wave.rate);
    const peakAt = (x) => {
      const a = Math.floor(from + (x / width) * span);
      const b = Math.max(a + 1, Math.floor(from + ((x + 1) / width) * span));
      let max = 0;
      for (let i = a; i < b && i < wave.peaks.length; i++) {
        if (i >= 0 && wave.peaks[i] > max) max = wave.peaks[i];
      }
      return Math.sqrt(Math.min(1, max / wave.top));
    };
    const floor = height - 1;
    const room = height - 4;
    ctx.beginPath();
    ctx.moveTo(0, floor);
    for (let x = 0; x < width; x++) ctx.lineTo(x + 0.5, floor - Math.max(1, peakAt(x) * room));
    ctx.lineTo(width, floor);
    ctx.closePath();
    ctx.fillStyle = '#3ddc6a';
    ctx.fill();
    seg.querySelector('.tl-wave')?.remove();
    seg.insertBefore(canvas, seg.firstChild);
  }

  async function attachWave(seg, clip) {
    seg.style.backgroundColor = '#102418';
    try {
      const wave = await loadWave(clip.file);
      if (!seg.isConnected) return;
      requestAnimationFrame(() => {
        if (seg.isConnected) paintWave(seg, wave, clip);
      });
    } catch (err) {
      seg.title = 'موج صدا ساخته نشد';
    }
  }

  function attachThumb(seg, clip, lane) {
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
        const sw = probe.videoWidth;
        const sh = probe.videoHeight;
        let sx = 0;
        let sy = 0;
        let sww = sw;
        let shh = sh;
        if (lane && lane.kind === 'band' && Number(lane.bands) > 1) {
          const bands = Number(lane.bands);
          const band = Math.max(0, Math.min(bands - 1, Number(lane.band) || 0));
          sy = Math.round((band * sh) / bands);
          shh = Math.max(1, Math.round(((band + 1) * sh) / bands) - sy);
        }
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 72;
        canvas.getContext('2d').drawImage(probe, sx, sy, sww, shh, 0, 0, canvas.width, canvas.height);
        seg.style.backgroundImage = 'url("' + canvas.toDataURL('image/jpeg', 0.72) + '")';
      } catch (err) {}
      finish();
    };
    probe.addEventListener('loadeddata', () => {
      if (!(probe.videoWidth > 2)) {
        seg.classList.add('tl-seg-novideo');
        const note = document.createElement('span');
        note.className = 'tl-seg-tag';
        note.textContent = 'بدون تصویر';
        seg.appendChild(note);
        finish();
        return;
      }
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
    let data = res.ok ? await res.json().catch(() => ({})) : {};
    const needsAudio =
      !force &&
      res.ok &&
      !data.audioMigrated &&
      (!Array.isArray(data.lanes) ||
        !data.lanes.some((lane) => lane && lane.kind === 'audio') ||
        !Array.isArray(data.clips) ||
        !data.clips.some((clip) => clip && clip.lane === 'audio'));
    if (force || res.status === 404 || needsAudio) {
      const durations = await measureDurations();
      res = await fetch('/api/captions/build?slug=' + encodeURIComponent(slug) + (force ? '&force=1' : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ durations: durations || {} }),
      });
      data = await res.json().catch(() => ({}));
    }
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
    rememberBaseline();
    undoStack = [];
    redoStack = [];
    updateHistoryButtons();
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
    scheduleSave('style');
  });
  sizeInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave('style');
  });
  wordSpaceInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave('style');
  });
  letterSpaceInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave('style');
  });
  lineHeightInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave('style');
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
    scheduleSave('style');
  });
  opacityInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave('style');
  });
  textOpacityInput.addEventListener('input', () => {
    readForm();
    renderCaption();
    scheduleSave('style');
  });
  wordInput.addEventListener('change', () => {
    readForm();
    renderCaption();
    scheduleSave();
  });
  function fileExt(file) {
    const name = String((file && file.name) || '').toLowerCase();
    const match = /\.([a-z0-9]+)$/.exec(name);
    return match ? match[1] : '';
  }

  function isAudioFileExt(ext) {
    return ext === 'mp3' || ext === 'wav' || ext === 'm4a' || ext === 'aac' || ext === 'ogg';
  }

  function isVideoFileExt(ext) {
    return ext === 'mp4' || ext === 'mov' || ext === 'webm';
  }

  async function postAttach(file, ext, split) {
    const query =
      '/api/attach?slug=' +
      encodeURIComponent(slug) +
      '&ext=' +
      encodeURIComponent(ext) +
      (split ? '&split=1' : '');
    const res = await fetch(query, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.file) throw new Error(data.error || 'فایل اضافه نشد');
    return data;
  }

  function pushClip(file, laneId, start, dur, volume) {
    clips.push({
      file: file,
      paragraph: clips[0] ? clips[0].paragraph : 0,
      start: round3(start),
      duration: round3(dur),
      srcIn: 0,
      srcSpan: round3(dur),
      speed: 1,
      volume: volume,
      camera: laneId,
      lane: laneId,
    });
  }

  async function addAttachedLine(file) {
    const ext = fileExt(file);
    if (!isVideoFileExt(ext)) {
      setStatus('برای خط جدید فقط mp4 یا webm یا mov');
      return;
    }
    setStatus('داره ویدیو اضافه می‌شه');
    try {
      const data = await postAttach(file, ext, false);
      let answer = 'none';
      if (data.hasAudio) {
        answer = await askSplit();
        if (!answer) {
          setStatus('ویدیو اضافه نشد');
          return;
        }
      }
      let split = null;
      if (answer === 'yes') {
        setStatus('داره صدای ویدیو جدا می‌شه');
        split = await postAttachSplit(data.file);
      }
      ensureLaneClips();
      const id = 'file-' + String(data.file).replace(/[^a-z0-9]/gi, '').slice(0, 18);
      const label = String(file.name || 'فایل').replace(/\.[^.]+$/, '').slice(0, 40) || 'فایل';
      const withAudio = answer === 'no';
      lanes.push({ id: id, label: label, kind: 'file', band: 0, bands: 1, file: data.file, withAudio: withAudio });
      let dur = Number(data.duration) || 0;
      if (!(dur > 0.05)) dur = await measureFile(data.file);
      if (!(dur > 0.05)) dur = 1;
      pushClip(data.file, id, 0, dur, withAudio ? 1 : 0);
      if (split && split.audioFile) {
        let audioDur = Number(split.audioDuration) || 0;
        if (!(audioDur > 0.05)) audioDur = await measureFile(split.audioFile);
        if (!(audioDur > 0.05)) audioDur = dur;
        const target = freeAudioLane(0, audioDur, label);
        pushClip(split.audioFile, target.id, 0, audioDur, 1);
      }
      refreshDuration();
      renderVideoLane();
      syncMixMode();
      paintMix();
      scheduleSave();
      if (answer === 'yes') setStatus('ویدیو و صداش روی دو خط جدا اومد');
      else if (answer === 'no') setStatus('ویدیو با صداش روی یه خط اومد');
      else setStatus('خط جدید اضافه شد');
    } catch (err) {
      setStatus(err.message || 'ویدیو اضافه نشد');
    }
  }

  async function postAttachSplit(file) {
    const res = await fetch(
      '/api/attach-split?slug=' + encodeURIComponent(slug) + '&file=' + encodeURIComponent(file),
      { method: 'POST' }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.audioFile) throw new Error(data.error || 'صدای ویدیو جدا نشد');
    return data;
  }

  // An audio lane plays one clip at a time, so a split sound that would sit on
  // top of the microphone gets its own audio lane.
  function freeAudioLane(start, dur, label) {
    const end = start + dur;
    const busy = (lane) =>
      clips.some((clip) => clip.lane === lane.id && clip.start < end - 0.02 && clip.start + clip.duration > start + 0.02);
    const open = lanes.find((lane) => lane.kind === 'audio' && !busy(lane));
    if (open) return open;
    if (countLanesByKind('audio') >= LANE_LIMIT) return audioLane() || lanes.find((lane) => lane.kind === 'audio');
    const lane = { id: 'audio-' + Date.now().toString(36), label: 'صدای ' + label, kind: 'audio', band: 0, bands: 1, file: '' };
    lanes.push(lane);
    return lane;
  }

  const splitAsk = document.getElementById('split-ask');
  function askSplit() {
    if (!splitAsk) return Promise.resolve(window.confirm('لاین صدا جدا بشه؟') ? 'yes' : 'no');
    return new Promise((resolve) => {
      splitAsk.hidden = false;
      const first = splitAsk.querySelector('[data-split-answer="yes"]');
      if (first) first.focus();
      function finish(answer) {
        splitAsk.hidden = true;
        splitAsk.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        resolve(answer);
      }
      function onClick(event) {
        const btn = event.target && event.target.closest ? event.target.closest('[data-split-answer]') : null;
        if (btn) {
          const value = btn.getAttribute('data-split-answer');
          finish(value === 'yes' || value === 'no' ? value : null);
        } else if (event.target === splitAsk) {
          finish(null);
        }
      }
      function onKey(event) {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      }
      splitAsk.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey, true);
    });
  }

  async function addToAudioLane(file, laneId) {
    const ext = fileExt(file);
    if (!isAudioFileExt(ext) && !isVideoFileExt(ext)) {
      setStatus('برای لاین صدا mp3 یا wav یا m4a یا aac یا ogg یا mp4 یا webm یا mov');
      return;
    }
    ensureLaneClips();
    const lane = (laneId && laneById(laneId)) || audioLane();
    if (!lane || lane.kind !== 'audio') {
      setStatus('لاین صدا پیدا نشد');
      return;
    }
    setStatus('داره به لاین صدا اضافه می‌شه');
    try {
      const split = isVideoFileExt(ext);
      const data = await postAttach(file, ext, split);
      let audioFile = data.file;
      let dur = Number(data.duration) || 0;
      if (split && data.audioFile) {
        audioFile = data.audioFile;
        dur = Number(data.audioDuration) || dur;
        const videoId = 'file-' + String(data.file).replace(/[^a-z0-9]/gi, '').slice(0, 18);
        const label = String(file.name || 'ویدیو').replace(/\.[^.]+$/, '').slice(0, 40) || 'ویدیو';
        lanes.push({ id: videoId, label: label, kind: 'file', band: 0, bands: 1, file: data.file });
        let videoDur = Number(data.duration) || 0;
        if (!(videoDur > 0.05)) videoDur = await measureFile(data.file);
        if (!(videoDur > 0.05)) videoDur = 1;
        pushClip(data.file, videoId, time, videoDur, 0);
      } else if (split && !data.audioFile) {
        setStatus('این ویدیو صدا ندارد');
        return;
      }
      if (!(dur > 0.05)) dur = await measureFile(audioFile);
      if (!(dur > 0.05)) dur = 1;
      pushClip(audioFile, lane.id, time, dur, 1);
      refreshDuration();
      renderVideoLane();
      syncMixMode();
      paintMix();
      scheduleSave();
      setStatus(split ? 'صدا و ویدیو جدا شد' : 'به لاین صدا اضافه شد');
    } catch (err) {
      setStatus(err.message || 'به لاین صدا اضافه نشد');
    }
  }

  function bindAudioLaneDrop(lane) {
    const laneId = lane.getAttribute('data-lane') || '';
    lane.addEventListener('dragover', (event) => {
      event.preventDefault();
      lane.classList.add('tl-drop-on');
    });
    lane.addEventListener('dragleave', () => {
      lane.classList.remove('tl-drop-on');
    });
    lane.addEventListener('drop', (event) => {
      event.preventDefault();
      lane.classList.remove('tl-drop-on');
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) addToAudioLane(file, laneId);
    });
    lane.addEventListener('dblclick', () => {
      if (!attachInput) return;
      attachInput.accept =
        'audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,video/mp4,video/webm,video/quicktime,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.webm,.mov';
      attachInput.dataset.target = 'audio';
      attachInput.dataset.laneId = laneId;
      attachInput.click();
    });
  }

  function hideAddMenu() {
    if (addMenu) addMenu.hidden = true;
  }

  function addEmptyLane(kind) {
    ensureLaneClips();
    const bucket = kind === 'audio' ? 'audio' : kind === 'text' ? 'text' : 'video';
    if (countLanesByKind(bucket) >= LANE_LIMIT) {
      setStatus('بیشتر از ' + faNum(LANE_LIMIT) + ' لاین از این نوع نمی‌شه');
      return;
    }
    if (kind === 'text') {
      textLaneVisible = true;
      if (!lanes.some((lane) => lane.kind === 'text')) {
        const id = 'text-' + Date.now().toString(36);
        lanes.push({ id: id, label: 'متن', kind: 'text', band: 0, bands: 1, file: '', weight: 1, panY: 0.5 });
      }
      selectedLaneId = '__words__';
      picked.kind = '';
      picked.index = -1;
      renderWordLane();
      renderVideoLane();
      showPicked();
      scheduleSave();
      setStatus('لاین متن اضافه شد');
      return;
    }
    if (kind === 'audio') {
      const id = 'audio-' + Date.now().toString(36);
      lanes.push({ id: id, label: 'صدا', kind: 'audio', band: 0, bands: 1, file: '' });
      renderVideoLane();
      scheduleSave();
      setStatus('لاین صدا اضافه شد؛ فایل را روی آن رها کن یا دابل‌کلیک کن');
      return;
    }
    attachInput.accept = 'video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp,.mp4,.webm,.mov,.jpg,.jpeg,.png,.webp';
    attachInput.dataset.target = 'video';
    attachInput.click();
  }

  zoomInput.addEventListener('input', placeTimeline);
  if (previewZoomInput) {
    previewZoomInput.addEventListener('input', () => {
      const raw = Number(previewZoomInput.value) || 100;
      previewZoom = Math.min(3, Math.max(1, raw / 100));
      applyPreviewZoom();
      renderCaption();
    });
  }
  if (deleteLineBtn) deleteLineBtn.addEventListener('click', deleteLane);
  if (addLineBtn) {
    addLineBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!addMenu) {
        addEmptyLane('video');
        return;
      }
      addMenu.hidden = !addMenu.hidden;
    });
  }
  if (addMenu) {
    addMenu.addEventListener('click', (event) => {
      const btn = event.target && event.target.closest ? event.target.closest('[data-lane-kind]') : null;
      if (!btn) return;
      hideAddMenu();
      addEmptyLane(btn.getAttribute('data-lane-kind') || 'video');
    });
  }
  document.addEventListener('click', (event) => {
    if (!addMenu || addMenu.hidden) return;
    if (event.target === addLineBtn || (addLineBtn && addLineBtn.contains(event.target))) return;
    if (addMenu.contains(event.target)) return;
    hideAddMenu();
  });
  if (attachInput) {
    attachInput.addEventListener('change', () => {
      const file = attachInput.files && attachInput.files[0];
      const target = attachInput.dataset.target || 'video';
      const laneId = attachInput.dataset.laneId || '';
      attachInput.value = '';
      attachInput.dataset.target = 'video';
      attachInput.dataset.laneId = '';
      if (!file) return;
      if (target === 'audio') addToAudioLane(file, laneId);
      else addAttachedLine(file);
    });
  }
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
      const size = outputSize();
      if (size.width < 2 || size.height < 2) {
        setStatus('اندازه‌ی ویدیو هنوز معلوم نیست');
        return;
      }
      const overlays = await buildCaptionSheet(size.width, size.height);
      if (!overlays.length) {
        setStatus('زیرنویسی برای نوشتن نیست');
        return;
      }
      const res = await fetch('/api/captions/render?slug=' + encodeURIComponent(slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ overlays: overlays }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || 'ساخت ویدیو نشد');
        return;
      }
      showExport(data.file || '');
      fetch('/api/open-export?slug=' + encodeURIComponent(slug), { method: 'POST' }).catch(() => {});
      setStatus('فایل ساخته شد. پوشه‌اش باز شد و پایین صفحه هم پخش می‌شود.');
    } catch (err) {
      setStatus('ساخت ویدیو نشد');
    } finally {
      renderBtn.disabled = false;
    }
  });

  video.addEventListener('timeupdate', () => {
    if (multiView()) return;
    if (!playing || !clockLive) return;
    const current = clips[activeIndex];
    if (!current || video.dataset.file !== current.file || isAudioClip(current)) return;
    const speed = current.speed || 1;
    const local = (video.currentTime - (current.srcIn || 0)) / speed;
    if (local >= current.duration - 0.04) {
      const videoClips = clips.filter((clip) => !isAudioClip(clip));
      const pos = videoClips.indexOf(current);
      if (pos >= 0 && pos < videoClips.length - 1) {
        seekTo(videoClips[pos + 1].start + 0.02, true);
        return;
      }
      playing = false;
      video.pause();
      pauseLaneVideos();
      time = Math.max(0, duration - 0.01);
      renderCaption();
      placeTimeline();
      updateClock();
      return;
    }
    time = current.start + Math.max(0, local);
    syncAudioLane(false);
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
    if (!clipHasSound(clip)) return;
    clip.volume = Number(volumeInput.value) / 100;
    volumeOut.textContent = faNum(volumeInput.value);
    syncMuteIcon(clip.volume < 0.01);
    syncAudioLane(false);
    refreshClipTag(picked.index);
    scheduleSave('volume');
  });
  muteBtn.addEventListener('click', () => {
    if (picked.kind !== 'clip' || !clips[picked.index]) return;
    const clip = clips[picked.index];
    if (!clipHasSound(clip)) return;
    clip.volume = (clip.volume || 0) < 0.01 ? 1 : 0;
    showPicked();
    syncAudioLane(false);
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
    if (!textLaneVisible) {
      textLaneVisible = true;
      renderWordLane();
      renderVideoLane();
    }
    if (!words.length) addWord(0);
    else if (picked.kind === 'word') addWord(picked.index);
    else addWord(Math.max(0, words.length - 1));
  });
  if (addPauseBtn) {
    addPauseBtn.addEventListener('click', () => {
      if (!textLaneVisible) {
        textLaneVisible = true;
        renderWordLane();
        renderVideoLane();
      }
      if (!words.length) addPause(0);
      else if (picked.kind === 'word') addPause(picked.index);
      else addPause(Math.max(0, words.length - 1));
    });
  }
  if (addBlankBtn) {
    addBlankBtn.addEventListener('click', () => {
      if (!textLaneVisible) {
        textLaneVisible = true;
        renderWordLane();
        renderVideoLane();
      }
      if (!words.length) addBlank(0);
      else if (picked.kind === 'word') addBlank(picked.index);
      else addBlank(Math.max(0, words.length - 1));
    });
  }
  deleteWordBtn.addEventListener('click', () => {
    if (picked.kind === 'word') deleteWord(picked.index);
  });

  function setCaptionSize(next) {
    const size = Math.round(Math.min(120, Math.max(8, next)));
    style.size = size;
    sizeInput.value = String(size);
    sizeOut.textContent = faNum(size);
    renderCaption();
  }

  function bindCaptionHandle(handle) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const kind = handle.dataset.handle || '';
      const rect = frame.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const box = capLayer.getBoundingClientRect();
      const startSize = style.size;
      const startX = style.x;
      const startY = style.y;
      const startW = Math.max(8, box.width);
      const startH = Math.max(8, box.height);
      const leftPct = ((box.left - rect.left) / rect.width) * 100;
      const rightPct = ((box.right - rect.left) / rect.width) * 100;
      const topPct = ((box.top - rect.top) / rect.height) * 100;
      const bottomPct = ((box.bottom - rect.top) / rect.height) * 100;
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const affectX = kind.indexOf('e') !== -1 || kind.indexOf('w') !== -1;
      const affectY = kind.indexOf('n') !== -1 || kind.indexOf('s') !== -1;
      function move(ev) {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        let scaleX = 1;
        let scaleY = 1;
        if (affectX) {
          if (kind.indexOf('e') !== -1) scaleX = Math.max(0.2, (startW + dx) / startW);
          else if (kind.indexOf('w') !== -1) scaleX = Math.max(0.2, (startW - dx) / startW);
        }
        if (affectY) {
          if (kind.indexOf('s') !== -1) scaleY = Math.max(0.2, (startH + dy) / startH);
          else if (kind.indexOf('n') !== -1) scaleY = Math.max(0.2, (startH - dy) / startH);
        }
        let scale = 1;
        if (affectX && affectY) scale = (scaleX + scaleY) / 2;
        else if (affectX) scale = scaleX;
        else if (affectY) scale = scaleY;
        const nextSize = Math.round(Math.min(120, Math.max(8, startSize * scale)));
        const used = nextSize / startSize;
        setCaptionSize(nextSize);
        let nextX = startX;
        let nextY = startY;
        if (kind.indexOf('e') !== -1) nextX = leftPct + ((rightPct - leftPct) * used) / 2;
        else if (kind.indexOf('w') !== -1) nextX = rightPct - ((rightPct - leftPct) * used) / 2;
        if (kind.indexOf('s') !== -1) nextY = topPct + ((bottomPct - topPct) * used) / 2;
        else if (kind.indexOf('n') !== -1) nextY = bottomPct - ((bottomPct - topPct) * used) / 2;
        style.x = round3(Math.min(100, Math.max(0, nextX)));
        style.y = round3(Math.min(100, Math.max(0, nextY)));
        renderCaption();
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        scheduleSave();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  document.querySelectorAll('.cap-handle').forEach(bindCaptionHandle);

  if (undoBtn) undoBtn.addEventListener('click', () => undoEdit());
  if (redoBtn) redoBtn.addEventListener('click', () => redoEdit());

  if (capLayer) {
    capLayer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest && event.target.closest('.cap-handle')) return;
      draggingCaption = true;
      try {
        capLayer.setPointerCapture(event.pointerId);
      } catch (err) {}
      function move(ev) {
        const rect = frame.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = ((ev.clientX - rect.left) / rect.width) * 100;
        const y = ((ev.clientY - rect.top) / rect.height) * 100;
        style.x = round3(Math.min(100, Math.max(0, x)));
        style.y = round3(Math.min(100, Math.max(0, y)));
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
  }

  document.addEventListener('keydown', (event) => {
    const tag = event.target && event.target.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = event.ctrlKey || event.metaKey;
    if (mod && (event.key === 's' || event.key === 'S')) {
      event.preventDefault();
      if (ready) flushSave();
      return;
    }
    if (mod && (event.key === 'z' || event.key === 'Z')) {
      if (inField) return;
      event.preventDefault();
      if (event.shiftKey) redoEdit();
      else undoEdit();
      return;
    }
    if (mod && (event.key === 'y' || event.key === 'Y')) {
      if (inField) return;
      event.preventDefault();
      redoEdit();
      return;
    }
    if (inField) return;
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
    applyPreviewZoom();
    renderCaption();
  });

  loadDoc(false).catch(() => setStatus('زیرنویس باز نشد'));
})();
