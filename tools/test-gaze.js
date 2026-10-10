'use strict';

const assert = require('assert');
const { frontalScore, bestFrontal, decideLook } = require('../public/gaze/gaze-score');

function face(points, boxW) {
  return {
    score: 0.96,
    width: 192,
    height: 192,
    box: { w: boxW, h: boxW },
    points: points,
  };
}

const frontal = frontalScore(
  face(
    [
      { x: 70, y: 80 },
      { x: 122, y: 80 },
      { x: 96, y: 104 },
      { x: 96, y: 124 },
      { x: 52, y: 96 },
      { x: 140, y: 96 },
    ],
    88
  )
);
const turned = frontalScore(
  face(
    [
      { x: 78, y: 80 },
      { x: 104, y: 84 },
      { x: 74, y: 108 },
      { x: 90, y: 126 },
      { x: 70, y: 100 },
      { x: 150, y: 110 },
    ],
    80
  )
);
assert.ok(frontal > 0.7, 'frontal ' + frontal);
assert.ok(turned < 0.25, 'turned ' + turned);
assert.strictEqual(frontalScore({ score: 0.2, width: 192, height: 192, points: [{ x: 1, y: 1 }] }), 0);
assert.ok(bestFrontal([{ score: 0.2, points: [] }, { score: 0.96, box: { w: 88, h: 88 }, points: [
  { x: 70, y: 80 },
  { x: 122, y: 80 },
  { x: 96, y: 104 },
  { x: 96, y: 124 },
  { x: 52, y: 96 },
  { x: 140, y: 96 },
] }], 192, 192) > 0.7);

const none = decideLook({ active: 0, locked: true, scores: [{ value: 0.1, at: 0 }], now: 100 });
assert.strictEqual(none.active, 0);
assert.strictEqual(none.switched, false);

const first = decideLook({
  active: 0,
  locked: false,
  scores: [null, null, { value: 0.9, at: 1000 }],
  now: 1000,
});
assert.strictEqual(first.active, 2);
assert.strictEqual(first.locked, true);
assert.strictEqual(first.switched, true);

const weak = decideLook({
  active: 0,
  locked: true,
  scores: [
    { value: 0.8, at: 1000 },
    { value: 0.85, at: 1000 },
  ],
  now: 1000,
});
assert.strictEqual(weak.active, 0);
assert.strictEqual(weak.wins, 0);

let pending = decideLook({
  active: 0,
  locked: true,
  scores: [
    { value: 0.2, at: 1000 },
    { value: 0.9, at: 1000 },
  ],
  now: 1000,
});
assert.strictEqual(pending.active, 0);
assert.strictEqual(pending.challenger, 1);
assert.strictEqual(pending.wins, 1);
pending = decideLook({
  active: pending.active,
  locked: pending.locked,
  challenger: pending.challenger,
  wins: pending.wins,
  scores: [
    { value: 0.2, at: 1100 },
    { value: 0.9, at: 1100 },
  ],
  now: 1100,
});
assert.strictEqual(pending.active, 1);
assert.strictEqual(pending.switched, true);

const stale = decideLook({
  active: 0,
  locked: true,
  scores: [
    { value: 0.2, at: 0 },
    { value: 0.9, at: 0 },
  ],
  now: 2000,
});
assert.strictEqual(stale.active, 0);
assert.strictEqual(stale.switched, false);

console.log('gaze ok');
