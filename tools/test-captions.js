'use strict';

const assert = require('assert');
const {
  spokenWords,
  buildWordsForClips,
  clampStyle,
  cuesFromWords,
  pickDuration,
  applyDurations,
  normalizeSavedClips,
  centersFromRight,
  buildAss,
  concatFilter,
  groupLines,
  sanitizeWords,
  toPersianDigits,
  uniqueRenderName,
  applyCutCameraFiles,
  sanitizeLanes,
  expandCutClips,
  sanitizeLookCuts,
  sliceLookClip,
  expandLookClips,
} = require('../lib/captions');

const spoken = spokenWords('سلام ⏸ دنیا  بعدی برای [2]تماس **[6]نمی‌کند.** 3 تا');
assert.deepStrictEqual(spoken, ['سلام', 'دنیا', 'بعدی', 'برای', 'تماس', 'نمی‌کند.', '۳', 'تا']);
assert.strictEqual(toPersianDigits('40 و ٤٥ و ۴۰'), '۴۰ و ۴۵ و ۴۰');
const stamp = new Date(2026, 9, 8, 23, 50, 10);
const firstName = uniqueRenderName([], 'demo', stamp);
const secondName = uniqueRenderName([firstName], 'demo', stamp);
assert.ok(firstName.indexOf('۲۰۲۶-۱۰-۰۸-۲۳-۵۰') !== -1);
assert.strictEqual(secondName, firstName.replace(/\.mp4$/, '-۲.mp4'));

const clips = [
  { file: '01-1.webm', paragraph: 0, start: 0, duration: 4, text: 'یک دو سه چهار' },
  { file: '02-1.webm', paragraph: 1, start: 4, duration: 2, text: 'پایان ⏸ کار' },
];
const words = buildWordsForClips(clips);
assert.strictEqual(words.length, 6);
assert.ok(words[0].start >= 0 && words[0].start < 0.2);
assert.ok(words[3].end <= 4.001);
assert.strictEqual(words[4].paragraph, 1);
assert.ok(words[4].start >= 4);
assert.ok(words.every((word, i) => i === 0 || word.start >= words[i - 1].start));

const style = clampStyle({
  color: 'red',
  size: 999,
  font: 'comic',
  highlightOpacity: 140,
  x: -4,
  y: 240,
  wordByWord: 1,
  highlight: 1,
});
assert.strictEqual(style.color, '#ffffff');
assert.strictEqual(style.size, 120);
assert.strictEqual(clampStyle({ size: 1 }).size, 8);
assert.strictEqual(style.font, 'vazir');
assert.strictEqual(style.highlightOpacity, 100);
assert.strictEqual(style.textOpacity, 100);
assert.strictEqual(style.x, 0);
assert.strictEqual(style.y, 100);
assert.strictEqual(style.wordByWord, true);

const lineCues = cuesFromWords(words, false);
assert.ok(lineCues.length >= 2);
assert.ok(lineCues.every((cue) => cue.text.indexOf('یک') === -1 || cue.text.indexOf('پایان') === -1));

assert.strictEqual(pickDuration(1.2, 4.5), 4.5);
assert.strictEqual(pickDuration(1.2, 0), 1.2);
assert.strictEqual(pickDuration(null, null), 0);

const shifted = applyDurations(
  [
    { file: '01-1.webm', paragraph: 0, start: 0, duration: 1 },
    { file: '02-1.webm', paragraph: 1, start: 1, duration: 1 },
  ],
  [{ file: '01-1.webm', duration: 3 }]
);
assert.strictEqual(shifted[0].duration, 3);
assert.strictEqual(shifted[1].start, 3);

const centers = centersFromRight([100, 100], 20);
assert.ok(centers[0] > 0 && centers[1] < 0);

const ass = buildAss({ style: clampStyle({ wordByWord: true, highlight: true }), words }, 720, 1280, 'Vazirmatn');
assert.ok(ass.indexOf('یک') !== -1);
assert.ok(ass.indexOf('PlayResX: 720') !== -1);
assert.ok(ass.indexOf('Style: Hot,') !== -1);
const digitAss = buildAss(
  { style: clampStyle({ wordByWord: true, highlight: false, font: 'titr' }), words: [{ text: '3', start: 0, end: 1, paragraph: 0 }] },
  1080,
  1920,
  'B Titr',
  null,
  true
);
assert.ok(digitAss.indexOf('۳') !== -1);
assert.ok(digitAss.indexOf('B Titr,48') !== -1);
assert.ok(digitAss.indexOf(',-1,0,0,0,') !== -1);
assert.strictEqual(ass.indexOf('\u2014'), -1);
assert.strictEqual(ass.indexOf('\u202B'), -1);

const spaced = buildAss(
  {
    style: clampStyle({ letterSpacing: 8, wordByWord: false, highlight: true }),
    words: words.slice(0, 2),
  },
  720,
  1280,
  'Vazirmatn'
);
assert.ok(spaced.indexOf(',100,100,0,0,') !== -1);
assert.strictEqual(spaced.indexOf('\u202B'), -1);
assert.ok(spaced.indexOf('یک') !== -1);

const lineAss = buildAss(
  { style: clampStyle({ wordByWord: false, highlight: true, highlightOpacity: 40 }), words },
  720,
  1280,
  'Vazirmatn',
  { space: 12, widths: words.map(() => 80) }
);
assert.ok(lineAss.indexOf('Style: Plain,') !== -1);
assert.ok(lineAss.indexOf('Style: Hot,') !== -1);
assert.ok(lineAss.split('Dialogue:').length > words.length);
assert.strictEqual(lineAss.indexOf('\u2014'), -1);

const filter = concatFilter(
  [
    { audio: true, duration: 4 },
    { audio: false, duration: 2 },
  ],
  720,
  1280,
  'C:\\takes\\captions.ass',
  'C:\\fonts'
);
assert.ok(filter.indexOf('concat=n=2') !== -1);
assert.ok(filter.indexOf('anullsrc=') !== -1);
assert.ok(filter.indexOf('ass=') !== -1);
assert.strictEqual(filter.indexOf('\u2014'), -1);

const faded = buildAss(
  { style: clampStyle({ textOpacity: 40, wordByWord: true, highlight: false }), words: words.slice(0, 1) },
  720,
  1280,
  'Vazirmatn'
);
assert.ok(faded.indexOf('&H99FFFFFF&') !== -1);

const baseClips = [
  { file: '01-1.webm', paragraph: 0, start: 0, duration: 4 },
  { file: '02-1.webm', paragraph: 1, start: 4, duration: 2 },
];
const split = normalizeSavedClips(baseClips, [
  { file: '01-1.webm', paragraph: 0, duration: 1.5, srcIn: 0, srcSpan: 1.5, speed: 1, volume: 1 },
  { file: '01-1.webm', paragraph: 0, duration: 2.5, srcIn: 1.5, srcSpan: 2.5, speed: 1, volume: 0.5 },
  { file: '02-1.webm', paragraph: 1, duration: 1, srcIn: 0, srcSpan: 2, speed: 2, volume: 1 },
]);
assert.strictEqual(split.length, 3);
assert.strictEqual(split[1].start, 1.5);
assert.strictEqual(split[1].volume, 0.5);
assert.strictEqual(split[2].start, 4);
assert.strictEqual(split[2].duration, 1);
assert.strictEqual(split[2].speed, 2);

const layered = normalizeSavedClips(baseClips, [
  { file: '01-1.webm', paragraph: 0, start: 0, duration: 4, srcIn: 0, srcSpan: 4, speed: 1, volume: 1, lane: 'cam-0' },
  { file: '01-1.webm', paragraph: 0, start: 0, duration: 2, srcIn: 1, srcSpan: 2, speed: 1, volume: 1, lane: 'cam-1' },
]);
assert.strictEqual(layered.length, 2);
assert.strictEqual(layered[0].start, 0);
assert.strictEqual(layered[1].start, 0);
assert.strictEqual(layered[1].lane, 'cam-1');
assert.strictEqual(layered[1].duration, 2);

const withShape = normalizeSavedClips(baseClips, [
  { file: '01-1.webm', paragraph: 0, start: 0, duration: 4, srcIn: 0, srcSpan: 4, speed: 1, volume: 1, lane: 'main' },
  { file: '', paragraph: 0, start: 0.5, duration: 2, shape: 'arrow', lane: 'shape-a' },
]);
assert.strictEqual(withShape.length, 2);
assert.strictEqual(withShape[1].shape, 'arrow');
assert.strictEqual(withShape[1].lane, 'shape-a');
assert.strictEqual(withShape[1].file, '');
const shapeLanes = sanitizeLanes([
  { id: 'shape-a', label: 'فلش', kind: 'shape', shape: 'arrow', color: '#F5C542', x: 140, y: 40, w: 30, h: 12, d: 22, stroke: 10 },
]);
assert.strictEqual(shapeLanes[0].kind, 'shape');
assert.strictEqual(shapeLanes[0].shape, 'arrow');
assert.strictEqual(shapeLanes[0].color, '#f5c542');
assert.strictEqual(shapeLanes[0].x, 100);

const stacked = require('../lib/captions').stackFilter(
  [
    { start: 0, duration: 4, srcIn: 0, srcSpan: 4, speed: 1, volume: 1, audio: true, useAudio: true, laneIndex: 0, cropBands: 2, cropBand: 0 },
    { start: 0, duration: 4, srcIn: 0, srcSpan: 4, speed: 1, volume: 0, audio: false, useAudio: false, laneIndex: 1, cropBands: 0, cropBand: 0 },
  ],
  720,
  1280,
  2,
  'C:\\takes\\captions.ass',
  'C:\\fonts'
);
const sheet = require('../lib/captions').overlayChain(
  'vc',
  [{ x: 12, y: 34, ranges: [{ start: 0, end: 1.5 }, { start: 2, end: 3 }] }],
  2
);
assert.ok(sheet.indexOf('[vc][2:v]overlay=12:34') !== -1);
assert.ok(sheet.indexOf('between(t,0.000,1.500)+between(t,2.000,3.000)') !== -1);
assert.ok(sheet.indexOf('[vout]') !== -1);
assert.strictEqual(sheet.indexOf('\u2014'), -1);

assert.ok(stacked.indexOf('overlay=') !== -1);
assert.ok(stacked.indexOf('crop=') !== -1);
assert.strictEqual(stacked.indexOf('\u2014'), -1);

const kept = require('../lib/captions').sanitizeWords(
  [
    { text: 'یک', start: 0.2, paragraph: 0 },
    { text: 'دو', start: 2, paragraph: 0 },
    { text: 'پایان', start: 4.2, paragraph: 1 },
  ],
  split
);
assert.strictEqual(kept.length, 3);
assert.ok(kept[0].end <= 1.501);
assert.ok(kept[1].start >= 1.5);
assert.ok(kept[1].end <= 4.001);

const broken = groupLines([
  { text: 'زدی', start: 0, end: 1, paragraph: 0 },
  { text: 'من', start: 1, end: 2, paragraph: 0 },
  { text: 'اینم', start: 2, end: 3, paragraph: 0, breakBefore: true },
  { text: 'بقیه', start: 3, end: 4, paragraph: 0 },
]);
assert.strictEqual(broken.length, 2);
assert.strictEqual(broken[0].map((word) => word.text).join(' '), 'زدی من');
assert.strictEqual(broken[1].map((word) => word.text).join(' '), 'اینم بقیه');

const sealed = groupLines([
  { text: 'زدی', start: 0, end: 1, paragraph: 0 },
  { text: 'من', start: 1, end: 2, paragraph: 0, breakBefore: true },
  { text: 'نزدم', start: 2, end: 3, paragraph: 0 },
  { text: 'اینم', start: 3, end: 4, paragraph: 0, breakBefore: true, breakSeal: true },
  { text: 'بقیه', start: 4, end: 5, paragraph: 0 },
]);
assert.strictEqual(sealed.map((group) => group.map((word) => word.text).join(' ')).join('|'), 'زدی|من نزدم|اینم بقیه');

const marked = sanitizeWords(
  [
    { text: 'یک', start: 0, paragraph: 0, breakBefore: true },
    { text: 'دو', start: 1, paragraph: 0 },
  ],
  [{ file: '01-1.webm', paragraph: 0, start: 0, duration: 4, lane: 'main' }]
);
assert.strictEqual(marked[0].breakBefore, true);
assert.ok(!marked[1].breakBefore);
const sealedWords = sanitizeWords(
  [
    { text: 'من', start: 0, paragraph: 0, breakBefore: true },
    { text: 'اینم', start: 1, paragraph: 0, breakBefore: true, breakSeal: true },
  ],
  [{ file: '01-1.webm', paragraph: 0, start: 0, duration: 4, lane: 'main' }]
);
assert.strictEqual(sealedWords[1].breakSeal, true);

const bg = clampStyle({ background: true, backgroundColor: '#112233', backgroundOpacity: 40 });
assert.strictEqual(bg.background, true);
assert.strictEqual(bg.backgroundColor, '#112233');
assert.strictEqual(bg.backgroundOpacity, 40);
assert.strictEqual(clampStyle({}).background, false);
const bgAss = buildAss(
  { style: bg, words: [{ text: 'سلام', start: 0, end: 1, paragraph: 0 }] },
  720,
  1280,
  'Vazirmatn'
);
assert.ok(bgAss.indexOf('Style: Back,') !== -1);
assert.ok(bgAss.indexOf('&H99332211&') !== -1);

const duplicated = [
  { file: '01-9.webm', paragraph: 0, start: 0, duration: 7.736, srcIn: 0, srcSpan: 7.736, speed: 1, volume: 0, lane: 'cam-0' },
  { file: '01-9.webm', paragraph: 0, start: 0, duration: 7.736, srcIn: 0, srcSpan: 7.736, speed: 1, volume: 0, lane: 'cam-1' },
  { file: '01-9-a.webm', paragraph: 0, start: 0, duration: 7.736, lane: 'audio', volume: 1 },
];
const sliced = expandCutClips(duplicated, ['cam-0', 'cam-1'], 1.5, false);
const slicedVideo = sliced.filter((clip) => clip.lane !== 'audio');
assert.strictEqual(slicedVideo.length, 6);
assert.strictEqual(slicedVideo.map((clip) => clip.lane).join(','), 'cam-0,cam-1,cam-0,cam-1,cam-0,cam-1');
assert.strictEqual(slicedVideo[0].duration, 1.5);
assert.strictEqual(slicedVideo[5].start, 7.5);
assert.ok(slicedVideo[5].duration < 0.3);
assert.strictEqual(sliced.filter((clip) => clip.lane === 'audio').length, 1);
const again = expandCutClips(sliced, ['cam-0', 'cam-1'], 1.5, true);
assert.strictEqual(again.length, sliced.length);
assert.ok(slicedVideo.every((clip, index) => clip.lane !== slicedVideo[(index + 1) % slicedVideo.length].lane || slicedVideo.length < 2));

const ownFiles = ['01-1-c0.webm', '01-1-c1.webm'];
const own = expandCutClips(
  [{ file: '01-1.webm', paragraph: 0, start: 0, duration: 3, srcIn: 0, srcSpan: 3, speed: 1, volume: 0, lane: 'cam-0' }],
  ['cam-0', 'cam-1'],
  1.5,
  false,
  () => ownFiles
);
assert.strictEqual(own.map((clip) => clip.file).join(','), '01-1-c0.webm,01-1-c1.webm');
assert.strictEqual(own.map((clip) => clip.lane).join(','), 'cam-0,cam-1');
assert.strictEqual(own[0].srcIn, 0);
assert.strictEqual(own[1].srcIn, 1.5);
assert.strictEqual(own[1].start, 1.5);

const retargeted = applyCutCameraFiles(slicedVideo, ['cam-0', 'cam-1'], () => ['01-9-c0.webm', '01-9-c1.webm']);
assert.strictEqual(retargeted[0].file, '01-9-c0.webm');
assert.strictEqual(retargeted[1].file, '01-9-c1.webm');
assert.strictEqual(retargeted[2].file, '01-9-c0.webm');
assert.strictEqual(retargeted[0].srcIn, slicedVideo[0].srcIn);
assert.strictEqual(retargeted[1].srcIn, slicedVideo[1].srcIn);
const blocked = applyCutCameraFiles(slicedVideo, ['cam-0', 'cam-1'], () => ['01-2-c0.webm', '01-2-c1.webm']);
assert.strictEqual(blocked[0].file, '01-9.webm');
const keptOwn = expandCutClips(retargeted, ['cam-0', 'cam-1'], 1.5, true, () => ['01-9-c0.webm', '01-9-c1.webm']);
assert.strictEqual(keptOwn.length, retargeted.length);
assert.strictEqual(keptOwn[0].file, '01-9-c0.webm');

const lookMaster = [{ file: '01-3.webm', paragraph: 0, start: 0, duration: 8, srcIn: 0, srcSpan: 8, speed: 1, volume: 0, lane: 'cam-0' }];
const lookCuts = [{ t: 0, camera: 0 }, { t: 2.5, camera: 1 }, { t: 5, camera: 0 }];
const looked = expandLookClips(lookMaster, ['cam-0', 'cam-1'], () => lookCuts, false, () => ['01-3-c0.webm', '01-3-c1.webm']);
assert.deepStrictEqual(looked.map((clip) => clip.lane), ['cam-0', 'cam-1', 'cam-0']);
assert.deepStrictEqual(looked.map((clip) => clip.file), ['01-3-c0.webm', '01-3-c1.webm', '01-3-c0.webm']);
assert.strictEqual(looked[1].start, 2.5);
assert.strictEqual(looked[1].srcIn, 2.5);
assert.strictEqual(looked[2].duration, 3);
const lookedAgain = expandLookClips(looked, ['cam-0', 'cam-1'], () => lookCuts, true, () => ['01-3-c0.webm', '01-3-c1.webm']);
assert.strictEqual(lookedAgain.length, looked.length);
assert.strictEqual(lookedAgain[0].file, '01-3-c0.webm');
const held = sliceLookClip(lookMaster[0], ['cam-0', 'cam-1'], [], ['01-3-c0.webm', '01-3-c1.webm']);
assert.strictEqual(held.length, 1);
assert.strictEqual(held[0].lane, 'cam-0');
assert.strictEqual(held[0].duration, 8);
const cleaned = sanitizeLookCuts([{ t: 1, camera: 1 }, { t: 1.1, camera: 0 }, { t: 4, camera: 2 }]);
assert.strictEqual(cleaned.length, 2);
assert.strictEqual(cleaned[0].t, 0);
assert.strictEqual(cleaned[0].camera, 0);
assert.strictEqual(cleaned[1].t, 4);
assert.strictEqual(cleaned[1].camera, 2);

console.log('captions ok');
