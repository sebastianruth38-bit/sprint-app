// The filming guide tells athletes how to shoot a clip this app can grade.
//
// Every line in it came from a clip the app actually refused, so the guide is
// only useful while it still matches what the code enforces. Two ways it rots:
// a threshold moves in app.js and the advice quietly becomes wrong, or a class
// or id in the hand-written SVG is mistyped and the diagram renders as nothing
// -- which no other suite would notice, because nothing throws.
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

const guide = (index.match(/<details class="filming-guide"[\s\S]*?<\/details>/) || [])[0];
check('the guide is in the page', !!guide);
if (!guide) {
  console.log(`\n${pass} passed, ${fails.length} failed`);
  fails.forEach((f) => console.log('  FAIL: ' + f));
  process.exit(1);
}

// ---------- where it sits ----------
// Advice after the button is advice nobody reads: it has to be the last thing
// before Analyze, inside the same form card.
check('it sits above the Analyze button',
  index.indexOf('filming-guide') < index.indexOf('id="saveDiagnosis"'));
check('and nothing but whitespace comes between them',
  /<\/details>\s*<button id="saveDiagnosis"/.test(index));

// The form is already long. Open by default and the button goes below the fold.
check('it is collapsed by default', !/<details class="filming-guide"[^>]*\bopen\b/.test(index));
check('it says what it is before you open it', /<summary>[^<]*film[^<]*<\/summary>/i.test(guide));

// ---------- the drawings actually draw ----------
// A mistyped class is invisible: the SVG renders, the shape is just unstyled.
const used = new Set();
for (const m of guide.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && used.add(c));
const undefinedClasses = [...used].filter((c) => !new RegExp(`\\.${c}[\\s,{:.]`).test(css));
check('every class used in the guide has a style rule', undefinedClasses.length === 0,
  undefinedClasses.join(', '));

// Two <defs> blocks with the same marker id is legal HTML and renders wrong in
// some browsers -- this nearly shipped when one diagram was split into a pair.
const ids = [...guide.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
check('no duplicate ids across the diagrams', new Set(ids).size === ids.length, ids.join(', '));
// A marker referenced but never defined silently drops the arrowheads.
const refs = [...guide.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
check('every url(#id) reference resolves inside the guide',
  refs.every((r) => ids.includes(r)), refs.join(', '));

// ---------- do and don't, both present ----------
const items = guide.match(/class="guide-item"/g) || [];
check('there are diagrams, not just a wall of text', items.length >= 3, `${items.length} found`);
// Each diagram is a pair: this is what makes it readable at 104px wide.
const oks = (guide.match(/g-frame ok/g) || []).length;
const bads = (guide.match(/g-frame bad/g) || []).length;
check('every diagram shows the right way and the wrong way',
  oks === items.length && bads === items.length, `${oks} ok / ${bads} bad / ${items.length} items`);
check('the list has both dos and donts',
  /li class="yes"/.test(guide) && /li class="no"/.test(guide));

// ---------- the advice matches the thresholds ----------
// "Three seconds of running" has to comfortably cover what the grader needs:
// MIN_TRACK_FRAMES posed frames, on the slowest device the app will still
// grade. If either constant moves far enough, the promise stops being true.
const minFrames = Number((app.match(/const MIN_TRACK_FRAMES = (\d+)/) || [])[1]);
const minFps = Number((app.match(/const MEASURABLE_FPS_MIN = (\d+)/) || [])[1]);
check('both grading thresholds are readable from the code', minFrames > 0 && minFps > 0,
  `${minFrames} frames @ ${minFps}fps`);
const promised = (guide.match(/\b(three|four|five)\s+seconds\b/i) || [])[1];
check('the guide promises a clip length', !!promised, promised);
const seconds = { three: 3, four: 4, five: 5 }[(promised || '').toLowerCase()];
check('and that length really is enough for the grader',
  seconds >= (minFrames / minFps) * 2,
  `promises ${seconds}s, grader needs ${(minFrames / minFps).toFixed(1)}s of clean running`);

// The resolution advice is only right while frame rate is what limits us.
check('the guide explains why resolution matters, not just what to set',
  /frames a second/i.test(guide));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
