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

// ---------- the default must not move anyone ----------
check('the column defaults to having a gym',
  /has_gym boolean not null default true/.test(schema));
check('and the app treats a missing setting the same way',
  /data\.has_gym !== false/.test(src));
check('the gym is its own setting, not one of the equipment chips',
  !/EQUIPMENT_OPTIONS = \[[^\]]*Gym/.test(src));
check('buildLiftDetails assumes a gym when not told otherwise',
  /function buildLiftDetails\(role, phase, hasGym = true\)/.test(src));
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
ROLES.forEach((role) => {
  PHASES.forEach((phase) => {
    movements(ctx.buildLiftDetails(role, phase, false)).forEach((mv) => {
      if (GYM_ONLY.test(mv)) offenders.push(`${role}/${phase.seasonPhase}: ${mv}`);
    });
  });
});
check('no bodyweight day prescribes something that needs a gym',
  offenders.length === 0, offenders.join(' | '));

// ---------- and nothing in it asks what weight was used ----------
// This is the check that matters most day to day: an unrecognised movement
// gets a weight input, and "what did you load your push-up with" is the kind
// of thing that makes an athlete stop trusting the app.
const asksForWeight = [];
ROLES.forEach((role) => {
  PHASES.forEach((phase) => {
    movements(ctx.buildLiftDetails(role, phase, false)).forEach((mv) => {
      if (!ctx.isBodyweightExercise(mv)) asksForWeight.push(`${role}/${phase.seasonPhase}: ${mv}`);
    });
  });
});
check('every movement in a bodyweight plan is recognised as bodyweight',
  asksForWeight.length === 0, asksForWeight.join(' | '));

// ---------- the substitutions keep the point of the day ----------
// A day is not warmed over by dropping the load: the accel day exists to
// produce force fast, and a version of it with no jumping in it is a
// different day wearing the same name.
const accelBw = ctx.buildLiftDetails('accel', { seasonPhase: 'off' }, false);
check('the acceleration day still has jumping in it', /jump/i.test(accelBw), accelBw);
const maxvBw = ctx.buildLiftDetails('maxv', { seasonPhase: 'off' }, false);
check('the max-velocity day still has elastic work in it',
  /jump|hop/i.test(maxvBw), maxvBw);
check('the tempo days still push and still pull',
  /push-up/i.test(ctx.buildLiftDetails('tempo1', { seasonPhase: 'off' }, false))
  && /row/i.test(ctx.buildLiftDetails('tempo1', { seasonPhase: 'off' }, false)));
check('and the competition-week day stays light',
  /nothing near failure|crisp/i.test(ctx.buildLiftDetails('competitionLight', { seasonPhase: 'in' }, false)));
// In-season volume should not exceed off-season volume on the same day.
ROLES.forEach((role) => {
  const inS = movements(ctx.buildLiftDetails(role, { seasonPhase: 'in' }, false)).length;
  const offS = movements(ctx.buildLiftDetails(role, { seasonPhase: 'off' }, false)).length;
  check(`"${role}" is not heavier in season than out of it`, inS <= offS, `${inS} vs ${offS}`);
});

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

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
