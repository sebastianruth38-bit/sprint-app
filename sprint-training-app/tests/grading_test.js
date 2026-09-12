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
               'sampleRate', 'refusalReason', 'describeCapture', 'MEASURABLE_FPS_MIN',
               'ACCEL_STRIKE_BANDS', 'ACCEL_STRIKE_MIN_CONTACTS', 'STRIKE_BANDS',
               'ACCEL_STRIKE_PLAUSIBLE_MIN', 'STRIKE_PLAUSIBLE_MIN', 'bandFor',
               'bestWindow', 'gradeWindowFrames', 'sizeOfMetric', 'GRADE_WINDOW_S',
               'DENSE_MAX_SAMPLES', 'framingCheck', 'SUBJECT_PX_MIN', 'buildTracks',
               'signatureDistance', 'toPoints',
               'passDensity', 'measurablePass', 'posedCount', 'PLAYBACK_GOOD_ENOUGH'];
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

// ---------- where the foot lands during acceleration ----------
// The athlete's scale, in his words: 5 is the foot landing right under you
// (some athletes even step back under themselves, rare but not a fault), 3 is
// in front, 1 is way in front. And: a first step lands in front as a matter
// of course, that is how a start works rather than bad mechanics, so it takes
// more than one stride to grade honestly.
//
// Worth stating plainly, because the scores this produces look flattering:
// every clip recorded so far lands under or behind the hips and scores 5,
// which is correct by the rule above but means REAL footage has never
// exercised the 3 or the 1. These build the readings synthetically so the
// whole scale is checked rather than the one end that happens to exist.
function contactsAt(offsets, depth = 0.9, startFoot = 0) {
  // One touchdown per entry, alternating feet, each with the ankle `offset`
  // leg lengths ahead of the hip. Frames between them keep footContacts from
  // merging the lot into one contact.
  const out = [];
  offsets.forEach((offset, k) => {
    for (let f = 0; f < 3; f++) {
      const planted = f === 1;
      const mk = (on) => ({
        hip: [200, 100], knee: [200, 150], legLen: 100, facing: 1,
        ank: [200 + (on ? offset * 100 : 0), 100 + (on ? depth * 100 : 40)],
        shinFromVertical: 12, footVsShin: 95, kneeAngle: on ? 165 : 60, thighSwing: 20, hipAngle: 110,
      });
      out.push({
        midHip: [200, 100], torsoFromVertical: 40, scissor: 100, kneeFold: 70,
        thighRise: 0.4, leadKnee: 90,
        legs: (k + startFoot) % 2 ? [mk(false), mk(planted)] : [mk(planted), mk(false)],
      });
    }
  });
  return out;
}
const strikeOf = (offsets) => {
  const rows = ctx.scoreGroundContact(contactsAt(offsets), 'Acceleration');
  return rows.find((p) => p.name === 'Foot Strike vs COM');
};

// The scale end to end. The first entry of each list is the dropped first
// step, so it is deliberately not the value being graded.
[[[0.0, -0.05, 0.0, -0.02], 5, 'under you'],
 [[0.0, 0.16, 0.15, 0.17], 4, 'slightly ahead'],
 [[0.0, 0.28, 0.27, 0.30], 3, 'in front'],
 [[0.0, 0.60, 0.62, 0.58], 1, 'way in front']].forEach(([offsets, want, what]) => {
  const row = strikeOf(offsets);
  check(`a foot landing ${what} scores ${want}`,
    row && row.score === want, row ? `${row.score}/5 ${row.note}` : '(no row)');
});

// Landing behind is not a fault during acceleration -- it is the drive phase,
// and the old top-speed bands threw it away as implausible.
const behind = strikeOf([0.0, -0.45, -0.50, -0.47]);
check('landing well behind the hips out of a start still scores 5',
  behind && behind.score === 5, behind ? `${behind.score}/5 ${behind.note}` : '(no row)');
check('and reads as behind rather than as a negative amount ahead',
  behind && /behind the hips/.test(behind.note) && !/-\d/.test(behind.note),
  behind && behind.note);

// The first step is dropped.
//
// These values are picked so that counting the first step gives a DIFFERENT
// score, which is harder than it sounds: a median already absorbs one outlier
// among four, so the obvious test (first step way out in front, rest under)
// passes whether the step is dropped or not and proves nothing. It has to be
// a case where the first step drags the median across a band edge.
//
//   [0.60, 0.30, 0.10] -> counting it, the median is 0.30, which is a 3.
//                         dropping it, the median of 0.30 and 0.10 is 0.20,
//                         which is a 4.
const forgiven = strikeOf([0.60, 0.30, 0.10]);
check('a first step landing in front is not counted against the athlete',
  forgiven && forgiven.score === 4,
  forgiven ? `${forgiven.score}/5 (3 would mean it was counted) ${forgiven.note}` : '(no row)');

// And the reverse, so the rule cannot hide a real fault: a tidy first step
// followed by two reaching strides must be judged on the reaching.
//
//   [0.0, 0.30, 0.40] -> counting it, the median is 0.30, a 3.
//                        dropping it, the median of 0.30 and 0.40 is 0.35, a 2.
const caught = strikeOf([0.0, 0.30, 0.40]);
check('but strides after the first are still judged',
  caught && caught.score === 2,
  caught ? `${caught.score}/5 (3 would mean the good first step masked them) ${caught.note}` : '(no row)');
check('and the note says what it was judged on',
  caught && /after the first step/.test(caught.note), caught && caught.note);
check('and counts the strides it actually used, not the ones it read',
  caught && /over 2 strides/.test(caught.note), caught && caught.note);

// Which foot the athlete starts on must not change the answer. Touchdowns are
// gathered one foot at a time, so before they were sorted into time order
// "the first step" was whichever contact the LEFT foot happened to make
// first. On a start off the left foot that is the right answer by accident,
// which is why the unsorted version passed everything above.
const otherFoot = ctx.scoreGroundContact(contactsAt([0.60, 0.30, 0.10], 0.9, 1), 'Acceleration')
  .find((p) => p.name === 'Foot Strike vs COM');
check('a start off the other foot drops the same first step',
  otherFoot && otherFoot.score === 4,
  otherFoot ? `${otherFoot.score}/5 ${otherFoot.note}` : '(no row)');

// Too few strides to spare one is not a grade.
const oneStride = strikeOf([0.4, 0.0]);
check('two touchdowns are not enough to grade a start on',
  oneStride && oneStride.score == null, oneStride && `${oneStride.score}/5`);
check('and the reason given is the first step, not the filming',
  oneStride && /first step of a start/.test(oneStride.note || ''),
  oneStride && (oneStride.note || '').slice(0, 80));
check('three touchdowns are enough', ctx.ACCEL_STRIKE_MIN_CONTACTS === 3,
  `${ctx.ACCEL_STRIKE_MIN_CONTACTS}`);

// Top speed keeps its own bands: there is no first step to allow for, and a
// foot landing behind the hip there is a mistrack rather than a drive step.
const atSpeed = ctx.scoreGroundContact(contactsAt([0.0, -0.45, -0.50, -0.47]), 'Max Velocity')
  .find((p) => p.name === 'Foot Strike vs COM');
check('the same reading at top speed is not scored well',
  atSpeed && atSpeed.score == null, atSpeed && `${atSpeed.score}/5 ${atSpeed.note}`);
check('acceleration tolerates a deeper strike than top speed does',
  ctx.ACCEL_STRIKE_PLAUSIBLE_MIN < ctx.STRIKE_PLAUSIBLE_MIN,
  `${ctx.ACCEL_STRIKE_PLAUSIBLE_MIN} vs ${ctx.STRIKE_PLAUSIBLE_MIN}`);

// The flag and the score must not contradict each other. Flagging an athlete
// for overstriding while scoring him 3/5 for not overstriding is the kind of
// thing that makes the whole card look unreliable.
const accelBand2 = ctx.ACCEL_STRIKE_BANDS.find((b) => b.score === 2);
check('the acceleration overstride flag fires where its bands say it should',
  accelBand2 && accelBand2.min === 0.35, accelBand2 && `band 2 starts at ${accelBand2.min}`);

// ---------- which stretch of the clip gets graded, and how much of it ----
// Two complaints off one clip: "why does it say the athlete is too far away"
// on a clip where he is plainly visible, and "it only measures a stride when
// I'm in the clip for 5 seconds". Both came back to the same window.

// How wide the window is.
//
// It used to be DENSE_MAX_SAMPLES = 32 frames, which is a budget for how many
// expensive SEEKS the fallback may spend, not a statement about how much
// running is worth grading. Measured on the recorded clips: a 7.1s clip with
// the athlete detected in 202 frames graded 32 of them, and two clips came
// out at 0.47s and 0.40s of measured running, because 32 frames is less time
// the faster the capture.
[[1 / 30, 54], [1 / 60, 108], [1 / 15, 27]].forEach(([spf, want]) => {
  check(`a window is ${ctx.GRADE_WINDOW_S}s of running at ${Math.round(1 / spf)} frames a second`,
    ctx.gradeWindowFrames(spf, 10000) === want,
    `${ctx.gradeWindowFrames(spf, 10000)} frames, wanted ${want}`);
});
// The point of expressing it in seconds: the capture rate must not move it.
const secondsAt = (spf) => ctx.gradeWindowFrames(spf, 10000) * spf;
check('so the measured stretch is the same length whatever the capture rate',
  Math.abs(secondsAt(1 / 30) - secondsAt(1 / 60)) < 0.05
  && Math.abs(secondsAt(1 / 30) - secondsAt(1 / 15)) < 0.05,
  [1 / 30, 1 / 60, 1 / 15].map((s) => secondsAt(s).toFixed(2) + 's').join(', '));
// Wide enough to hold the three strides limitToStrides asks for. A stride is
// both feet down, ~0.45s at sprint turnover.
check('and wide enough to contain the three strides that get graded',
  ctx.GRADE_WINDOW_S >= 3 * 0.45, `${ctx.GRADE_WINDOW_S}s vs 1.35s of stride`);
check('never wider than the athlete was actually seen for',
  ctx.gradeWindowFrames(1 / 30, 20) === 20, `${ctx.gradeWindowFrames(1 / 30, 20)}`);
check('and never too short for the tracker to follow him',
  ctx.gradeWindowFrames(1 / 30, 3) >= 3, `${ctx.gradeWindowFrames(1 / 30, 3)}`);

// Which stretch it lands on.
//
// bestWindow ranks by how visible the athlete is. It used to read bodyFrac --
// his share of the picture pose was handed. When he is far away that picture
// is a CROP, and the crop padding pins him at roughly 1/2.2 of it however
// distant he is, so bodyFrac rises exactly where he gets smaller. framingCheck
// then refuses on bodyPx, which cropping cannot change. Measured across the
// recorded clips, cropped frames read 0.45 frac / 183 px against 0.25 frac /
// 274 px uncropped on the same clip, on five of seven -- so the ranking was
// steering toward the stretch the refusal would reject.
function runningClip(halves) {
  // One athlete, running throughout, whose apparent size changes halfway.
  //
  // The shape rotates at a CONSTANT rate, which matters: the first version
  // swung sinusoidally, so the motion rate dipped below the sprinter band at
  // the turning points, only 69% of frames read as running against the 70%
  // a window needs, and which window won was decided by which ones happened
  // to pass rather than by size. The test passed and proved nothing. A
  // constant rate puts every frame in the band, so the size preference is
  // the only thing left to decide.
  const W = 0.0668;  // ~2.0 units/s of shape change: mid-band for a sprinter
  const frames = [];
  halves.forEach(({ frac, px, n }) => {
    for (let i = 0; i < n; i++) {
      const th = frames.length * W;
      const at = (base) => [
        Math.cos(base + th), Math.sin(base + th),
      ];
      frames.push([{
        sig: {
          hip: [200, 300], size: 50,
          norm: [at(0), at(1), at(2), at(3), at(4), at(5)],
        },
        metrics: { bodyFrac: frac, bodyPx: px, bodyAtEdge: false, midHip: [200, 300], legs: [] },
      }]);
    }
  });
  return frames;
}
// Second half looks bigger and is further away -- the exact shape of the bug.
const mixed = runningClip([{ frac: 0.25, px: 300, n: 70 }, { frac: 0.45, px: 150, n: 70 }]);
const picked = ctx.bestWindow(mixed, 1 / 30, ctx.gradeWindowFrames(1 / 30, 140));
check('a window is found at all on a clip that is running throughout',
  !!picked, JSON.stringify(picked));
if (picked) {
  const midpoint = (picked.from + picked.to) / 2;
  check('the graded window lands where the athlete is biggest in real pixels',
    midpoint < 70, `window ${picked.from}-${picked.to}, the distant half starts at 70`);
  check('and not where he merely fills more of a crop',
    picked.to < 105, `window ends at ${picked.to}`);
}
// The ranking key itself, directly.
check('visibility is read in pixels when the capture recorded them',
  ctx.sizeOfMetric({ bodyFrac: 0.45, bodyPx: 150 }, true) === 150);
check('and falls back to share of the frame when it did not',
  ctx.sizeOfMetric({ bodyFrac: 0.45, bodyPx: null }, false) === 0.45);
check('a missing frame counts as nothing rather than throwing',
  ctx.sizeOfMetric(null, true) === 0 && ctx.sizeOfMetric(undefined, false) === 0);

// ---------- a pass has to be measurable, not merely lucky ----------
// The athlete's refused clip, by its own numbers: 1080x1920 H.264, 210 frames
// at 29.9fps, 7.0s, nothing unusual about it. The app reported "30 frames, 17
// with pose, 4 usable frames a second, could not play the clip through".
//
// 30 is exactly SCOUT_MAX_SAMPLES for a 7s clip, so the scout sweep is what
// won -- and 17 detections cleared PLAYBACK_GOOD_ENOUGH (16), so the dense
// pass, the only one that samples at DENSE_RATE and the only thing that could
// have rescued the clip, never ran. The app settled for a sampling rate it
// had chosen itself and then refused the clip for it.
//
// Both decisions compared counts. Neither asked how far apart the frames were.
const pass_ = (n, from, to) => {
  // n detections spread evenly between two timestamps, in the shape the
  // capture hands over: one array per frame, each holding its poses.
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? from : from + (to - from) * (i / (n - 1));
    rows.push([{ metrics: { t } }]);
  }
  return rows;
};
const sweep = pass_(17, 0.2, 4.1);     // the real one: 17 over 3.9s = 4.3/s
const playback = pass_(16, 1.0, 1.5);  // fewer detections, 30 a second

check('the sweep that won really is the sparse one',
  Math.round(ctx.passDensity(sweep)) === 4, `${ctx.passDensity(sweep).toFixed(1)}/s`);
check('and the playback pass really is the dense one',
  Math.round(ctx.passDensity(playback)) === 30, `${ctx.passDensity(playback).toFixed(1)}/s`);
check('17 detections at 4 a second cannot measure a stride',
  !ctx.measurablePass(sweep), `${ctx.posedCount(sweep)} detections`);
check('16 at 30 a second can',
  ctx.measurablePass(playback), `${ctx.posedCount(playback)} detections`);
// The threshold the app already refuses on, applied where the decision is
// made rather than only in the apology afterwards.
check('measurability uses the same floor the refusal message quotes',
  ctx.passDensity(pass_(20, 0, 20 / ctx.MEASURABLE_FPS_MIN)) >= ctx.MEASURABLE_FPS_MIN * 0.9);
// Counting alone still matters: dense but barely there is not enough either.
check('a handful of frames is not rescued by being close together',
  !ctx.measurablePass(pass_(4, 1.0, 1.1)), `${ctx.posedCount(pass_(4, 1.0, 1.1))} detections`);
check('and a pass that found nobody is not measurable',
  !ctx.measurablePass([[], [], []]) && ctx.passDensity([[], []]) === 0);
check('nor does a single detection divide by a zero span',
  ctx.passDensity(pass_(1, 2, 2)) === 0 && ctx.passDensity([[{ metrics: { t: 1 } }], [{ metrics: { t: 1 } }]]) === 0);
// Timestamps that never arrived must be dropped, not read as t=0: a stray
// zero stretches the span from one second to six and turns a measurable pass
// into a sparse one. The values matter here -- an undated frame alongside
// t=1 and t=2 gives 1/s either way, and proves nothing.
check('frames with no timestamp are ignored rather than counted as zero',
  ctx.passDensity([[{ metrics: {} }], [{ metrics: { t: 5 } }], [{ metrics: { t: 6 } }]]) === 1,
  `${ctx.passDensity([[{ metrics: {} }], [{ metrics: { t: 5 } }], [{ metrics: { t: 6 } }]])}/s`);
check('and a missing list does not throw',
  ctx.passDensity(null) === 0 && ctx.posedCount(null) === 0 && !ctx.measurablePass(null));

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
