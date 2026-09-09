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

  let purgeCalls=[], removedPaths=null, updatedPatch=null, signCalls=[], allRemoves=[];
  // What is actually sitting in the bucket, including files no entry points at.
  const hourAgo=new Date(Date.now()-3600000).toISOString();
  let bucketFiles=[
    {name:'old.mp4',created_at:hourAgo},
    {name:'new.mp4',created_at:hourAgo},
    {name:'stranded1.mov',created_at:hourAgo},
    {name:'stranded2.mov',created_at:hourAgo},
    // Uploaded seconds ago: a save whose row has not been written yet.
    {name:'inflight.mov',created_at:new Date().toISOString()},
  ];
  const old = new Date(Date.now()-90*86400000).toISOString();
  const recent = new Date().toISOString();
  let entries=[
    {id:'d1',created_at:old,clip_type:'Max Velocity',video_path:'u/old.mp4',analysis:{summary:'Old clip',pinpoints:[]}},
    {id:'d2',created_at:recent,clip_type:'Acceleration',video_path:'u/new.mp4',thumb:'data:image/jpeg;base64,/9j/4AAQSkZJRg==',analysis:{summary:'Recent clip',pinpoints:[]}},
  ];

  await page.route('**/*supabase.co/**',async route=>{
    const u=route.request().url(),m=route.request().method();
    const json=b=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
    if(u.includes('/storage/v1/object/list')){
      return json(bucketFiles);
    }
    if(u.includes('/storage/v1/object/remove')||(u.includes('/storage/')&&m==='DELETE')){
      removedPaths=route.request().postData();
      allRemoves.push(route.request().postData()); return json([]);
    }
    if(u.includes('/storage/v1/object/sign')){signCalls.push(u);return json({signedURL:'/x.mp4?token='+(signCalls.length)});}
    if(u.includes('/rest/v1/diagnosis_entries')&&m==='GET'){
      purgeCalls.push(u);
      // The purge query and the orphan query both filter video_path not null.
      // Only the purge carries a created_at cutoff -- keying on the shared
      // filter alone made the orphan sweep see one entry and conclude every
      // other clip was unreferenced.
      if(u.includes('video_path=not.is.null')&&u.includes('created_at=lt.'))
        return json(entries.filter(e=>e.video_path&&e.created_at===old));
      if(u.includes('video_path=not.is.null'))
        return json(entries.filter(e=>e.video_path));
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
  // Two sweeps remove files now (retention, then orphans), so assert against
  // every remove call rather than whichever happened to be last.
  const everyRemove = allRemoves.join(' ');
  assert(everyRemove.includes('old.mp4'),'the 90-day-old clip is removed from storage: '+everyRemove);
  assert(!everyRemove.includes('new.mp4'),'a recent clip is left alone: '+everyRemove);
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

  // Counted before the tap below, which swaps one button out for a video.
  const thumbed = await page.$$eval('#diagnosisList .video-load-btn.has-thumb',
    els=>els.map(e=>e.style.backgroundImage));
  assert(thumbed.length===1,'the entry that has a stored still shows it, got '+thumbed.length);
  assert(/^url\("data:image\/jpeg/.test(thumbed[0]||''),
    'the preview comes from the row, not a fetched file: '+(thumbed[0]||'').slice(0,40));
  const plainBtns = await page.$$('#diagnosisList .video-load-btn:not(.has-thumb)');
  assert(plainBtns.length===1,'an entry saved before thumbnails existed still gets a plain button');

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

  // ---------- files in the bucket that no entry points at ----------
  // The retention purge walks entries, so a file that never got a row is
  // invisible to it and sits there for good. Six had accumulated, 101MB,
  // left behind when a save was interrupted after the upload.
  const removedAll = allRemoves.join(' ');
  assert(/stranded1\.mov/.test(removedAll) && /stranded2\.mov/.test(removedAll),
    'files with no entry pointing at them are cleared: '+removedAll);
  // A save writes its row after the upload. Sweeping in that window -- from a
  // render in another tab, or the one that follows the save itself -- would
  // delete the clip out from under a save that then succeeds.
  assert(!/inflight\.mov/.test(removedAll),
    'a file uploaded seconds ago is left alone, in case its save is still in flight: '+removedAll);

  // Retention notice is visible to the athlete
  const hint = await page.$$eval('#panel-diagnosis .hint',els=>els.map(e=>e.textContent).join(' '));
  // Asserted against the constant, not a hard-coded number: the two drifted
  // apart the moment retention changed, and the UI kept promising 60 days
  // while the purge had already moved to 30.
  const days = await page.evaluate(() => VIDEO_RETENTION_DAYS);
  assert(new RegExp(days + ' days').test(hint),
    `the UI states the same retention the purge uses (${days} days): ` + hint);

  await browser.close();server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
