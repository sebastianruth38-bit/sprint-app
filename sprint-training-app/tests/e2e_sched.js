const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP_DIR = process.env.APP_DIR || require('path').join(__dirname, 'fixtures/app');
const OUT = process.env.OUT_DIR || require('path').join(__dirname, 'out');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
function serve(){return new Promise(r=>{const s=http.createServer((rq,rs)=>{const fp=path.join(APP_DIR,rq.url==='/'?'/index.html':rq.url);fs.readFile(fp,(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});rs.end(d);});});s.listen(0,()=>r(s));});}
let pass=0, fail=0;
const assert=(c,m)=>{ if(c){console.log('PASS: '+m);pass++;} else {console.error('FAIL: '+m);fail++;} };

(async () => {
  const server = await serve(); const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));

  // Athlete can sprint Tue/Wed/Sat, gym Tue/Sat. Monday is out.
  let availability = { sprint_days:['Tuesday','Wednesday','Saturday'], gym_days:['Tuesday','Saturday'] };
  let stored = [];
  let lastUpsert = null;

  await page.route('**/*supabase.co/**', async (route) => {
    const u = route.request().url(), m = route.request().method();
    const json = b => route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(b) });
    if (u.includes('/rest/v1/availability') && m === 'GET') return json(availability);
    if (u.includes('/rest/v1/availability')) return json({});
    if (u.includes('/rest/v1/workouts') && m === 'GET') return json(stored);
    if (u.includes('/rest/v1/workouts') && m === 'POST') {
      lastUpsert = JSON.parse(route.request().postData());
      stored = lastUpsert.map((r, i) => ({ ...r, id: 'row' + i }));
      return json([]);
    }
    if (u.includes('/rest/v1/competition_seasons')) return m === 'GET' ? json({ outdoor_start:'2027-04-01', outdoor_end:'2027-06-30' }) : json({});
    if (u.includes('/rest/v1/athlete_settings')) return json({ primary_events:['100m'], equipment:[], next_meet_date:null, next_meet_events:[] });
    return json([]);
  });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => typeof window.handleSession === 'function');
  await page.evaluate(() => window.handleSession({ user:{ id:'u' } }));
  await page.click('[data-tab="workouts"]');
  await page.waitForSelector('.day-card');

  // --- Generate with availability in effect ---
  await page.click('#generateWeekPlan');
  await page.waitForTimeout(600);
  assert(!!lastUpsert, 'generation wrote a plan');
  const onUnavailableDays = lastUpsert.filter(r =>
    !['Rest Day','Recovery / Mobility','Lift Only','Meet Day','Pre-Meet'].includes(r.type)
    && !availability.sprint_days.includes(r.day));
  assert(onUnavailableDays.length === 0,
    'no sprint session was written to a day the athlete cannot sprint: ' + JSON.stringify(onUnavailableDays.map(r=>r.day+':'+r.type)));
  const liftsOffGymDays = lastUpsert.filter(r => r.lift_details && !availability.gym_days.includes(r.day));
  assert(liftsOffGymDays.length === 0, 'no lift written to a non-gym day: ' + JSON.stringify(liftsOffGymDays.map(r=>r.day)));
  const speed = lastUpsert.filter(r => ['Acceleration (0-30m)','Max Velocity (flys/build-ups)'].includes(r.type));
  assert(speed.length === 2, 'both speed sessions survived onto the 3 available days, got ' + speed.length);

  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/ui_moved.png`, fullPage: true });

  // --- Change availability afterwards: plan should re-place itself ---
  const before = JSON.stringify(stored.map(r => r.day + ':' + r.type));
  availability = { sprint_days:['Monday','Thursday','Friday'], gym_days:['Monday','Friday'] };
  await page.click('#calendarBtn');
  await page.waitForTimeout(300);
  await page.click('#saveAvailability');
  await page.waitForTimeout(800);
  const after = stored.map(r => r.day + ':' + r.type);
  assert(before !== JSON.stringify(after), 'saving new availability re-placed the week');
  const strandedNow = stored.filter(r =>
    !['Rest Day','Recovery / Mobility','Lift Only','Meet Day','Pre-Meet'].includes(r.type)
    && !availability.sprint_days.includes(r.day));
  assert(strandedNow.length === 0, 'after re-placement nothing sits on an unavailable day: ' + JSON.stringify(after));
  const speedAfter = stored.filter(r => ['Acceleration (0-30m)','Max Velocity (flys/build-ups)'].includes(r.type));
  assert(speedAfter.length === 2, 'both speed sessions survived the re-placement, got ' + speedAfter.length);

  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
