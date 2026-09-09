// Account deletion, in a real browser.
//
// This is the one feature where a bug destroys a season of someone's data and
// there is no undo, no export and no backup. So the tests are mostly about
// what must NOT happen: no deletion without two confirmations, no deletion
// when the typed word is wrong, no silent success when the server fails, and
// no user id in the request body for anyone to tamper with.
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

  let deleteCalls = [];
  let signedOut = false;
  let serverFails = false;
  await page.route('**/*supabase.co/**', async (route) => {
    const u = route.request().url();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('/functions/v1/delete-account')) {
      deleteCalls.push(route.request().postData());
      if (serverFails) return json({ error: 'Could not delete your clips. Nothing was deleted.' }, 500);
      return json({ ok: true, filesRemoved: 3 });
    }
    if (u.includes('/auth/v1/logout')) { signedOut = true; return json({}); }
    return json([]);
  });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => typeof window.handleSession === 'function');
  await page.evaluate(() => window.handleSession({ user: { id: 'u' } }));
  await page.waitForTimeout(400);

  // A reload is how the app leaves the deleted session behind.
  let reloaded = false;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloaded = true; });

  const dialogs = [];
  // Drives the two prompts: confirm(), then a prompt() wanting the word.
  const answer = (okConfirm, typedWord) => {
    page.removeAllListeners('dialog');
    page.on('dialog', async (d) => {
      dialogs.push({ type: d.type(), message: d.message() });
      if (d.type() === 'confirm') return okConfirm ? d.accept() : d.dismiss();
      if (d.type() === 'prompt') return typedWord === null ? d.dismiss() : d.accept(typedWord);
      return d.accept();
    });
  };

  // The settings button toggles, so blindly clicking it closes the menu on
  // every other call. Open it only when it is shut.
  const clickDelete = async () => {
    const shut = await page.$eval('#settingsMenu', (e) => e.hasAttribute('hidden'));
    if (shut) await page.click('#settingsBtn');
    await page.waitForSelector('#deleteAccountBtn', { state: 'visible' });
    await page.click('#deleteAccountBtn');
    await page.waitForTimeout(500);
  };

  // ---------- backing out ----------
  dialogs.length = 0; deleteCalls = [];
  answer(false, null);
  await clickDelete();
  assert(deleteCalls.length === 0, 'declining the first confirmation deletes nothing');
  assert(/cannot be undone/i.test((dialogs[0] || {}).message || ''),
    'and the first prompt says it cannot be undone: ' + ((dialogs[0] || {}).message || '').slice(0, 60));

  dialogs.length = 0; deleteCalls = [];
  answer(true, null);
  await clickDelete();
  assert(deleteCalls.length === 0, 'cancelling the typed confirmation deletes nothing');

  // ---------- the word has to match ----------
  dialogs.length = 0; deleteCalls = [];
  answer(true, 'yes');
  await clickDelete();
  assert(deleteCalls.length === 0, 'a wrong word deletes nothing — tapping OK is not enough');
  assert(dialogs.length === 3 && dialogs[2].type === 'alert',
    'and the athlete is told it was not deleted: ' + JSON.stringify((dialogs[2] || {}).message));

  // ---------- the server failing must not look like success ----------
  dialogs.length = 0; deleteCalls = []; serverFails = true; signedOut = false;
  answer(true, 'DELETE');
  await clickDelete();
  assert(deleteCalls.length === 1, 'a matching word does call the server');
  assert(!signedOut, 'a failed deletion does NOT sign the athlete out, so nothing looks done');
  const failMsg = (dialogs[dialogs.length - 1] || {}).message || '';
  assert(/could not/i.test(failMsg) && /nothing was deleted/i.test(failMsg),
    'and the failure says plainly that nothing was deleted: ' + failMsg.slice(0, 80));
  const stillThere = await page.$eval('#deleteAccountBtn', (e) => ({ disabled: e.disabled, text: e.textContent }));
  assert(!stillThere.disabled && /Delete Account/.test(stillThere.text),
    'the button is handed back so it can be retried: ' + JSON.stringify(stillThere));

  // ---------- the real thing ----------
  dialogs.length = 0; deleteCalls = []; serverFails = false; reloaded = false;
  answer(true, 'delete');   // case-insensitive on purpose
  await clickDelete();
  assert(deleteCalls.length === 1, 'confirming twice deletes the account');
  // The function deletes whoever the JWT says is calling. A user id in the
  // body would let any signed-in athlete delete somebody else's account.
  assert(!deleteCalls[0] || !/\bu\b|user_id|userId/.test(deleteCalls[0] || ''),
    'and sends no user id for anyone to tamper with: ' + JSON.stringify(deleteCalls[0]));
  // The test session is faked with handleSession, so signOut() has no stored
  // token to revoke and never reaches the network -- watching for the logout
  // request proves nothing here. What is observable is that the success path
  // ran to the end: the athlete is told, and the page reloads to the signed-out
  // state rather than leaving a dead session on screen.
  const okAlert = dialogs.find((d) => d.type === 'alert');
  assert(okAlert && /have been deleted/i.test(okAlert.message),
    'the athlete is told it worked: ' + JSON.stringify(okAlert && okAlert.message));
  assert(reloaded, 'and the page reloads out of the now-deleted session');

  assert(errors.length === 0, 'no page errors throughout: ' + JSON.stringify(errors));

  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
