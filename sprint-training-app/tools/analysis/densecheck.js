// Does the dense pass give the same answer regardless of where the window
// lands? That is the whole point of the change.
const fs=require('fs'), vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'..','..','app.js'),'utf8');
const ctx={console,Math,JSON,Array,Object,Number,Infinity,isFinite}; vm.createContext(ctx);
const a=src.indexOf('const POSE_LM'), b=src.indexOf('function getPoseLandmarker');
const names=['frameMetrics','poseSignature','followNearest','longestConsistentRun',
             'buildLocalAnalysis','median','scoreMaxVelocity','limitToStrides'];
vm.runInContext(src.slice(a,b).replace(/^function renderAnalysis[\s\S]*?^\}/m,'')+'\n'+
  names.map(n=>`globalThis.${n}=${n};`).join('\n'),ctx);
const pick=(an,name)=>{const p=(an.pinpoints||[]).find(p=>p.name.startsWith(name));return p?p.note.match(/-?\d+(\.\d+)?/g).pop():'-';};
console.log('window            frames  hip@peak  scissor  torso  fold');
for(const f of process.argv.slice(2)){
  const {cw,ch,srcH,frames}=JSON.parse(fs.readFileSync(f,'utf8'));
  const fp=frames.map(ps=>ps.map(lms=>{
    const m=ctx.frameMetrics(lms,cw,ch); m.bodyPx=m.bodyFrac?m.bodyFrac*srcH:null;
    return {sig:ctx.poseSignature(lms,cw,ch),metrics:m};
  }));
  const m=ctx.longestConsistentRun(ctx.followNearest(fp));
  const an=ctx.buildLocalAnalysis(m,'Max Velocity','Track');
  console.log(`${f.split('/').pop().padEnd(16)}  ${String(m.length).padStart(6)}  `+
    `${pick(an,'Torso-to-Thigh').padStart(8)}  ${pick(an,'Thigh Separation').padStart(7)}  `+
    `${pick(an,'Upright').padStart(5)}  ${pick(an,'Heel Recovery').padStart(4)}`);
}
