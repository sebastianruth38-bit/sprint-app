// Does the harness now reproduce the app's mixed-coordinate bug? Builds the
// same clip both ways: crop frames left in their own coordinates (the bug),
// and mapped back to whole-frame coordinates (the fix).
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'..','..','app.js'),'utf8');
const ctx={console,Math,JSON,Array,Object,Number,Infinity,isFinite};vm.createContext(ctx);
const a=src.indexOf('const POSE_LM'),b=src.indexOf('function getPoseLandmarker');
['frameMetrics','poseSignature','selectSubject','buildTracks','median','longestConsistentRun',
 'DENSE_RATE','DENSE_MAX_SAMPLES','MIN_TRACK_FRAMES','busiestTime']
 .forEach(()=>{});
vm.runInContext(src.slice(a,b).replace(/^function renderAnalysis[\s\S]*?^\}/m,'')+'\n'+
 ['frameMetrics','poseSignature','selectSubject','buildTracks','median','longestConsistentRun',
  'DENSE_RATE','DENSE_MAX_SAMPLES','MIN_TRACK_FRAMES','busiestTime']
  .map(n=>`globalThis.${n}=${n};`).join('\n'),ctx);
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));

function build(poses,t,srcPxH,region,mapBack){
  return poses.map((lms)=>{
    const cropW=region?d.cw*region.w:d.cw, cropH=region?d.ch*region.h:d.ch;
    const seen=ctx.frameMetrics(lms,cropW||d.cw,cropH||d.ch);
    const whole=(region&&mapBack)?lms.map(p=>Object.assign({},p,{
      x:region.x+p.x*region.w, y:region.y+p.y*region.h})):lms;
    const W=(region&&!mapBack)?cropW:d.cw, H=(region&&!mapBack)?cropH:d.ch;
    const m=(region&&mapBack)?ctx.frameMetrics(whole,d.cw,d.ch):ctx.frameMetrics(lms,W,H);
    m.bodyFrac=seen.bodyFrac; m.footAtEdge=seen.footAtEdge; m.bodyAtEdge=seen.bodyAtEdge;
    m.bodyPx=m.bodyFrac?m.bodyFrac*(srcPxH||d.srcH):null; m.t=t;
    return {sig:ctx.poseSignature(whole,W,H),metrics:m};
  });
}
for(const mapBack of [false,true]){
  const shot=d.scout.map((p,i)=>build(p,d.scoutTimes[i],d.scoutH&&d.scoutH[i],d.scoutR&&d.scoutR[i],mapBack));
  const seenAt=[]; shot.forEach((p,i)=>{if(p.length)seenAt.push(d.scoutTimes[i]);});
  const first=seenAt[0],last=seenAt[seenAt.length-1];
  const span=ctx.DENSE_MAX_SAMPLES/ctx.DENSE_RATE;
  const busiest=ctx.busiestTime(shot,d.scoutTimes,d.secondsPerFrame);
  const centre=busiest!=null?busiest:seenAt[Math.floor(seenAt.length/2)];
  const from=(last-first<=span)?first:Math.min(Math.max(first,centre-span/2),last-span);
  const to=Math.min(last,from+span);
  const idx=d.denseTimes.map((t,i)=>({t,i})).filter(x=>x.t>=from-1e-6&&x.t<=to+1e-6).slice(0,ctx.DENSE_MAX_SAMPLES);
  const dense=idx.map(x=>build(d.dense[x.i],x.t,d.denseH&&d.denseH[x.i],d.denseR&&d.denseR[x.i],mapBack));
  const tks=ctx.buildTracks(dense,1/ctx.DENSE_RATE).sort((x,y)=>y.metrics.length-x.metrics.length);
  const sel=ctx.selectSubject(dense,1/ctx.DENSE_RATE);
  console.log(`\n--- crop frames ${mapBack?'MAPPED BACK to whole-frame coords (fixed)':'left in their own coords (the bug)'} ---`);
  console.log(`  tracks: ${tks.slice(0,5).map(t=>`${t.metrics.length}f@${t.motionPerSec==null?'-':t.motionPerSec.toFixed(2)}`).join('  ')}`);
  console.log(`  result: ${sel.rejection || `graded on ${ctx.longestConsistentRun(sel.metrics).length} frames`}`);
}
