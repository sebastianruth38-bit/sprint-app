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

  assert(results.elite.pinpoints[0].score===5,'elite clip values score 5/5 on thigh separation: '+results.elite.pinpoints[0].note);
  assert(/Smooth progressive rise/.test(results.accel.pinpoints[0].note),'acceleration scored on the progression: '+results.accel.pinpoints[0].note);
  assert(results.weak.flags.length>0,'weak separation raises a flag: '+JSON.stringify(results.weak.flags));
  assert(results.blind.pinpoints.length===0,'unreadable clip refuses to score rather than guessing');

  // The local result must render through the existing analysis UI unchanged.
  const html = await page.evaluate(() => renderAnalysisHtml(
    buildLocalAnalysis([{torsoFromVertical:6,scissor:119,thighRise:0.09,hipAngle:87,leadKnee:81,kneeFold:50},
                        {torsoFromVertical:6,scissor:113,thighRise:0.06,hipAngle:85,leadKnee:88,kneeFold:52},
                        {torsoFromVertical:5,scissor:112,thighRise:0.02,hipAngle:85,leadKnee:87,kneeFold:48}],'Max Velocity','Track')));
  assert(/score-pill/.test(html)&&/\/5/.test(html),'local scores render through the existing analysis card');
  // Max velocity is scored on the scissor now; Torso-to-Thigh was read at the
  // same instant off the same frames and said the same thing twice.
  assert(/Thigh Separation/.test(html),'the thigh separation measurement is shown by name');

  // Each score gets the same bar the profile uses, so a colour means the same
  // thing in both places.
  const bars = await page.evaluate((a) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="barProbe">' + renderAnalysisHtml(a) + '</div>');
    const out = Array.from(document.querySelectorAll('#barProbe .score-bar .progress-fill'))
      .map((e) => ({ w: e.style.width, c: e.style.background, fill: e.style.getPropertyValue('--fill').trim() }));
    const names = Array.from(document.querySelectorAll('#barProbe .score-row span:first-child'))
      .map((e) => e.textContent);
    document.getElementById('barProbe').remove();
    return { out, rows: names.length };
  }, {
    summary: 'x',
    pinpoints: [
      { name: 'Best', score: 5, note: 'n' },
      { name: 'Worst', score: 1, note: 'n' },
      { name: 'Middle', score: 3, note: 'n' },
      // Measured but deliberately not scored, like swing balance. A bar at
      // zero here would read as the worst possible mark.
      { name: 'Unscored', score: null, note: 'n' },
    ],
  });
  assert(bars.rows === 4, 'every measurement still gets a row, scored or not: ' + bars.rows);
  assert(bars.out.length === 3, 'only the scored ones get a bar: ' + bars.out.length);
  // The bar is full width and scaled, not a width that grows: animating width
  // relays out the page every frame, and this app cannot spare the main thread.
  assert(bars.out.every((b) => b.w === '100%'),
    'every bar is full width, and scaled instead: ' + JSON.stringify(bars.out.map((b) => b.w)));
  assert(bars.out[0].fill === '1' && bars.out[1].fill === '0.2' && bars.out[2].fill === '0.6',
    'the scale tracks the score: ' + JSON.stringify(bars.out.map((b) => b.fill)));
  assert(new Set(bars.out.map((b) => b.c)).size === 3,
    'and each score band gets its own colour: ' + JSON.stringify(bars.out.map((b) => b.c)));

  // ---------- a measure that cannot be read says so ----------
  // Ankle at Touchdown comes off the toe and declines to report more often
  // than it reports. A row that silently vanishes looks like the app forgot;
  // the athlete needs to know there is nothing wrong with their ankle.
  const ankle = await page.evaluate(() => {
    // Contacts whose toe angles disagree wildly: the toe was jumping, not the
    // ankle. Exactly the case the agreement gate exists to catch.
    let phase = 0;
    const m = (footVsShin) => {
      const ph = phase++ % 6;
      const down = (d) => ({ ank: [100, d ? 180 : 130], hip: [100, 100], legLen: 80,
        footVsShin, facing: 1, thighSwing: 20, knee: 50, shinFromVertical: 30 });
      return { torsoFromVertical: 8, scissor: 110, thighRise: 0.05, hipAngle: 88,
        leadKnee: 60, kneeFold: 50, midHip: [100, 100],
        legs: [down(ph === 0 || ph === 1), down(ph === 3 || ph === 4)] };
    };
    const spread = [70, 130, 75, 135, 72, 128].map(m);
    const accel = buildLocalAnalysis(spread, 'Acceleration', 'Track');
    const maxv = buildLocalAnalysis(spread, 'Max Velocity', 'Track');
    const find = (r) => (r.pinpoints || []).find((p) => p.name === 'Ankle at Touchdown');
    return {
      accelRow: find(accel) || null,
      maxvRow: find(maxv) || null,
      accelHtml: renderAnalysisHtml(accel),
    };
  });
  assert(ankle.accelRow, 'an acceleration clip still lists Ankle at Touchdown when it cannot be read');
  assert(ankle.accelRow && ankle.accelRow.score === null,
    'with no score, so it is skipped by the average and gets no bar: ' + JSON.stringify(ankle.accelRow && ankle.accelRow.score));
  assert(ankle.accelRow && /not measurable/i.test(ankle.accelRow.note),
    'and says it is not measurable: ' + (ankle.accelRow && ankle.accelRow.note || '').slice(0, 60));
  assert(ankle.accelRow && /toe/i.test(ankle.accelRow.note),
    'naming the toe, so it does not read as a fault in the athlete: ' + (ankle.accelRow && ankle.accelRow.note || '').slice(0, 90));
  assert(!ankle.maxvRow, 'max velocity does not list it at all, since it is an acceleration read now');
  assert(/Ankle at Touchdown/.test(ankle.accelHtml) && /Not measurable/i.test(ankle.accelHtml),
    'and the row renders through the analysis card');

  // Pose model absent (blocked CDN here) must degrade, not crash.
  const degraded = await page.evaluate(async () => {
    try { await getPoseLandmarker(); return 'loaded'; }
    catch (e) { return 'threw:' + (e.message || e).slice(0,40); }
  });
  assert(degraded.startsWith('threw'),'pose loader rejects cleanly when the CDN is unreachable (sandbox): '+degraded);
  assert(errors.length===0,'…and that rejection does not surface as an uncaught page error');

  // ---------- a slow device must not be blamed on the athlete ----------
  // Every band in the grader was calibrated at 30fps. Subsampling real clips
  // shows the motion figure that decides "is this a sprinter" falling with the
  // capture rate -- one clip reads 3.13/s at 30fps and 1.40/s at 4fps against
  // a floor of 0.9, with nothing about the running changed. Refusing is still
  // right at that rate, since two samples a stride cannot measure a touchdown
  // angle. Telling the athlete he was not sprinting is not.
  const reasons = await page.evaluate(() => ({
    slow: refusalReason('Nobody in this clip is moving like a sprinter.',
      { frames: 34, withPose: 16, duration: 9.0, span: 9.0, played: true, mode: 'playback' }),
    normal: refusalReason('Tracking jumped between overlapping people — film one athlete alone, side-on.',
      { frames: 85, withPose: 16, duration: 7.1, span: 7.1, played: true, mode: 'playback' }),
    // The seek fallback: 32 samples taken across about a second of a long
    // clip. That is the full capture rate, and dividing it by the clip's
    // whole duration is what reported it as 4/s.
    stepped: refusalReason('Nobody in this clip is moving like a sprinter.',
      { frames: 32, withPose: 30, duration: 7.5, span: 1.07, played: false, mode: 'scan' }),
    // The same pass genuinely sampling too thinly, over the stretch it
    // covered rather than over the clip.
    thin: refusalReason('Nobody in this clip is moving like a sprinter.',
      { frames: 30, withPose: 12, duration: 7.5, span: 7.5, played: false, mode: 'scan' }),
  }));
  assert(/frames a second/.test(reasons.slow) && /about the device rather than your running/.test(reasons.slow),
    'a 4fps playback capture blames the phone, not the athlete: ' + reasons.slow.slice(0, 90));
  assert(!/moving like a sprinter/.test(reasons.slow),
    'and drops the guard message that would read as a verdict on him: ' + reasons.slow.slice(0, 60));
  assert(/in shot about 4\.2s of 9\.0s/.test(reasons.slow),
    'while still carrying the numbers that make it diagnosable: ' + reasons.slow);
  // At a workable rate the real reason must survive untouched.
  assert(/overlapping people/.test(reasons.normal),
    'a 12fps capture keeps the guard that actually tripped: ' + reasons.normal.slice(0, 70));

  // The bug this replaced: 32 samples over 1.07s is 30/s, the rate we ask
  // for. Measured against the 7.5s clip it came out as 4/s and the athlete
  // was told his phone could not keep up, on a clip he had filmed at 30fps
  // and watched back himself.
  assert(!/frames a second/.test(reasons.stepped),
    'a dense seek pass at full rate is not reported as a slow one: ' + reasons.stepped.slice(0, 110));
  assert(/moving like a sprinter/.test(reasons.stepped),
    'so the guard that actually tripped is what gets shown: ' + reasons.stepped.slice(0, 80));
  // And when a seek pass really is too thin, it still says so -- without
  // pinning it on a phone that never got asked to decode anything.
  assert(/frames a second/.test(reasons.thin),
    'a genuinely thin seek pass still reports its rate: ' + reasons.thin.slice(0, 90));
  assert(!/this phone|this device/i.test(reasons.thin),
    'but does not blame the device for a rate the seek pass chose: ' + reasons.thin.slice(0, 120));
  assert(/Nothing is wrong with how you filmed it/.test(reasons.thin),
    'and says so plainly: ' + reasons.thin.slice(0, 120));

  // ---------- one-tap sign-in ----------
  // The point of the Google button is that a teammate standing on a track can
  // start using this without typing an email and inventing a password, which
  // is exactly where people give up. So it has to be the thing they see first.
  const auth = await page.evaluate(() => {
    const gate = document.getElementById('authGate');
    const g = document.getElementById('authGoogle');
    const email = document.getElementById('authEmail');
    return {
      hasGoogle: !!g,
      // Position, not just presence: below the email fields it is decoration.
      googleFirst: !!(g && email && g.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING),
      redirect: typeof authRedirectUrl === 'function' ? authRedirectUrl() : null,
      legalLinks: Array.from(gate.querySelectorAll('a')).map((a) => a.getAttribute('href')),
    };
  });
  assert(auth.hasGoogle, 'the sign-in screen offers Google');
  assert(auth.googleFirst, 'and offers it above the email fields, not under them');
  // Hard-coding a redirect breaks the moment the app moves domain, and a stale
  // one fails at the provider rather than in the app, which is hard to debug.
  const origin = await page.evaluate(() => window.location.origin);
  assert(auth.redirect && auth.redirect.startsWith(origin),
    'the redirect points back at wherever the app is actually served from: ' + auth.redirect);
  assert(!/[?#]/.test(auth.redirect),
    'and carries no query or hash, which would confuse the auth code coming back: ' + auth.redirect);
  assert(auth.legalLinks.includes('terms.html') && auth.legalLinks.includes('privacy.html'),
    'the gate links the terms and privacy policy someone is agreeing to: ' + JSON.stringify(auth.legalLinks));

  // ---------- key frames degrade rather than failing a save ----------
  // The clip is no longer stored: a session's record is its scores plus a few
  // stills. The scores are the part that matters, so every step of the
  // picture-taking has to be able to come back empty-handed without taking
  // the save down with it -- the same trade the compressor used to make when
  // it handed back an unshrunk file rather than none.
  const frames = await page.evaluate(async () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const real = dataUrlToBlob(jpeg);
    const moment = { t: 1.5, label: 'Touchdown', measure: 'Foot Strike vs COM' };
    return {
      realType: real && real.type,
      realSize: real && real.size,
      junk: dataUrlToBlob('not a data url'),
      empty: dataUrlToBlob(''),
      nothingCaptured: framesForMoments([], [moment]).length,
      noMoments: framesForMoments([{ t: 1.5, dataUrl: jpeg }], []).length,
      matched: framesForMoments([{ t: 1.5, dataUrl: jpeg }], [moment]).length,
      // A picture from a different instant is worse than no picture: it would
      // be captioned with a measurement that was not read there.
      farOff: framesForMoments([{ t: 9.0, dataUrl: jpeg }], [moment]).length,
      unmeasured: keyMoments([], 'Acceleration').length,
      noTimestamps: keyMoments([{ thighRise: 40 }], 'Acceleration').length,
    };
  });
  assert(frames.realType === 'image/jpeg' && frames.realSize > 0,
    'a captured frame becomes an uploadable jpeg: ' + frames.realType + ' ' + frames.realSize);
  assert(frames.junk === null && frames.empty === null,
    'anything that is not a data url comes back null instead of throwing');
  assert(frames.matched === 1, 'a moment with a frame at that instant keeps it');
  assert(frames.farOff === 0, 'a frame from a different instant is dropped, not mislabelled');
  assert(frames.nothingCaptured === 0 && frames.noMoments === 0,
    'no stills or no moments yields no frames, quietly');
  assert(frames.unmeasured === 0 && frames.noTimestamps === 0,
    'a clip that could not be measured asks for no pictures');

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
  // Frame counts are diagnostic; seconds in shot is the thing he can act on.
  // The athlete believed he was visible for four seconds on a clip where it
  // was closer to one, and that was the whole reason it could not be graded.
  assert(/in shot about 0\.5s of 2\.1s/.test(note),
    'and says how long he was actually in shot, which is the actionable part: ' + note);
  // Nothing was gradeable, so there is no moment to photograph -- and, more
  // to the point, the clip itself must not be uploaded in its place.
  assert(row && !row.key_frames,
    'a refused clip stores no key frames: ' + JSON.stringify(row && row.key_frames));
  assert(row && !row.video_path,
    'and no video path, because the clip is never uploaded: ' + JSON.stringify(row && row.video_path));

  await browser.close();server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
