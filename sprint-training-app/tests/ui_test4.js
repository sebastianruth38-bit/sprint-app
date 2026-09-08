const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_DIR = process.env.APP_DIR || require('path').join(__dirname, 'fixtures/app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = req.url === '/' ? '/index.html' : req.url;
      const fp = path.join(APP_DIR, file);
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
        res.end(data);
      });
    });
    server.listen(0, () => resolve(server));
  });
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log('PASS: ' + msg); pass++; }
  else { console.error('FAIL: ' + msg); fail++; }
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let lastUpsertBody = null;
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  await page.route('**/*supabase.co/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/rest/v1/workouts') && method === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          id: 'w1', day: 'Monday', type: 'Acceleration (0-30m)',
          details: '(2x20,2x25,2x30,1x40)', timed: 'Timed',
          lift_details: 'Power Cleans 3x3-5, Broad Jumps 3x3, Bulgarian Split Squats 3x6-8, Core 3x',
          logged_result: null, lift_log: null,
        }]),
      });
    }
    if (url.includes('/rest/v1/workouts') && (method === 'POST' || method === 'PATCH')) {
      lastUpsertBody = route.request().postData();
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => typeof window.handleSession === 'function');
  await page.evaluate(() => window.handleSession({ user: { id: 'test-user-id' } }));
  await page.click('[data-tab="workouts"]');
  await page.waitForSelector('.day-card');
  await page.locator('.day-card', { hasText: 'Monday' }).click();
  await page.waitForSelector('#exerciseLog .ex-row');

  // Bodyweight exercises (Broad Jumps, Core) should have NO weight input at all.
  const groupHeaders = await page.$$eval('#exerciseLog .explog-group-label', (els) => els.map((e) => e.textContent));
  assert(!groupHeaders.includes('Broad Jumps 3x3'), 'Broad Jumps has no log UI at all (bodyweight): ' + JSON.stringify(groupHeaders));
  assert(!groupHeaders.includes('Core 3x'), 'Core has no log UI at all (bodyweight): ' + JSON.stringify(groupHeaders));
  assert(groupHeaders.includes('Power Cleans 3x3-5') && groupHeaders.includes('Bulgarian Split Squats 3x6-8'),
    'weighted exercises still show their group headers: ' + JSON.stringify(groupHeaders));

  // Compact combo rows: exactly one row per multi-set/rep exercise (dropdown + one input),
  // not one row per individual set/rep.
  const comboRowCount = await page.$$eval('.explog-combo-row', (els) => els.length);
  assert(comboRowCount === 3, 'exactly 3 compact combo rows (Power Cleans + Bulgarian Split Squats lifts, plus the sprint ladder), got ' + comboRowCount);

  const liftSelectOptions = await page.$eval('.explog-combo-row select[data-kind="lift"]', (el) => Array.from(el.options).map((o) => o.textContent));
  assert(JSON.stringify(liftSelectOptions) === JSON.stringify(['Set 1', 'Set 2', 'Set 3']), 'lift dropdown lists Set 1/2/3, got ' + JSON.stringify(liftSelectOptions));

  const sprintSelectOptions = await page.$$eval('.explog-combo-row select[data-kind="sprint"] option', (els) => els.map((e) => e.textContent));
  assert(sprintSelectOptions.length === 7, 'sprint dropdown lists all 7 reps, got ' + sprintSelectOptions.length);

  // Overlap check still holds with the new combo rows.
  const overlaps = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#exerciseLog .explog-row'));
    const bad = [];
    rows.forEach((row) => {
      const kids = Array.from(row.children);
      for (let i = 0; i < kids.length - 1; i++) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[i + 1].getBoundingClientRect();
        const sameLine = !(a.bottom <= b.top || b.bottom <= a.top);
        if (sameLine && a.right > b.left) bad.push({ row: row.className, a: kids[i].tagName, b: kids[i+1].tagName });
      }
      const input = row.querySelector('.explog-input, .explog-set-select');
      if (input) {
        const r = input.getBoundingClientRect();
        if (r.right > document.documentElement.clientWidth + 1) bad.push({ overflow: true });
      }
    });
    return bad;
  });
  assert(overlaps.length === 0, 'no overlap/overflow among combo row children at 375px, found: ' + JSON.stringify(overlaps));

  // Fill set 1, switch to set 2 (should be blank, not carry set 1's value), fill it, switch back to set 1 (should still show its value).
  const liftSelect = page.locator('.explog-combo-row select[data-kind="lift"]').first();
  const liftInputCombo = page.locator('.explog-combo-row').filter({ has: page.locator('select[data-kind="lift"]') }).first().locator('.explog-input');
  await liftInputCombo.fill('135');
  await liftSelect.selectOption('1'); // Set 2
  const set2ValueBeforeFill = await liftInputCombo.inputValue();
  assert(set2ValueBeforeFill === '', 'switching to Set 2 shows blank (not Set 1s value), got "' + set2ValueBeforeFill + '"');
  await liftInputCombo.fill('145');
  await liftSelect.selectOption('0'); // back to Set 1
  const set1ValueAfterSwitch = await liftInputCombo.inputValue();
  assert(set1ValueAfterSwitch === '135', 'switching back to Set 1 still shows 135 (not lost), got "' + set1ValueAfterSwitch + '"');

  // Also log one sprint rep via its dropdown.
  const sprintSelect = page.locator('.explog-combo-row select[data-kind="sprint"]').first();
  const sprintInputCombo = page.locator('.explog-combo-row').filter({ has: page.locator('select[data-kind="sprint"]') }).locator('.explog-input');
  await sprintSelect.selectOption('2'); // 3rd option
  await sprintInputCombo.fill('3.6');

  await page.click('#saveWorkout');
  await page.waitForTimeout(300);
  const parsed = JSON.parse(lastUpsertBody);
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  assert(Object.keys(row.lift_log).length === 2, 'both Set 1 (135) and Set 2 (145) saved despite switching away, got ' + JSON.stringify(row.lift_log));
  assert(Object.values(row.lift_log).includes('135') && Object.values(row.lift_log).includes('145'), 'saved values are 135 and 145: ' + JSON.stringify(row.lift_log));
  assert(Object.keys(row.logged_result).length === 1 && Object.values(row.logged_result)[0] === '3.6', 'sprint rep 3 time (3.6) saved: ' + JSON.stringify(row.logged_result));
  assert(!JSON.stringify(row.lift_log).includes('Broad Jumps'), 'no bodyweight-exercise keys leaked into lift_log');

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
