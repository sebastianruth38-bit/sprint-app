// The app has to load, and it has to load the version the SERVER has.
//
// deploy.sh stamps ?v=<sha> onto the script tags so a cached app.js can never
// shadow a new one. That works right up until the PAGE is the cached thing: an
// index.html held by the browser keeps pointing at the app.js it shipped with,
// and every deploy after it is invisible to that device.
//
// It is not a theoretical failure. Two fixes in a row reached GitHub Pages and
// neither reached the athlete's iPad, which spent a day reporting a bug that
// had already been fixed twice, with the deployed files correct the whole
// time. The evidence was in the message: the refusal carried no build stamp,
// and the build stamp had shipped in the deploy before it.
//
// So index.html now discovers the version at load time from a file fetched
// with no-store, and injects the scripts with it. That moves the boot onto a
// code path that can fail in a way the old static tags could not -- a bad
// bootstrap is a blank app for everyone, not a stale one for someone. Hence
// this file.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SRC = process.env.APP_DIR || path.join(__dirname, 'fixtures/app');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
};

// `version` null means the file is missing, which is what every local server
// and every test harness serves, and what a deploy that half-failed serves.
function serve(version) {
  return new Promise((resolve) => {
    const hits = [];
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      hits.push(req.url);
      if (url === '/version.json') {
        if (version == null) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ build: version }));
        return;
      }
      const fp = path.join(SRC, url === '/' ? '/index.html' : url);
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
        res.end(data);
      });
    });
    server.listen(0, () => resolve({ server, hits }));
  });
}

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

(async () => {
  const browser = await chromium.launch();

  for (const version of ['abc1234', null]) {
    const label = version ? 'with a version file' : 'with no version file';
    const { server, hits } = await serve(version);
    const port = server.address().port;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`http://localhost:${port}/`);
    // The scripts are injected after a fetch now, so the app is not there the
    // instant the document is.
    await page.waitForFunction(() => typeof window.extractFrames === 'function',
      { timeout: 15000 }).catch(() => {});

    const got = await page.evaluate(() => ({
      build: typeof APP_BUILD === 'undefined' ? null : APP_BUILD,
      app: typeof extractFrames === 'function',
      supabase: typeof supabaseClient === 'object' && supabaseClient !== null,
      gate: !!document.getElementById('authGate'),
      shown: (document.getElementById('settingsBuild') || {}).textContent || '',
      css: (document.querySelector('link[href*="styles.css"]') || {}).href || '',
    }));

    // The whole point: the app runs at all.
    check(`${label}: the app loads`, got.app, JSON.stringify(got));
    check(`${label}: with no page errors`, errors.length === 0, errors.join(' | '));
    // app.js reads config.js's constants on its first line, so a race between
    // the two injected scripts shows up as a dead client rather than a warning.
    check(`${label}: config.js ran before app.js`, got.supabase, JSON.stringify(got));
    check(`${label}: the markup is intact`, got.gate);

    if (version) {
      check(`${label}: the build is the server's, not the page's`,
        got.build === version, `got ${got.build}`);
      check(`${label}: and the scripts were fetched at that version`,
        hits.some((h) => h.startsWith('/app.js?v=' + version)),
        hits.filter((h) => h.startsWith('/app.js')).join(', '));
      check(`${label}: the stylesheet is re-pointed too`,
        got.css.includes(version), got.css);
      check(`${label}: and it is readable in Settings`,
        got.shown === `build ${version}`, got.shown);
      // The file that carries the version must never itself be cached, or the
      // whole mechanism inherits the problem it exists to solve.
      const boot = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
      check(`${label}: version.json is fetched with no-store`,
        /version\.json['"],\s*\{\s*cache:\s*['"]no-store['"]/.test(boot),
        (boot.match(/fetch\([^)]*version[^)]*\)/) || ['(no fetch found)'])[0]);
      // Asserted on the source rather than on behaviour, deliberately.
      // Dynamically inserted scripts run in insertion order only while
      // async is false; with it true they race, and a race between two
      // small files on localhost resolves the right way almost every time.
      // A test that passes 95% of the time is worse than one that reads the
      // guarantee off the page, so this reads the guarantee.
      check(`${label}: the injected scripts keep their order`,
        /\.async\s*=\s*false/.test(boot),
        (boot.match(/s\.async[^;]*;/) || ['(no async assignment)'])[0]);
    } else {
      // A missing version file must degrade to loading the app, never to a
      // blank page. This is the case every local server hits.
      check(`${label}: it falls back rather than failing`, got.build === 'dev',
        `got ${got.build}`);
      check(`${label}: and asks for the script unversioned`,
        hits.includes('/app.js'), hits.filter((h) => h.startsWith('/app.js')).join(', '));
    }

    await page.close();
    server.close();
  }

  // ---------- the version fetch itself failing ----------
  // A 404 is not this case: the server still answers, `r.ok` is false, and the
  // null flows through the normal path. This is the request never completing
  // at all -- offline, DNS gone, the connection dropped -- which is the only
  // thing the .catch is there for, and which no amount of serving 404s
  // exercises. Without it the app never boots rather than booting stale.
  {
    const { server } = await serve('abc1234');
    const port = server.address().port;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/version.json', (route) => route.abort('failed'));

    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => typeof window.extractFrames === 'function',
      { timeout: 15000 }).catch(() => {});
    const got = await page.evaluate(() => ({
      build: typeof APP_BUILD === 'undefined' ? null : APP_BUILD,
      app: typeof extractFrames === 'function',
      supabase: typeof supabaseClient === 'object' && supabaseClient !== null,
    }));

    check('a failed version fetch still boots the app', got.app, JSON.stringify(got));
    check('and still wires the client up', got.supabase, JSON.stringify(got));
    check('and says so rather than claiming a version it never read',
      got.build === 'dev', `got ${got.build}`);
    check('without throwing on the way', errors.length === 0, errors.join(' | '));

    await page.close();
    server.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
})();
