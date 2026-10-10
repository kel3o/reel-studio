(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.reelGazeScore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const LOOK_MIN = 0.58;
  const LOOK_MARGIN = 0.1;
  const LOOK_STALE_MS = 900;
  const LOOK_WINS = 2;

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function asPixels(points, width, height) {
    let max = 0;
    points.forEach((point) => {
      if (!point) return;
      max = Math.max(max, Number(point.x) || 0, Number(point.y) || 0);
    });
    const norm = max <= 1.5;
    return points.map((point) => ({
      x: norm ? (Number(point && point.x) || 0) * width : Number(point && point.x) || 0,
      y: norm ? (Number(point && point.y) || 0) * height : Number(point && point.y) || 0,
    }));
  }

  function boxWidth(box, width) {
    if (!box) return 0;
    const raw = Number(box.w != null ? box.w : box.width);
    if (!(raw > 0)) return 0;
    return raw <= 1.5 ? raw * width : raw;
  }

  // BlazeFace order: right eye, left eye, nose, mouth, right ear, left ear.
  // Eye order does not matter. The nose has to sit near the middle of the two eyes.
  function frontalScore(face) {
    if (!face || !Array.isArray(face.points) || face.points.length < 3) return 0;
    const width = Number(face.width) > 8 ? Number(face.width) : 1;
    const height = Number(face.height) > 8 ? Number(face.height) : 1;
    const confidence = Number(face.score);
    if (Number.isFinite(confidence) && confidence < 0.5) return 0;
    const pts = asPixels(face.points, width, height);
    const right = pts[0];
    const left = pts[1];
    const nose = pts[2];
    if (!right || !left || !nose) return 0;
    const eyeSpan = Math.hypot(left.x - right.x, left.y - right.y);
    if (eyeSpan < Math.max(6, width * 0.04)) return 0;
    const yaw = Math.abs(nose.x - (left.x + right.x) / 2) / eyeSpan;
    const yawScore = clamp01(1 - (yaw - 0.08) / 0.42);
    let earScore = 0.75;
    if (pts.length >= 6 && pts[4] && pts[5]) {
      const d0 = Math.hypot(pts[4].x - nose.x, pts[4].y - nose.y);
      const d1 = Math.hypot(pts[5].x - nose.x, pts[5].y - nose.y);
      const balance = Math.min(d0, d1) / Math.max(d0, d1, 1);
      earScore = clamp01((balance - 0.42) / 0.45);
    }
    let faceW = boxWidth(face.box, width);
    if (!(faceW > 0)) faceW = eyeSpan * 2.2;
    if (faceW < width * 0.1) return 0;
    const sizeScore = clamp01(faceW / (width * 0.22));
    const confScore = Number.isFinite(confidence) ? clamp01(confidence) : 0.85;
    const score = yawScore * (0.42 + 0.58 * earScore) * (0.65 + 0.35 * sizeScore) * (0.55 + 0.45 * confScore);
    return Math.round(score * 1000) / 1000;
  }

  function bestFrontal(faces, width, height) {
    let best = 0;
    (Array.isArray(faces) ? faces : []).forEach((face) => {
      const value = frontalScore({
        score: face && face.score,
        box: face && face.box,
        points: face && face.points,
        width: width,
        height: height,
      });
      if (value > best) best = value;
    });
    return best;
  }

  function decideLook(input) {
    const source = input || {};
    const active = Number.isFinite(Number(source.active)) ? Math.max(0, Math.round(Number(source.active))) : 0;
    const locked = !!source.locked;
    const now = Number(source.now) || 0;
    const scores = Array.isArray(source.scores) ? source.scores : [];
    let challenger = Number.isFinite(Number(source.challenger)) ? Number(source.challenger) : -1;
    let wins = Number(source.wins) || 0;
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < scores.length; i++) {
      const row = scores[i];
      if (!row || !(Number(row.value) > 0)) continue;
      if (now - Number(row.at) > LOOK_STALE_MS) continue;
      if (row.value > bestScore) {
        bestScore = row.value;
        bestIndex = i;
      }
    }
    const activeRow = scores[active];
    const activeFresh = !!(activeRow && now - Number(activeRow.at) <= LOOK_STALE_MS);
    const activeScore = activeFresh ? Number(activeRow.value) || 0 : 0;
    if (bestIndex < 0 || bestScore < LOOK_MIN) {
      return { active: active, locked: locked, challenger: -1, wins: 0, switched: false };
    }
    if (!locked) {
      return {
        active: bestIndex,
        locked: true,
        challenger: -1,
        wins: 0,
        switched: bestIndex !== active,
      };
    }
    if (bestIndex === active || bestScore < activeScore + LOOK_MARGIN) {
      return { active: active, locked: true, challenger: -1, wins: 0, switched: false };
    }
    if (challenger === bestIndex) wins += 1;
    else {
      challenger = bestIndex;
      wins = 1;
    }
    if (wins >= LOOK_WINS) {
      return { active: bestIndex, locked: true, challenger: -1, wins: 0, switched: true };
    }
    return { active: active, locked: true, challenger: challenger, wins: wins, switched: false };
  }

  return {
    LOOK_MIN: LOOK_MIN,
    frontalScore: frontalScore,
    bestFrontal: bestFrontal,
    decideLook: decideLook,
  };
});
