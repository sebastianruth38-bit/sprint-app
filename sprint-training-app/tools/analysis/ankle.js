// The athlete says his ankle was stiff, and it scored 2/5 "landing toes-down".
// Which frames is the ankle angle actually being read from?
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'..','..','app.js'),'utf8');
const ctx={console,Math,JSON,Array,Object,Number,Infinity,isFinite};vm.createContext(ctx);
const a=src.indexOf('const POSE_LM'),b=src.indexOf('function getPoseLandmarker');
const N=['frameMetrics','poseSignature','selectSubject','longestConsistentRun','footContacts',
        'median','busiestTime','DENSE_MAX_SAMPLES','DENSE_RATE','MIN_TRACK_FRAMES','CONTACT_TOLERANCE'];
vm.runInContext(src.slice(a,b).replace(/^function renderAnalysis[\s\S]*?^\}/m,'')+'\n'+
  N.map(n=>`globalThis.${n}=${n};`).join('\n'),ctx);
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const build=(poses,t,srcPxH,region)=>poses.map((lms)=>{
  const cw=region?d.cw*region.w:d.cw, ch=region?d.ch*region.h:d.ch;
  const seen=ctx.frameMetrics(lms,cw||d.cw,ch||d.ch);
  const whole=region?lms.map(p=>Object.assign({},p,{x:region.x+p.x*region.w,y:region.y+p.y*region.h})):lms;
  const m=region?ctx.frameMetrics(whole,d.cw,d.ch):seen;
  m.bodyFrac=seen.bodyFrac;m.footAtEdge=seen.footAtEdge;m.bodyAtEdge=seen.bodyAtEdge;
  m.bodyPx=m.bodyFrac?m.bodyFrac*(srcPxH||d.srcH):null;m.t=t;
  return {sig:ctx.poseSignature(whole,d.cw,d.ch),metrics:m};
});
const shot=d.scout.map((p,i)=>build(p,d.scoutTimes[i],d.scoutH&&d.scoutH[i],d.scoutR&&d.scoutR[i]));
const seenAt=[];shot.forEach((p,i)=>{if(p.length)seenAt.push(d.scoutTimes[i]);});
const span=ctx.DENSE_MAX_SAMPLES/ctx.DENSE_RATE;
const busiest=ctx.busiestTime(shot,d.scoutTimes,d.secondsPerFrame);
const centre=busiest!=null?busiest:seenAt[Math.floor(seenAt.length/2)];
const first=seenAt[0],last=seenAt[seenAt.length-1];
const from=(last-first<=span)?first:Math.min(Math.max(first,centre-span/2),last-span);
const to=Math.min(last,from+span);
const idx=d.denseTimes.map((t,i)=>({t,i})).filter(x=>x.t>=from-1e-6&&x.t<=to+1e-6).slice(0,ctx.DENSE_MAX_SAMPLES);
const dense=idx.map(x=>build(d.dense[x.i],x.t,d.denseH&&d.denseH[x.i],d.denseR&&d.denseR[x.i]));
const sel=ctx.selectSubject(dense,1/ctx.DENSE_RATE);
if(sel.rejection){console.log('refused:',sel.rejection);process.exit(0);}
const m=ctx.longestConsistentRun(sel.metrics);
console.log(`graded on ${m.length} frames, contact tolerance ${ctx.CONTACT_TOLERANCE}\n`);
console.log('  t      footDepth(L)  footDepth(R)   ankleL  ankleR   <- depth = how far below the hip, in leg lengths');
m.forEach((f)=>{
  const dep=(l)=>l?((l.ank[1]-f.midHip[1])/(l.legLen||1)).toFixed(2):'  -';
  const an=(l)=>l&&l.footVsShin!=null?l.footVsShin.toFixed(0):' -';
  console.log(`  ${f.t.toFixed(2)}   ${dep(f.legs[0]).padStart(10)}   ${dep(f.legs[1]).padStart(10)}   ${an(f.legs[0]).padStart(6)}  ${an(f.legs[1]).padStart(6)}`);
});
[0,1].forEach((side)=>{
  const cs=ctx.footContacts(m,side);
  console.log(`\nside ${side}: ${cs.length} contact(s) at t=${cs.map(c=>m[c.i].t.toFixed(2)).join(', ')}` +
    `  ankle=${cs.map(c=>c.leg.footVsShin!=null?c.leg.footVsShin.toFixed(0):'-').join(', ')}`);
});
