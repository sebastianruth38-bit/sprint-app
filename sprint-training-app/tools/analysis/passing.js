// "Backside isn't the enemy, frontside isn't the hero -- you'll have both."
//
// So the question is not how far the thigh travels each way. The coaching
// measure of the two working together is the PASSING POSITION: as the
// recovery thigh swings through vertical, has the leg folded and come up
// under the hip, or is it still trailing long behind?
//
// A long lever passing low is slow to bring through however much frontside
// follows it. A folded one is quick. That is about the two halves being
// organised together, not about having less of one.
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'..','..','app.js'),'utf8');
const ctx={console,Math,JSON,Array,Object,Number,Infinity,isFinite};vm.createContext(ctx);
const a=src.indexOf('const POSE_LM'),b=src.indexOf('function getPoseLandmarker');
const N=['frameMetrics','poseSignature','selectSubject','longestConsistentRun','median',
 'busiestTime','DENSE_MAX_SAMPLES','MIN_TRACK_FRAMES','CAPTURE_RATE'];
vm.runInContext(src.slice(a,b).replace(/^function renderAnalysis[\s\S]*?^\}/m,'')+'\n'+
 N.map(n=>`globalThis.${n}=${n};`).join('\n'),ctx);

function measure(file,label){
  const d=JSON.parse(fs.readFileSync(file,'utf8'));
  const build=(poses,t,srcPxH,region)=>poses.map((lms)=>{
    const cw=region?d.cw*region.w:d.cw, ch=region?d.ch*region.h:d.ch;
    const seen=ctx.frameMetrics(lms,cw||d.cw,ch||d.ch);
    const whole=region?lms.map(p=>Object.assign({},p,{x:region.x+p.x*region.w,y:region.y+p.y*region.h})):lms;
    const m=region?ctx.frameMetrics(whole,d.cw,d.ch):seen;
    m.bodyFrac=seen.bodyFrac;m.bodyAtEdge=seen.bodyAtEdge;m.footAtEdge=seen.footAtEdge;
    m.bodyPx=m.bodyFrac?m.bodyFrac*(srcPxH||d.srcH):null;m.t=t;
    return {sig:ctx.poseSignature(whole,d.cw,d.ch),metrics:m};
  });
  const all=d.dense.map((p,i)=>build(p,d.denseTimes[i],d.denseH&&d.denseH[i],d.denseR&&d.denseR[i]));
  const spf=1/ctx.CAPTURE_RATE;
  const sel=ctx.selectSubject(all,spf);
  if(sel.rejection){console.log(`${label.padEnd(22)} refused (${sel.rejection})`);return;}
  const m=ctx.longestConsistentRun(sel.metrics);
  const facing=ctx.median(m.flatMap(f=>(f.legs||[]).map(l=>l.facing)).filter(v=>v))||1;

  // Find where each thigh passes vertical, and how folded the leg is there.
  const passes=[];
  [0,1].forEach((side)=>{
    for(let i=1;i<m.length;i++){
      const p=m[i-1].legs&&m[i-1].legs[side], q=m[i].legs&&m[i].legs[side];
      if(!p||!q) continue;
      const a0=p.thighSwing*facing, a1=q.thighSwing*facing;
      if(a0<0 && a1>=0){                       // swinging through vertical
        const leg=q, hip=leg.hip, ank=leg.ank, knee=leg.knee;
        const L=leg.legLen||1;
        passes.push({
          t:m[i].t,
          heelUnderHip:(hip[1]-ank[1])/L,      // + = ankle ABOVE the hip
          heelToKnee:(knee[1]-ank[1])/L,       // + = ankle above the knee
          fold:leg.kneeAngle,                   // thigh-to-shin at that moment
        });
      }
    }
  });
  if(!passes.length){console.log(`${label.padEnd(22)} no passing frames found`);return;}
  const f=(k)=>ctx.median(passes.map(p=>p[k]));
  // The tightest the leg folds ANYWHERE in the cycle, for comparison: the
  // gap between that and the fold at passing is the timing question -- does
  // the leg shorten in time to swing through, or only afterwards?
  const tightest=Math.min(...m.map(x=>x.kneeFold).filter(v=>v!=null));
  console.log(`${label.padEnd(22)} ${String(passes.length).padStart(2)} passes | ` +
    `ankle below knee ${f('heelToKnee').toFixed(2)} legs | ` +
    `fold AT passing ${f('fold').toFixed(0)}° | tightest fold anywhere ${tightest.toFixed(0)}° | ` +
    `late by ${(f('fold')-tightest).toFixed(0)}°`);
}
console.log('at the moment the recovery thigh passes vertical (all in leg lengths):\n');
process.argv.slice(2).forEach((x)=>{const [l,f]=x.split('=');measure(f,l);});
