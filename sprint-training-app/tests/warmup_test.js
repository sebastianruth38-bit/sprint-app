// The warm-up is built from the athlete's own scores, which means it is only
// as good as its links to the rest of the app. Three of those links are
// invisible when they break:
//
//   - a drill keyed to a measure name the grader never emits can never be
//     shown, and nothing errors -- the athlete just never gets that drill;
//   - a session type the workout planner offers but the primer table does not
//     know silently loses its finish;
//   - the threshold and the ordering decide what the athlete actually spends
//     ten minutes doing.
//
// So all three are checked against the source they have to agree with.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// The warm-up engine is pure -- no DOM, no network -- so it runs as-is.
const from = src.indexOf('// WARM-UP');
const to = src.indexOf('// Today\'s session decides the primer');
const ctx = { console, Math, JSON, Object, Array, Number };
vm.createContext(ctx);
vm.runInContext(
  'function ytSearch(q){return "https://example.test/?q=" + encodeURIComponent(q);}\n'
  + 'function encodeURIComponent(s){return String(s).replace(/ /g,"%20");}\n'
  + src.slice(from, to)
  + '\nglobalThis.WARMUP_DRILLS=WARMUP_DRILLS;'
  + 'globalThis.WARMUP_PRIMER=WARMUP_PRIMER;'
  + 'globalThis.SESSION_TO_CLIP=SESSION_TO_CLIP;'
  + 'globalThis.WARMUP_WEAK_MAX=WARMUP_WEAK_MAX;'
  + 'globalThis.WARMUP_MAX_TARGETS=WARMUP_MAX_TARGETS;'
  + 'globalThis.warmupTargets=warmupTargets;'
  + 'globalThis.buildWarmup=buildWarmup;', ctx);

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

// ---------- every drill is reachable ----------
// The grader's measure names are the only keys that can ever be looked up.
const emitted = new Set([...src.matchAll(/name: '([A-Z][^']*)'/g)].map((m) => m[1]));
const orphans = Object.keys(ctx.WARMUP_DRILLS).filter((k) => !emitted.has(k));
check('every drill is keyed to a measure the grader emits', orphans.length === 0,
  orphans.join(', '));

// The reverse is not required -- some measures have no useful drill -- but the
// ones an athlete is most likely to score badly on should be covered.
['Foot Strike vs Hips', 'Heel Recovery (knee fold)', 'Thigh Separation (scissor)',
 'Hip Height', 'Support Stiffness', 'Drive Position'].forEach((m) => {
  check(`"${m}" has drills`, !!ctx.WARMUP_DRILLS[m]);
});

// A drill with no prescription is a word on a screen.
const badDrills = [];
Object.entries(ctx.WARMUP_DRILLS).forEach(([measure, entry]) => {
  if (!entry.why || entry.why.length < 20) badDrills.push(measure + ' (no why)');
  (entry.drills || []).forEach((d) => {
    if (!d.name || !d.detail) badDrills.push(measure + '/' + (d.name || '?'));
    // Reps or distance -- something countable. "Do some skips" is not a warm-up.
    if (d.detail && !/\d/.test(d.detail)) badDrills.push(measure + '/' + d.name + ' (no numbers)');
  });
  if (!entry.drills || !entry.drills.length) badDrills.push(measure + ' (no drills)');
});
check('every drill says what it is for and how much of it to do',
  badDrills.length === 0, badDrills.join(', '));

// ---------- every session the planner offers gets a finish ----------
const offered = [...(index.match(/<select id="workoutType">([\s\S]*?)<\/select>/) || ['', ''])[1]
  .matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1]);
check('the workout planner offers session types', offered.length > 5, String(offered.length));
const unknown = offered.filter((t) => !(t in ctx.WARMUP_PRIMER));
check('every session type the planner offers has a primer decided for it',
  unknown.length === 0, unknown.join(', '));
// Rest Day is deliberately null; everything else should say something.
const silent = offered.filter((t) => t in ctx.WARMUP_PRIMER && !ctx.WARMUP_PRIMER[t] && t !== 'Rest Day');
check('and only a rest day finishes with nothing', silent.length === 0, silent.join(', '));
const mappedSessions = Object.keys(ctx.SESSION_TO_CLIP).filter((t) => !offered.includes(t));
check('no clip-type mapping points at a session that does not exist',
  mappedSessions.length === 0, mappedSessions.join(', '));

// ---------- what actually gets drilled ----------
const scores = (obj) => ({ 'Max Velocity': obj });
const names = (t) => t.map((x) => x.measure);

const weakest = ctx.warmupTargets(scores({
  'Heel Recovery (knee fold)': 2,
  'Foot Strike vs Hips': 3,
  'Thigh Separation (scissor)': 1,
  'Upright Posture': 5,
}), 'Max Velocity (flys/build-ups)');
check('the worst score is drilled first',
  names(weakest)[0] === 'Thigh Separation (scissor)', JSON.stringify(names(weakest)));
check('and only the worst few, so the warm-up stays a warm-up',
  weakest.length === ctx.WARMUP_MAX_TARGETS, String(weakest.length));

const strong = ctx.warmupTargets(scores({
  'Foot Strike vs Hips': 4, 'Upright Posture': 5, 'Hip Height': 4,
}), 'Max Velocity (flys/build-ups)');
check('a score above the threshold is not a weakness and is left alone',
  strong.length === 0, JSON.stringify(names(strong)));

const borderline = ctx.warmupTargets(scores({ 'Hip Height': ctx.WARMUP_WEAK_MAX }),
  'Max Velocity (flys/build-ups)');
check('a score exactly at the threshold still counts', borderline.length === 1);

// A measure with no drills must not occupy one of the two slots.
const undrillable = ctx.warmupTargets(scores({
  'Some Measure With No Drills': 1, 'Hip Height': 3,
}), 'Max Velocity (flys/build-ups)');
check('a weak measure with no drill does not use up a slot',
  names(undrillable).length === 1 && names(undrillable)[0] === 'Hip Height',
  JSON.stringify(names(undrillable)));

// ---------- which clips are believed ----------
const mixed = ctx.warmupTargets({
  'Acceleration': { 'Drive Position': 1 },
  'Max Velocity': { 'Hip Height': 2 },
}, 'Max Velocity (flys/build-ups)');
check('the session\'s own clip type is preferred over a worse score elsewhere',
  names(mixed)[0] === 'Hip Height', JSON.stringify(names(mixed)));
check('but the other clip type still contributes rather than being thrown away',
  names(mixed).includes('Drive Position'), JSON.stringify(names(mixed)));

const onlyOther = ctx.warmupTargets({ 'Acceleration': { 'Drive Position': 2 } },
  'Max Velocity (flys/build-ups)');
check('an athlete with only the wrong kind of clip still gets their drill',
  names(onlyOther).length === 1, JSON.stringify(names(onlyOther)));

// ---------- the whole plan ----------
const plan = ctx.buildWarmup(scores({ 'Heel Recovery (knee fold)': 2 }),
  'Max Velocity (flys/build-ups)');
check('the general work is always there', plan.raise.length > 0 && plan.mobilise.length > 0);
check('the finish matches the session', /build-up/i.test(plan.primer || ''), plan.primer);
check('and the drills are linked to something to watch',
  plan.targets[0].drills.every((d) => /^https?:\/\//.test(d.url || '')));

const rest = ctx.buildWarmup(scores({ 'Heel Recovery (knee fold)': 2 }), 'Rest Day');
check('a rest day prescribes nothing at all',
  rest.resting && !rest.raise.length && !rest.targets.length && !rest.primer);

const noSession = ctx.buildWarmup(scores({ 'Hip Height': 2 }), null);
check('no session set still gives the general work and the drills',
  noSession.raise.length > 0 && noSession.targets.length === 1);
check('but no finish is invented for a session nobody chose', noSession.primer === null);

const nothing = ctx.buildWarmup({}, 'Max Velocity (flys/build-ups)');
check('an athlete with no clips gets a warm-up anyway',
  nothing.raise.length > 0 && nothing.targets.length === 0 && !!nothing.primer);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
