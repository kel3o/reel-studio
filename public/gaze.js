(function () {
  let detector = null;
  let ready = false;
  let failed = false;
  let starting = null;

  function packFace(detection) {
    const box = detection && detection.boundingBox;
    const categories = detection && detection.categories;
    return {
      score: categories && categories[0] ? Number(categories[0].score) || 0 : 0,
      box: box
        ? {
            x: Number(box.originX) || 0,
            y: Number(box.originY) || 0,
            w: Number(box.width) || 0,
            h: Number(box.height) || 0,
          }
        : null,
      points: ((detection && detection.keypoints) || []).map((point) => ({
        x: Number(point && point.x) || 0,
        y: Number(point && point.y) || 0,
      })),
    };
  }

  function boot() {
    if (ready) return Promise.resolve(true);
    if (failed) return Promise.resolve(false);
    if (starting) return starting;
    starting = import('/gaze/vision_bundle.mjs')
      .then((mod) => {
        return mod.FilesetResolver.forVisionTasks('/gaze/wasm').then((fileset) => {
          return mod.FaceDetector.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: '/gaze/blaze_face_short_range.tflite',
              delegate: 'CPU',
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.5,
          });
        });
      })
      .then((created) => {
        detector = created;
        ready = true;
        return true;
      })
      .catch(() => {
        failed = true;
        starting = null;
        return false;
      });
    return starting;
  }

  function detect(bitmap, index, width, height) {
    if (!detector) {
      if (bitmap && bitmap.close) bitmap.close();
      return Promise.resolve(null);
    }
    try {
      const result = detector.detect(bitmap);
      const faces = ((result && result.detections) || []).map(packFace);
      return Promise.resolve({
        index: index,
        width: width || (bitmap && bitmap.width) || 0,
        height: height || (bitmap && bitmap.height) || 0,
        faces: faces,
      });
    } catch (err) {
      return Promise.resolve({ index: index, width: width || 0, height: height || 0, faces: [] });
    } finally {
      if (bitmap && bitmap.close) bitmap.close();
    }
  }

  window.__reelGaze = {
    boot: boot,
    detect: detect,
    isReady: function () {
      return ready;
    },
    isFailed: function () {
      return failed;
    },
  };
})();
