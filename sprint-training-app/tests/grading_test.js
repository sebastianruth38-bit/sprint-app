// What the athlete is told when a measure cannot be taken.
//
// Two bugs, both reported off a real clip. An acceleration card came back
// with one score on it and the athlete reasonably read that as the grading
// being broken. It was not: five of the six measures had returned null and
// vanished, four of them because one gate rejected every touchdown in the
// clip, and a row that disappears leaves nothing to tell that story with.
//
// The second was in the summary line of that same card. It read "Strongest:
// drive position. Work on: ankle at touchdown" -- while three lines lower the
// ankle row said it was not measurable. best/worst were picked with
// `b.score < a.score`, and an unscored row carries score null, which coerces
// to 0 and wins every comparison. The one measure that was NOT taken was
// being handed to the athlete as the thing to go and work on.
//
// So: a measure may be withheld, and withheld has to mean unscored and
// explained, never absent. And nothing without a score may be described.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ctx = { console, Math, JSON, Array, Object, Number, Infinity, isFinite };
vm.createContext(ctx);
// Wider than the other suites take: the refusal wording lives past the pose
// loader, and it is half of what this file is about. Everything in between is
// a declaration -- nothing in the range runs until it is called.
const a = src.indexOf('const POSE_LM'), b = src.indexOf('const THUMB_WIDTH');
const names = ['buildLocalAnalysis', 'scoreGroundContact', 'scoreShinAngle',
               'scoreSupportStiffness', 'scoreHipSink', 'scoreKneeFold',
               'notMeasurable', 'touchdownShortfall', 'median', 'footContacts',
               'CONTACT_DEPTH_MIN', 'CONTACT_DEPTH_MAX', 'MIN_CONTACTS',
               'sampleRate', 'refusalReason', 'describeCapture', 'MEASURABLE_FPS_MIN'];
vm.runInContext(
  src.slice(a, b).replace(/^function renderAnalysis[\s\S]*?^\}/m, '') + '\n' +
  names.map((n) => `globalThis.${n}=${n};`).join('\n'), ctx);

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

// ---------- a running clip, built to order ----------
// Landmarks rather than angles, so the scorers do the same arithmetic they do
// on a real clip. `depth` is how far the ankle sits below the hip in leg
// lengths, which is the quantity the touchdown gate is written against.
function stride(depth, frames = 24) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    // Two feet half a cycle apart, each planting once per cycle.
    const phase = (i / 6) * Math.PI;
    const leg = (p) => {
      const down = (Math.cos(p) + 1) / 2;          // 1 planted, 0 at peak lift
      const drop = 100 * (0.45 + 0.55 * down * (depth / 0.9));
      return {
        hip: [200, 100], knee: [200, 100 + drop * 0.5], ank: [200, 100 + drop],
        legLen: 100, facing: 1, shinFromVertical: 12, footVsShin: 95,
        kneeAngle: 40 + 120 * down, thighSwing: 40 * Math.cos(p), hipAngle: 110,
      };
    };
    out.push({
      midHip: [200, 100], torsoFromVertical: 8, scissor: 100,
      thighRise: 0.4 + 0.2 * Math.cos(phase), leadKnee: 90,
      kneeFold: 40 + 60 * Math.abs(Math.sin(phase)),
      legs: [leg(phase), leg(phase + Math.PI)],
    });
  }
  return out;
}

// ---------- the gate that emptied the card ----------
// Measured across nine recorded clips (seven distinct), real touchdowns land
// at 0.75-1.03 of a leg length below the hip. The gate stood at 0.8, so one
// whole clip -- four genuine contacts at 0.75-0.79 -- lost every measure read
// at touchdown. The file's own note beside CONTACT_DEPTH_MAX recorded that
// range the whole time.
check('the touchdown floor sits below every contact actually measured',
  ctx.CONTACT_DEPTH_MIN <= 0.747,
  `floor ${ctx.CONTACT_DEPTH_MIN}, shallowest real contact 0.747 (wide grass, CALIBRATION.md)`);
check('and still below the depth a planted leg cannot exceed',
  ctx.CONTACT_DEPTH_MIN < ctx.CONTACT_DEPTH_MAX,
  `${ctx.CONTACT_DEPTH_MIN} vs ${ctx.CONTACT_DEPTH_MAX}`);

// The clip that lost three measures. Each depth here was measured off a real
// touchdown, so anything that rejects them is rejecting running.
[0.75, 0.78, 0.79, 0.83, 0.89, 1.00].forEach((d) => {
  check(`a touchdown at ${d} of a leg length is treated as a touchdown`,
    d >= ctx.CONTACT_DEPTH_MIN, `floor is ${ctx.CONTACT_DEPTH_MIN}`);
});

// ---------- no measure may leave silently ----------
// The whole complaint in one assertion: whatever the clip, the card shows
// every measure the clip type promises.
const ACCELERATION_SET = ['Shin Angle at Touchdown', 'Support Stiffness',
                          'Foot Strike vs COM', 'Ankle at Touchdown', 'Hip Height'];
const MAXV_SET = ['Support Stiffness', 'Foot Strike vs COM', 'Hip Height'];

[['Acceleration', ACCELERATION_SET], ['Max Velocity', MAXV_SET]].forEach(([type, expected]) => {
  // A clip good enough to read, and one whose touchdowns are too shallow to
  // gate through. Neither may drop a row.
  [['a readable clip', stride(0.9)], ['a barely-readable clip', stride(0.3)]].forEach(([what, frames]) => {
    const out = ctx.buildLocalAnalysis(frames, type, 'Track');
    const names = (out.pinpoints || []).map((p) => p.name);
    const missing = expected.filter((n) => !names.some((m) => m.startsWith(n)));
    check(`${type}: ${what} reports every measure it promises`,
      missing.length === 0, `missing ${missing.join(', ') || 'none'} — got ${names.join(', ')}`);
    // Withheld means explained. A row with no score and no reason is the
    // same blank the athlete complained about, wearing a name.
    (out.pinpoints || []).filter((p) => typeof p.score !== 'number').forEach((p) => {
      check(`${type}: ${what} explains the unscored "${p.name}"`,
        /not (measurable|graded)/i.test(p.note || ''), (p.note || '').slice(0, 60) || '(no note)');
    });
  });
});

// ---------- the summary may only describe what was scored ----------
// The exact card the athlete saw: one real score, one unscored row. Before
// this, "Work on:" named the unscored one.
const oneScore = ctx.buildLocalAnalysis(stride(0.3), 'Acceleration', 'Track');
const unscored = (oneScore.pinpoints || []).filter((p) => typeof p.score !== 'number');
check('the test clip really does produce unscored rows, or it proves nothing',
  unscored.length > 0, `${unscored.length} unscored of ${(oneScore.pinpoints || []).length}`);
unscored.forEach((p) => {
  check(`the summary never calls the unmeasured "${p.name}" the weakest`,
    !(oneScore.summary || '').toLowerCase().includes(`work on: ${p.name.toLowerCase()}`),
    oneScore.summary);
});
// And the positive half: when something WAS scored, the summary talks about it.
const scored = (oneScore.pinpoints || []).filter((p) => typeof p.score === 'number');
if (scored.length) {
  const named = scored.some((p) => (oneScore.summary || '').toLowerCase().includes(p.name.toLowerCase()));
  check('the summary describes a measure that was actually scored', named, oneScore.summary);
}
// A clip where nothing scored must say so, not name a row at random.
const nothing = ctx.buildLocalAnalysis(
  Array.from({ length: 12 }, () => ({ midHip: [200, 100], torsoFromVertical: 8, scissor: 100, legs: [] })),
  'Acceleration', 'Track');
check('a clip with nothing scoreable says exactly that',
  !/work on/i.test(nothing.summary || ''), nothing.summary);

// ---------- the hero average and the warm-up must skip unscored rows ----------
// Both filter on the score being a number. If an unscored row ever carried a
// numeric score, a measure nobody took would drag the athlete's average down
// and the warm-up would start drilling it.
const everyRow = [...(oneScore.pinpoints || [])];
check('an unscored row carries null, never 0',
  everyRow.every((p) => typeof p.score === 'number' || p.score === null),
  JSON.stringify(everyRow.map((p) => `${p.name}:${p.score}`)));

// ---------- sampling rate is measured over what was sampled ----------
// The seek fallback takes its samples from a deliberately narrow window: 32
// of them across about a second. Divided by a 7.5s clip that is 4/s, and the
// athlete was told his phone managed 4 frames a second on a clip he filmed at
// 30 and watched back himself.
check('a dense pass over one second reads at its real rate',
  Math.round(ctx.sampleRate({ frames: 32, duration: 7.5, span: 1.07 })) === 30,
  `${ctx.sampleRate({ frames: 32, duration: 7.5, span: 1.07 })}`);
check('and that is above the floor, so it is not called unmeasurable',
  ctx.sampleRate({ frames: 32, duration: 7.5, span: 1.07 }) >= ctx.MEASURABLE_FPS_MIN);
check('a pass that really did cover the whole clip is unchanged',
  Math.round(ctx.sampleRate({ frames: 75, duration: 2.5, span: 2.5 })) === 30);
check('a missing span falls back to the clip duration rather than dividing by zero',
  ctx.sampleRate({ frames: 30, duration: 3 }) === 10);

// Only playback measures the device. A seek pass samples where it is told to.
const scanReason = ctx.refusalReason('Nobody in this clip is moving like a sprinter.',
  { frames: 30, withPose: 12, duration: 7.5, span: 7.5, played: false, mode: 'scan' });
const playReason = ctx.refusalReason('Nobody in this clip is moving like a sprinter.',
  { frames: 30, withPose: 12, duration: 7.5, span: 7.5, played: true, mode: 'playback' });
check('a slow playback pass is allowed to blame the device',
  /this phone/i.test(playReason), playReason.slice(0, 70));
check('a slow seek pass is not', !/this phone|this device/i.test(scanReason),
  scanReason.slice(0, 90));
check('and tells the athlete his filming was not the problem',
  /nothing is wrong with how you filmed it/i.test(scanReason), scanReason.slice(0, 110));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
