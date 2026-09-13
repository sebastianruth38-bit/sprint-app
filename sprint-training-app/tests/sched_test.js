const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Sessions that don't need track access, plus competition days -- a meet
// isn't skipped because the athlete ticked a box, and a rest day needs
// nothing to "do". Everything else needs a day they can sprint.
const NO_TRACK_NEEDED = new Set(['Rest Day', 'Recovery / Mobility', 'Meet Day', 'Pre-Meet', 'Lift Only']);

// A meet, and the day before it, are dates -- they never get moved.
const FIXED_TYPES = new Set(['Meet Day', 'Pre-Meet']);

// Speed work claims the available track days first. If the athlete only has
// two days this week, they should be spent on acceleration and max velocity,
// not on tempo -- so the lower the number, the earlier it picks a day.
const SESSION_PRIORITY = {
  'Acceleration (0-30m)': 1,
  'Max Velocity (flys/build-ups)': 1,
  'Blocks / Starts': 2,
  'Hill Sprints': 2,
  'Race Modeling': 3,
  'Speed Endurance (60-150m)': 4,
  'Special Endurance (150-300m)': 4,
  'Tempo (extensive/aerobic)': 5,
};

// Re-places a week onto the days the athlete can actually train, instead of
// dropping whatever falls on a day they can't. Sessions are placed hardest-
// first so scarce track days go to the highest-value work; each one prefers
// the day it was already on, then the nearest free day it can use. `locked`
// days (already logged, so already done) stay exactly where they are.
// Returns the new plan plus anything that couldn't be fitted at all.
function reschedulePlan(plan, sprintDays, gymDays, locked = new Set()) {
  const sprintFiltered = sprintDays.size > 0;
  const gymFiltered = gymDays.size > 0;
  if (!sprintFiltered && !gymFiltered) return { plan, dropped: [] };

  const canSprint = (d) => !sprintFiltered || sprintDays.has(d);
  const canGym = (d) => !gymFiltered || gymDays.has(d);
  const nearestTo = (from) => (a, b) =>
    Math.abs(DAYS.indexOf(a) - DAYS.indexOf(from)) - Math.abs(DAYS.indexOf(b) - DAYS.indexOf(from));

  const placed = {};
  const dropped = [];
  plan.forEach((e) => {
    if (FIXED_TYPES.has(e.type) || locked.has(e.day)) placed[e.day] = e;
  });

  const sessions = plan
    .filter((e) => !placed[e.day] && !NO_TRACK_NEEDED.has(e.type))
    .sort((a, b) =>
      (SESSION_PRIORITY[a.type] || 9) - (SESSION_PRIORITY[b.type] || 9) ||
      DAYS.indexOf(a.day) - DAYS.indexOf(b.day));

  const homelessLifts = [];
  sessions.forEach((entry) => {
    const target = DAYS.filter((d) => canSprint(d) && !placed[d]).sort(nearestTo(entry.day))[0];
    if (!target) {
      // No track day left for this session -- but its lift doesn't need a
      // track, so it still gets a shot at a gym day below.
      dropped.push({ kind: 'session', label: entry.type });
      if (entry.liftDetails) homelessLifts.push({ from: entry.day, type: entry.type, lift: entry.liftDetails });
      return;
    }
    placed[target] = { ...entry, day: target };
  });

  // Rest / recovery days fill in around the sessions.
  plan
    .filter((e) => !placed[e.day] && NO_TRACK_NEEDED.has(e.type) && !FIXED_TYPES.has(e.type))
    .forEach((entry) => {
      const target = DAYS.filter((d) => !placed[d]).sort(nearestTo(entry.day))[0];
      if (target) placed[target] = { ...entry, day: target };
    });

  // A lift rides with its session when there's gym access that day.
  Object.keys(placed).forEach((day) => {
    const entry = placed[day];
    if (!entry.liftDetails || canGym(day) || locked.has(day)) return;
    placed[day] = { ...entry, liftDetails: null };
    homelessLifts.push({ from: day, type: entry.type, lift: entry.liftDetails });
  });

  // Otherwise it moves to the nearest gym day not already carrying one --
  // landing on a rest day turns that day into a lift-only day rather than
  // reading as a rest day with a workout on it.
  homelessLifts
    .sort((a, b) => (SESSION_PRIORITY[a.type] || 9) - (SESSION_PRIORITY[b.type] || 9))
    .forEach(({ from, type, lift }) => {
      const target = DAYS
        .filter((d) => canGym(d) && !locked.has(d) && !(placed[d] && placed[d].liftDetails))
        .sort(nearestTo(from))[0];
      if (!target) { dropped.push({ kind: 'lift', label: type }); return; }
      const existing = placed[target];
      placed[target] = existing && existing.type !== 'Rest Day'
        ? { ...existing, liftDetails: lift }
        : { day: target, type: 'Lift Only', details: '', liftDetails: lift };
    });

  return {
    plan: DAYS.map((day) => placed[day] || { day, type: 'Rest Day', details: '' }),
    dropped,
  };
}

// Set whenever a plan is placed, so the board can say what didn't fit.
let lastPlanNote = '';

// Counts matter here: the week can carry two tempo sessions, so "Tempo was
// cut" would be misleading when one of them is still on the board.
function describeDropped(dropped) {
  if (!dropped.length) return '';
  const byType = {};
  dropped.filter((d) => d.kind === 'session').forEach((d) => { byType[d.label] = (byType[d.label] || 0) + 1; });
  const parts = Object.entries(byType).map(([label, n]) => `${n} ${label} session${n > 1 ? 's' : ''}`);
  const lifts = dropped.filter((d) => d.kind === 'lift').length;
  if (lifts) parts.push(`${lifts} lift${lifts > 1 ? 's' : ''}`);
  return `Cut to fit your available days: ${parts.join(', ')}.`;
}

let pass=0, fail=0;
const assert=(c,m)=>{ if(c){console.log('PASS: '+m);pass++;} else {console.error('FAIL: '+m);fail++;} };
const S = (...d) => new Set(d);
const show = p => p.map(e => `${e.day.slice(0,3)}=${e.type.replace(/ \(.*/,'')}${e.liftDetails?'+L':''}`).join(' ');

const OFF = [
  { day:'Monday',    type:'Acceleration (0-30m)',         details:'2x(10,20,30)', timed:'Timed', liftDetails:'Power Cleans 3x3-5' },
  { day:'Tuesday',   type:'Tempo (extensive/aerobic)',    details:'8x200',        liftDetails:'Flat Bench 3x8' },
  { day:'Wednesday', type:'Rest Day',                     details:'' },
  { day:'Thursday',  type:'Max Velocity (flys/build-ups)',details:'4x30m fly',    timed:'Timed', liftDetails:'Hang Snatches 3x3-5' },
  { day:'Friday',    type:'Tempo (extensive/aerobic)',    details:'6x200 + mobility', liftDetails:'Incline Bench 3x8' },
  { day:'Saturday',  type:'Rest Day',                     details:'' },
  { day:'Sunday',    type:'Rest Day',                     details:'' },
];

let r = reschedulePlan(OFF, S(), S());
assert(JSON.stringify(r.plan) === JSON.stringify(OFF), 'no availability marked -> plan untouched');

r = reschedulePlan(OFF, S('Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), S('Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'));
let accel = r.plan.find(e=>e.type==='Acceleration (0-30m)');
assert(r.plan.find(e=>e.day==='Monday').type === 'Rest Day', 'Monday (unavailable) becomes a rest day');
assert(accel && accel.day === 'Tuesday', 'acceleration MOVED to nearest available day (Tuesday), got ' + (accel && accel.day));
assert(accel.liftDetails === 'Power Cleans 3x3-5', 'its paired lift moved with it');

r = reschedulePlan(OFF, S('Wednesday','Saturday'), S('Wednesday','Saturday'));
const scheduled = r.plan.filter(e => !['Rest Day','Recovery / Mobility','Lift Only'].includes(e.type)).map(e=>e.type);
assert(scheduled.length === 2, 'only two sessions scheduled when only two track days exist, got ' + scheduled.length);
assert(scheduled.includes('Acceleration (0-30m)') && scheduled.includes('Max Velocity (flys/build-ups)'),
  'the two SPEED sessions win the scarce days: ' + JSON.stringify(scheduled));
assert(r.dropped.filter(d=>d.kind==='session' && d.label==='Tempo (extensive/aerobic)').length === 2, 'both tempo sessions reported dropped');

// Gym only Wednesday: 4 lifts compete for 1 gym day
r = reschedulePlan(OFF, S('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), S('Wednesday'));
const lifted = r.plan.filter(e=>e.liftDetails);
assert(lifted.length === 1 && lifted[0].day === 'Wednesday', 'exactly one lift lands on the only gym day: ' + show(r.plan));
assert(lifted[0].type === 'Lift Only', 'a rest day receiving a lift is relabelled "Lift Only", not "Rest Day": ' + lifted[0].type);
assert(lifted[0].liftDetails === 'Power Cleans 3x3-5', 'the highest-priority session\'s lift is the one that survives');
assert(r.dropped.filter(d=>d.kind==='lift').length === 3, 'the other three lifts reported dropped: ' + JSON.stringify(r.dropped));

// Sprint Mon/Thu, gym Mon/Thu/Sun -- a dropped session's lift still finds a gym day
r = reschedulePlan(OFF, S('Monday','Thursday'), S('Monday','Thursday','Sunday'));
const sun = r.plan.find(e=>e.day==='Sunday');
assert(sun.type === 'Lift Only' && !!sun.liftDetails,
  'a dropped session\'s lift still gets a gym day as Lift Only: ' + show(r.plan));

const MEET = [
  { day:'Monday', type:'Max Velocity (flys/build-ups)', details:'4x30m fly', liftDetails:'Core 2x' },
  { day:'Tuesday', type:'Recovery / Mobility', details:'Rest + light mobility' },
  { day:'Wednesday', type:'Race Modeling', details:'2x150, 1x180', timed:'Timed' },
  { day:'Thursday', type:'Recovery / Mobility', details:'Rest + light mobility' },
  { day:'Friday', type:'Pre-Meet', details:'' },
  { day:'Saturday', type:'Meet Day', details:'' },
  { day:'Sunday', type:'Rest Day', details:'' },
];
r = reschedulePlan(MEET, S('Sunday'), S('Sunday'));
assert(r.plan.find(e=>e.day==='Saturday').type === 'Meet Day', 'Meet Day never moves');
assert(r.plan.find(e=>e.day==='Friday').type === 'Pre-Meet', 'Pre-Meet never moves');

r = reschedulePlan(OFF, S('Wednesday','Thursday','Friday'), S('Wednesday','Thursday','Friday'), new Set(['Monday']));
assert(r.plan.find(e=>e.day==='Monday').type === 'Acceleration (0-30m)', 'an already-logged session is not moved');

const avail = S('Monday','Wednesday','Friday');
const first = reschedulePlan(OFF, avail, avail);
const second = reschedulePlan(first.plan, avail, avail);
assert(JSON.stringify(first.plan) === JSON.stringify(second.plan), 'placement is stable when re-run:\n  1st: ' + show(first.plan) + '\n  2nd: ' + show(second.plan));

let coverageOk = true;
[S(), S('Monday'), S('Tuesday','Friday'), avail].forEach((a) => {
  const days = reschedulePlan(OFF, a, a).plan.map(e=>e.day);
  if (JSON.stringify(days) !== JSON.stringify(DAYS)) coverageOk = false;
});
assert(coverageOk, 'all 7 days present, in order, for every availability combination');

const CLASH = [
  { day:'Monday', type:'Tempo (extensive/aerobic)', details:'8x200' },
  { day:'Tuesday', type:'Acceleration (0-30m)', details:'2x(10,20,30)' },
];
r = reschedulePlan(CLASH, S('Monday'), S());
assert(r.plan.find(e=>e.day==='Monday').type === 'Acceleration (0-30m)', 'speed takes the single day over tempo');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
