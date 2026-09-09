// The privacy policy makes factual claims about what the code does. This
// checks the claims against the code.
//
// A policy that misdescribes the app is worse than no policy: it is a promise
// to users that the software does not keep. The retention number has already
// drifted once -- the UI still said 60 days after the purge moved to 30 -- and
// that was only caught because a test read the constant instead of a literal.
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const privacy = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8');
const terms = fs.readFileSync(path.join(__dirname, '..', 'terms.html'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const deploy = fs.readFileSync(path.join(__dirname, '..', 'tools', 'deploy.sh'), 'utf8');
const fn = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'analyze-form', 'index.ts'), 'utf8');

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

// ---------- retention ----------
const retention = (app.match(/const VIDEO_RETENTION_DAYS = (\d+)/) || [])[1];
check('the app declares a retention period', !!retention);
check('the privacy policy states the same retention the purge enforces',
  privacy.includes(`${retention} days`),
  `code says ${retention} days`);
check('the terms state it too', terms.includes(`${retention} days`));
check('and so does the app itself', index.includes(`${retention} days`));

// ---------- what leaves the device ----------
// The policy's central claim is that grading is local and only the opt-in AI
// path sends anything. If that ever stops being true the policy becomes a lie.
check('grading really does run in the browser, not on a server',
  /getPoseLandmarker/.test(app) && !/upload[\s\S]{0,200}extractFrames/.test(app));
check('the policy says grading happens on the device',
  /on your own device|inside your browser/i.test(privacy));
check('the AI path is opt-in in the code',
  /getElementById\('aiAssist'\)\.checked/.test(app));
check('the checkbox really is unchecked by default',
  /id="aiAssist"(?![^>]*\bchecked\b)/.test(index));
check('the policy says the AI notes are off by default',
  /off by default/i.test(privacy));
check('the policy names where the frames go',
  /anthropic/i.test(privacy) && /api\.anthropic\.com/.test(fn));

// The number of frames the policy promises is the number the app sends.
const frameCount = (app.match(/extractFrames\(pendingBlob,\s*(\d+)/) || [])[1];
check('the app sends a known number of frames', !!frameCount, frameCount);
check('the policy states that same number',
  new RegExp(`\\b(six|${frameCount})\\b`, 'i').test(privacy),
  `code sends ${frameCount}`);

// ---------- promises the app has to be able to keep ----------
check('per-clip deletion, which the policy promises, exists',
  /delete-btn/.test(app) && /storage[\s\S]{0,120}\.remove\(/.test(app));
// Account deletion exists now, so the policy has to describe it -- and the
// button it points at has to be there. A policy promising a button that does
// not exist is the exact failure this file is here to catch.
check('the policy tells you how to delete your account',
  /Delete Account/.test(privacy));
check('and that button exists in the app',
  /id="deleteAccountBtn"/.test(index));
check('and it is wired to the server function',
  /invoke\('delete-account'\)/.test(app));
check('the policy warns there is no undo',
  /no undo|cannot be undone/i.test(privacy));

// ---------- reachable ----------
check('both pages are linked from the app', index.includes('privacy.html') && index.includes('terms.html'));
check('the pages link to each other', privacy.includes('terms.html') && terms.includes('privacy.html'));
check('both link back into the app', privacy.includes('index.html') && terms.includes('index.html'));
// The App Store wants a privacy policy at a URL that loads without an account.
check('neither page needs a login or any script to render',
  !/<script/i.test(privacy) && !/<script/i.test(terms));
check('the deploy script ships both pages',
  deploy.includes('privacy.html') && deploy.includes('terms.html'));

// ---------- the contact placeholder ----------
// Deliberately a failing check until a real address is filled in: a privacy
// policy whose contact line reads "[ADD YOUR CONTACT EMAIL HERE]" is not a
// finished document, and shipping it to an app store would be worse than
// having none.
const placeholder = /ADD YOUR CONTACT EMAIL HERE/;
if (placeholder.test(privacy) || placeholder.test(terms)) {
  fails.push('contact email is still a placeholder — fill it in before these pages go anywhere public');
} else {
  pass++;
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
