const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP_DIR = process.env.APP_DIR || require('path').join(__dirname, 'fixtures/app');
const OUT = process.env.OUT_DIR || require('path').join(__dirname, 'out');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
function serve(){return new Promise(r=>{const s=http.createServer((rq,rs)=>{const fp=path.join(APP_DIR,rq.url==='/'?'/index.html':rq.url);fs.readFile(fp,(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});rs.end(d);});});s.listen(0,()=>r(s));});}
let pass=0, fail=0;
const assert=(c,m)=>{ if(c){console.log('PASS: '+m);pass++;} else {console.error('FAIL: '+m);fail++;} };

const PLAN = [
  { id:'w1', day:'Monday', type:'Acceleration (0-30m)', details:'2x(10,20,30)', timed:'Timed', lift_details:'Power Cleans 3x3-5', logged_result:null, lift_log:null },
  { id:'w2', day:'Tuesday', type:'Tempo (extensive/aerobic)', details:'8x200', timed:null, lift_details:'Flat Bench 3x8', logged_result:null, lift_log:null },
  { id:'w3', day:'Wednesday', type:'Rest Day', details:'', timed:null, lift_details:null, logged_result:null, lift_log:null },
  { id:'w4', day:'Thursday', type:'Max Velocity (flys/build-ups)', details:'4x30m fly', timed:'Timed', lift_details:'Hang Snatches 3x3-5', logged_result:null, lift_log:null },
  { id:'w5', day:'Friday', type:'Recovery / Mobility', details:'Mobility + foam roll', timed:null, lift_details:null, logged_result:null, lift_log:null },
  { id:'w6', day:'Saturday', type:'Meet Day', details:'', timed:null, lift_details:null, logged_result:null, lift_log:null },
];

async function boardFor(page, avail) {
  await page.evaluate((a) => { window.__avail = a; }, avail);
  await page.evaluate(() => window.renderWeekBoard && window.renderWeekBoard());
  await page.waitForTimeout(350);
  return page.$$eval('.day-card', cards => cards.map(c => ({
    day: c.querySelector('h4').textContent,
    type: c.querySelector('.type') ? c.querySelector('.type').textContent.trim() : null,
    details: c.querySelector('.details') ? c.querySelector('.details').textContent.trim() : null,
    lift: Array.from(c.querySelectorAll('.hint')).map(h => h.textContent.trim()).find(t => t.startsWith('🏋️')) || null,
    blocked: c.classList.contains('blocked-day'),
  })));
}

(async () => {
  const server = await serve(); const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));

  await page.route('**/*supabase.co/**', async (route) => {
    const u = route.request().url();
    const json = b => route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(b) });
    if (u.includes('/rest/v1/workouts')) return json(PLAN);
    if (u.includes('/rest/v1/availability')) {
      return route.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify(global.__availPayload || null) });
    }
    return json([]);
  });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => typeof window.handleSession === 'function');
  await page.evaluate(() => window.handleSession({ user:{ id:'u' } }));
  await page.click('[data-tab="workouts"]');
  await page.waitForSelector('.day-card');

  // --- Case 1: no availability set at all (the dangerous default) ---
  global.__availPayload = null;
  await page.evaluate(() => window.renderWeekBoard()); await page.waitForTimeout(400);
  let cards = await page.$$eval('.day-card', cs => cs.map(c => ({
    day: c.querySelector('h4').textContent,
    type: c.querySelector('.type')?.textContent.trim() || null,
    lift: Array.from(c.querySelectorAll('.hint')).map(h=>h.textContent.trim()).find(t=>t.startsWith('🏋️')) || null,
    blocked: c.classList.contains('blocked-day'),
  })));
  assert(cards.filter(c => c.blocked).length === 0, 'nothing is hidden when availability was never set');
  assert(cards.find(c=>c.day==='Monday').type.startsWith('Acceleration'), 'Monday still shows its session');
  assert(cards.find(c=>c.day==='Monday').lift.includes('Power Cleans'), 'Monday still shows its lift');

  // --- Case 2: can't sprint Monday, can't gym Tuesday ---
  global.__availPayload = { sprint_days:['Tuesday','Thursday','Friday','Saturday','Sunday','Wednesday'], gym_days:['Monday','Thursday'] };
  await page.evaluate(() => window.renderWeekBoard()); await page.waitForTimeout(400);
  cards = await page.$$eval('.day-card', cs => cs.map(c => ({
    day: c.querySelector('h4').textContent,
    type: c.querySelector('.type')?.textContent.trim() || null,
    details: c.querySelector('.details')?.textContent.trim() || null,
    lift: Array.from(c.querySelectorAll('.hint')).map(h=>h.textContent.trim()).find(t=>t.startsWith('🏋️')) || null,
    blocked: c.classList.contains('blocked-day'),
  })));
  const mon = cards.find(c=>c.day==='Monday');
  assert(mon.type === "Can't sprint this day", 'Monday sprint session hidden: ' + mon.type);
  assert(mon.details.includes('Acceleration (0-30m) skipped'), 'Monday says which session was skipped: ' + mon.details);
  assert(mon.lift && mon.lift.includes('Power Cleans'), 'Monday keeps its lift (gym IS available Monday): ' + mon.lift);

  const tue = cards.find(c=>c.day==='Tuesday');
  assert(tue.type.startsWith('Tempo'), 'Tuesday keeps its sprint session (can sprint): ' + tue.type);
  assert(/no gym this day/i.test(tue.lift), 'Tuesday lift hidden with a reason: ' + tue.lift);

  const thu = cards.find(c=>c.day==='Thursday');
  assert(thu.type.startsWith('Max Velocity') && thu.lift.includes('Hang Snatches'), 'Thursday untouched (both available)');

  // --- Case 3: rest / recovery / meet days are never blocked ---
  global.__availPayload = { sprint_days:['Monday'], gym_days:['Monday'] };
  await page.evaluate(() => window.renderWeekBoard()); await page.waitForTimeout(400);
  cards = await page.$$eval('.day-card', cs => cs.map(c => ({
    day: c.querySelector('h4').textContent,
    type: c.querySelector('.type')?.textContent.trim() || null,
    blocked: c.classList.contains('blocked-day'),
  })));
  assert(cards.find(c=>c.day==='Wednesday').type === 'Rest Day', 'Rest Day never blocked');
  assert(cards.find(c=>c.day==='Friday').type.startsWith('Recovery'), 'Recovery/Mobility never blocked');
  assert(cards.find(c=>c.day==='Saturday').type === 'Meet Day', 'Meet Day never blocked');
  assert(cards.find(c=>c.day==='Tuesday').type === "Can't sprint this day", 'Tuesday now blocked under the tighter availability');

  // --- Case 4: reversible -- re-marking available restores the session ---
  global.__availPayload = { sprint_days:['Monday','Tuesday'], gym_days:['Monday','Tuesday'] };
  await page.evaluate(() => window.renderWeekBoard()); await page.waitForTimeout(400);
  const tue2 = await page.$eval('.day-card:nth-child(2)', c => ({
    type: c.querySelector('.type')?.textContent.trim(),
    lift: Array.from(c.querySelectorAll('.hint')).map(h=>h.textContent.trim()).find(t=>t.startsWith('🏋️')),
  }));
  assert(tue2.type.startsWith('Tempo'), 'session comes back when the day is marked available again: ' + tue2.type);
  assert(tue2.lift.includes('Flat Bench'), 'lift comes back too: ' + tue2.lift);

  global.__availPayload = { sprint_days:['Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'], gym_days:['Thursday'] };
  await page.evaluate(() => window.renderWeekBoard()); await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/ui_avail.png`, fullPage: true });

  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
