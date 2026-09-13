// The athlete's idea: if the ankle collapses the hip falls with it, so hip
// height THROUGH a contact should carry the same information as the ankle
// angle -- but read from the hip and knee, which are large stable landmarks,
// instead of the toe, which is neither.
//
// Question this answers: is hip drop through contact stable enough to score?
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'..','..','app.js'),'utf8');
const ctx={console,Math,JSON,Array,Object,Number,Infinity,isFinite};vm.createContext(ctx);
const a=src.indexOf('const POSE_LM'),b=src.indexOf('function getPoseLandmarker');
const N=['frameMetrics','poseSignature','selectSubject','longestConsistentRun','footContacts',
        'median','busiestTime','DENSE_MAX_SAMPLES','DENSE_RATE','MIN_TRACK_FRAMES','CONTACT_DEPTH_MIN'];
vm.runInContext(src.slice(a,b).replace(/^function renderAnalysis[\s\S]*?^\}/m,'')+'\n'+
  N.map(n=>`globalThis.${n}=${n};`).join('\n'),ctx);

function analyse(file,label){
  const d=JSON.parse(fs.readFileSync(file,'utf8'));
  const build=(poses,t,srcPxH,region)=>poses.map((lms)=>{
    const cw=region?d.cw*region.w:d.cw, ch=region?d.ch*region.h:d.ch;
    const seen=ctx.frameMetrics(lms,cw||d.cw,ch||d.ch);
    const whole=region?lms.map(p=>Object.assign({},p,{x:region.x+p.x*region.w,y:region.y+p.y*region.h})):lms;
    const m=region?ctx.frameMetrics(whole,d.cw,d.ch):seen;
    m.bodyFrac=seen.bodyFrac;m.footAtEdge=seen.footAtEdge;m.bodyAtEdge=seen.bodyAtEdge;
    m.bodyPx=m.bodyFrac?m.bodyFrac*(srcPxH||d.srcH):null;m.t=t;
    return {sig:ctx.poseSignature(whole,d.cw,d.ch),metrics:m};
  });
  // use the whole dense capture: contacts are what matter, not the window
  const dense=d.dense.map((p,i)=>build(p,d.denseTimes[i],d.denseH&&d.denseH[i],d.denseR&&d.denseR[i]));
  const sel=ctx.selectSubject(dense,1/30);
  if(sel.rejection){console.log(`${label}: refused (${sel.rejection})`);return;}
  const m=ctx.longestConsistentRun(sel.metrics);
  const hipH=(f,l)=>(l.ank[1]-f.midHip[1])/(l.legLen||1);
  const rows=[];
  [0,1].forEach((side)=>{
    ctx.footContacts(m,side).forEach((c)=>{
      const i=c.i;
      const at=hipH(m[i],c.leg);
      if(at < ctx.CONTACT_DEPTH_MIN) return;
      // Follow the hip only while that foot is STILL PLANTED. Running past
      // toe-off measures the leg swinging through, not the hip settling, and
      // that is where the wild outliers came from.
      let lowest=at, held=0;
      for(let j=i;j<Math.min(m.length,i+5);j++){
        const l=m[j].legs[side];
        if(!l) break;
        const h=hipH(m[j],l);
        if(h < ctx.CONTACT_DEPTH_MIN) break;   // foot has left the ground
        lowest=Math.min(lowest,h); held++;
      }
      if(held<2) return;                        // never saw it settle
      rows.push({t:m[i].t,at,lowest,drop:at-lowest,held,ankle:c.leg.footVsShin});
    });
  });
  if(!rows.length){console.log(`${label}: no real touchdowns`);return;}
  const drops=rows.map(r=>r.drop);
  console.log(`\n${label}  (${rows.length} touchdowns, ${m.length} frames)`);
  console.log('   t     hipAtTD  hipLowest   DROP  held  ankle(toe-based)');
  rows.forEach(r=>console.log(`  ${r.t.toFixed(2)}   ${r.at.toFixed(2)}     ${r.lowest.toFixed(2)}    ${r.drop.toFixed(3)}   ${String(r.held).padStart(2)}f   ${r.ankle!=null?r.ankle.toFixed(0):'-'}`));
  console.log(`  median drop ${ctx.median(drops).toFixed(3)} of a leg   spread ${(Math.max(...drops)-Math.min(...drops)).toFixed(3)}`);
}
process.argv.slice(2).forEach((x)=>{const [l,f]=x.split('=');analyse(f,l);});
