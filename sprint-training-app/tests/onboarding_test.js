// The first screen a new athlete ever sees.
//
// Two ways this feature fails badly and neither shows up by looking at it:
//
//   1. It opens for somebody who has used the app for months. A full-screen
//      overlay at z-index 60 does not just look wrong, it eats every tap
//      underneath it.
//   2. It closes without saving. Five screens of tapping, and the week that
//      gets built afterwards is the default one -- with nothing on screen to
//      say the answers went nowhere.
//
// So this suite drives the real page and asserts both ends: who it opens for,
// and what actually reaches the two tables. It also pins Skip to saving the
// same things Finish saves, because the tempting implementation (skip = throw
// it away) punishes the athlete for a button we put there ourselves.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_DIR = process.env.APP_DIR || path.join(__dirname, 'fixtures/app');
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((rq, rs) => {
      const fp = path.join(APP_DIR, rq.url === '/' ? '/index.html' : rq.url.split('?')[0]);
      fs.readFile(fp, (e, d) => {
        if (e) { rs.writeHead(404); rs.end(); return; }
        rs.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
        rs.end(d);
      });
    });
    s.listen(0, () => resolve(s));
  });
}

let pass = 0, fail = 0;
const assert = (c, m) => {
  if (c) { console.log('PASS: ' + m); pass++; }
  else { console.error('FAIL: ' + m); fail++; }
};

// Rebuilt per case so each one starts from a page that has never signed in.
async function openPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    reducedMotion: opts.reducedMotion || 'no-preference',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const writes = [];

  await page.route('**/*supabase.co/**', async (route) => {
    const req = route.request();
    const u = req.url();
    const m = req.method();
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

    // Only table writes count. Auth and storage traffic is POSTed too and is
    // not what "did the answers get saved" is asking about.
    const table = (u.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    if (table && (m === 'POST' || m === 'PATCH')) {
      let body = null;
      try { body = JSON.parse(req.postData() || 'null'); } catch (e) { body = req.postData(); }
      writes.push({ table, body: Array.isArray(body) ? body[0] : body });
      if (opts.failWrites) return json({ message: 'nope' }, 500);
      return json([]);
    }
    if (u.includes('/rest/v1/athlete_settings')) return json(opts.settings === undefined ? [] : opts.settings);
    return json([]);
  });

  await page.goto(`http://localhost:${opts.port}/index.html`);
  await page.waitForFunction(() => typeof window.handleSession === 'function');
  return { page, ctx, writes, errors };
}

// `offsetParent` is null for anything position:fixed, which is both the
// overlay and every modal in this app, so it cannot be the visibility test.
const visible = (page, sel) => page.$eval(sel, (el) => {
  if (el.hidden) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
}).catch(() => false);
const stepOnScreen = (page) => page.$$eval('#onboardStage .onboard-step', (els) => {
  const shown = els.filter((e) => !e.hidden);
  return shown.length === 1 ? shown[0].dataset.step : shown.map((e) => e.dataset.step).join('+');
});

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---- 1. It stays out of the way of an athlete who has been here ----
  {
    const { page, ctx, errors } = await openPage(browser, {
      port,
      settings: { user_id: 'u', onboarded_at: '2026-01-01T00:00:00Z' },
    });
    await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
    await page.waitForTimeout(400);
    assert(!(await visible(page, '#onboarding')),
      'a returning athlete (onboarded_at set) never sees the walkthrough');
    assert(await visible(page, '#appShell'), 'and lands straight in the app');
    assert(errors.length === 0, 'no page errors: ' + JSON.stringify(errors));
    await ctx.close();
  }

  // A read that fails must not open it either -- interrupting somebody
  // mid-season because a query timed out is the worse of the two mistakes.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.route('**/*supabase.co/**', (route) => {
      if (route.request().url().includes('/rest/v1/athlete_settings')) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.goto(`http://localhost:${port}/index.html`);
    await page.waitForFunction(() => typeof window.handleSession === 'function');
    await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
    await page.waitForTimeout(400);
    assert(!(await visible(page, '#onboarding')),
      'a failed read of the first-run state leaves the walkthrough shut');
    await ctx.close();
  }

  // ---- 2. It opens for a brand-new account, and walks ----
  {
    const { page, ctx, writes, errors } = await openPage(browser, { port, settings: [] });
    await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
    await page.waitForTimeout(400);

    assert(await visible(page, '#onboarding'), 'a new account gets the walkthrough');
    assert(await stepOnScreen(page) === 'intro', 'it opens on the intro');
    assert(exactlyOne(await page.$$eval('#onboardStage .onboard-step', (e) => e.map((x) => x.hidden))),
      'exactly one step is on screen at a time');
    const intro = await page.$eval('[data-step="intro"]', (e) => e.textContent);
    assert(/never leaves your phone/i.test(intro),
      'the intro says the video stays on the device, which is the thing people ask');
    // The count in that line is derived from ONBOARD_STEPS, not typed, so a
    // sixth question cannot leave the intro promising four.
    const tail = await page.$eval('#onboardTail', (e) => e.textContent);
    const stepCount = await page.$$eval('#onboardStage .onboard-step', (e) => e.length);
    assert(tail.startsWith(String(stepCount - 2) + ' quick question'),
      'the intro counts the questions rather than claiming a number: ' + tail);
    assert(await page.$eval('#onboardBack', (e) => e.hidden), 'no Back on the first screen');
    assert(!(await page.$eval('#onboardSkip', (e) => e.hidden)), 'Skip is offered from the start');

    // Forward through every step.
    const seen = ['intro'];
    for (let i = 0; i < 5; i++) {
      await page.click('#onboardNext');
      await page.waitForTimeout(120);
      seen.push(await stepOnScreen(page));
    }
    assert(
      seen.join(',') === 'intro,events,equipment,calendar,season,done',
      'Next walks intro → events → equipment → calendar → season → done: ' + seen.join(',')
    );
    assert(await page.$eval('#onboardSkip', (e) => e.hidden), 'Skip disappears once there is nothing left to skip');
    assert(/start/i.test(await page.$eval('#onboardNext', (e) => e.textContent)),
      'the last button says what it does, not "Next"');

    // And back out of it again.
    const backTo = [];
    for (let i = 0; i < 5; i++) {
      await page.click('#onboardBack');
      await page.waitForTimeout(120);
      backTo.push(await stepOnScreen(page));
    }
    assert(backTo.join(',') === 'season,calendar,equipment,events,intro',
      'Back retraces it: ' + backTo.join(','));
    // Not `writes.length === 0`: a fresh account also seeds the reference
    // exercise list, which has nothing to do with the walkthrough.
    const mine = writes.filter((w) => ['athlete_settings', 'competition_seasons', 'availability'].includes(w.table));
    assert(mine.length === 0, 'walking the steps saves nothing until it is finished: ' + JSON.stringify(mine.map((w) => w.table)));
    assert(errors.length === 0, 'no page errors walking it: ' + JSON.stringify(errors));
    await ctx.close();
  }

  // ---- 3. The answers reach the tables ----
  {
    const { page, ctx, writes, errors } = await openPage(browser, { port, settings: [] });
    await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
    await page.waitForTimeout(400);

    await page.click('#onboardNext');               // → events
    await page.waitForTimeout(100);
    await clickChip(page, '#onboardEvents', '200m');
    await clickChip(page, '#onboardEvents', '400m');
    await page.fill('#onboardEventsOther', '4x400, 4x100');

    await page.click('#onboardNext');               // → equipment
    await page.waitForTimeout(100);
    await page.click('#onboardGymBtn');             // turn the weight room OFF
    await clickChip(page, '#onboardEquipment', 'Hills');

    await page.click('#onboardNext');               // → calendar
    await page.waitForTimeout(100);
    await clickChip(page, '#onboardSprintDays', 'Mon');
    await clickChip(page, '#onboardSprintDays', 'Wed');
    await clickChip(page, '#onboardGymDays', 'Tue');

    await page.click('#onboardNext');               // → season
    await page.waitForTimeout(100);
    await page.fill('#onboardOutdoorStart', '2027-04-01');
    await page.fill('#onboardOutdoorEnd', '2027-06-30');
    await page.fill('#onboardMeetDate', '2027-04-17');
    await page.fill('#onboardMeetEvents', '200m, 4x400');

    await page.click('#onboardNext');               // → done
    await page.waitForTimeout(150);
    const summary = await page.$eval('#onboardSummary', (e) => e.textContent);
    assert(/200m/.test(summary) && /bodyweight/i.test(summary) && /2027-04-17/.test(summary),
      'the last screen reads the answers back: ' + summary);

    await page.click('#onboardNext');               // finish
    await page.waitForTimeout(400);

    assert(!(await visible(page, '#onboarding')), 'finishing closes it');

    const settings = writes.find((w) => w.table === 'athlete_settings');
    assert(!!settings, 'athlete_settings was written');
    assert(
      JSON.stringify(settings.body.primary_events) === JSON.stringify(['200m', '400m', '4x400', '4x100']),
      'the chips and the free-text box both land in primary_events: ' + JSON.stringify(settings && settings.body.primary_events)
    );
    assert(settings.body.has_gym === false, 'the weight room toggle is saved as given, not as the default');
    assert(
      JSON.stringify(settings.body.equipment) === JSON.stringify(['Hills']),
      'equipment is saved: ' + JSON.stringify(settings.body.equipment)
    );
    assert(settings.body.next_meet_date === '2027-04-17', 'the next meet date is saved');
    assert(
      JSON.stringify(settings.body.next_meet_events) === JSON.stringify(['200m', '4x400']),
      'the meet events are split on commas: ' + JSON.stringify(settings.body.next_meet_events)
    );
    assert(!!settings.body.onboarded_at, 'onboarded_at is stamped, so it never opens twice');

    const season = writes.find((w) => w.table === 'competition_seasons');
    assert(season && season.body.outdoor_start === '2027-04-01' && season.body.outdoor_end === '2027-06-30',
      'the outdoor season reaches competition_seasons');
    assert(season && season.body.indoor_start === null,
      'a blank indoor season is saved as null rather than an empty string');

    const avail = writes.find((w) => w.table === 'availability');
    assert(avail && JSON.stringify(avail.body.sprint_days) === JSON.stringify(['Monday', 'Wednesday']),
      'the sprint days reach availability: ' + JSON.stringify(avail && avail.body.sprint_days));
    assert(avail && JSON.stringify(avail.body.gym_days) === JSON.stringify(['Tuesday']),
      'and the gym days: ' + JSON.stringify(avail && avail.body.gym_days));
    assert(!!avail.body.week_key, 'availability is written against a week');

    assert(errors.length === 0, 'no page errors: ' + JSON.stringify(errors));
    await page.screenshot({ path: `${OUT}/ui_onboarding_done.png`, fullPage: true });
    await ctx.close();
  }

  // ---- 4. Skip keeps what was already answered ----
  {
    const { page, ctx, writes } = await openPage(browser, { port, settings: [] });
    await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
    await page.waitForTimeout(400);
    await page.click('#onboardNext');
    await page.waitForTimeout(100);
    await clickChip(page, '#onboardEvents', '100m');
    await page.click('#onboardNext');
    await page.waitForTimeout(100);
    await page.click('#onboardSkip');
    await page.waitForTimeout(400);

    assert(!(await visible(page, '#onboarding')), 'Skip closes it');
    const s = writes.find((w) => w.table === 'athlete_settings');
    assert(s && JSON.stringify(s.body.primary_events) === JSON.stringify(['100m']),
      'Skip keeps the answers already given rather than binning them: ' + JSON.stringify(s && s.body.primary_events));
    assert(s && !!s.body.onboarded_at, 'Skip still stamps onboarded_at, so it does not reopen tomorrow');
    assert(!writes.find((w) => w.table === 'competition_seasons'),
      'nothing was entered for the season, so no empty row is written over one that may exist');
    assert(!writes.find((w) => w.table === 'availability'),
      'and no empty availability row either');
    await ctx.close();
  }

  // ---- 5. A failed save must not trap anybody on this screen ----
  {
    const { page, ctx } = await openPage(browser, { port, settings: [], failWrites: true });
    page.on('dialog', (d) => d.accept());
    await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
    await page.waitForTimeout(400);
    await page.click('#onboardSkip');
    await page.waitForTimeout(600);
    assert(!(await visible(page, '#onboarding')),
      'a write that fails still lets the athlete into the app');
    await ctx.close();
  }

  // ---- 6. Reduced motion actually gets reduced motion ----
  {
    const { page, ctx } = await openPage(browser, { port, settings: [], reducedMotion: 'reduce' });
    await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
    await page.waitForTimeout(400);
    const names = await page.$$eval(
      '#onboarding, .onboard-step, .onboard-step > *, .onboard-points > li',
      (els) => els.map((e) => getComputedStyle(e).animationName)
    );
    assert(names.length > 3 && names.every((n) => n === 'none'),
      'nothing in the walkthrough animates under prefers-reduced-motion: ' + JSON.stringify(names));
    await ctx.close();
  }

  // ---- 7. It does not restart under an athlete on a second auth event ----
  {
    const { page, ctx } = await openPage(browser, { port, settings: [] });
    await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
    await page.waitForTimeout(300);
    await page.click('#onboardNext');
    await page.click('#onboardNext');
    await page.waitForTimeout(150);
    assert(await stepOnScreen(page) === 'equipment', 'walked to the equipment step');
    // getSession() and onAuthStateChange both land on handleSession within a
    // tick of each other. The second one must not throw them back to step 1.
    await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
    await page.waitForTimeout(400);
    assert(await stepOnScreen(page) === 'equipment',
      'a second auth event leaves them where they were, not back at the intro');
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

function exactlyOne(hiddenFlags) {
  return hiddenFlags.filter((h) => !h).length === 1;
}

async function clickChip(page, container, label) {
  const found = await page.$$eval(
    container + ' .day-chip',
    (els, want) => {
      const hit = els.find((e) => e.textContent.trim() === want);
      if (hit) hit.click();
      return !!hit;
    },
    label
  );
  if (!found) { console.error('FAIL: no chip "' + label + '" in ' + container); fail++; }
  await page.waitForTimeout(40);
}
