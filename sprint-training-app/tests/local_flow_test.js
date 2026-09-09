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
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  // What the athlete is actually shown when a save goes wrong.
  const alerts=[]; page.on('dialog',d=>{alerts.push(d.message);d.dismiss().catch(()=>{});});
  await page.route('**/*supabase.co/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(()=>typeof window.handleSession==='function');
  await page.evaluate(()=>window.handleSession({user:{id:'u'}}));
  await page.waitForTimeout(500);
  assert(errors.length===0,'app loads with no errors: '+JSON.stringify(errors));

  // AI is opt-in, off by default -- this is the "paused" state.
  const checked = await page.$eval('#aiAssist', el=>el.checked);
  assert(checked===false,'AI coach notes are OFF by default (local is the default engine)');
  const label = await page.$eval('.ai-toggle', el=>el.textContent.replace(/\s+/g,' ').trim());
  assert(/daily quota/.test(label),'the toggle says it costs quota: "'+label+'"');

  // Exercise the real scoring pipeline in the page, using measurements taken
  // from the athlete's actual reference images.
  const results = await page.evaluate(() => {
    // Legs with real touchdowns, so the clip has countable strides. Without
    // them nothing can be told about how much run this is, and acceleration
    // is judged on the lean rather than on the rise -- correctly, but that is
    // not what these fixtures are here to check.
    let phase=0;
    const m=(t,s,h=87,k=50)=>{
      const ph=phase++%6, down=(d)=>({ank:[100,d?180:130],hip:[100,100],legLen:80,
        footVsShin:95,facing:1,thighSwing:20,knee:k});
      return {torsoFromVertical:t,scissor:s,thighRise:s/1000,hipAngle:h,leadKnee:k,kneeFold:k,
        midHip:[100,100],legs:[down(ph===0||ph===1),down(ph===3||ph===4)]};
    };
    return {
      // peak scissor 80.1 = measured from the elite max-velocity reference
      elite: buildLocalAnalysis([m(6,119),m(6,113),m(5,112),m(7,108)],'Max Velocity','Track'),
      // torso 68 -> 6 = measured from the block-clearance and max-v references
      // long enough to show a progression: 68 degrees down to 6 across
      // several strides, which is the block-clearance to upright reference
      accel: buildLocalAnalysis(
        [68,62,56,50,44,37,30,24,18,12,8,6,6,6,6,6,6,6].map((t,i)=>m(t,40+i*2)),'Acceleration'),
      weak:  buildLocalAnalysis([m(6,66,125,90),m(6,68,124,92),m(6,65,126,91),m(6,64,127,90)],'Max Velocity','Track'),
      blind: buildLocalAnalysis([{torsoFromVertical:null,scissor:null},{torsoFromVertical:null,scissor:null},{torsoFromVertical:null,scissor:null}],'Max Velocity','Track'),
    };
  });

  assert(results.elite.pinpoints[0].score===5,'elite clip values score 5/5 on torso-to-thigh: '+results.elite.pinpoints[0].note);
  assert(/Smooth progressive rise/.test(results.accel.pinpoints[0].note),'acceleration scored on the progression: '+results.accel.pinpoints[0].note);
  assert(results.weak.flags.length>0,'weak separation raises a flag: '+JSON.stringify(results.weak.flags));
  assert(results.blind.pinpoints.length===0,'unreadable clip refuses to score rather than guessing');

  // The local result must render through the existing analysis UI unchanged.
  const html = await page.evaluate(() => renderAnalysisHtml(
    buildLocalAnalysis([{torsoFromVertical:6,scissor:119,thighRise:0.09,hipAngle:87,leadKnee:81,kneeFold:50},
                        {torsoFromVertical:6,scissor:113,thighRise:0.06,hipAngle:85,leadKnee:88,kneeFold:52},
                        {torsoFromVertical:5,scissor:112,thighRise:0.02,hipAngle:85,leadKnee:87,kneeFold:48}],'Max Velocity','Track')));
  assert(/score-pill/.test(html)&&/\/5/.test(html),'local scores render through the existing analysis card');
  assert(/Torso-to-Thigh/.test(html),'the torso-to-thigh measurement is shown by name');

  // Pose model absent (blocked CDN here) must degrade, not crash.
  const degraded = await page.evaluate(async () => {
    try { await getPoseLandmarker(); return 'loaded'; }
    catch (e) { return 'threw:' + (e.message || e).slice(0,40); }
  });
  assert(degraded.startsWith('threw'),'pose loader rejects cleanly when the CDN is unreachable (sandbox): '+degraded);
  assert(errors.length===0,'…and that rejection does not surface as an uncaught page error');

  // ---------- the save path, for a clip that gets refused ----------
  // buildLocalAnalysis above is called directly, so nothing here had ever
  // exercised saveDiagnosis itself. A refusal reads several values out of
  // extractFrames to explain itself, and one of them (capture) was used
  // without being destructured -- a ReferenceError that node --check cannot
  // see, that every unit test missed, and that turned every refused clip on
  // the athlete's phone into "analysis failed".
  let insertedRow = null;
  await page.route('**/*supabase.co/**', async (route) => {
    const u = route.request().url(), m = route.request().method();
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('/storage/v1/object/list')) return json([]);
    if (u.includes('/storage/')) return json({ Key: 'ok' });
    if (u.includes('/rest/v1/diagnosis_entries') && m === 'POST') {
      insertedRow = route.request().postData(); return json([]);
    }
    return json([]);
  });

  const refusal = await page.evaluate(async () => {
    // Stand in for the whole capture stage: a clip that was read fine and
    // simply has nobody gradeable in it, which is the shape that broke.
    window.extractFrames = async () => ({
      frames: ['data:image/jpeg;base64,/9j/4AAQSkZJRg=='],
      metrics: [], denseFrames: 0,
      rejection: 'Nobody in this clip is moving like a sprinter.',
      shotTrimmed: false, duplicateShare: 0, cropped: 0,
      capture: { frames: 63, withPose: 16, played: true, duration: 2.1 },
    });
    pendingBlob = new File([new Uint8Array([0])], 'clip.mov', { type: 'video/quicktime' });
    document.getElementById('clipType').value = 'Acceleration';
    const before = Date.now();
    document.getElementById('saveDiagnosis').click();
    // Wait for the button to be handed back, which is the end of the flow.
    while (document.getElementById('saveDiagnosis').disabled && Date.now() - before < 15000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return document.getElementById('analysisStatus').textContent;
  });

  // saveDiagnosis catches its own errors and shows them in an alert, so a
  // throw in here never reaches pageerror -- watching for one proves nothing.
  // What the athlete actually saw was the alert, and an entry whose analysis
  // came back null. Assert on those.
  assert(!/analysis failed/i.test(alerts.join(' ')),
    'a refused clip does not alert the athlete that analysis failed: ' + JSON.stringify(alerts));
  assert(!!insertedRow, 'the refused clip is still saved');
  const saved = insertedRow ? JSON.parse(insertedRow) : null;
  const row = saved ? (Array.isArray(saved) ? saved[0] : saved) : null;
  assert(row && row.analysis, 'the saved entry carries an analysis rather than null: ' + JSON.stringify(row && row.analysis));
  const note = (row && row.analysis && row.analysis.filming_note) || '';
  assert(/moving like a sprinter/.test(note), 'the refusal reason is kept: ' + note);
  assert(/16 of 63 frames/.test(note),
    'and it carries what the device actually decoded, so a screenshot is diagnosable: ' + note);

  await browser.close();server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
