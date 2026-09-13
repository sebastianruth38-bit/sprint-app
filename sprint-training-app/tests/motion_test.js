// The athlete-motion measure must not move with the sampling rate. That was
// the bug that refused three clips the athlete filmed himself: the same
// runner read 1.11/s sampled at 6/s and 2.61/s sampled at 30/s, straddling
// the floor that decides whether he is graded at all.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const ctx = { console, Math, JSON, Array, Object, Number, Infinity, isFinite };
vm.createContext(ctx);
const a = src.indexOf('const POSE_LM'), b = src.indexOf('function getPoseLandmarker');
const names = ['trackMotionPerSec', 'buildTracks', 'signatureDistance', 'poseSignature',
               'frameMetrics', 'selectSubject', 'median', 'MOTION_GAP_S',
               'ATHLETE_MOTION_MIN', 'ATHLETE_MOTION_MAX', 'SECOND_ATHLETE_SHARE', 'MIN_TRACK_FRAMES'];
vm.runInContext(src.slice(a, b).replace(/^function renderAnalysis[\s\S]*?^\}/m, '') + '\n' +
  names.map((n) => `globalThis.${n}=${n};`).join('\n'), ctx);

let pass = 0; const fails = [];
const check = (n, c, extra) => { if (c) pass++; else fails.push(n + (extra ? ' — ' + extra : '')); };

// A body whose shape changes at a steady, known rate, sampled at whatever
// interval we like. Real jitter is added on top so the test exercises the
// thing that actually broke: noise that does not shrink with the interval.
function history(rateHz, seconds, shapePerSecond, jitter) {
  const n = Math.round(seconds * rateHz);
  const out = [];
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / rateHz;
    const base = t * shapePerSecond;
    out.push({ fi: i, norm: [[base + rnd() * jitter, 0], [-base + rnd() * jitter, 0]] });
  }
  return out;
}

// ---------- rate invariance ----------
const readings = [6, 10, 15, 30, 60].map((hz) => ({
  hz, v: ctx.trackMotionPerSec(history(hz, 1.2, 3.0, 0.15), 1 / hz),
}));
readings.forEach((r) => check(`motion is measurable at ${r.hz}/s`, r.v != null));
const vals = readings.map((r) => r.v).filter((v) => v != null);
const spread = Math.max(...vals) / Math.min(...vals);
check('the same movement reads the same at 6/s and 60/s',
  spread < 1.35, `spread ${spread.toFixed(2)}x across ${vals.map((v) => v.toFixed(2)).join(', ')}`);

// The old adjacent-frame method, for contrast: jitter scaled by the rate.
const oldWay = (h, spf) => {
  let tot = 0;
  for (let i = 1; i < h.length; i++) tot += ctx.signatureDistance(h[i - 1].norm, h[i].norm);
  return (tot / (h.length - 1)) / spf;
};
const oldVals = [6, 60].map((hz) => oldWay(history(hz, 1.2, 3.0, 0.15), 1 / hz));
check('and the old method would not have',
  Math.max(...oldVals) / Math.min(...oldVals) > spread,
  `old spread ${(Math.max(...oldVals) / Math.min(...oldVals)).toFixed(2)}x vs new ${spread.toFixed(2)}x`);

// ---------- the measure still separates fast from slow ----------
const slow = ctx.trackMotionPerSec(history(30, 1.2, 1.0, 0.04), 1 / 30);
const fast = ctx.trackMotionPerSec(history(30, 1.2, 5.0, 0.04), 1 / 30);
check('a faster-changing body reads higher', fast > slow * 3, `${slow.toFixed(2)} vs ${fast.toFixed(2)}`);

// ---------- the band admits every athlete that was measured ----------
// Real tracks, fixed-gap measure -- see tools/CALIBRATION.md.
const measured = {
  'fast run': 4.14, 'drive phase': 3.22, 'runner in a race pack': 3.27,
  'first steps out of the blocks': 1.24,
};
Object.entries(measured).forEach(([what, v]) => {
  check(`the band admits a real ${what} (${v}/s)`,
    v >= ctx.ATHLETE_MOTION_MIN && v <= ctx.ATHLETE_MOTION_MAX);
});
check('the ceiling excludes a skeleton jumping between people in a crowd (7.97/s)',
  7.97 > ctx.ATHLETE_MOTION_MAX);

// The floor is honest about what it cannot do. A block start out of the
// blocks reads 1.24 and the same athlete motionless in the set position
// reads 1.06 -- 17% apart. Any floor admitting the first admits the second,
// so this asserts the trade-off is the one intended rather than pretending
// the guard separates them.
check('the floor admits a real block start rather than excluding it',
  1.24 >= ctx.ATHLETE_MOTION_MIN);
check('the floor is knowingly too low to exclude a set athlete',
  1.06 >= ctx.ATHLETE_MOTION_MIN);
check('but still excludes a body that is barely changing at all',
  0.3 < ctx.ATHLETE_MOTION_MIN);

// ---------- degenerate input ----------
check('a one-frame track has no measurable motion',
  ctx.trackMotionPerSec([{ fi: 0, norm: [[0, 0]] }], 1 / 30) === null);
check('a zero sample interval does not divide by zero',
  ctx.trackMotionPerSec(history(30, 1, 3, 0), 0) === null);
check('a track shorter than one gap still returns a figure',
  ctx.trackMotionPerSec(history(30, 0.05, 3, 0), 1 / 30) != null);

// ---------- a broken-off fragment is not a second athlete ----------
function poseAt(x, spreadY) {
  const lms = Array.from({ length: 33 }, (_, i) => ({
    x: x + (i % 5) * 0.01, y: 0.3 + (i / 32) * spreadY, visibility: 0.95,
  }));
  return lms;
}
function movingTrack(frames, startX, drift, shapeRate) {
  return Array.from({ length: frames }, (_, f) => {
    const sig = ctx.poseSignature(poseAt(startX + f * drift, 0.45), 480, 854);
    sig.norm = sig.norm.map(([p, q]) => [p + f * shapeRate, q]);
    return { sig, metrics: { bodyFrac: 0.45, bodyPx: 400, footAtEdge: false, legs: [] } };
  });
}
// One long athlete plus a short stub of the same person, well separated.
// 0.1 of shape change per frame at 30/s is ~3/s, inside the athlete band.
const longRun = movingTrack(24, 0.2, 0.004, 0.1);
const stub = movingTrack(8, 0.75, 0.004, 0.1);
const frames = longRun.map((p, i) => (i < stub.length ? [p, stub[i]] : [p]));
const sel = ctx.selectSubject(frames, 1 / 30);
check('a short fragment is not treated as a second athlete',
  !/More than one athlete/.test(sel.rejection || ''), sel.rejection || 'accepted');
check('the longest track is the one graded',
  sel.rejection ? false : sel.metrics.length >= 20, `${sel.metrics.length} frames`);

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
