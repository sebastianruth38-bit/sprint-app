// The README describes the app. This checks it still describes THIS app.
//
// The last README went stale without anyone noticing: it called the app Sprint
// Lab, said there was no account and no server, and said all data lived in
// localStorage -- three things that had not been true for weeks. Nothing broke,
// because prose cannot break. That is the problem.
//
// Rewriting it, three more claims came out wrong on the first pass: a measure
// filed under the wrong clip type, a feature put in the wrong tab, and the
// retention purge described as running on sign-in when it runs on render. All
// three were caught by reading the code afterwards, which is not a process that
// scales. So: every name and number the docs quote is checked against source.
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const app = read('app.js');
const index = read('index.html');
const readme = read('README.md');
const setup = read('supabase', 'SETUP.md');
const schema = read('supabase', 'schema.sql');
const runner = read('tests', 'run.sh');
const fn = read('supabase', 'functions', 'analyze-form', 'index.ts');

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

// ---------- the app it claims to be ----------
check('the README calls the app by its current name', /^# Sprintr/m.test(readme));
// The specific claims that went stale last time. They describe an app that
// stopped existing when the backend went in.
const deadClaims = [
  [/Sprint Lab/, 'uses the old name'],
  [/no account/i, 'says there are no accounts'],
  [/no server/i, 'says there is no server'],
  [/everything is saved locally/i, 'says data is local-only'],
];
deadClaims.forEach(([re, what]) => check(`the README no longer ${what}`, !re.test(readme)));
check('nor does the backend setup doc use the old name', !/Sprint Lab/.test(setup));

// ---------- every measure it names is a measure the app produces ----------
// A name here that app.js never emits is a score the reader will look for and
// never see.
const measures = new Set();
for (const m of app.matchAll(/name: '([A-Z][^']*)'/g)) measures.add(m[1]);
// Only the measures that are still SCORED. Torso-to-Thigh, Passing Position,
// Front/Back Balance and Upright Posture survive as flags rather than scores,
// so the README no longer lists them as things you are graded on.
const quoted = [
  'Foot Strike vs COM', 'Hip Height', 'Support Stiffness', 'Ankle at Touchdown',
  'Drive Position', 'Acceleration Posture', 'Thigh Separation', 'Heel Recovery',
  'Shin Angle at Touchdown',
];
quoted.forEach((q) => {
  const inReadme = readme.includes(q);
  const inApp = [...measures].some((m) => m.startsWith(q));
  check(`"${q}" is both documented and produced`, inReadme && inApp,
    inReadme ? 'README names it, app.js does not emit it' : 'app.js emits it, README dropped it');
});

// Clip types are a closed list in a <select>; the README's table is organised
// around them and goes wrong the moment one is added or renamed.
// Scoped to the clip-type <select>: the workout planner has its own list of
// session types that reads almost identically and is not what this documents.
const clipSelect = (index.match(/<select id="clipType">([\s\S]*?)<\/select>/) || ['', ''])[1];
const clipTypes = [...clipSelect.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1])
  .filter((t) => !/^Clip type/.test(t));
check('the README knows every clip type the app offers', clipTypes.length > 0
  && clipTypes.every((t) => readme.includes(t)), clipTypes.join(', '));

// ---------- tabs ----------
// A feature described under the wrong tab sends the reader somewhere it isn't.
const tabs = [...index.matchAll(/<span class="tab-label">([^<]+)<\/span>/g)].map((m) => m[1]);
check('the README lists the tabs the app actually has',
  tabs.length > 0 && tabs.every((t) => readme.includes(t)), tabs.join(', '));
// Which tab a feature is documented under, derived rather than hard-coded.
// The first version of this named the panel it expected; when that panel was
// renamed the lookup returned -1, the comparison stayed true, and the check
// passed while asserting nothing. So: find the panel the markup actually puts
// it in, turn that into the tab's own label, and read the README bullet for
// that label.
const tabLabel = (panelId) => {
  const slug = panelId.replace(/^panel-/, '');
  const btn = index.match(new RegExp(`data-tab="${slug}"[^>]*>([\\s\\S]*?)</button>`));
  return btn ? (btn[1].match(/class="tab-label">([^<]+)</) || [])[1] : null;
};
const panelHolding = (needle) => {
  const at = index.indexOf(needle);
  if (at === -1) return null;
  const before = index.slice(0, at);
  const ids = [...before.matchAll(/<section class="tab-panel[^"]*" id="([^"]+)"/g)];
  return ids.length ? ids[ids.length - 1][1] : null;
};
const boardPanel = panelHolding('id="chasingBoard"');
check('the chasing board is in some panel', !!boardPanel, String(boardPanel));
const boardTab = boardPanel && tabLabel(boardPanel);
check('and that panel has a tab', !!boardTab, `${boardPanel} -> ${boardTab}`);
if (boardTab) {
  const bullet = (readme.match(new RegExp(`- \\*\\*${boardTab}\\*\\*[^\\n]*`)) || [''])[0];
  check('and the README documents the board under that tab',
    /chasing/i.test(bullet), `${boardTab}: ${bullet || '(no bullet)'}`);
  // The reverse: no other tab's bullet may claim it.
  const wrong = [...readme.matchAll(/- \*\*([^*]+)\*\*([^\n]*)/g)]
    .filter(([, name, rest]) => name !== boardTab && /chasing/i.test(rest))
    .map(([, name]) => name);
  check('and no other tab claims it', wrong.length === 0, wrong.join(', '));
}

// ---------- every number ----------
const num = (src, re, what) => {
  const v = (src.match(re) || [])[1];
  check(`${what} is readable from source`, !!v);
  return v;
};
const retention = num(app, /const VIDEO_RETENTION_DAYS = (\d+)/, 'the retention period');
check('the README states the retention the code enforces',
  readme.includes(`${retention} days`), `code says ${retention}`);
check('and the setup doc points at the constant rather than repeating it',
  /VIDEO_RETENTION_DAYS/.test(setup));

const frames = num(app, /extractFrames\(pendingBlob,\s*(\d+)/, 'the AI frame count');
check('the README states the number of frames that leave the device',
  new RegExp(`\\b(six|${frames})\\b`, 'i').test(readme), `code sends ${frames}`);

const limit = num(fn, /DAILY_ANALYSIS_LIMIT = Number\(Deno\.env\.get\("[^"]+"\) \?\? "(\d+)"\)/,
  'the daily AI quota');
check('the README states the daily quota the function enforces',
  new RegExp(`\\b(ten|${limit})\\b`, 'i').test(readme), `function allows ${limit}`);

// The suite count is the kind of number that is right the day it is written
// and wrong the next time a file is added.
const list = (re) => (runner.match(re) || ['', ''])[1].trim().split(/\s+/).filter(Boolean);
const suites = list(/node_only=\(([\s\S]*?)\n\)/).length
  + list(/browser=\(([\s\S]*?)\n\)/).length
  + (/\+=\(crop_flow_test\)/.test(runner) ? 1 : 0);
check('the README states how many suites there are',
  new RegExp(`\\b${suites}\\b\\s+suites`).test(readme), `run.sh has ${suites}`);

// ---------- names that only exist in one place ----------
check('the storage bucket named in the docs is the one the schema creates',
  /diagnosis-videos/.test(schema) && /diagnosis-videos/.test(setup));
const fns = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'functions'));
check('the setup doc names every deployed function', fns.every((f) => setup.includes(f)),
  fns.join(', '));
// The doc says both functions turn the platform's JWT check off and verify the
// caller themselves instead. Whether the flag is off is a deploy setting and
// not visible from here -- but the half that IS in this repo is the half that
// matters: with verify_jwt off, a function that stops reading the Authorization
// header is open to anyone. So that is what gets checked.
const selfChecked = fns.filter((f) => {
  const src = read('supabase', 'functions', f, 'index.ts');
  return /req\.headers\.get\("Authorization"\)/.test(src) && /auth\.getUser\(\)/.test(src);
});
check('every function checks the caller\'s token itself, as the doc says',
  selfChecked.length === fns.length,
  `${selfChecked.join(', ') || 'none'} of ${fns.join(', ')}`);

// ---------- the sign-in methods it advertises ----------
const methods = [
  [/signInWithPassword/, 'email + password'],
  [/signInWithOtp/, 'magic link'],
  [/signInWithOAuth/, 'Google'],
];
methods.forEach(([re, what]) => check(`the README advertises ${what} only if the app offers it`,
  re.test(app) === readme.toLowerCase().includes(what.toLowerCase().split(' ')[0])));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
