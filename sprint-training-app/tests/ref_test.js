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

  let exercises = [
    { id:'e1', name:'Back Squat', url:'https://www.youtube.com/results?search_query=how+to+back+squat', is_custom:false },
    { id:'e2', name:'Power Clean', url:null, is_custom:false },
    { id:'e3', name:'Nordic Hamstring Curl', url:'javascript:alert(1)', is_custom:true },
  ];
  let lastPatch = null, weightChecksHit = false;

  await page.route('**/*supabase.co/**', async (route) => {
    const u = route.request().url(), m = route.request().method();
    const json = b => route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(b) });
    if (u.includes('/rest/v1/weight_checks')) { weightChecksHit = true; return json([]); }
    if (u.includes('/rest/v1/exercises') && m === 'GET') return json(exercises);
    if (u.includes('/rest/v1/exercises') && m === 'PATCH') {
      lastPatch = JSON.parse(route.request().postData());
      const id = new URL(u).searchParams.get('id') || '';
      exercises = exercises.map(e => (id.includes(e.id) ? { ...e, ...lastPatch } : e));
      return json([]);
    }
    return json([]);
  });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => typeof window.handleSession === 'function');
  await page.evaluate(() => window.handleSession({ user: { id:'u' } }));
  await page.click('[data-tab="weights"]');
  await page.waitForSelector('#weightsList .ex-row');

  const boxes = await page.$$eval('#weightsList input[type="checkbox"]', els => els.length);
  assert(boxes === 0, 'no checkboxes remain on the reference page, found ' + boxes);
  assert(weightChecksHit === false, 'weight_checks table is no longer queried');

  const watchLinks = await page.$$eval('#weightsList .ex-name-link', els => els.map(e => e.getAttribute('href')));
  assert(watchLinks.length === 1 && watchLinks[0].startsWith('https://www.youtube.com'), 'only the valid http(s) link renders a Watch link: ' + JSON.stringify(watchLinks));
  assert(!watchLinks.some(h => h.startsWith('javascript:')), 'javascript: url is not rendered as a link');

  const btnLabels = await page.$$eval('#weightsList .ex-link-btn', els => els.map(e => e.textContent));
  assert(JSON.stringify(btnLabels) === JSON.stringify(['Edit link','Add link','Add link']), 'buttons read Edit/Add correctly: ' + JSON.stringify(btnLabels));

  // Paste a bare URL with no scheme onto "Power Clean"
  page.once('dialog', d => d.accept('youtube.com/watch?v=abc123'));
  await page.locator('#weightsList .ex-row', { hasText: 'Power Clean' }).locator('.ex-link-btn').click();
  await page.waitForTimeout(400);
  assert(lastPatch && lastPatch.url === 'https://youtube.com/watch?v=abc123', 'bare URL gets https:// prepended and saved: ' + JSON.stringify(lastPatch));
  const nowLinked = await page.locator('#weightsList .ex-row', { hasText: 'Power Clean' }).locator('.ex-name-link').count();
  assert(nowLinked === 1, 'Watch link appears after saving, got ' + nowLinked);

  // Clearing: blank input removes the link
  page.once('dialog', d => d.accept('   '));
  await page.locator('#weightsList .ex-row', { hasText: 'Back Squat' }).locator('.ex-link-btn').click();
  await page.waitForTimeout(400);
  assert(lastPatch && lastPatch.url === null, 'blank input clears the link: ' + JSON.stringify(lastPatch));

  // Cancel leaves it alone
  lastPatch = null;
  page.once('dialog', d => d.dismiss());
  await page.locator('#weightsList .ex-row', { hasText: 'Nordic' }).locator('.ex-link-btn').click();
  await page.waitForTimeout(300);
  assert(lastPatch === null, 'cancelling the prompt saves nothing');

  await page.screenshot({ path: `${OUT}/ui_reference.png` });
  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
