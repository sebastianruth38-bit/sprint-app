// Logging a time, in a real browser.
//
// This exists because the feature failed in total silence. The athlete typed
// a time, pressed the button, and nothing happened -- no row, no message, the
// time still sitting in the box. The server logs showed no request at all,
// which is the signature of a handler that gave up before the network and the
// one failure you cannot diagnose from the outside.
//
// So the assertions are mostly about what the athlete is TOLD. A save that
// works is easy; a save that cannot work and says so is the thing that was
// missing.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const APP_DIR = process.env.APP_DIR || path.join(__dirname, 'fixtures/app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const serve = () => new Promise((r) => {
  const s = http.createServer((rq, rs) => {
    const fp = path.join(APP_DIR, rq.url === '/' ? '/index.html' : rq.url.split('?')[0]);
    fs.readFile(fp, (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
      rs.end(d);
    });
  });
  s.listen(0, () => r(s));
});

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { console.log('PASS: ' + m); pass++; } else { console.error('FAIL: ' + m); fail++; } };

(async () => {
  const server = await serve(), port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));

  let posts = [], rows = [], serverFails = false;
  await page.route('**/*supabase.co/**', async (route) => {
    const u = route.request().url(), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('/rest/v1/times') && m === 'POST') {
      posts.push(JSON.parse(route.request().postData() || '{}'));
      if (serverFails) return json({ message: 'row violates row-level security policy' }, 403);
      rows.unshift(posts[posts.length - 1]);
      return json([]);
    }
    if (u.includes('/rest/v1/times')) return json(rows);
    return json([]);
  });

  const alerts = [];
  page.on('dialog', async (d) => { alerts.push(d.message()); await d.accept(); });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => typeof window.handleSession === 'function');
  await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
  await page.waitForTimeout(500);
  await page.click('.tab-btn[data-tab="times"]');
  await page.waitForTimeout(300);

  const log = async (value, { date } = {}) => {
    alerts.length = 0;
    await page.fill('#timeValue', value);
    if (date !== undefined) await page.evaluate((d) => { document.getElementById('timeDate').value = d; }, date);
    await page.click('#saveTime');
    await page.waitForTimeout(400);
  };

  // ---------- the date is prefilled, which is what makes one tap enough ----------
  const prefilled = await page.$eval('#timeDate', (e) => e.value);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(prefilled), 'the date starts on today: ' + prefilled);

  // ---------- nothing typed ----------
  posts = [];
  await log('');
  assert(posts.length === 0, 'an empty field sends nothing');
  assert(alerts.some((a) => /enter a time/i.test(a)),
    'and the athlete is told to enter one, rather than nothing happening: ' + JSON.stringify(alerts));

  // ---------- not a time ----------
  posts = [];
  await log('pb attempt');
  assert(posts.length === 0, 'a value that is not a time sends nothing');
  assert(alerts.some((a) => /does not look like a time/i.test(a)),
    'and says so: ' + JSON.stringify(alerts));
  assert(await page.$eval('#timeValue', (e) => e.value) !== '',
    'and does not wipe what was typed');

  // ---------- a real time ----------
  posts = [];
  await log('11.42');
  assert(posts.length === 1, 'a real time is sent');
  assert(posts[0] && posts[0].time === '11.42' && posts[0].distance,
    'with the distance attached: ' + JSON.stringify(posts[0]));
  assert(posts[0] && /^\d{4}-\d{2}-\d{2}$/.test(posts[0].logged_date),
    'and a real date: ' + JSON.stringify(posts[0] && posts[0].logged_date));
  assert(alerts.length === 0, 'and nothing is alerted on success: ' + JSON.stringify(alerts));
  assert(await page.$eval('#timeValue', (e) => e.value) === '',
    'the field clears, so the next time can be typed straight in');
  assert((await page.$$('#timesList .entry')).length === 1, 'and it appears in the list');

  // ---------- the formats an athlete actually types ----------
  for (const [typed, why] of [['1:02.4', 'minutes and seconds, for a 400'],
                              ['11,42', 'a comma, which some keyboards give'],
                              ['52', 'whole seconds']]) {
    posts = [];
    await log(typed);
    assert(posts.length === 1, `"${typed}" is accepted — ${why}`);
  }

  // ---------- a cleared date must not lose the time ----------
  // Postgres rejects an empty string for a date column, so this used to be a
  // silent 400 after the athlete had already typed everything.
  posts = [];
  await log('10.99', { date: '' });
  assert(posts.length === 1, 'a cleared date still saves');
  assert(posts[0] && /^\d{4}-\d{2}-\d{2}$/.test(posts[0].logged_date),
    'falling back to today rather than sending an empty string: ' + JSON.stringify(posts[0] && posts[0].logged_date));

  // ---------- the server refusing must not look like success ----------
  serverFails = true;
  posts = [];
  await log('12.01');
  assert(posts.length === 1, 'the request is made');
  assert(alerts.some((a) => /could not save/i.test(a)),
    'and a refusal is shown, not swallowed: ' + JSON.stringify(alerts));
  assert(await page.$eval('#timeValue', (e) => e.value) === '12.01',
    'the time stays in the box so it does not have to be retyped');
  const btn = await page.$eval('#saveTime', (e) => ({ disabled: e.disabled, text: e.textContent }));
  assert(!btn.disabled && /log time/i.test(btn.text),
    'and the button comes back so it can be retried: ' + JSON.stringify(btn));
  serverFails = false;

  // ---------- signed out ----------
  posts = [];
  alerts.length = 0;
  await page.evaluate(() => { currentUser = null; });
  await page.fill('#timeValue', '11.11');
  await page.click('#saveTime');
  await page.waitForTimeout(300);
  assert(posts.length === 0, 'a signed-out athlete sends nothing');
  assert(alerts.some((a) => /signed out/i.test(a)),
    'and is told to sign in again rather than the click doing nothing: ' + JSON.stringify(alerts));

  assert(errors.length === 0, 'no page errors throughout: ' + JSON.stringify(errors));

  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
