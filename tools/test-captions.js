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
} = require('../lib/captions');

const spoken = spokenWords('سلام ⏸ دنیا  بعدی برای [2]تماس **[6]نمی‌کند.**');
assert.deepStrictEqual(spoken, ['سلام', 'دنیا', 'بعدی', 'برای', 'تماس', 'نمی‌کند.']);

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
assert.strictEqual(ass.indexOf('\u2014'), -1);

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

console.log('captions ok');
