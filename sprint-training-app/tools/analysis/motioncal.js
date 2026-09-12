// Is the new motion measure actually rate-invariant, and where do the bands go?
// Same clip, same track, measured at the scout rate and at 30/s.
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'..','..','app.js'),'utf8');
const ctx={console,Math,JSON,Array,Object,Number,Infinity,isFinite};vm.createContext(ctx);
const a=src.indexOf('const POSE_LM'),b=src.indexOf('function getPoseLandmarker');
const names=['frameMetrics','poseSignature','buildTracks','trackMotionPerSec','median',
             'signatureDistance','MOTION_GAP_S','MIN_TRACK_FRAMES'];
vm.runInContext(src.slice(a,b).replace(/^function renderAnalysis[\s\S]*?^\}/m,'')+'\n'+
  names.map(n=>`globalThis.${n}=${n};`).join('\n'),ctx);

// The old adjacent-frame measure, for comparison.
function oldMotion(history, spf){
  if(!history||history.length<2) return null;
  let tot=0,n=0;
  for(let i=1;i<history.length;i++){tot+=ctx.signatureDistance(history[i-1].norm,history[i].norm);n++;}
  return (tot/n)*(1/spf);
}
function tracksOf(frames,cw,ch,spf){
  const fp=frames.map(ps=>ps.map(lms=>({sig:ctx.poseSignature(lms,cw,ch),metrics:ctx.frameMetrics(lms,cw,ch)})));
  return ctx.buildTracks(fp,spf).filter(t=>t.metrics.length>=4)
    .map(t=>({n:t.metrics.length,neu:t.motionPerSec,old:oldMotion(t.history,spf)}))
    .sort((x,y)=>y.n-x.n);
}
console.log(`gap ${ctx.MOTION_GAP_S}s\n`);
console.log('clip                    rate     frames   NEW /s   OLD /s');
for(const [label,f] of process.argv.slice(2).map(x=>x.split('='))){
  const d=JSON.parse(fs.readFileSync(f,'utf8'));
  for(const [which,spf,frames] of [['scout',d.secondsPerFrame,d.scout],['dense',1/30,d.dense]]){
    const ts=tracksOf(frames,d.cw,d.ch,spf);
    if(!ts.length){console.log(`${label.padEnd(22)} ${which} @${(1/spf).toFixed(1)}/s   (no track)`);continue;}
    // show every track long enough to be a candidate, not just the longest
    const shown=ts.filter(t=>t.n>=8).slice(0,4);
    const cells=shown.map(t=>`${t.n}f:${t.neu==null?'-':t.neu.toFixed(2)}`).join('  ');
    console.log(`${label.padEnd(22)} ${which.padEnd(5)} @${(1/spf).toFixed(1).padStart(4)}/s  ${cells||'(no track >=8f)'}`);
  }
}
