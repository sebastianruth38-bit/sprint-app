// Without a weight room the week's lifts are prescribed as bodyweight work.
//
// Three things go wrong quietly here.
//
// The default. `equipment` is a set where absent means "does not have it", so
// putting the gym in there would have moved every existing athlete to
// bodyweight the moment it shipped, without anyone touching a setting. It is
// its own column defaulting to true, and that default is checked.
//
// The load prompt. The log asks what weight was used for anything it does not
// recognise as bodyweight, so a movement missing from BODYWEIGHT_LIFT_KEYWORDS
// asks the athlete what they loaded a push-up with. Nothing errors.
//
// And the plan itself: a bodyweight day that quietly drops the quality the day
// existed for is worse than no substitution. The accel day is about producing
// force fast, so it must still contain jumping.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

const ctx = { console, Math, JSON, Object, Array, Number };
vm.createContext(ctx);
const grab = (startMark, endMark) => {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  return src.slice(a, b);
};
vm.runInContext(
  grab('const BODYWEIGHT_LIFT_KEYWORDS', 'function isBodyweightExercise')
  + grab('function isBodyweightExercise', '\n\n')
  + grab('function buildLiftDetails', 'function buildWeekPlan')
  + '\nglobalThis.buildLiftDetails=buildLiftDetails;'
  + 'globalThis.isBodyweightExercise=isBodyweightExercise;'
  + 'globalThis.BODYWEIGHT_LIFT_KEYWORDS=BODYWEIGHT_LIFT_KEYWORDS;', ctx);

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

const ROLES = ['accel', 'maxv', 'tempo1', 'tempo2', 'competitionLight'];
const PHASES = [{ seasonPhase: 'in' }, { seasonPhase: 'off' }];
const movements = (text) => (text || '').split(',').map((s) => s.trim()).filter(Boolean);

// Every version of every day, not just the first one.
//
// Each day used to be a single fixed string, so checking it once checked all
// of it. Now there is a pool, and a check that only ever reads variant 0
// leaves the rest of the pool unguarded -- which is where a movement that
// needs a gym, or one the log would ask a weight for, would actually slip in.
const VARIANTS = (src.match(/const LIFT_VARIANTS = (\d+)/) || [null, '1'])[1] | 0;
check('the number of day variants is readable from the app', VARIANTS >= 2, String(VARIANTS));
const everyPlan = (hasGym) => {
  const out = [];
  ROLES.forEach((role) => PHASES.forEach((phase) => {
    for (let v = 0; v < VARIANTS; v++) {
      out.push({ role, phase, v, text: ctx.buildLiftDetails(role, phase, hasGym, v) });
    }
  }));
  return out;
};

// ---------- the default must not move anyone ----------
check('the column defaults to having a gym',
  /has_gym boolean not null default true/.test(schema));
check('and the app treats a missing setting the same way',
  /data\.has_gym !== false/.test(src));
check('the gym is its own setting, not one of the equipment chips',
  !/EQUIPMENT_OPTIONS = \[[^\]]*Gym/.test(src));
// The default is what matters, not the arity -- a fourth argument was added
// for the day variant and this used to pin the whole parameter list, so a
// purely additive change failed a check about something else entirely.
check('buildLiftDetails assumes a gym when not told otherwise',
  /function buildLiftDetails\(role, phase, hasGym = true[,)]/.test(src),
  (src.match(/function buildLiftDetails\([^)]*\)/) || ['(not found)'])[0]);
ROLES.forEach((role) => {
  PHASES.forEach((phase) => {
    check(`"${role}" (${phase.seasonPhase}) is unchanged when the caller says nothing`,
      ctx.buildLiftDetails(role, phase) === ctx.buildLiftDetails(role, phase, true));
  });
});

// ---------- there is a bodyweight plan at all ----------
ROLES.forEach((role) => {
  PHASES.forEach((phase) => {
    const bw = ctx.buildLiftDetails(role, phase, false);
    check(`"${role}" (${phase.seasonPhase}) has a bodyweight plan`, !!bw && bw.length > 10, String(bw));
    check(`and it is not just the barbell plan again`,
      bw !== ctx.buildLiftDetails(role, phase, true));
  });
});

// ---------- nothing in it needs a gym ----------
const GYM_ONLY = /\b(barbell|bench press|flat bench|incline bench|squat rack|power clean|hang clean|hang snatch|quarter squat|back squat|pushdown|lateral raise|shoulder press|med ball|hurdle hop|step up)\b/i;
const offenders = [];
everyPlan(false).forEach(({ role, phase, v, text }) => {
  movements(text).forEach((mv) => {
    if (GYM_ONLY.test(mv)) offenders.push(`${role}/${phase.seasonPhase}/v${v}: ${mv}`);
  });
});
check('no bodyweight day prescribes something that needs a gym',
  offenders.length === 0, offenders.join(' | '));

// ---------- and nothing in it asks what weight was used ----------
// This is the check that matters most day to day: an unrecognised movement
// gets a weight input, and "what did you load your push-up with" is the kind
// of thing that makes an athlete stop trusting the app.
const asksForWeight = [];
everyPlan(false).forEach(({ role, phase, v, text }) => {
  movements(text).forEach((mv) => {
    if (!ctx.isBodyweightExercise(mv)) asksForWeight.push(`${role}/${phase.seasonPhase}/v${v}: ${mv}`);
  });
});
check('every movement in a bodyweight plan is recognised as bodyweight',
  asksForWeight.length === 0, asksForWeight.join(' | '));

// ---------- the substitutions keep the point of the day ----------
// A day is not warmed over by dropping the load: the accel day exists to
// produce force fast, and a version of it with no jumping in it is a
// different day wearing the same name.
// Asked of EVERY version, not just the first. A pool makes it easy to add a
// variant that is a reasonable session and the wrong session -- an accel day
// of split squats and glute bridges is a fine workout that is no longer an
// acceleration day.
const QUALITIES = [
  ['accel', /jump/i, 'jumping'],
  ['maxv', /jump|hop/i, 'elastic work'],
  ['tempo1', /push-up/i, 'pushing'],
  ['tempo1', /row/i, 'pulling'],
  ['tempo2', /push-up|dip/i, 'pushing'],
  ['tempo2', /row/i, 'pulling'],
  ['competitionLight', /nothing near failure|crisp/i, 'a keep-it-light note'],
];
QUALITIES.forEach(([role, re, what]) => {
  const missing = everyPlan(false)
    .filter((p) => p.role === role && !re.test(p.text || ''))
    .map((p) => `${p.phase.seasonPhase}/v${p.v}: ${p.text}`);
  check(`every bodyweight "${role}" version still has ${what}`,
    missing.length === 0, missing.join(' | '));
});
// The same for the barbell plans: a version of the accel day with no jump in
// it is the same mistake with a bar in its hands.
[['accel', /jump|throw/i, 'jumping or throwing'],
 ['maxv', /hop|jump/i, 'elastic work']].forEach(([role, re, what]) => {
  const missing = everyPlan(true)
    .filter((p) => p.role === role && !re.test(p.text || ''))
    .map((p) => `${p.phase.seasonPhase}/v${p.v}: ${p.text}`);
  check(`every gym "${role}" version still has ${what}`,
    missing.length === 0, missing.join(' | '));
});
// In-season volume should not exceed off-season volume on the same day, for
// any version of it.
//
// Bodyweight plans only, as before. The barbell plans legitimately ADD a
// movement in season -- med ball throws on the two high-CNS days -- while
// cutting sets, so counting movements is not a volume measure there. Widening
// this to the gym plans failed it on behaviour that was deliberate.
ROLES.forEach((role) => {
  for (let v = 0; v < VARIANTS; v++) {
    const inS = movements(ctx.buildLiftDetails(role, { seasonPhase: 'in' }, false, v)).length;
    const offS = movements(ctx.buildLiftDetails(role, { seasonPhase: 'off' }, false, v)).length;
    check(`"${role}" v${v} is not heavier in season than out of it`,
      inS <= offS, `${inS} vs ${offS}`);
  }
});
// Variety is the point: the versions have to actually differ.
[true, false].forEach((hasGym) => {
  ROLES.forEach((role) => {
    PHASES.forEach((phase) => {
      const seen = new Set();
      for (let v = 0; v < VARIANTS; v++) seen.add(ctx.buildLiftDetails(role, phase, hasGym, v));
      check(`"${role}" (${phase.seasonPhase}, ${hasGym ? 'gym' : 'bodyweight'}) offers ${VARIANTS} different days`,
        seen.size === VARIANTS, `${seen.size} distinct`);
    });
  });
});
// And out-of-range variants must wrap rather than return nothing -- the
// caller picks the number, and a caller is a thing that can be wrong.
check('a variant past the end of the pool wraps around',
  ctx.buildLiftDetails('accel', { seasonPhase: 'off' }, true, VARIANTS)
    === ctx.buildLiftDetails('accel', { seasonPhase: 'off' }, true, 0));
check('and a negative one does too',
  !!ctx.buildLiftDetails('accel', { seasonPhase: 'off' }, true, -1));

// ---------- the setting is reachable and saved ----------
check('there is a toggle in Training Setup', /id="hasGymBtn"/.test(index));
check('it says which state it is in', /I have a gym/.test(src) && /No gym/.test(src));
check('and what that means for the plan', /bodyweight work/i.test(src));
check('it is saved with the rest of the setup', /has_gym: hasGymSelected/.test(src));
check('and read back when the modal opens', /hasGymSelected = data\.has_gym !== false/.test(src));
check('the week builder is told about it',
  /buildWeekPlan\(phase, equipment, primaryEvents, hasGym\)/.test(src));
check('and passes it down to every lift it prescribes',
  !/buildLiftDetails\('\w+', phase\)/.test(src));
// The week picks the variant, because buildLiftDetails has to stay pure.
check('the week plan varies the lifting day rather than repeating one',
  /Math\.floor\(Math\.random\(\) \* LIFT_VARIANTS\)/.test(src));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
