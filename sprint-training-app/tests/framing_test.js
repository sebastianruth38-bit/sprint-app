// Tests for the framing guards: the toe-landmark crash, subject size,
// shot-cut splitting, background/mover detection and feet-in-frame.
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const ctx = { console, Math, JSON, Array, Float32Array, Number, Object, isFinite };
vm.createContext(ctx);

// Pull the pure functions we need out of the file, in order.
const WANT = [
  'POSE_LM', 'MIN_LANDMARK_CONFIDENCE', 'SUBJECT_FRAC_MIN', 'CROP_PADDING',
  'SHOT_CUT_RATIO', 'SHOT_CUT_FLOOR', 'MIN_SHOT_FRAMES', 'EDGE_MARGIN', 'MAX_EDGE_FRACTION',
  'MAX_PEOPLE_IN_FRAME', 'MIN_TRACK_FRAMES',
  'ATHLETE_MOTION_MIN', 'ATHLETE_MOTION_MAX',
  'MOTION_GAP_S', 'SECOND_ATHLETE_SHARE',
  'SIG_JOINTS',
  'median', 'midpoint', 'angleAt', 'angleFromVertical', 'toPoints',
  'SUBJECT_PX_MIN', 'poseBounds', 'longestShot', 'framingCheck',
  'legMetrics', 'frameMetrics', 'poseSignature', 'signatureDistance',
  'buildTracks', 'selectSubject',
];
let code = '';
for (const n of WANT) {
  const re = new RegExp(
    `^(?:const ${n} = \\{[\\s\\S]*?^\\};|const ${n} = \\[[\\s\\S]*?^\\];|const ${n} = [^\\n]*;|function ${n}\\([\\s\\S]*?^\\})`,
    'm'
  );
  const m = src.match(re);
  if (!m) throw new Error('could not extract ' + n);
  code += m[0] + '\n';
}
// `const`/`let` declared at the top level of a vm script stay in the script's
// own lexical scope, so hand them to the context explicitly.
code += '\n' + WANT.map((n) => `globalThis.${n} = ${n};`).join('\n');
vm.runInContext(code, ctx);

let pass = 0;
const fails = [];
function check(name, cond, extra) {
  if (cond) { pass++; } else { fails.push(name + (extra ? ' — ' + extra : '')); }
}

// ---------- the crash that killed the whole grader ----------
const fullPose = (over = {}) =>
  Array.from({ length: 33 }, (_, i) => ({
    x: over[i] ? over[i].x : 0.45 + (i % 5) * 0.02,
    y: over[i] ? over[i].y : 0.30 + i * 0.012,
    visibility: over[i] && over[i].visibility != null ? over[i].visibility : 0.95,
  }));

let threw = null;
let fm = null;
try { fm = ctx.frameMetrics(fullPose(), 480, 854); } catch (e) { threw = e; }
check('frameMetrics does not throw on a fully-visible pose', !threw, threw && threw.message);
check('POSE_LM defines both toe landmarks', ctx.POSE_LM.lToe === 31 && ctx.POSE_LM.rToe === 32);
check('legs are measured', fm && fm.legs.length === 2);
check('facing is resolved from the foot', fm && fm.legs[0].facing !== 0,
  fm && 'facing=' + fm.legs[0].facing);
check('ankle angle is computed', fm && fm.legs[0].footVsShin != null);

// ---------- body fraction ----------
// Landmarks spanning y 0.3..0.7 of the image => the athlete is 40% of frame.
const spread = {};
for (let i = 0; i < 33; i++) spread[i] = { x: 0.5, y: 0.3 + (i / 32) * 0.4, visibility: 0.9 };
const big = ctx.frameMetrics(fullPose(spread), 480, 854);
check('bodyFrac measures the athlete\'s share of frame height',
  big.bodyFrac > 0.39 && big.bodyFrac < 0.41, 'got ' + (big && big.bodyFrac));

const tiny = {};
for (let i = 0; i < 33; i++) tiny[i] = { x: 0.5, y: 0.5 + (i / 32) * 0.08, visibility: 0.9 };
const small = ctx.frameMetrics(fullPose(tiny), 480, 854);
check('a distant athlete reports a small bodyFrac', small.bodyFrac < 0.1);

// ---------- feet at the frame edge ----------
const midField = ctx.frameMetrics(fullPose(spread), 480, 854);
check('feet inside the frame are not flagged', midField.footAtEdge === false);

const clamped = Object.assign({}, spread);
[27, 28, 31, 32].forEach((i) => { clamped[i] = { x: 0.5, y: 0.999, visibility: 0.9 }; });
check('an ankle pinned to the frame edge is flagged',
  ctx.frameMetrics(fullPose(clamped), 480, 854).footAtEdge === true);

// ---------- shot splitting ----------
// Ordinary running motion sits near the clip median; a cut must clear both
// the ratio and the absolute floor.
const steady = Array.from({ length: 30 }, () => 6 + Math.random());
check('a single continuous shot is not split',
  JSON.stringify(ctx.longestShot(steady)) === JSON.stringify([0, 30]));

// A scroll partway through: 12 frames, a spike, then 18 frames.
const scrolled = steady.slice();
scrolled[12] = 60;
check('a scroll splits the clip and keeps the longer side',
  JSON.stringify(ctx.longestShot(scrolled)) === JSON.stringify([12, 30]),
  JSON.stringify(ctx.longestShot(scrolled)));

// Control centre pulled down at the very end: the long head must survive.
const tailCut = steady.slice();
tailCut[26] = 45;
check('a cut near the end keeps the long opening shot',
  JSON.stringify(ctx.longestShot(tailCut)) === JSON.stringify([0, 26]),
  JSON.stringify(ctx.longestShot(tailCut)));

// Chopping into slivers must not leave us grading 3 frames.
const confetti = steady.map((v, i) => (i % 3 === 0 && i > 0 ? 70 : v));
const conf = ctx.longestShot(confetti);
check('shots shorter than the minimum fall back to the whole clip',
  conf[1] - conf[0] === 30, JSON.stringify(conf));

// ---------- poseBounds ----------
const bounded = Array.from({ length: 33 }, (_, i) => ({
  x: 0.30 + (i % 4) * 0.05, y: 0.20 + (i / 32) * 0.45, visibility: 0.9,
}));
const pb = ctx.poseBounds(bounded);
check('poseBounds spans the visible landmarks',
  pb && Math.abs(pb.x0 - 0.30) < 1e-9 && Math.abs(pb.y0 - 0.20) < 1e-9 && Math.abs(pb.y1 - 0.65) < 1e-9,
  JSON.stringify(pb));

const mostlyHidden = bounded.map((p, i) => (i < 30 ? Object.assign({}, p, { visibility: 0.1 }) : p));
check('poseBounds refuses a pose that is mostly invisible', ctx.poseBounds(mostlyHidden) === null);

const flat = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
check('poseBounds refuses a degenerate zero-area pose', ctx.poseBounds(flat) === null);

// ---------- framingCheck ----------
const fc = ctx.framingCheck([
  { bodyFrac: 0.4, footAtEdge: false },
  { bodyFrac: 0.5, footAtEdge: false },
  { bodyFrac: 0.45, footAtEdge: true },
]);
check('framingCheck medians the body fraction', fc.frac === 0.45, 'got ' + fc.frac);
check('framingCheck reports the edge fraction', Math.abs(fc.edgeFraction - 1 / 3) < 1e-9);
check('framingCheck copes with no measurements',
  ctx.framingCheck([]).frac === null && ctx.framingCheck([null]).frac === null);

// ---------- selectSubject rejects unusable framing ----------
// Build a plausible single running athlete, then vary only the framing.
function trackOf(bodyFrac, footAtEdge, bodyPx = 400) {
  const poses = [];
  for (let f = 0; f < 20; f++) {
    const lms = fullPose();
    // walk him across the frame so the tracker sees steady motion
    lms.forEach((p, i) => { p.x = 0.3 + f * 0.01 + (i % 5) * 0.02; });
    const sig = ctx.poseSignature(lms, 480, 854);
    // perturb the normalized pose a little each frame => motion in range
    sig.norm = sig.norm.map(([a, b]) => [a + f * 0.20, b + f * 0.15]);
    poses.push([{ sig, metrics: { bodyFrac, footAtEdge, bodyPx, thighRise: 0.2, legs: [] } }]);
  }
  return poses;
}
const okSel = ctx.selectSubject(trackOf(0.45, false), 0.1);
check('a well-framed athlete is accepted', okSel.rejection === null, okSel.rejection);

const smallSel = ctx.selectSubject(trackOf(0.10, false), 0.1);
check('a too-small athlete is refused', /too small in the frame/.test(smallSel.rejection || ''),
  smallSel.rejection);
check('a refused clip returns no metrics', smallSel.metrics.length === 0);

const edgeSel = ctx.selectSubject(trackOf(0.45, true), 0.1);
check('feet leaving the picture is refused', /feet leave the picture/.test(edgeSel.rejection || ''),
  edgeSel.rejection);

// Right at the boundary the clip must still be graded, not refused.
const boundary = ctx.selectSubject(trackOf(0.25, false), 0.1);
check('exactly at the size threshold is still graded', boundary.rejection === null, boundary.rejection);

// Cropping can rescue a small share of the frame, but not a shortage of
// real pixels -- those are refused even when the crop made him look big.
const fewPx = ctx.selectSubject(trackOf(0.6, false, 40), 0.1);
check('too few real pixels of athlete is refused even when he fills the crop',
  /too far away/.test(fewPx.rejection || ''), fewPx.rejection);
const enoughPx = ctx.selectSubject(trackOf(0.6, false, 150), 0.1);
check('a small but detailed athlete is graded', enoughPx.rejection === null, enoughPx.rejection);

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
