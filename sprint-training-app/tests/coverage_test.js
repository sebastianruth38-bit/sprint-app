// Guards the Form Reference list against drifting from what the workout
// generator actually prescribes -- in BOTH directions.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');

// Pull buildLiftDetails + DEFAULT_EXERCISES straight out of the app.
const lift = src.match(/function buildLiftDetails[\s\S]*?\n}/)[0];
const defaults = src.match(/const DEFAULT_EXERCISES = \[[\s\S]*?\n\];/)[0];
eval(lift);
eval(defaults.replace('const DEFAULT_EXERCISES', 'globalThis.DEFAULT_EXERCISES'));

// Every phase/role/VERSION combination the generator can produce.
//
// The versions matter: each lifting day used to be one fixed string, and this
// walked all of it by calling the function once per role. Now there is a pool,
// and a movement that appears only in version 2 is exactly the one that would
// reach an athlete with nothing in the Reference to look it up under.
const roles = ['accel', 'maxv', 'tempo1', 'tempo2', 'competitionLight'];
const phases = [{ seasonPhase: 'off' }, { seasonPhase: 'pre' }, { seasonPhase: 'in' }];
const VARIANTS = (src.match(/const LIFT_VARIANTS = (\d+)/) || [null, '1'])[1] | 0;
const prescribed = new Set();
phases.forEach(p => roles.forEach(r => {
for (let v = 0; v < VARIANTS; v++) {
  const s = buildLiftDetails(r, p, true, v);
  if (!s) continue;
  s.split(',').map(x => x.trim()).forEach(item => {
    // strip the sets/reps and any trailing note -> bare movement name
    const name = item.replace(/\s+\d+(-\d+)?\s*x.*$/i, '').trim();
    if (name) prescribed.add(name);
  });
}
}));

// How a prescribed name maps onto a reference entry. Anything not listed
// here must match a reference entry by name (singular/plural aside).
const ALIASES = {
  'Step Ups & Squats': ['Step Up', 'Back Squat'],
  'Flat Bench': ['Flat Bench Press'],
  'Incline Bench': ['Incline Bench Press'],
  'Back Row': ['Barbell Back Row'],
  'Barbell Back Row': ['Barbell Back Row'],
  'Hang Cleans': ['Hang Power Clean'],
  'Core': ['Core Circuit'],
  'Hang Snatches': ['Hang Snatch'],   // -es plural, not a plain -s
};
const refNames = new Set(DEFAULT_EXERCISES.map(e => e.name));
const singular = n => n.replace(/s$/, '');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { console.log('PASS: ' + m); pass++; } else { console.error('FAIL: ' + m); fail++; } };

const referenced = new Set();
const missing = [];
prescribed.forEach((name) => {
  const targets = ALIASES[name]
    || [...refNames].filter(r => singular(r) === singular(name) || singular(r) === singular(name).replace(/s$/, ''));
  if (!targets.length) { missing.push(name); return; }
  targets.forEach((t) => {
    if (!refNames.has(t)) { missing.push(`${name} -> ${t}`); return; }
    referenced.add(t);
  });
});

console.log(`\nGenerator prescribes ${prescribed.size} movements; reference list has ${refNames.size} entries.\n`);
assert(missing.length === 0, 'every prescribed lift has a Form Reference entry. Missing: ' + JSON.stringify(missing));

const unused = [...refNames].filter(r => !referenced.has(r));
assert(unused.length === 0, 'no reference entry is dead weight (all are actually programmed). Extra: ' + JSON.stringify(unused));

const noUrl = DEFAULT_EXERCISES.filter(e => !/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(e.url));
assert(noUrl.length === 0, 'every entry points at a specific video (not a search page): ' + JSON.stringify(noUrl.map(e => e.name + ' -> ' + e.url)));

const ids = DEFAULT_EXERCISES.map(e => e.url);
assert(new Set(ids).size === ids.length, 'no two exercises share the same video link');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
