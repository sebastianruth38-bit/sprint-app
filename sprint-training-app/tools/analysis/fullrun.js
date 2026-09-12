// Mirrors the shipping pipeline: coarse sweep locates the athlete, dense pass
// over his window does subject selection AND measurement. All logic from app.js.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname,'..','..','app.js'), 'utf8');
const ctx = { console, Math, JSON, Array, Object, Number, Infinity, isFinite };
vm.createContext(ctx);
const a = src.indexOf('const POSE_LM'), b = src.indexOf('function getPoseLandmarker');
const names = ['frameMetrics','poseSignature','selectSubject','buildLocalAnalysis','framingCheck',
               'longestConsistentRun','median','DENSE_RATE','DENSE_MAX_SAMPLES','MIN_TRACK_FRAMES',
               'buildTracks','ATHLETE_MOTION_MIN','ATHLETE_MOTION_MAX','busiestTime','signatureDistance','MOTION_GAP_S'];
vm.runInContext(src.slice(a, b).replace(/^function renderAnalysis[\s\S]*?^\}/m,'') + '\n' +
  names.map((n) => `globalThis.${n}=${n};`).join('\n'), ctx);

const file = process.argv[2], clipType = process.argv[3] || 'Max Velocity', label = process.argv[4] || file;
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
// Mirrors app.js measure(): geometry in WHOLE-FRAME coordinates even when the
// model was shown a crop, framing flags in the coordinates it actually saw.
// The earlier version of this harness normalised everything to one size,
// which silently papered over exactly the bug it was meant to catch.
const build = (poses, t, srcPxH, region) => poses.map((lms) => {
  const cropW = region ? d.cw * region.w : d.cw;
  const cropH = region ? d.ch * region.h : d.ch;
  const seen = ctx.frameMetrics(lms, cropW || d.cw, cropH || d.ch);
  const whole = region
    ? lms.map((p) => Object.assign({}, p, {
        x: region.x + p.x * region.w, y: region.y + p.y * region.h }))
    : lms;
  const m = region ? ctx.frameMetrics(whole, d.cw, d.ch) : seen;
  m.bodyFrac = seen.bodyFrac;
  m.footAtEdge = seen.footAtEdge;
  m.bodyAtEdge = seen.bodyAtEdge;
  m.bodyPx = m.bodyFrac ? m.bodyFrac * (srcPxH || d.srcH) : null;
  m.t = t;
  return { sig: ctx.poseSignature(whole, d.cw, d.ch), metrics: m };
});
console.log(`\n${'='.repeat(64)}\n${label}   (${d.duration.toFixed(2)}s)`);

// ---- coarse sweep: where is he?
const seenAt = [];
d.scout.forEach((p, i) => { if (p.length) seenAt.push(d.scoutTimes[i]); });
console.log(`  coarse: ${seenAt.length}/${d.scout.length} frames had somebody`);
if (!seenAt.length) { console.log('  REFUSED: nobody found'); process.exit(0); }

// ---- dense window over his appearance
const first = seenAt[0], last = seenAt[seenAt.length-1];
const span = ctx.DENSE_MAX_SAMPLES / ctx.DENSE_RATE;
const shotPoses = d.scout.map((p,i)=>build(p, d.scoutTimes[i], d.scoutH && d.scoutH[i], d.scoutR && d.scoutR[i]));
const busiest = ctx.busiestTime(shotPoses, d.scoutTimes, d.secondsPerFrame);
const centre = busiest != null ? busiest : seenAt[Math.floor(seenAt.length/2)];
console.log(`  busiest (running) at ${busiest==null?'unknown':busiest.toFixed(2)+'s'}`);
const from = (last - first <= span) ? first : Math.min(Math.max(first, centre - span/2), last - span);
const to = Math.min(last, from + span);
console.log(`  on screen ${first.toFixed(2)}-${last.toFixed(2)}s -> dense window ${from.toFixed(2)}-${to.toFixed(2)}s`);

const idx = d.denseTimes.map((t,i)=>({t,i})).filter(x=>x.t>=from-1e-6&&x.t<=to+1e-6).slice(0, ctx.DENSE_MAX_SAMPLES);
if (idx.length < ctx.MIN_TRACK_FRAMES) { console.log(`  window too short (${idx.length} samples)`); process.exit(0); }
const densePoses = idx.map((x) => build(d.dense[x.i], x.t, d.denseH && d.denseH[x.i], d.denseR && d.denseR[x.i]));
console.log(`  dense: ${idx.length} samples, ${densePoses.filter(p=>p.length).length} posed`);

const tks = ctx.buildTracks(densePoses, 1/ctx.DENSE_RATE)
  .filter(t=>t.metrics.length>=ctx.MIN_TRACK_FRAMES)
  .sort((x,y)=>y.metrics.length-x.metrics.length);
console.log(`  tracks in window: ${tks.map(t=>`${t.metrics.length}f@${t.motionPerSec==null?'-':t.motionPerSec.toFixed(2)}/s`).join('  ') || 'none >= '+ctx.MIN_TRACK_FRAMES}`);
console.log(`  band ${ctx.ATHLETE_MOTION_MIN}-${ctx.ATHLETE_MOTION_MAX}`);
const subject = ctx.selectSubject(densePoses, 1/ctx.DENSE_RATE);
const fc = ctx.framingCheck(densePoses.flat().map(p=>p.metrics));
console.log(`  framing: body ${fc.frac?(fc.frac*100).toFixed(0)+'%':'-'}, ${fc.px?fc.px.toFixed(0)+'px':'-'}, feet-at-edge ${(fc.edgeFraction*100).toFixed(0)}%`);
if (subject.rejection) { console.log(`  REFUSED: ${subject.rejection}`); process.exit(0); }
const measured = ctx.longestConsistentRun(subject.metrics);
console.log(`  graded on ${measured.length} frames`);

const an = ctx.buildLocalAnalysis(measured, clipType, 'Track');
console.log(`\n  --- ${clipType} ---\n  ${an.summary}`);
if (an.basis) console.log('  ' + an.basis);
(an.pinpoints||[]).forEach(p=>console.log(`   ${p.score}/5  ${p.name} — ${p.note}`));
(an.flags||[]).forEach(f=>console.log('   FLAG: '+f));
