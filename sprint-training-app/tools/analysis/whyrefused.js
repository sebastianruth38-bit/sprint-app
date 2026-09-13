// When the app says it could not grade a clip, this says which guard stopped
// it and by how much. Every refusal message is deliberately vague to the
// athlete ("nobody is moving like a sprinter"); this prints the number behind
// it and the threshold it missed, so a refusal can be judged as correct or as
// a band that needs widening.
//
//   python3 appsim.py clip.mov out.json && node whyrefused.js out.json
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'app.js'), 'utf8');
const ctx = { console, Math, JSON, Array, Object, Number, Infinity, isFinite };
vm.createContext(ctx);
const a = src.indexOf('const POSE_LM'), b = src.indexOf('function getPoseLandmarker');
const N = ['frameMetrics', 'poseSignature', 'selectSubject', 'framingCheck', 'buildTracks',
  'trackMotionPerSec', 'longestConsistentRun', 'median', 'bestWindow', 'signatureDistance',
  'DENSE_MAX_SAMPLES', 'MIN_TRACK_FRAMES', 'CAPTURE_RATE', 'SUBJECT_FRAC_MIN', 'SUBJECT_PX_MIN',
  'ATHLETE_MOTION_MIN', 'ATHLETE_MOTION_MAX', 'MAX_EDGE_FRACTION', 'MOTION_GAP_S'];
vm.runInContext(src.slice(a, b).replace(/^function renderAnalysis[\s\S]*?^\}/m, '') + '\n' +
  N.map((n) => `globalThis.${n}=${n};`).join('\n'), ctx);

const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const build = (poses, t, srcPxH, region) => poses.map((lms) => {
  const cw = region ? d.cw * region.w : d.cw, ch = region ? d.ch * region.h : d.ch;
  const seen = ctx.frameMetrics(lms, cw || d.cw, ch || d.ch);
  const whole = region ? lms.map((p) => Object.assign({}, p, { x: region.x + p.x * region.w, y: region.y + p.y * region.h })) : lms;
  const m = region ? ctx.frameMetrics(whole, d.cw, d.ch) : seen;
  m.bodyFrac = seen.bodyFrac; m.footAtEdge = seen.footAtEdge; m.bodyAtEdge = seen.bodyAtEdge;
  m.bodyPx = m.bodyFrac ? m.bodyFrac * (srcPxH || d.srcH) : null; m.t = t;
  return { sig: ctx.poseSignature(whole, d.cw, d.ch), metrics: m };
});
const all = d.dense.map((p, i) => build(p, d.denseTimes[i], d.denseH && d.denseH[i], d.denseR && d.denseR[i]));
const spf = 1 / ctx.CAPTURE_RATE;

console.log(`\n${process.argv[3] || process.argv[2]}  ${d.duration.toFixed(2)}s, ${all.length} frames captured`);
const posed = all.filter((f) => f.length).length;
console.log(`  frames with any pose : ${posed}/${all.length}  ${posed < all.length * 0.3 ? '<-- mostly empty picture' : ''}`);
if (!posed) { console.log('  STOP: nobody detected anywhere.'); process.exit(0); }

const fc = ctx.framingCheck(all.flat().map((p) => p.metrics));
const fracOK = fc.frac >= ctx.SUBJECT_FRAC_MIN, pxOK = !fc.px || fc.px >= ctx.SUBJECT_PX_MIN;
console.log(`  subject height       : ${(fc.frac * 100).toFixed(0)}% of frame  (needs >= ${(ctx.SUBJECT_FRAC_MIN * 100).toFixed(0)}%) ${fracOK ? 'ok' : 'TOO SMALL'}`);
console.log(`  subject pixels       : ${fc.px ? fc.px.toFixed(0) : '-'}px  (needs >= ${ctx.SUBJECT_PX_MIN}) ${pxOK ? 'ok' : 'TOO FAR'}`);
console.log(`  feet at frame edge   : ${(fc.edgeFraction * 100).toFixed(0)}% of frames  (max ${(ctx.MAX_EDGE_FRACTION * 100).toFixed(0)}%) ${fc.edgeFraction <= ctx.MAX_EDGE_FRACTION ? 'ok' : 'CROPPED OUT'}`);

// The window the app would actually grade, then every track inside it.
const maxF = Math.min(ctx.DENSE_MAX_SAMPLES, posed);
const w = ctx.bestWindow(all, spf, maxF);
const seenIdx = []; all.forEach((p, i) => { if (p.length) seenIdx.push(i); });
const lo = w ? w.from : seenIdx[0];
const hi = w ? w.to + 1 : Math.min(seenIdx[seenIdx.length - 1] + 1, lo + maxF);
const win = all.slice(Math.max(0, lo), hi);
console.log(`  graded window        : ${d.denseTimes[Math.max(0, lo)].toFixed(2)}-${d.denseTimes[Math.min(d.denseTimes.length - 1, hi - 1)].toFixed(2)}s (${win.length} frames)`);

const tracks = ctx.buildTracks(win, spf);
console.log(`\n  tracks in that window: ${tracks.length}`);
tracks.forEach((t, i) => {
  const frames = t.metrics.length;
  const motion = t.motionPerSec;
  const longEnough = frames >= ctx.MIN_TRACK_FRAMES;
  const moves = motion != null && motion >= ctx.ATHLETE_MOTION_MIN && motion <= ctx.ATHLETE_MOTION_MAX;
  const why = !longEnough ? `too short (${frames} < ${ctx.MIN_TRACK_FRAMES} frames -- lost and re-found, or only briefly in shot)`
    : motion == null ? 'no motion measurable'
    : motion < ctx.ATHLETE_MOTION_MIN ? `TOO STILL (${motion.toFixed(2)} < ${ctx.ATHLETE_MOTION_MIN}/s -- standing, jogging, or set in the blocks)`
    : motion > ctx.ATHLETE_MOTION_MAX ? `TOO ERRATIC (${motion.toFixed(2)} > ${ctx.ATHLETE_MOTION_MAX}/s -- tracking is jumping between people)`
    : `ok (${motion.toFixed(2)}/s, band ${ctx.ATHLETE_MOTION_MIN}-${ctx.ATHLETE_MOTION_MAX})`;
  console.log(`    track ${i}: ${String(frames).padStart(3)} frames  ${longEnough && moves ? 'ACCEPTED' : 'rejected'}  ${why}`);
});

const sel = ctx.selectSubject(win, spf);
console.log(`\n  verdict: ${sel.rejection || 'graded on ' + ctx.longestConsistentRun(sel.metrics).length + ' frames'}`);
