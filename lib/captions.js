'use strict';

const fs = require('fs');
const path = require('path');

const PAUSE_MARK = '⏸';
const LINE_MAX_WORDS = 7;
const LINE_MAX_CHARS = 32;
const FONTS = [
  'vazir',
  'yekan',
  'titr',
  'lalezar',
  'nastaliq',
  'ordibehesht',
  'dastnevis',
  'iransans',
  'peyda',
  'ravi',
];

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function spokenWords(text) {
  return String(text || '')
    .replace(/\*\*/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^\[([1-6])\]/, ''))
    .filter((word) => word && word !== PAUSE_MARK);
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

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value) : fallback;
}

function clampStyle(input) {
  const base = defaultStyle();
  const style = input || {};
  return {
    color: clampColor(style.color, base.color),
    size: Math.round(clampNumber(style.size, 8, 120, base.size)),
    font: FONTS.indexOf(style.font) === -1 ? base.font : style.font,
    highlight: !!style.highlight,
    highlightColor: clampColor(style.highlightColor, base.highlightColor),
    highlightOpacity: Math.round(clampNumber(style.highlightOpacity, 0, 100, base.highlightOpacity)),
    textOpacity: Math.round(clampNumber(style.textOpacity, 0, 100, base.textOpacity)),
    wordSpacing: Math.round(clampNumber(style.wordSpacing, 0, 40, base.wordSpacing)),
    letterSpacing: Math.round(clampNumber(style.letterSpacing, 0, 20, base.letterSpacing)),
    lineHeight: Math.round(clampNumber(style.lineHeight, 100, 220, base.lineHeight)),
    wordByWord: !!style.wordByWord,
    x: round3(clampNumber(style.x, 0, 100, base.x)),
    y: round3(clampNumber(style.y, 0, 100, base.y)),
  };
}

function findClip(clips, paragraph, start) {
  const list = [];
  (Array.isArray(clips) ? clips : []).forEach((clip) => {
    if (Number(clip.paragraph) !== Number(paragraph)) return;
    // Prefer video clips over audio-lane companions for caption timing.
    if (clip.lane === 'audio') return;
    list.push(clip);
  });
  if (!list.length) {
    (Array.isArray(clips) ? clips : []).forEach((clip) => {
      if (Number(clip.paragraph) === Number(paragraph)) list.push(clip);
    });
  }
  if (!list.length) return null;
  for (let i = 0; i < list.length; i++) {
    const clip = list[i];
    const end = clip.start + clip.duration;
    if (start >= clip.start - 0.001 && start < end - 0.001) return clip;
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

function recomputeEnds(words, clips) {
  const groups = (Array.isArray(clips) ? clips : []).map(() => []);
  (Array.isArray(words) ? words : []).forEach((word) => {
    const clip = findClip(clips, word.paragraph, word.start);
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
  return words;
}

function buildWordsForClips(clips) {
  const words = [];
  clips.forEach((clip) => {
    const parts = spokenWords(clip.text);
    if (!parts.length || !(clip.duration > 0)) return;
    const pad = Math.min(0.12, clip.duration * 0.04);
    const span = Math.max(0.05, clip.duration - pad * 2);
    const step = span / parts.length;
    parts.forEach((text, i) => {
      words.push({
        text,
        start: round3(clip.start + pad + i * step),
        paragraph: Number(clip.paragraph),
      });
    });
  });
  recomputeEnds(words, clips);
  words.forEach((word) => {
    word.start = round3(word.start);
    word.end = round3(word.end);
  });
  return words;
}

function sanitizeWords(words, clips) {
  const clean = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const paragraph = Number(word && word.paragraph);
    const probe = Number(word && word.start);
    const clip = findClip(clips, paragraph, Number.isFinite(probe) ? probe : 0);
    if (!clip) return;
    const raw = String((word && word.text) || '')
      .replace(/\*\*/g, '')
      .replace(/^\[([1-6])\]/, '')
      .replace(/\s+/g, ' ')
      .trim();
    const isPause = !!(word && word.pause) || raw === PAUSE_MARK || raw === '' || raw === '·';
    if (!isPause && !raw) return;
    const text = isPause ? '' : raw;
    let start = Number(word.start);
    if (!Number.isFinite(start)) return;
    const min = clip.start;
    const max = clip.start + clip.duration - 0.05;
    if (!(max > min)) start = min;
    else start = Math.min(max, Math.max(min, start));
    const next = { text, start: round3(start), paragraph };
    if (isPause) next.pause = true;
    clean.push(next);
  });
  clean.sort((a, b) => a.start - b.start || a.paragraph - b.paragraph);
  const last = new Map();
  clean.forEach((word) => {
    const clip = findClip(clips, word.paragraph, word.start);
    if (!clip) return;
    const prev = last.get(word.paragraph);
    if (prev != null && word.start < prev + 0.05) word.start = round3(prev + 0.05);
    const max = clip.start + clip.duration - 0.05;
    if (word.start > max) word.start = round3(Math.max(clip.start, max));
    last.set(word.paragraph, word.start);
  });
  recomputeEnds(clean, clips);
  clean.forEach((word) => {
    word.start = round3(word.start);
    word.end = round3(word.end);
  });
  return clean;
}

function groupLines(words) {
  const groups = [];
  let current = [];
  let chars = 0;
  words.forEach((word) => {
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

function pickDuration(stored, hinted) {
  const hint = Number(hinted);
  if (hint > 0.05 && hint < 60 * 60) return hint;
  const saved = Number(stored);
  if (saved > 0.05 && saved < 60 * 60) return saved;
  return 0;
}

function applyDurations(clips, updates) {
  const durations = new Map();
  (Array.isArray(updates) ? updates : []).forEach((clip) => {
    const file = String((clip && clip.file) || '');
    const duration = Number(clip && clip.duration);
    if (file && duration > 0.05 && duration < 60 * 60) durations.set(file, duration);
  });
  let cursor = 0;
  return (Array.isArray(clips) ? clips : []).map((clip) => {
    const duration = durations.has(clip.file) ? durations.get(clip.file) : Number(clip.duration) || 0;
    const next = {
      file: clip.file,
      paragraph: Number(clip.paragraph),
      start: round3(cursor),
      duration: round3(Math.max(0, duration)),
    };
    cursor += next.duration;
    return next;
  });
}

function estimateWidth(text, fontSize) {
  let units = 0;
  const value = String(text || '');
  for (let i = 0; i < value.length; i++) {
    units += value.charCodeAt(i) < 128 ? 0.55 : 0.58;
  }
  return Math.max(fontSize * 0.45, units * fontSize);
}

function metricsFor(words, metrics, fontSize) {
  const raw = metrics && Array.isArray(metrics.widths) ? metrics.widths : [];
  const spaceGiven = Number(metrics && metrics.space);
  const space = spaceGiven > 0 && spaceGiven < fontSize * 2 ? spaceGiven : fontSize * 0.28;
  const widths = new Map();
  words.forEach((word, index) => {
    const given = Number(raw[index]);
    widths.set(word, given > 1 && given < fontSize * 30 ? given : estimateWidth(word.text, fontSize));
  });
  return { space, widths };
}

function centersFromRight(widths, space) {
  const gaps = Math.max(0, widths.length - 1);
  const total = widths.reduce((sum, width) => sum + width, 0) + space * gaps;
  const centers = [];
  let edge = total / 2;
  for (let i = 0; i < widths.length; i++) {
    centers.push(edge - widths[i] / 2);
    edge -= widths[i] + space;
  }
  return centers;
}

function cuesFromWords(words, wordByWord) {
  const list = Array.isArray(words) ? words : [];
  if (wordByWord) {
    return list.map((word) => ({
      start: word.start,
      end: word.end,
      text: word.text,
    }));
  }
  return groupLines(list).map((group) => ({
    start: group[0].start,
    end: group[group.length - 1].end,
    text: group.map((word) => word.text).join(' '),
  }));
}

function assEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, ' ');
}

function assTime(seconds) {
  const t = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.min(99, Math.floor((t - Math.floor(t)) * 100));
  const pad = (n) => String(n).padStart(2, '0');
  return h + ':' + pad(m) + ':' + pad(s) + '.' + pad(cs);
}

function hexToAss(hex, opacityPercent) {
  const value = clampColor(hex, '#ffffff').slice(1);
  const opacity = clampNumber(opacityPercent, 0, 100, 100);
  const alpha = Math.round((1 - opacity / 100) * 255);
  const aa = alpha.toString(16).padStart(2, '0');
  const rr = value.slice(0, 2);
  const gg = value.slice(2, 4);
  const bb = value.slice(4, 6);
  return ('&H' + aa + bb + gg + rr + '&').toUpperCase();
}

function assStyle(name, fontName, style, borderStyle, outline, shadow, outlineColour, backColour) {
  const spacing = Math.round(Number(style.letterSpacing) || 0);
  return (
    'Style: ' +
    name +
    ',' +
    fontName +
    ',' +
    style.size +
    ',' +
    hexToAss(style.color, style.textOpacity) +
    ',&H000000FF&,' +
    outlineColour +
    ',' +
    backColour +
    ',0,0,0,0,100,100,' +
    spacing +
    ',0,' +
    borderStyle +
    ',' +
    outline +
    ',' +
    shadow +
    ',5,20,20,20,1'
  );
}

function pushDialogue(lines, layer, start, end, styleName, x, y, text) {
  const stop = end < start + 0.04 ? start + 0.04 : end;
  const body = '\u202B' + assEscape(text) + '\u202C';
  lines.push(
    'Dialogue: ' +
      layer +
      ',' +
      assTime(start) +
      ',' +
      assTime(stop) +
      ',' +
      styleName +
      ',,0,0,0,,{\\an5\\pos(' +
      Math.round(x) +
      ',' +
      Math.round(y) +
      ')}' +
      body
  );
}

function buildAss(doc, width, height, fontName, metrics) {
  const style = clampStyle(doc.style);
  const words = Array.isArray(doc.words) ? doc.words : [];
  const boxColour = hexToAss(style.highlightColor, style.highlight ? style.highlightOpacity : 0);
  const pad = Math.max(4, Math.round(style.size * 0.12));
  const x = (style.x / 100) * width;
  const y = (style.y / 100) * height;
  const fitted = metricsFor(words, metrics, style.size);
  // 0 means words touch. Extra value is gap in PlayRes pixels between words.
  const wordGap = Math.max(0, Number(style.wordSpacing) || 0);
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: ' + width,
    'PlayResY: ' + height,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    assStyle('Plain', fontName, style, 1, 2, 1, '&H00000000&', '&H64000000&'),
    assStyle('Hot', fontName, style, 3, pad, 0, boxColour, boxColour),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  if (style.wordByWord) {
    words.forEach((word) => {
      if (!(word.end > word.start) || !word.text) return;
      pushDialogue(lines, style.highlight ? 1 : 0, word.start, word.end, style.highlight ? 'Hot' : 'Plain', x, y, word.text);
    });
  } else {
    // Same layout as the editor preview: place each word, gap = wordSpacing.
    groupLines(words).forEach((group) => {
      const centers = centersFromRight(
        group.map((word) => fitted.widths.get(word)),
        wordGap
      );
      const start = group[0].start;
      const end = group[group.length - 1].end;
      if (!(end > start)) return;
      if (style.highlight) {
        group.forEach((active, activeIndex) => {
          if (!(active.end > active.start)) return;
          group.forEach((word, index) => {
            const hot = index === activeIndex;
            pushDialogue(
              lines,
              hot ? 1 : 0,
              active.start,
              active.end,
              hot ? 'Hot' : 'Plain',
              x + centers[index],
              y,
              word.text
            );
          });
        });
      } else {
        group.forEach((word, index) => {
          pushDialogue(lines, 0, start, end, 'Plain', x + centers[index], y, word.text);
        });
      }
    });
  }
  lines.push('');
  return lines.join('\n');
}

function ffmpegFilterPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function evenDim(n) {
  const value = Math.max(2, Math.round(Number(n) || 0));
  return value % 2 === 0 ? value : value - 1;
}

function clampSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n === 3 || n === 4 || n === 5 || n === 10) return n;
  return Math.round(clampNumber(n, 0.5, 2, 1) * 100) / 100;
}

function clampVolume(value) {
  return round3(clampNumber(value, 0, 2, 1));
}

function sourceLimit(clips) {
  const limits = new Map();
  (Array.isArray(clips) ? clips : []).forEach((clip) => {
    const file = String(clip.file || '');
    if (!file) return;
    const speed = clampSpeed(clip.speed);
    const srcIn = Math.max(0, Number(clip.srcIn) || 0);
    const srcSpan = Number(clip.srcSpan) > 0 ? Number(clip.srcSpan) : Math.max(0, Number(clip.duration) || 0) * speed;
    limits.set(file, Math.max(limits.get(file) || 0, srcIn + srcSpan));
  });
  return limits;
}

function normalizeSavedClips(existing, incoming, extraFiles) {
  const base = Array.isArray(existing) ? existing : [];
  const list = Array.isArray(incoming) ? incoming : [];
  const known = new Set(base.map((clip) => String(clip.file || '')));
  (Array.isArray(extraFiles) ? extraFiles : []).forEach((file) => known.add(String(file || '')));
  const touched = list.some(
    (clip) => clip && (clip.srcIn != null || clip.srcSpan != null || clip.speed != null || clip.volume != null)
  );
  if (!touched) return applyDurations(base, list);
  const limits = sourceLimit(base);
  const usable = list.filter((clip) => known.has(String(clip && clip.file || '')));
  if (!usable.length) return applyDurations(base, []);
  const multi = usable.some((clip) => clip && clip.lane);
  let cursor = 0;
  return usable.map((clip) => {
    const file = String(clip.file);
    const speed = clampSpeed(clip.speed);
    const volume = clampVolume(clip.volume);
    const limit = limits.get(file) || 0;
    let srcIn = Math.max(0, Number(clip.srcIn) || 0);
    let srcSpan = Number(clip.srcSpan);
    if (!(srcSpan > 0.04)) {
      const timeline = Number(clip.duration);
      srcSpan = (timeline > 0.04 ? timeline : 0.05) * speed;
    }
    if (limit > 0 && srcIn > limit) srcIn = Math.max(0, limit - 0.05);
    if (srcIn + srcSpan > 60 * 60) srcSpan = Math.max(0.05, 60 * 60 - srcIn);
    const duration = round3(Math.max(0.05, srcSpan / speed));
    const paragraph = Number(clip.paragraph);
    const knownParagraph = base.some((item) => Number(item.paragraph) === paragraph);
    const start = multi ? round3(Math.max(0, Number(clip.start) || 0)) : round3(cursor);
    const next = {
      file,
      paragraph: knownParagraph ? paragraph : Number(base[0].paragraph),
      start,
      duration,
      srcIn: round3(srcIn),
      srcSpan: round3(srcSpan),
      speed,
      volume,
      camera: clip.camera == null || clip.camera === '' ? '0' : String(clip.camera).slice(0, 40),
    };
    if (clip.lane) next.lane = String(clip.lane).slice(0, 40);
    if (!multi) cursor += duration;
    return next;
  });
}

function sanitizeLanes(lanes) {
  if (!Array.isArray(lanes)) return [];
  const out = [];
  const seen = new Set();
  lanes.forEach((lane) => {
    if (!lane || !lane.id) return;
    const id = String(lane.id).slice(0, 40);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id)) return;
    seen.add(id);
    const kind =
      lane.kind === 'file'
        ? 'file'
        : lane.kind === 'band'
          ? 'band'
          : lane.kind === 'audio'
            ? 'audio'
            : lane.kind === 'text'
              ? 'text'
              : 'full';
    out.push({
      id,
      label: String(lane.label || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      kind,
      band: Math.max(0, Math.round(Number(lane.band) || 0)),
      bands: Math.max(1, Math.min(8, Math.round(Number(lane.bands) || 1))),
      file: kind === 'file' ? String(lane.file || '').slice(0, 80) : '',
      withAudio: kind === 'file' && !!lane.withAudio,
    });
  });
  return out.slice(0, 15);
}

function isVisualMeta(meta) {
  if (!meta) return false;
  if (meta.audioOnly) return false;
  if (meta.useAudio && meta.video === false) return false;
  if (Number(meta.laneIndex) < 0) return false;
  return true;
}

function audioOverlaps(sorted) {
  let end = -Infinity;
  for (const item of sorted) {
    const start = Math.max(0, Number(item.entry.start) || 0);
    if (start < end - 0.04) return true;
    end = Math.max(end, start + Math.max(0.05, Number(item.entry.duration) || 0.05));
  }
  return false;
}

// A video line that keeps its own sound can play over the microphone line,
// so overlapping sound is mixed on the timeline instead of laid end to end.
function mixAudioTimeline(parts, audible, total) {
  const labels = [];
  audible.forEach((item) => {
    const entry = item.entry;
    if (!entry.audio) return;
    const start = Math.max(0, Number(entry.start) || 0);
    const dur = Math.max(0.05, Number(entry.duration) || 0.05);
    const speed = clampSpeed(entry.speed);
    const srcIn = Math.max(0, Number(entry.srcIn) || 0);
    const srcSpan = Math.max(0.05, Number(entry.srcSpan) > 0 ? Number(entry.srcSpan) : dur * speed);
    const volume = clampVolume(entry.volume == null ? 1 : entry.volume);
    const delay = Math.round(start * 1000);
    const label = 'am' + item.index;
    parts.push(
      '[' +
        item.index +
        ':a]atrim=start=' +
        srcIn.toFixed(3) +
        ':duration=' +
        srcSpan.toFixed(3) +
        ',asetpts=PTS-STARTPTS,' +
        atempoChain(speed) +
        ',volume=' +
        volume +
        ',aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=' +
        dur.toFixed(3) +
        ',atrim=0:' +
        dur.toFixed(3) +
        ',adelay=' +
        delay +
        ':all=1[' +
        label +
        ']'
    );
    labels.push('[' + label + ']');
  });
  if (!labels.length) {
    parts.push('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:' + total.toFixed(3) + '[ac]');
    return;
  }
  parts.push(
    labels.join('') +
      'amix=inputs=' +
      labels.length +
      ':duration=longest:normalize=0,apad=whole_dur=' +
      total.toFixed(3) +
      ',atrim=0:' +
      total.toFixed(3) +
      '[ac]'
  );
}

function buildAudioTimeline(parts, list, total) {
  const audible = list
    .map((entry, index) => ({ entry, index }))
    .filter((item) => item.entry.useAudio);
  audible.sort((a, b) => (Number(a.entry.start) || 0) - (Number(b.entry.start) || 0));
  if (!audible.length) {
    parts.push('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:' + total.toFixed(3) + '[ac]');
    return;
  }
  if (audioOverlaps(audible)) {
    mixAudioTimeline(parts, audible, total);
    return;
  }
  const bits = [];
  let cursor = 0;
  audible.forEach((item) => {
    const entry = item.entry;
    const start = Math.max(0, Number(entry.start) || 0);
    const dur = Math.max(0.05, Number(entry.duration) || 0.05);
    if (start > cursor + 0.04) {
      const gap = start - cursor;
      const label = 'ag' + bits.length;
      parts.push('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:' + gap.toFixed(3) + '[' + label + ']');
      bits.push('[' + label + ']');
    }
    const label = 'aa' + item.index;
    const speed = clampSpeed(entry.speed);
    const srcIn = Math.max(0, Number(entry.srcIn) || 0);
    const srcSpan = Math.max(0.05, Number(entry.srcSpan) > 0 ? Number(entry.srcSpan) : dur * speed);
    const volume = clampVolume(entry.volume == null ? 1 : entry.volume);
    if (entry.audio) {
      parts.push(
        '[' +
          item.index +
          ':a]atrim=start=' +
          srcIn.toFixed(3) +
          ':duration=' +
          srcSpan.toFixed(3) +
          ',asetpts=PTS-STARTPTS,' +
          atempoChain(speed) +
          ',volume=' +
          volume +
          ',aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=' +
          dur.toFixed(3) +
          '[' +
          label +
          ']'
      );
    } else {
      parts.push('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:' + dur.toFixed(3) + '[' + label + ']');
    }
    bits.push('[' + label + ']');
    cursor = start + dur;
  });
  if (total > cursor + 0.04) {
    parts.push(
      'anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:' + (total - cursor).toFixed(3) + '[agtail]'
    );
    bits.push('[agtail]');
  }
  parts.push(bits.join('') + 'concat=n=' + bits.length + ':v=0:a=1[ac]');
}

function atempoChain(speed) {
  let remaining = clampSpeed(speed);
  if (!(remaining > 0)) remaining = 1;
  const parts = [];
  // atempo accepts about 0.5..2 per stage; chain for special speeds.
  while (remaining > 2.0001) {
    parts.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-6) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }
  parts.push('atempo=' + (Math.round(remaining * 1000) / 1000));
  return parts.join(',');
}

function concatFilter(metas, width, height, assPath, fontsDir) {
  const list = Array.isArray(metas) ? metas : [];
  const hasSeparateAudio = list.some((meta) => meta && meta.useAudio);
  const visual = list
    .map((meta, index) => ({ meta, index }))
    .filter((item) => isVisualMeta(item.meta));
  if (hasSeparateAudio || visual.length !== list.length) {
    const total = Math.max(
      0.2,
      list.reduce((max, entry) => Math.max(max, (Number(entry.start) || 0) + (Number(entry.duration) || 0)), 0)
    );
    const parts = [];
    const labels = [];
    visual.forEach((item, order) => {
      const meta = item.meta;
      const i = item.index;
      const timeline = Math.max(0.05, Number(meta.duration) || 0.05);
      const speed = clampSpeed(meta.speed);
      const srcIn = Math.max(0, Number(meta.srcIn) || 0);
      const srcSpan = Math.max(0.05, Number(meta.srcSpan) > 0 ? Number(meta.srcSpan) : timeline * speed);
      parts.push(
        '[' +
          i +
          ':v]trim=start=' +
          srcIn.toFixed(3) +
          ':duration=' +
          srcSpan.toFixed(3) +
          ',setpts=(PTS-STARTPTS)/' +
          speed +
          ',scale=' +
          width +
          ':' +
          height +
          ':force_original_aspect_ratio=decrease,pad=' +
          width +
          ':' +
          height +
          ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS[v' +
          order +
          ']'
      );
      labels.push('[v' + order + ']');
    });
    if (!labels.length) {
      parts.push('color=c=black:s=' + width + 'x' + height + ':r=30:d=' + total.toFixed(3) + '[vc]');
    } else {
      parts.push(labels.join('') + 'concat=n=' + labels.length + ':v=1:a=0[vc]');
    }
    buildAudioTimeline(parts, list, total);
    parts.push("[vc]ass='" + ffmpegFilterPath(assPath) + "':fontsdir='" + ffmpegFilterPath(fontsDir) + "'[vout]");
    return parts.join(';');
  }
  const parts = [];
  const labels = [];
  list.forEach((meta, i) => {
    const timeline = Math.max(0.05, Number(meta.duration) || 0.05);
    const speed = clampSpeed(meta.speed);
    const volume = clampVolume(meta.volume == null ? 1 : meta.volume);
    const srcIn = Math.max(0, Number(meta.srcIn) || 0);
    const srcSpan = Math.max(0.05, Number(meta.srcSpan) > 0 ? Number(meta.srcSpan) : timeline * speed);
    const plain = speed === 1 && Math.abs(volume - 1) < 0.001 && srcIn < 0.001 && Math.abs(srcSpan - timeline) < 0.02;
    const dur = timeline.toFixed(3);
    if (plain) {
      parts.push(
        '[' +
          i +
          ':v]scale=' +
          width +
          ':' +
          height +
          ':force_original_aspect_ratio=decrease,pad=' +
          width +
          ':' +
          height +
          ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS[v' +
          i +
          ']'
      );
      if (meta.audio) {
        parts.push(
          '[' +
            i +
            ':a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:' +
            dur +
            ',apad=whole_dur=' +
            dur +
            ',asetpts=PTS-STARTPTS[a' +
            i +
            ']'
        );
      } else {
        parts.push('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:' + dur + '[a' + i + ']');
      }
    } else {
      parts.push(
        '[' +
          i +
          ':v]trim=start=' +
          srcIn.toFixed(3) +
          ':duration=' +
          srcSpan.toFixed(3) +
          ',setpts=(PTS-STARTPTS)/' +
          speed +
          ',scale=' +
          width +
          ':' +
          height +
          ':force_original_aspect_ratio=decrease,pad=' +
          width +
          ':' +
          height +
          ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS[v' +
          i +
          ']'
      );
      if (meta.audio) {
        parts.push(
          '[' +
            i +
            ':a]atrim=start=' +
            srcIn.toFixed(3) +
            ':duration=' +
            srcSpan.toFixed(3) +
            ',asetpts=PTS-STARTPTS,' +
            atempoChain(speed) +
            ',volume=' +
            volume +
            ',aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=' +
            dur +
            ',asetpts=PTS-STARTPTS[a' +
            i +
            ']'
        );
      } else {
        parts.push('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:' + dur + '[a' + i + ']');
      }
    }
    labels.push('[v' + i + '][a' + i + ']');
  });
  parts.push(labels.join('') + 'concat=n=' + list.length + ':v=1:a=1[vc][ac]');
  parts.push("[vc]ass='" + ffmpegFilterPath(assPath) + "':fontsdir='" + ffmpegFilterPath(fontsDir) + "'[vout]");
  return parts.join(';');
}

function stackFilter(entries, width, height, laneCount, assPath, fontsDir) {
  const list = Array.isArray(entries) ? entries : [];
  const n = Math.max(1, Math.min(8, Math.round(laneCount) || 1));
  const boxes = [];
  for (let i = 0; i < n; i++) {
    const y0 = Math.round((i * height) / n);
    const y1 = Math.round(((i + 1) * height) / n);
    let y = y0 - (y0 % 2);
    let h = y1 - y;
    if (h % 2) h -= 1;
    if (h < 2) h = 2;
    boxes.push({ y, h });
  }
  const total = Math.max(
    0.2,
    list.reduce((max, entry) => Math.max(max, (Number(entry.start) || 0) + (Number(entry.duration) || 0)), 0)
  );
  const parts = [];
  parts.push('color=c=black:s=' + width + 'x' + height + ':r=30:d=' + total.toFixed(3) + '[base0]');
  let base = 'base0';
  list.forEach((entry, i) => {
    if (!isVisualMeta(entry)) return;
    const box = boxes[Math.max(0, Math.min(n - 1, Number(entry.laneIndex) || 0))] || boxes[0];
    const speed = clampSpeed(entry.speed);
    const srcIn = Math.max(0, Number(entry.srcIn) || 0);
    const srcSpan = Math.max(0.05, Number(entry.srcSpan) > 0 ? Number(entry.srcSpan) : (Number(entry.duration) || 0.05) * speed);
    const start = Math.max(0, Number(entry.start) || 0);
    const end = start + Math.max(0.05, Number(entry.duration) || 0.05);
    let chain =
      '[' +
      i +
      ':v]trim=start=' +
      srcIn.toFixed(3) +
      ':duration=' +
      srcSpan.toFixed(3) +
      ',setpts=(PTS-STARTPTS)/' +
      speed;
    const cropBands = Math.round(Number(entry.cropBands) || 0);
    if (cropBands > 1) {
      const band = Math.max(0, Math.min(cropBands - 1, Math.round(Number(entry.cropBand) || 0)));
      chain += ',crop=iw:floor(ih/' + cropBands + '):0:floor(ih*' + band + '/' + cropBands + ')';
    }
    chain +=
      ',scale=' +
      width +
      ':' +
      box.h +
      ':force_original_aspect_ratio=increase,crop=' +
      width +
      ':' +
      box.h +
      ',setsar=1,fps=30,setpts=PTS+' +
      start.toFixed(3) +
      '/TB[sv' +
      i +
      ']';
    const next = 'base' + (i + 1);
    parts.push(chain);
    parts.push(
      '[' +
        base +
        '][sv' +
        i +
        "]overlay=0:" +
        box.y +
        ":enable='between(t," +
        start.toFixed(3) +
        ',' +
        end.toFixed(3) +
        ")'[" +
        next +
        ']'
    );
    base = next;
  });
  buildAudioTimeline(parts, list, total);
  parts.push('[' + base + "]ass='" + ffmpegFilterPath(assPath) + "':fontsdir='" + ffmpegFilterPath(fontsDir) + "'[vout]");
  return parts.join(';');
}

function resolveFont(key, publicDir) {
  const local = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts');
  const win = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const bundled = path.join(publicDir, 'fonts');
  const options = {
    vazir: [
      { name: 'Vazirmatn', file: path.join(bundled, 'Vazirmatn-Regular.ttf') },
      { name: 'Vazirmatn', file: path.join(bundled, 'Vazirmatn-Regular.woff2') },
    ],
    yekan: [
      { name: 'IPT Yekan', file: path.join(local, 'IYekan.ttf') },
      { name: 'B Yekan', file: path.join(local, 'BYekan.ttf') },
      { name: 'IPT Yekan', file: path.join(win, 'IYekan.ttf') },
      { name: 'B Yekan', file: path.join(win, 'BYekan.ttf') },
    ],
    titr: [
      { name: 'B Titr', file: path.join(local, 'BTitrBd.ttf') },
      { name: 'IPT Titr', file: path.join(local, 'ITitrBd.ttf') },
      { name: 'B Titr', file: path.join(win, 'BTitrBd.ttf') },
      { name: 'IPT Titr', file: path.join(win, 'ITitrBd.ttf') },
    ],
    lalezar: [
      { name: 'NPI Laleh', file: path.join(local, 'NPILaleh.ttf') },
      { name: 'NPI Laleh', file: path.join(win, 'NPILaleh.ttf') },
      { name: 'Lalezar', file: path.join(bundled, 'Lalezar-Regular.ttf') },
    ],
    nastaliq: [
      { name: 'IranNastaliq', file: path.join(local, 'IranNastaliq.ttf') },
      { name: 'IranNastaliq', file: path.join(win, 'IranNastaliq.ttf') },
    ],
    ordibehesht: [
      { name: 'F Behesht', file: path.join(local, 'F_behesht.ttf') },
      { name: 'B Homa', file: path.join(local, 'BHoma.ttf') },
      { name: 'B Homa', file: path.join(win, 'BHoma.ttf') },
    ],
    dastnevis: [
      { name: 'Mj Freehand', file: path.join(local, 'Mj_Freehand.ttf') },
      { name: 'Mj Ghalam', file: path.join(local, 'Mj_Ghalam-1.TTF') },
      { name: 'B Davat', file: path.join(local, 'BDavat.ttf') },
      { name: 'B Davat', file: path.join(win, 'BDavat.ttf') },
    ],
    iransans: [
      { name: 'NPI Iran', file: path.join(local, 'NPIIran.ttf') },
      { name: 'IRANSans', file: path.join(local, 'IRANSans.ttf') },
      { name: 'IRANSans', file: path.join(win, 'IRANSans.ttf') },
      { name: 'B Nazanin', file: path.join(local, 'BNazanin.ttf') },
    ],
    peyda: [
      { name: 'Peyda', file: path.join(local, 'Peyda-Regular.ttf') },
      { name: 'Peyda', file: path.join(bundled, 'Peyda-Regular.ttf') },
      { name: 'B Roya', file: path.join(local, 'BRoya.ttf') },
      { name: 'B Roya', file: path.join(win, 'BRoya.ttf') },
    ],
    ravi: [
      { name: 'Ravi', file: path.join(local, 'Ravi-Regular.ttf') },
      { name: 'Ravi', file: path.join(bundled, 'Ravi-Regular.ttf') },
      { name: 'B Traffic', file: path.join(local, 'BTraffic.ttf') },
      { name: 'B Traffic', file: path.join(win, 'BTraffic.ttf') },
    ],
  };
  const list = options[key] || options.vazir;
  for (let i = 0; i < list.length; i++) {
    if (list[i].file && fs.existsSync(list[i].file)) return list[i];
  }
  return null;
}

module.exports = {
  LINE_MAX_WORDS,
  LINE_MAX_CHARS,
  spokenWords,
  defaultStyle,
  clampStyle,
  recomputeEnds,
  buildWordsForClips,
  sanitizeWords,
  groupLines,
  cuesFromWords,
  pickDuration,
  applyDurations,
  normalizeSavedClips,
  sanitizeLanes,
  estimateWidth,
  centersFromRight,
  buildAss,
  ffmpegFilterPath,
  evenDim,
  concatFilter,
  stackFilter,
  resolveFont,
};
