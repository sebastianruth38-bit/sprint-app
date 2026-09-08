// Where does the time actually go: seeking/decoding, or pose inference?
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const APP='/tmp/claude-0/-home-user-claude-code/961e20ff-2122-5f80-8e50-942d67de74dd/scratchpad/sb-test/app';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webm':'video/webm'};
const s=http.createServer((rq,rs)=>{const u=rq.url.split('?')[0];
 const fp=u.startsWith('/clip/')?path.join('/tmp/pose',u.slice(6)):path.join(APP,u==='/'?'/index.html':u);
 fs.readFile(fp,(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});rs.end(d);});});
s.listen(0,async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const p=await b.newPage();
 await p.route('**/*supabase.co/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
 await p.goto('http://localhost:'+s.address().port+'/index.html');
 await p.waitForFunction(()=>typeof extractFrames==='function');
 const out = await p.evaluate(async (u)=>{
   const t={seek:0,pose:0,draw:0,encode:0,poseCalls:0,seeks:0};
   // wrap the timing points
   const origRAF=window.requestAnimationFrame;
   window.__t=t;
   window.getPoseLandmarker=async()=>({detect:(src)=>{
     const a=performance.now();
     // burn roughly what a real pose inference costs so the split is realistic
     let x=0; for(let i=0;i<3.2e6;i++) x+=Math.sqrt(i);
     t.pose+=performance.now()-a; t.poseCalls++;
     const lm=[]; for(let i=0;i<33;i++) lm.push({x:0.35+(i%5)*0.02,y:0.2+(i/32)*0.6,visibility:0.95});
     return {landmarks:[lm], _x:x};
   }});
   const blob=await (await fetch(u)).blob();
   const t0=performance.now();
   const r=await extractFrames(blob,6,480,()=>{});
   return {total:Math.round(performance.now()-t0), pose:Math.round(t.pose), poseCalls:t.poseCalls,
           cropped:r.cropped, dup:r.duplicateShare};
 }, 'http://localhost:'+s.address().port+'/clip/blockStart.webm');
 console.log(`total ${out.total}ms | pose ${out.pose}ms across ${out.poseCalls} calls | everything else ${out.total-out.pose}ms`);
 console.log(`crops ${out.cropped} (each cropped frame costs a SECOND pose call)`);
 console.log(`=> pose is ${(out.pose/out.total*100).toFixed(0)}% of the time, seek/decode ${((out.total-out.pose)/out.total*100).toFixed(0)}%`);
 await b.close(); s.close();
});
