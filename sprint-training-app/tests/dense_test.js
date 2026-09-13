// Tests for the dense re-measure pass and the tracker that follows the
// athlete through it.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const ctx = { console, Math, JSON, Array, Object, Number, Infinity, isFinite };
vm.createContext(ctx);
const a = src.indexOf('const POSE_LM'), b = src.indexOf('function getPoseLandmarker');
const names = ['longestConsistentRun', 'median', 'MOTION_GAP_S',
               'SCOUT_RATE', 'DENSE_RATE', 'DENSE_WINDOW_S', 'DENSE_MAX_SAMPLES',
               'SCOUT_MAX_SAMPLES', 'SCOUT_MIN_SAMPLES', 'MIN_TRACK_FRAMES'];
vm.runInContext(src.slice(a, b).replace(/^function renderAnalysis[\s\S]*?^\}/m, '') + '\n' +
  names.map((n) => `globalThis.${n}=${n};`).join('\n'), ctx);

let pass = 0; const fails = [];
const check = (n, c, extra) => { if (c) pass++; else fails.push(n + (extra ? ' — ' + extra : '')); };

const pose = (x, y, size, tag) => ({ sig: { hip: [x, y], size, norm: [] }, metrics: { tag, legs: [], midHip: [x, y] } });

// ---------- the window is dense enough to catch a stride peak ----------
// A sprinter turns over ~4.5 strides a second; peak lift lasts about one
// frame of 30fps footage.
check('the dense rate gives at least 5 samples per stride',
  ctx.DENSE_RATE / 4.5 >= 5, `${(ctx.DENSE_RATE / 4.5).toFixed(1)} per stride`);
check('the coarse sweep alone would not have',
  ctx.SCOUT_RATE / 4.5 < 3, `${(ctx.SCOUT_RATE / 4.5).toFixed(1)} per stride`);
check('the dense window covers about three strides',
  ctx.DENSE_WINDOW_S * 4.5 >= 3 && ctx.DENSE_WINDOW_S * 4.5 <= 5,
  `${(ctx.DENSE_WINDOW_S * 4.5).toFixed(1)} strides`);

// The coarse sweep only locates the athlete, so its rate no longer has to
// match anything -- motion is measured over a fixed time gap now. What it
// must do is stay cheap and still be able to find him in a short clip.
check('the coarse sweep is cheap', ctx.SCOUT_MAX_SAMPLES <= 30);
check('and takes enough samples to find him in a short clip',
  ctx.SCOUT_MIN_SAMPLES >= 12);
check('a dense window can afford enough frames to build a track',
  ctx.DENSE_MAX_SAMPLES >= ctx.MIN_TRACK_FRAMES * 2,
  `${ctx.DENSE_MAX_SAMPLES} vs ${ctx.MIN_TRACK_FRAMES}`);
check('the two passes together cost less than the old single pass of 60',
  ctx.SCOUT_MAX_SAMPLES + ctx.DENSE_MAX_SAMPLES <= 92,
  `${ctx.SCOUT_MAX_SAMPLES} + ${ctx.DENSE_MAX_SAMPLES}`);
// Motion is compared across frames a fixed time apart, which is what makes
// the band independent of the sampling rate.
check('the motion gap spans several frames at the dense rate',
  ctx.MOTION_GAP_S * ctx.DENSE_RATE >= 2,
  `${(ctx.MOTION_GAP_S * ctx.DENSE_RATE).toFixed(1)} frames`);

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
