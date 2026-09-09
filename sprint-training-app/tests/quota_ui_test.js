const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const APP_DIR=process.env.APP_DIR || require('path').join(__dirname, 'fixtures/app');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
function serve(){return new Promise(r=>{const s=http.createServer((rq,rs)=>{const fp=path.join(APP_DIR,rq.url==='/'?'/index.html':rq.url);fs.readFile(fp,(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});rs.end(d);});});s.listen(0,()=>r(s));});}
let pass=0,fail=0;
const assert=(c,m)=>{if(c){console.log('PASS: '+m);pass++;}else{console.error('FAIL: '+m);fail++;}};

(async()=>{
  const server=await serve(),port=server.address().port;
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const page=await (await browser.newContext({viewport:{width:390,height:844}})).newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));

  let purgeCalls=[], removedPaths=null, updatedPatch=null, signCalls=[];
  const old = new Date(Date.now()-90*86400000).toISOString();
  const recent = new Date().toISOString();
  let entries=[
    {id:'d1',created_at:old,clip_type:'Max Velocity',video_path:'u/old.mp4',analysis:{summary:'Old clip',pinpoints:[]}},
    {id:'d2',created_at:recent,clip_type:'Acceleration',video_path:'u/new.mp4',analysis:{summary:'Recent clip',pinpoints:[]}},
  ];

  await page.route('**/*supabase.co/**',async route=>{
    const u=route.request().url(),m=route.request().method();
    const json=b=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
    if(u.includes('/storage/v1/object/remove')||(u.includes('/storage/')&&m==='DELETE')){
      removedPaths=route.request().postData(); return json([]);
    }
    if(u.includes('/storage/v1/object/sign')){signCalls.push(u);return json({signedURL:'/x.mp4?token='+(signCalls.length)});}
    if(u.includes('/rest/v1/diagnosis_entries')&&m==='GET'){
      purgeCalls.push(u);
      // the purge query filters on video_path not null + created_at older than cutoff
      if(u.includes('video_path=not.is.null')) return json(entries.filter(e=>e.video_path&&e.created_at===old));
      return json(entries);
    }
    if(u.includes('/rest/v1/diagnosis_entries')&&m==='PATCH'){
      updatedPatch=route.request().postData(); return json([]);
    }
    return json([]);
  });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(()=>typeof window.handleSession==='function');
  await page.evaluate(()=>window.handleSession({user:{id:'u'}}));
  await page.waitForTimeout(900);

  assert(errors.length===0,'no page errors on load: '+JSON.stringify(errors));

  const purgeQuery = purgeCalls.find(u=>u.includes('video_path=not.is.null'));
  assert(!!purgeQuery,'retention purge queries only entries that still have a video');
  assert(purgeQuery && /created_at=lt\./.test(purgeQuery),'purge is bounded by a created_at cutoff: '+(purgeQuery||'').split('?')[1]);
  assert(!!removedPaths && removedPaths.includes('old.mp4'),'the 90-day-old clip is removed from storage: '+removedPaths);
  assert(!removedPaths || !removedPaths.includes('new.mp4'),'a recent clip is left alone');
  assert(!!updatedPatch && updatedPatch.includes('video_path')&&updatedPatch.includes('null'),'video_path is nulled after the file is deleted: '+updatedPatch);

  // ---------- egress: browsing the history must not download the clips ----------
  // A clip is 20-30MB and a phone puts the file index at the END, so a browser
  // asked for even a still frame pulls most of the file down. Attaching a
  // <video src> per entry meant opening this tab downloaded the whole history,
  // and re-signing on every render defeated the CDN cache on top of that --
  // together they burned a month of free-tier egress in a handful of visits.
  assert(signCalls.length===0,
    'opening the history signs no video urls at all, so nothing is fetched: '+signCalls.length+' calls');
  const videoSrcs = await page.$$eval('#diagnosisList video',els=>els.map(e=>e.getAttribute('src')||''));
  assert(videoSrcs.length===0,'no <video> element exists before the athlete asks for one');
  const playBtns = await page.$$('#diagnosisList .video-load-btn');
  assert(playBtns.length===2,'each stored clip offers a play button instead, got '+playBtns.length);

  // Tapping one loads exactly that clip, and nothing else.
  await playBtns[0].click();
  await page.waitForSelector('#diagnosisList video');
  assert(signCalls.length===1,'tapping play signs exactly one url: '+signCalls.length);
  const loaded = await page.$$eval('#diagnosisList video',els=>els.map(e=>({src:e.getAttribute('src'),pre:e.getAttribute('preload')})));
  assert(loaded.length===1,'only the clip that was tapped gets a video element, got '+loaded.length);
  assert(loaded[0].pre==='none','the video does not preload beyond what playback needs');
  assert(/x\.mp4/.test(loaded[0].src||''),'the tapped clip points at its signed url: '+loaded[0].src);

  // Re-signing the same path would mint a new url, which the CDN has never
  // seen and cannot serve from cache -- that is what made this cached egress.
  const reused = await page.evaluate(async ()=>{
    const a = await window.signedVideoUrl('u/new.mp4');
    const b = await window.signedVideoUrl('u/new.mp4');
    return a===b;
  });
  assert(reused,'a second request for the same clip reuses the signed url rather than minting a new one');

  // Retention notice is visible to the athlete
  const hint = await page.$$eval('#panel-diagnosis .hint',els=>els.map(e=>e.textContent).join(' '));
  assert(/60 days/.test(hint),'the 60-day retention is stated in the UI');

  await browser.close();server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
