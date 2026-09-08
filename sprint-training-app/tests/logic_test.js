// ---------- Training phase (calendar-driven) ----------
// Deload = every 3rd ISO week of the year. Taper = meet is 7-13 days out.
// Competition week = meet falls in the next 0-6 days. Otherwise off/pre/in
// season based on the competition_seasons date ranges.
// Returns both the underlying seasonPhase ('off'|'pre'|'in') -- which
// decides the weekly workout pattern -- and a modifier ('deload'|'taper'|
// 'competition'|null) that layers on top of whatever pattern applies.
// label/className are for the badge and stay as before.
function computeTrainingPhase(season, nextMeetDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toDate = (s) => (s ? new Date(s + 'T00:00:00') : null);

  const ranges = [
    [toDate(season && season.indoor_start), toDate(season && season.indoor_end)],
    [toDate(season && season.outdoor_start), toDate(season && season.outdoor_end)],
  ].filter(([s, e]) => s && e);

  const inSeason = ranges.some(([s, e]) => today >= s && today <= e);

  let seasonPhase = 'off';
  if (inSeason) {
    seasonPhase = 'in';
  } else {
    const upcomingStarts = ranges.map(([s]) => s).filter((s) => s > today);
    if (upcomingStarts.length) {
      const nearest = upcomingStarts.reduce((a, b) => (a < b ? a : b));
      const daysToStart = Math.round((nearest - today) / 86400000);
      seasonPhase = daysToStart <= 60 ? 'pre' : 'off';
    }
  }

  let modifier = null;
  if (nextMeetDate) {
    const daysToMeet = Math.round((toDate(nextMeetDate) - today) / 86400000);
    if (daysToMeet >= 0 && daysToMeet <= 6) modifier = 'competition';
    else if (daysToMeet >= 7 && daysToMeet <= 13) modifier = 'taper';
  }
  if (!modifier) {
    const weekNum = parseInt(getWeekKey().split('W')[1], 10);
    if (weekNum % 3 === 0) modifier = 'deload';
  }

  const seasonLabels = { off: 'Off-Season', pre: 'Pre-Season', in: 'In Season' };
  const modLabels = { competition: 'Competition Week', taper: 'Taper Week', deload: 'Deload Week' };
  return {
    seasonPhase,
    modifier,
    label: modifier ? modLabels[modifier] : seasonLabels[seasonPhase],
    className: modifier || '',
  };
}

async function getSeasonAndMeet() {
  if (!currentUser) return { season: null, nextMeetDate: null };
  const [{ data: season }, { data: settings }] = await Promise.all([
    supabaseClient.from('competition_seasons').select('*').eq('user_id', currentUser.id).maybeSingle(),
    supabaseClient.from('athlete_settings').select('next_meet_date').eq('user_id', currentUser.id).maybeSingle(),
  ]);
  return { season, nextMeetDate: settings && settings.next_meet_date };
}

// ---------- Workout templates + equipment substitution ----------
const WORKOUT_TEMPLATES = {
  'Acceleration (0-30m)': [
    { text: '2x(10,20,30)' },
    { text: '2x20-30m hill sprints', requires: 'Hills' },
    { text: '(2x20,2x25,2x30,1x40)' },
    { text: 'Sleds (2x10,20,30)', requires: 'Sleds', fallback: '2x30' },
  ],
  'Max Velocity (flys/build-ups)': [
    { text: '4x30m fly' },
    { text: '4x float sprint (40-60-90)' },
    { text: '2x40m fly, 2x30m fly' },
  ],
  'Tempo (extensive/aerobic)': [
    '8x200', '8x150', '3x3x100', '5x300', '3x500', '4x350', '6x250',
    '150,200,250,300,250,200,150', '200,300,200,300,200',
  ].map((text) => ({ text })),
  'Speed Endurance (60-150m)': [
    '5x150', '3x250', '3x300', '200,300,200', '5x120', '4x250',
  ].map((text) => ({ text })),
};

// Race modeling depends on the athlete's normal events (Training Setup),
// not equipment -- handled separately from pickTemplateText.
function pickRaceModelingText(primaryEvents) {
  const events = (primaryEvents || []).map((e) => e.toLowerCase());
  const has100 = events.some((e) => e.includes('100'));
  const has200 = events.some((e) => e.includes('200'));
  const has400 = events.some((e) => e.includes('400'));

  let pool;
  if (has400) {
    pool = ['3x200', '300,200,300', '2x350', 'Broken 450s (150,150,150)'];
  } else {
    pool = ['1x110, 1x120, 1x150, 1x180, 1x220', '2x150, 1x180'];
    if (has100 && !has200) pool.push('5x80'); // 100-only runners, not 200 runners
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Mobility/Tempo day: same tempo circuit but a few reps lighter, so it
// doesn't compete with the two hard speed days.
function shortenTempo(text) {
  let m = text.match(/^(\d+)x(\d+)x(\d+)$/); // e.g. 3x3x100
  if (m) return `${Math.max(2, parseInt(m[1], 10) - 1)}x${m[2]}x${m[3]}`;
  m = text.match(/^(\d+)x(.+)$/); // e.g. 8x200
  if (m) return `${Math.max(2, parseInt(m[1], 10) - 2)}x${m[2]}`;
  if (text.includes(',')) { // ladder, e.g. 150,200,250,300,250,200,150
    const parts = text.split(',').map((s) => s.trim());
    if (parts.length > 2) return parts.slice(1, -1).join(', ');
  }
  return `${text} (shortened)`;
}

// Picks a template for a workout type, substitutes for missing equipment,
// and appends a volume/intensity note for deload/taper/competition weeks.
// Returns null if there are no templates for this type yet.
function pickTemplateText(type, equipment, phase) {
  const options = WORKOUT_TEMPLATES[type];
  if (!options) return null;

  // A template with a fallback stays eligible even without the equipment
  // (it just swaps to the fallback text below) -- only equipment-locked
  // templates with no fallback get excluded outright.
  const usable = options.filter((o) => !o.requires || equipment.has(o.requires) || o.fallback);
  const pick = usable.length ? usable[Math.floor(Math.random() * usable.length)] : options[0];
  let text = pick.text;
  if (pick.requires && !equipment.has(pick.requires) && pick.fallback) {
    text = `${pick.fallback} (no ${pick.requires.toLowerCase()})`;
  }

  if (phase.modifier === 'deload' || phase.modifier === 'taper') {
    text += ` -- ${phase.label.toLowerCase()}, cut volume ~30%`;
  } else if (phase.modifier === 'competition') {
    text += ' -- competition week, keep it light';
  }
  return text;
}

async function getEquipment() {
  if (!currentUser) return new Set();
  const { data } = await supabaseClient.from('athlete_settings').select('equipment').eq('user_id', currentUser.id).maybeSingle();
  return new Set((data && data.equipment) || []);
}

async function getPrimaryEvents() {
  if (!currentUser) return [];
  const { data } = await supabaseClient.from('athlete_settings').select('primary_events').eq('user_id', currentUser.id).maybeSingle();
  return (data && data.primary_events) || [];
}

// ---------- Full week plan: fixed weekday mapping per phase ----------
// Off-season and pre-season are identical. Competition week assumes the
// meet falls on Saturday. "lift"/"noLift" drive gym pairing below.
// ---------- Lift pairing ----------
// Off/pre-season: 3x per exercise. In-season: 2-3x, lower-fatigue variants
// (quarter squats instead of full squats, hang power clean instead of hang
// snatch), plus med ball throws added on the two high-CNS speed days.
function buildLiftDetails(role, phase) {
  const inSeason = phase.seasonPhase === 'in';

  if (role === 'accel') {
    return inSeason
      ? 'Power Cleans 3x3-5, Broad Jumps 3x3, Bulgarian Split Squats 2-3x6, Med Ball Throws 2x5, Core 2x'
      : 'Power Cleans 3x3-5, Broad Jumps 3x3, Bulgarian Split Squats 3x6-8, Core 3x';
  }
  if (role === 'maxv') {
    const oly = inSeason ? 'Hang Power Cleans' : 'Hang Snatches';
    const legs = inSeason ? 'Quarter Squats 2-3x6' : 'Step Ups & Squats 3x6-8';
    return inSeason
      ? `${oly} 3x3-5, Hurdle Hops 2-3x5, ${legs}, Med Ball Throws 2x5, Core 2x`
      : `${oly} 3x3-5, Hurdle Hops 3x5, ${legs}, Core 3x`;
  }
  if (role === 'tempo1') {
    return 'Flat Bench 3x8, Back Row 3x8, Pull-Ups 3x, Tricep Pushdowns 3x12, Lateral Raises 3x12';
  }
  if (role === 'tempo2') {
    return 'Incline Bench 3x8, Barbell Back Row 3x8, Shoulder Press 3x8, Tricep Overhead Extensions 3x12';
  }
  if (role === 'competitionLight') {
    return 'Core 2x, Med Ball Throws 2x5, Hang Cleans 2x3 @ ~half normal load, Quarter Squats 2x5 @ ~half normal load';
  }
  return null;
}

function buildWeekPlan(phase, equipment, primaryEvents) {
  const accel = () => pickTemplateText('Acceleration (0-30m)', equipment, phase) || '';
  const maxV = () => pickTemplateText('Max Velocity (flys/build-ups)', equipment, phase) || '';
  const tempo = () => pickTemplateText('Tempo (extensive/aerobic)', equipment, phase) || '';
  const speedEnd = () => pickTemplateText('Speed Endurance (60-150m)', equipment, phase) || '';
  const tempoPlusMobility = () => `${shortenTempo(tempo())} + mobility`;

  if (phase.modifier === 'competition') {
    // Meet assumed Saturday (end of week) -- competition is "towards the
    // end of the week", so Monday gets one light lift; every other day
    // stays lift-free.
    return [
      { day: 'Monday', type: 'Max Velocity (flys/build-ups)', details: maxV(), liftDetails: buildLiftDetails('competitionLight', phase) },
      { day: 'Tuesday', type: 'Recovery / Mobility', details: 'Rest + light mobility' },
      { day: 'Wednesday', type: 'Race Modeling', details: pickRaceModelingText(primaryEvents), timed: 'Timed' },
      { day: 'Thursday', type: 'Recovery / Mobility', details: 'Rest + light mobility' },
      { day: 'Friday', type: 'Pre-Meet', details: '' },
      { day: 'Saturday', type: 'Meet Day', details: '' },
      { day: 'Sunday', type: 'Rest Day', details: '' },
    ];
  }

  if (phase.seasonPhase === 'in') {
    return [
      { day: 'Monday', type: 'Acceleration (0-30m)', details: accel(), timed: 'Timed', liftDetails: buildLiftDetails('accel', phase) },
      { day: 'Tuesday', type: 'Speed Endurance (60-150m)', details: speedEnd(), timed: 'Timed' },
      { day: 'Wednesday', type: 'Recovery / Mobility', details: 'Mobility + foam roll' },
      { day: 'Thursday', type: 'Max Velocity (flys/build-ups)', details: maxV(), timed: 'Timed', liftDetails: buildLiftDetails('maxv', phase) },
      { day: 'Friday', type: 'Tempo (extensive/aerobic)', details: tempoPlusMobility(), liftDetails: buildLiftDetails('tempo2', phase) },
      { day: 'Saturday', type: 'Rest Day', details: '' },
      { day: 'Sunday', type: 'Rest Day', details: '' },
    ];
  }

  // Off-season and pre-season share the same sprint/rest layout, but
  // pre-season (within ~2 months of competition) drops the Friday lift
  // so the athlete isn't loading heavy this close to the season starting.
  return [
    { day: 'Monday', type: 'Acceleration (0-30m)', details: accel(), timed: 'Timed', liftDetails: buildLiftDetails('accel', phase) },
    { day: 'Tuesday', type: 'Tempo (extensive/aerobic)', details: tempo(), liftDetails: buildLiftDetails('tempo1', phase) },
    { day: 'Wednesday', type: 'Rest Day', details: '' },
    { day: 'Thursday', type: 'Max Velocity (flys/build-ups)', details: maxV(), timed: 'Timed', liftDetails: buildLiftDetails('maxv', phase) },
    { day: 'Friday', type: 'Tempo (extensive/aerobic)', details: tempoPlusMobility(), liftDetails: phase.seasonPhase === 'pre' ? null : buildLiftDetails('tempo2', phase) },
    { day: 'Saturday', type: 'Rest Day', details: '' },
    { day: 'Sunday', type: 'Rest Day', details: '' },
  ];
}

function getWeekKey() {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

// --- Tests ---
function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { console.log('PASS: ' + msg); } }

const testEquipment = new Set();
const testEvents = ["100m"];

const offSeason = { outdoor_start: new Date(Date.now() + 200*86400000).toISOString().slice(0,10), outdoor_end: new Date(Date.now() + 260*86400000).toISOString().slice(0,10) };
const offPhase = computeTrainingPhase(offSeason, null);
assert(offPhase.seasonPhase === 'off', 'off-season phase computed correctly, got ' + offPhase.seasonPhase);
const offPlan = buildWeekPlan(offPhase, testEquipment, testEvents);
const offFriday = offPlan.find(d => d.day === 'Friday');
assert(!!offFriday.liftDetails, 'off-season Friday HAS a lift: ' + offFriday.liftDetails);

const preSeason = { outdoor_start: new Date(Date.now() + 40*86400000).toISOString().slice(0,10), outdoor_end: new Date(Date.now() + 100*86400000).toISOString().slice(0,10) };
const prePhase = computeTrainingPhase(preSeason, null);
assert(prePhase.seasonPhase === 'pre', 'pre-season phase computed correctly, got ' + prePhase.seasonPhase);
const prePlan = buildWeekPlan(prePhase, testEquipment, testEvents);
const preFriday = prePlan.find(d => d.day === 'Friday');
assert(!preFriday.liftDetails, 'pre-season Friday has NO lift, got: ' + preFriday.liftDetails);
assert(!!preFriday.details && preFriday.type === 'Tempo (extensive/aerobic)', 'pre-season Friday still has a sprint session: ' + preFriday.type);

const inSeasonObj = { outdoor_start: new Date(Date.now() - 10*86400000).toISOString().slice(0,10), outdoor_end: new Date(Date.now() + 30*86400000).toISOString().slice(0,10) };
const inPhase = computeTrainingPhase(inSeasonObj, null);
assert(inPhase.seasonPhase === 'in', 'in-season phase computed correctly, got ' + inPhase.seasonPhase);
const inPlan = buildWeekPlan(inPhase, testEquipment, testEvents);
const inFriday = inPlan.find(d => d.day === 'Friday');
assert(!!inFriday.liftDetails, 'in-season Friday still has a lift (unaffected by change): ' + inFriday.liftDetails);
