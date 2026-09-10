// The warm-up is a complete four-phase warm-up whatever the scores say, with
// the athlete's weak points starred inside it.
//
// The rule that matters most here is a negative one: it must never come back
// empty. An earlier version built the whole tab out of weak points and showed
// almost nothing to the athlete who had none -- the one furthest along got the
// least. So "every phase is populated" and "something is always flagged once
// anything has been measured" are both checked directly.
//
// The rest are the joins that fail silently: a measure name on an item that
// the grader never emits is a star that can never light, and a session type
// the planner offers but phase IV does not know loses its whole fourth phase.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const from = src.indexOf('// WARM-UP');
const to = src.indexOf('function todaysDayName');
const ctx = { console, Math, JSON, Object, Array, Number };
vm.createContext(ctx);
vm.runInContext(
  'function encodeURIComponent(s){return String(s).replace(/ /g,"%20");}\n'
  + 'function ytSearch(q){return "https://example.test/?q=" + encodeURIComponent(q);}\n'
  + src.slice(from, to)
  + '\n' + ['WARMUP_PHASES', 'WARMUP_PLANS', 'SESSION_WARMUP', 'SESSION_TO_CLIP', 'WARMUP_WEAK_MAX',
            'measureScores', 'warmupFlags', 'buildWarmup', 'WARMUP_SESSIONS']
      .map((n) => `globalThis.${n}=${n};`).join(''), ctx);

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

const MAXV = 'Max Velocity (flys/build-ups)';
const scores = (obj) => ({ 'Max Velocity': obj });
const flaggedItems = (plan) =>
  plan.phases.flatMap((p) => p.items.filter((i) => i.flag).map((i) => i.name));
const allItems = (plan) => plan.phases.flatMap((p) => p.items);

// ---------- the four phases ----------
check('there are three fixed phases before the session-specific one',
  ctx.WARMUP_PHASES.length === 3, String(ctx.WARMUP_PHASES.length));
check('numbered I, II, III',
  ctx.WARMUP_PHASES.map((p) => p.numeral).join(',') === 'I,II,III');
check('named for what they are',
  ctx.WARMUP_PHASES.map((p) => p.name).join(', ') === 'Mobility, Movement, Activation',
  ctx.WARMUP_PHASES.map((p) => p.name).join(', '));

const plan = ctx.buildWarmup(scores({ 'Heel Recovery (knee fold)': 2 }), MAXV);
check('and a fourth for the session', plan.phases.length === 4
  && plan.phases[3].numeral === 'IV' && /Workout Specific/.test(plan.phases[3].name));
check('every phase says what it is for', plan.phases.every((p) => p.why && p.why.length > 20));
// The complaint that started this rewrite: a warm-up that is mostly empty.
check('every phase of a track session actually has work in it', plan.phases.every((p) => p.items.length > 0),
  JSON.stringify(plan.phases.map((p) => `${p.numeral}:${p.items.length}`)));
check('and the whole thing is a real warm-up, not a handful of drills',
  allItems(plan).length >= 18, String(allItems(plan).length));

// A drill with no prescription is a word on a screen.
const vague = [];
[...ctx.WARMUP_PHASES, ...Object.values(ctx.WARMUP_PLANS)].forEach((group) => {
  (group.items || []).forEach((d) => {
    if (!d.name || !d.detail) vague.push(d.name || '?');
    // A drill needs a countable amount -- "do some skips" is not a
    // prescription. Items explicitly marked as cues are exempt: some
    // instructions ("keep moving until you are called") have no rep count and
    // inventing one would be worse than saying it plainly.
    else if (!d.cue && !/\d/.test(d.detail)) vague.push(d.name + ' (no reps or distance)');
  });
});
check('every item says how much of it to do', vague.length === 0, vague.join(', '));
check('and every item is linked to something to watch',
  allItems(plan).every((i) => /^https?:\/\//.test(i.url || '')));

// ---------- the stars can actually light ----------
const emitted = new Set([...src.matchAll(/name: '([A-Z][^']*)'/g)].map((m) => m[1]));
const tagged = new Set();
[...ctx.WARMUP_PHASES, ...Object.values(ctx.WARMUP_PLANS)].forEach((group) => {
  (group.items || []).forEach((d) => (d.measures || []).forEach((m) => tagged.add(m)));
});
const unknown = [...tagged].filter((m) => !emitted.has(m));
check('every measure tagged on an item is one the grader emits',
  unknown.length === 0, unknown.join(', '));
// The reverse matters too: a measure nothing is tagged with can be scored 1/5
// and never star anything, so the athlete is told to fix it and shown nowhere.
const scoreable = ['Foot Strike vs Hips', 'Ankle at Touchdown', 'Support Stiffness',
  'Hip Height', 'Torso-to-Thigh at Peak Lift', 'Thigh Separation (scissor)',
  'Heel Recovery (knee fold)', 'Passing Position', 'Drive Position',
  'Acceleration Posture', 'Upright Posture', 'Front/Back Swing Balance'];
const unreachable = scoreable.filter((m) => !tagged.has(m));
check('and every measure an athlete can be weak at stars something',
  unreachable.length === 0, unreachable.join(', '));

// ---------- every session the planner offers gets a phase IV ----------
const offered = [...(index.match(/<select id="workoutType">([\s\S]*?)<\/select>/) || ['', ''])[1]
  .matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1]);
check('the workout planner offers session types', offered.length > 5, String(offered.length));
const missing = offered.filter((t) => !(t in ctx.SESSION_WARMUP));
check('every session type the planner offers has a warm-up decided for it',
  missing.length === 0, missing.join(', '));
check('and every one of those points at a plan that exists',
  Object.values(ctx.SESSION_WARMUP).every((k) => k in ctx.WARMUP_PLANS),
  Object.values(ctx.SESSION_WARMUP).filter((k) => !(k in ctx.WARMUP_PLANS)).join(', '));
// Sessions wanting the same preparation share one plan rather than each
// carrying a near-copy that drifts out of step with the others.
check('there are far fewer warm-ups than sessions',
  Object.keys(ctx.WARMUP_PLANS).length < offered.length,
  `${Object.keys(ctx.WARMUP_PLANS).length} plans for ${offered.length} sessions`);
check('special endurance warms up exactly like speed endurance',
  ctx.SESSION_WARMUP['Special Endurance (150-300m)'] === ctx.SESSION_WARMUP['Speed Endurance (60-150m)']);
check('blocks and hills warm up like an acceleration day',
  ctx.SESSION_WARMUP['Blocks / Starts'] === 'accel' && ctx.SESSION_WARMUP['Hill Sprints'] === 'accel');
check('a meet day warms up like a pre-meet',
  ctx.SESSION_WARMUP['Meet Day'] === ctx.SESSION_WARMUP['Pre-Meet']);
// Rest and recovery are deliberately empty; everything else has work.
const empty = offered.filter((t) => {
  const plan = ctx.WARMUP_PLANS[ctx.SESSION_WARMUP[t]];
  return plan && !plan.items.length && !['Rest Day', 'Recovery / Mobility'].includes(t);
});
check('and only rest and recovery days have nothing session-specific',
  empty.length === 0, empty.join(', '));

// ---------- a lift day ----------
// No room to run, so the sprint drills in II and III are not on offer. What
// replaces them is the part of a lifting session people skip.
const gym = ctx.buildWarmup({}, 'Lift Only');
check('a lift day gets mobility and nothing else general',
  gym.phases.map((p) => p.numeral).join(',') === 'I,IV',
  gym.phases.map((p) => p.numeral).join(','));
// Phase IV is the last phase, whichever index that lands on -- a lift day
// skips II and III, so it is not index 3 there.
const lastPhase = (pl) => pl.phases[pl.phases.length - 1];
const gymIV = lastPhase(gym);
check('phase IV is still the last phase on a lift day', gymIV.numeral === 'IV', gymIV.numeral);
const ramp = gymIV.items.map((i) => i.name).join(' | ');
check('and works up to the weight rather than starting at it',
  /25%/.test(ramp) && /50%/.test(ramp) && /75%/.test(ramp) && /90%/.test(ramp), ramp);
check('starting from the movement itself',
  /empty|base/i.test(gymIV.items[0].name), gymIV.items[0].name);
check('and ending at the working sets',
  /working sets/i.test(gymIV.items[gymIV.items.length - 1].name));
const recovery = ctx.buildWarmup({}, 'Recovery / Mobility');
check('a recovery day is mobility and stops there',
  recovery.phases.map((p) => p.numeral).join(',') === 'I,IV'
  && lastPhase(recovery).items.length === 0);
// A running session must not lose its running drills to the mobility-only path.
check('a track session still gets all four phases',
  ctx.buildWarmup({}, MAXV).phases.map((p) => p.numeral).join(',') === 'I,II,III,IV');
const ghosts = Object.keys(ctx.SESSION_TO_CLIP).filter((t) => !offered.includes(t));
check('no clip-type mapping points at a session that does not exist',
  ghosts.length === 0, ghosts.join(', '));

// ---------- what gets starred ----------
const weak = ctx.buildWarmup(scores({
  'Heel Recovery (knee fold)': 2, 'Foot Strike vs Hips': 3,
  'Thigh Separation (scissor)': 4, 'Upright Posture': 5,
}), MAXV);
check('a weak measure stars the items that address it', flaggedItems(weak).length > 0,
  JSON.stringify(flaggedItems(weak)));
check('B-skips are starred for a weak heel recovery',
  flaggedItems(weak).includes('B-skips'), JSON.stringify(flaggedItems(weak)));
check('and the flag names the measure and carries a fix to watch',
  allItems(weak).filter((i) => i.flag).every((i) =>
    i.flag.measure && /^https?:\/\//.test(i.flag.fixUrl || '')));
const strongOnes = allItems(weak).filter((i) => i.flag && i.flag.score > ctx.WARMUP_WEAK_MAX);
check('nothing scoring above the threshold is starred as a fault',
  strongOnes.length === 0, JSON.stringify(strongOnes.map((i) => i.name)));
check('an item covering two faults is starred for the worse one',
  (allItems(weak).find((i) => i.name === 'Ankling') || {}).flag.measure === 'Foot Strike vs Hips');

// THE point of this rewrite: strong scores must not mean an empty page.
const strong = ctx.buildWarmup(scores({
  'Heel Recovery (knee fold)': 4, 'Foot Strike vs Hips': 5, 'Upright Posture': 4,
}), MAXV);
check('an athlete with no faults still gets the whole warm-up',
  allItems(strong).length === allItems(weak).length);
check('and is still told what to sharpen, rather than nothing',
  Object.keys(strong.flags).length > 0 && flaggedItems(strong).length > 0,
  JSON.stringify(Object.keys(strong.flags)));
check('flagged as sharpening, not as a fault', strong.flagKind === 'sharpen', strong.flagKind);
check('and it is the lowest score that gets sharpened',
  Object.values(strong.flags).every((f) => f.score === 4),
  JSON.stringify(Object.entries(strong.flags).map(([m, f]) => `${m}:${f.score}`)));
check('a real fault is flagged as a fault, not as sharpening', weak.flagKind === 'focus');

const nothing = ctx.buildWarmup({}, MAXV);
check('an athlete who has filmed nothing still gets the whole warm-up',
  allItems(nothing).length === allItems(weak).length);
check('with nothing starred, because nothing is known',
  Object.keys(nothing.flags).length === 0 && flaggedItems(nothing).length === 0);

// ---------- which clips are believed ----------
const mixed = ctx.warmupFlags({
  'Acceleration': { 'Drive Position': 1 },
  'Max Velocity': { 'Drive Position': 4, 'Hip Height': 2 },
}, MAXV);
check("the session's own clip type is believed over another's for the same measure",
  !mixed['Drive Position'], JSON.stringify(Object.keys(mixed)));
check('but a fault only the other clip type saw is still raised',
  !!ctx.warmupFlags({ 'Acceleration': { 'Drive Position': 2 } }, MAXV)['Drive Position']);

// ---------- days ----------
const rest = ctx.buildWarmup(scores({ 'Hip Height': 2 }), 'Rest Day');
check('a rest day prescribes nothing at all',
  rest.resting && rest.phases.length === 0 && Object.keys(rest.flags).length === 0);
const noSession = ctx.buildWarmup(scores({ 'Hip Height': 2 }), null);
check('a day with no session still gets phases I-III',
  noSession.phases.length === 4 && noSession.phases.slice(0, 3).every((p) => p.items.length));
check('and phase IV says how to fill it in rather than sitting empty and unexplained',
  /Workouts/.test(noSession.phases[3].why), noSession.phases[3].why);
// ---------- the picker ----------
// Chosen by workout, not by day: the athlete knows what session they are about
// to do, and making them find the day it falls on adds a step and nothing else.
check('the picker chooses a workout', /id="warmupSessionPick"/.test(src));
check('and offers every session the warm-up table knows',
  /const WARMUP_SESSIONS = Object\.keys\(SESSION_WARMUP\)/.test(src));

// ---------- nothing needs equipment ----------
// The athlete warms up on a track with nothing but their own kit bag. A drill
// that needs a band, a hurdle or a sled is a drill they skip, and a warm-up
// with holes in it is worse than a shorter one that is whole.
const KIT = /\b(bands?|hurdles?|wickets?|sleds?|barbells?|dumbbells?|kettlebells?|blocks|plyo box|medicine ball|bar only)\b/i;
const needsKit = [];
[...ctx.WARMUP_PHASES, ...Object.values(ctx.WARMUP_PLANS)].forEach((group) => {
  (group.items || []).forEach((d) => {
    const text = `${d.name} ${d.detail}`;
    // "no blocks needed" names the kit only to say it is not wanted.
    if (KIT.test(text) && !/\bno (blocks|bands?|hurdles?|kit|equipment)\b/i.test(text)) {
      needsKit.push(d.name);
    }
  });
});
check('no drill needs equipment the athlete has to own', needsKit.length === 0,
  needsKit.join(', '));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
