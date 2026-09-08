// The app now plays the clip once and processes every frame. This scores that
// capture directly, which is what ships -- rather than the retired two-pass
// shape the older harness still models.
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'..','..','app.js'),'utf8');
const ctx={console,Math,JSON,Array,Object,Number,Infinity,isFinite};vm.createContext(ctx);
const a=src.indexOf('const POSE_LM'),b=src.indexOf('function getPoseLandmarker');
const N=['frameMetrics','poseSignature','selectSubject','buildLocalAnalysis','framingCheck',
 'longestConsistentRun','median','bestWindow','buildTracks','stridesMeasured',
 'DENSE_MAX_SAMPLES','DENSE_RATE','MIN_TRACK_FRAMES','CAPTURE_RATE'];
vm.runInContext(src.slice(a,b).replace(/^function renderAnalysis[\s\S]*?^\}/m,'')+'\n'+
 N.map(n=>`globalThis.${n}=${n};`).join('\n'),ctx);
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const clipType=process.argv[3]||'Max Velocity', label=process.argv[4]||process.argv[2];
const build=(poses,t,srcPxH,region)=>poses.map((lms)=>{
  const cw=region?d.cw*region.w:d.cw, ch=region?d.ch*region.h:d.ch;
  const seen=ctx.frameMetrics(lms,cw||d.cw,ch||d.ch);
  const whole=region?lms.map(p=>Object.assign({},p,{x:region.x+p.x*region.w,y:region.y+p.y*region.h})):lms;
  const m=region?ctx.frameMetrics(whole,d.cw,d.ch):seen;
  m.bodyFrac=seen.bodyFrac;m.footAtEdge=seen.footAtEdge;m.bodyAtEdge=seen.bodyAtEdge;
  m.bodyPx=m.bodyFrac?m.bodyFrac*(srcPxH||d.srcH):null;m.t=t;
  return {sig:ctx.poseSignature(whole,d.cw,d.ch),metrics:m};
});
const all=d.dense.map((p,i)=>build(p,d.denseTimes[i],d.denseH&&d.denseH[i],d.denseR&&d.denseR[i]));
const spf=1/ctx.CAPTURE_RATE;
console.log(`\n${'='.repeat(64)}\n${label}  (${d.duration.toFixed(2)}s)`);
console.log(`  captured ${all.length} frames, ${all.filter(f=>f.length).length} with a pose`);
const fc=ctx.framingCheck(all.flat().map(p=>p.metrics));
console.log(`  framing: body ${fc.frac?(fc.frac*100).toFixed(0)+'%':'-'}, ${fc.px?fc.px.toFixed(0)+'px':'-'}, feet-at-edge ${(fc.edgeFraction*100).toFixed(0)}%`);
const seenIdx=[]; all.forEach((p,i)=>{if(p.length)seenIdx.push(i);});
if(!seenIdx.length){console.log('  REFUSED: nobody found');process.exit(0);}
const times=d.denseTimes;
const maxF=Math.min(ctx.DENSE_MAX_SAMPLES,seenIdx.length);
const w=ctx.bestWindow(all,spf,maxF);
const lo=w?w.from:seenIdx[0];
const hi=w?w.to+1:Math.min(seenIdx[seenIdx.length-1]+1,lo+maxF);
const win=all.slice(Math.max(0,lo),hi);
if(w)console.log(`  window chosen where he is most visible (body ${(w.seen*100).toFixed(0)}% of the picture)`);
console.log(`  on screen ${times[seenIdx[0]].toFixed(2)}-${times[seenIdx[seenIdx.length-1]].toFixed(2)}s -> window ${times[Math.max(0,lo)].toFixed(2)}-${times[Math.min(times.length-1,hi-1)].toFixed(2)}s (${win.length} frames)`);
let sel=ctx.selectSubject(win,spf);
if(sel.rejection){console.log(`  REFUSED: ${sel.rejection}`);process.exit(0);}
const m=ctx.longestConsistentRun(sel.metrics);
console.log(`  graded on ${m.length} frames`);
const an=ctx.buildLocalAnalysis(m,clipType,'Grass');
console.log(`\n  ${an.summary}`);
if(an.basis)console.log(`  ${an.basis}`);
(an.pinpoints||[]).forEach(p=>console.log(`   ${p.score}/5  ${p.name} — ${p.note}`));
(an.flags||[]).forEach(f=>console.log('   FLAG: '+f));
