// Tests for four bugs found by measuring a real athlete-filmed clip:
//   1. thighSwing measured from the wrong pole, so front/back balance sat at
//      180 degrees and handed out a free 5/5.
//   2. hip sink read from raw image Y, so a panning camera scored as a hip
//      collapse (227% of a leg length -- underground).
//   3. hip height read during flight, where the "lowest foot" is a recovering
//      heel rather than the track.
//   4. the subject track running on over the bystanders once the athlete left
//      the shot, dragging the torso angle from 4 degrees to 52.
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const ctx = { console, Math, JSON, Array, Object, Number, Infinity, isFinite };
vm.createContext(ctx);
const a = src.indexOf('const POSE_LM'), b = src.indexOf('function getPoseLandmarker');
const names = ['frameMetrics', 'legMetrics', 'median', 'longestConsistentRun',
               'scoreHipSink', 'scoreSwingBalance', 'footContacts', 'toPoints',
               'MIN_CONTACTS', 'STRIKE_PLAUSIBLE_MIN', 'STRIKE_PLAUSIBLE_MAX',
               'scoreGroundContact', 'stridesMeasured', 'EDGE_MARGIN',
               'scoreDrivePosition', 'scoreAcceleration', 'bandFor', 'DRIVE_BANDS',
               'ANKLE_AGREEMENT_MAX', 'CONTACT_DEPTH_MIN',
               'scoreSupportStiffness', 'supportDrops', 'SUPPORT_AGREEMENT_MAX',
               'CONTACT_DEPTH_MAX', 'scoreHipSink',
               'bestWindow', 'poseSignature', 'buildTracks', 'ATHLETE_MOTION_MIN',
               'passingFolds', 'scorePassingPosition', 'PASSING_FOOT_MAX_DEPTH',
               'PROGRESSION_MIN_STRIDES'];
vm.runInContext(
  src.slice(a, b).replace(/^function renderAnalysis[\s\S]*?^\}/m, '') + '\n' +
  names.map((n) => `globalThis.${n}=${n};`).join('\n'), ctx);

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

// ---------- 1. thigh swing is measured from straight-down ----------
// Canvas y grows downward. Hip at (100,100); knee directly below it is a leg
// hanging straight down and must read 0, not 180.
const swingOf = (kneeX, kneeY) => {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  lms[11] = { x: 0.40, y: 0.30, visibility: 0.9 };  // shoulders
  lms[12] = { x: 0.40, y: 0.30, visibility: 0.9 };
  lms[23] = { x: 0.50, y: 0.50, visibility: 0.9 };  // hips at (100,100) on a 200x200
  lms[24] = { x: 0.50, y: 0.50, visibility: 0.9 };
  lms[25] = { x: kneeX / 200, y: kneeY / 200, visibility: 0.9 };
  lms[26] = { x: kneeX / 200, y: kneeY / 200, visibility: 0.9 };
  lms[27] = { x: kneeX / 200, y: (kneeY + 40) / 200, visibility: 0.9 };
  lms[28] = { x: kneeX / 200, y: (kneeY + 40) / 200, visibility: 0.9 };
  return ctx.frameMetrics(lms, 200, 200).legs[0].thighSwing;
};
check('a leg hanging straight down reads 0 degrees, not 180',
  Math.abs(swingOf(100, 150)) < 1, 'got ' + swingOf(100, 150).toFixed(1));
check('a thigh carried forward reads positive',
  swingOf(150, 150) > 30 && swingOf(150, 150) < 60, 'got ' + swingOf(150, 150).toFixed(1));
check('a thigh trailing behind reads negative',
  swingOf(50, 150) < -30 && swingOf(50, 150) > -60, 'got ' + swingOf(50, 150).toFixed(1));
check('a thigh lifted to horizontal reads near 90',
  Math.abs(swingOf(150, 100)) > 85 && Math.abs(swingOf(150, 100)) < 95,
  'got ' + swingOf(150, 100).toFixed(1));

// ---------- swing balance no longer scores a free 5 ----------
// A stride with clearly more backside than frontside must not read balanced.
const strideMetrics = (frontDeg, backDeg) =>
  Array.from({ length: 12 }, (_, i) => ({
    legs: [
      { thighSwing: i % 2 ? frontDeg : -backDeg, facing: 1, legLen: 80, ank: [0, 180] },
      { thighSwing: i % 2 ? -backDeg : frontDeg, facing: 1, legLen: 80, ank: [0, 180] },
    ],
    midHip: [0, 100],
  }));
// Swing balance is measured but no longer scored: every athlete measured so
// far lands between 0.27 and 0.43, which the old bands all called the worst
// score, and a number that comes out the same for everyone tells nobody
// anything. The measurement itself must still be right for the day there is
// a reference to calibrate against.
const lop = ctx.scoreSwingBalance(strideMetrics(40, 100));
check('swing balance is measured but not scored', lop && lop.score === null,
  lop && `score=${lop.score}`);
check('the front and back travel are still reported',
  lop && lop.front > 0 && lop.back > 0, lop && lop.note);
check('a thigh going further back than forward is still caught',
  lop && lop.back > lop.front, `front ${lop && lop.front} back ${lop && lop.back}`);
const even = ctx.scoreSwingBalance(strideMetrics(80, 85));
check('an even stride reads as roughly even', even && even.ratio > 0.9,
  even && `ratio ${even.ratio.toFixed(2)}`);

// ---------- 2 + 3. hip height survives a moving camera ----------
// Same athlete, same mechanics, but the whole frame drifts upward 120px as
// the operator pans. Hip height must be unchanged by that.
// A six-frame stride cycle, four strides of it. Each foot is planted for two
// consecutive frames and airborne for four, which is roughly what ~10 samples
// a second looks like against a real stride -- and, unlike a foot that
// alternates every frame, it collapses into separate contacts rather than one
// long one.
function runningFrames(cameraDrift) {
  const out = [];
  for (let i = 0; i < 24; i++) {
    const d = cameraDrift * i;
    const phase = i % 6;
    const leftDown = phase === 0 || phase === 1;
    const rightDown = phase === 3 || phase === 4;
    const footY = (down) => (down ? 180 : 130);
    out.push({
      torsoFromVertical: 5,
      midHip: [100, 100 + d],
      legs: [
        { ank: [100, footY(leftDown) + d], legLen: 80, thighSwing: 30, facing: 1, knee: 120, hip: [100, 100 + d] },
        { ank: [100, footY(rightDown) + d], legLen: 80, thighSwing: -30, facing: 1, knee: 120, hip: [100, 100 + d] },
      ],
    });
  }
  return out;
}
const still = ctx.scoreHipSink(runningFrames(0));
const panning = ctx.scoreHipSink(runningFrames(-15)); // camera tilts through the run
check('hip height is measured at all', still !== null);
check('a locked-off camera gives a sane hip range',
  still && still.value >= 0 && still.value < 0.3, still && `${(still.value * 100).toFixed(0)}%`);
check('a panning camera gives the same answer, not a fake collapse',
  panning && Math.abs(panning.value - still.value) < 0.02,
  panning && `still ${(still.value * 100).toFixed(0)}% vs panning ${(panning.value * 100).toFixed(0)}%`);
check('hip height never exceeds one leg length of travel',
  still.value < 1 && panning.value < 1);

// ---------- 4. the track stops at the bystanders ----------
// 20 frames of the athlete, then 8 of spectators: smaller bodies, upright,
// and the torso steps 38 degrees at the seam.
const athlete = Array.from({ length: 20 }, (_, i) => ({
  torsoFromVertical: 4 + (i % 3),
  legs: [{ legLen: 84 + (i % 5), ank: [0, 180] }, { legLen: 82 + (i % 4), ank: [0, 178] }],
  midHip: [100, 100],
}));
const bystanders = Array.from({ length: 8 }, (_, i) => ({
  torsoFromVertical: 44 + i * 5,
  legs: [{ legLen: 34 + (i % 3), ank: [0, 180] }, { legLen: 33 + (i % 2), ank: [0, 178] }],
  midHip: [100, 100],
}));
const trimmed = ctx.longestConsistentRun([...athlete, ...bystanders]);
check('the track is cut where it jumps to a different body',
  trimmed.length === 20, `kept ${trimmed.length} of 28`);
check('the frames kept are the athlete, not the spectators',
  trimmed.every((m) => m.torsoFromVertical < 12),
  'max torso kept ' + Math.max(...trimmed.map((m) => m.torsoFromVertical)));

// The athlete may also enter late -- the longest run must win either way.
const lateEntry = ctx.longestConsistentRun([...bystanders, ...athlete]);
check('a late-entering athlete is still the one graded',
  lateEntry.length === 20 && lateEntry.every((m) => m.torsoFromVertical < 12),
  `kept ${lateEntry.length}`);

// A clean track must be left alone.
check('a clean track is not trimmed', ctx.longestConsistentRun(athlete).length === 20);

// Gradual change of distance as he runs past is not a cut.
const receding = Array.from({ length: 24 }, (_, i) => ({
  torsoFromVertical: 5,
  legs: [{ legLen: 90 - i * 2, ank: [0, 180] }, { legLen: 89 - i * 2, ank: [0, 178] }],
  midHip: [100, 100],
}));
check('an athlete steadily running away is not treated as a new person',
  ctx.longestConsistentRun(receding).length === 24,
  `kept ${ctx.longestConsistentRun(receding).length} of 24`);

// ---------- a body running out of the picture ----------
// Its visible size shrinks, so it must not be used to size a crop or to
// decide where the athlete is running -- that zoomed the crop into a
// fragment and left only the frames before he started.
const inside = Array.from({ length: 33 }, (_, i) => ({
  x: 0.4 + (i % 3) * 0.02, y: 0.2 + (i / 32) * 0.5, visibility: 0.9,
}));
check('a body wholly inside the picture is not flagged',
  ctx.frameMetrics(inside, 480, 854).bodyAtEdge === false);

const leaving = inside.map((p, i) => (i % 4 === 0 ? Object.assign({}, p, { x: 0.995 }) : p));
check('a body running off the side of the picture is flagged',
  ctx.frameMetrics(leaving, 480, 854).bodyAtEdge === true);

const cut = inside.map((p, i) => (i > 28 ? Object.assign({}, p, { y: 0.995 }) : p));
check('a body cut off at the bottom is flagged',
  ctx.frameMetrics(cut, 480, 854).bodyAtEdge === true);

// ---------- short clips are graded, not refused ----------
// Whatever the athlete filmed gets graded; a short clip means saying less
// about it, not turning it away. What must never happen is an impossible
// value scoring well, and the good end of the strike band is open, so a
// foot half a leg length BEHIND the hip used to come back 5/5.
// A planted foot sits about a leg length below the hip; 180 - 100 = 80 = one
// legLen, so these are real touchdowns.
function contactFrames(strikeOffsetPx) {
  const out = [];
  for (let i = 0; i < 24; i++) {
    const phase = i % 6;
    const leftDown = phase === 0 || phase === 1;
    const rightDown = phase === 3 || phase === 4;
    const mk = (down) => ({
      ank: [100 + (down ? strikeOffsetPx : 0), down ? 180 : 130],
      hip: [100, 100], legLen: 80, footVsShin: 95, facing: 1, thighSwing: 20, knee: 120,
    });
    out.push({ midHip: [100, 100], legs: [mk(leftDown), mk(rightDown)] });
  }
  return out;
}

// The same stride, but the foot never gets near the ground -- the lowest
// frame of a flight phase, not a contact.
function shallowFrames() {
  const out = [];
  for (let i = 0; i < 24; i++) {
    const phase = i % 6;
    const mk = (down) => ({
      ank: [100, down ? 148 : 130], hip: [100, 100], legLen: 80,
      footVsShin: 95, facing: 1, thighSwing: 20, knee: 120,
    });
    out.push({ midHip: [100, 100], legs: [mk(phase === 0 || phase === 1), mk(phase === 3 || phase === 4)] });
  }
  return out;
}
// Nothing here is SCORED. Ankle at Touchdown now appears with a null score
// and a reason rather than vanishing, so the check is that no number came out
// of it, not that the row is missing -- a silently absent row was the thing
// that looked like the app forgetting.
check('a foot that never reaches the ground produces no score',
  ctx.scoreGroundContact(shallowFrames()).every((p) => p.score == null),
  JSON.stringify(ctx.scoreGroundContact(shallowFrames()).map((p) => `${p.name}:${p.score}`)));
// The athlete reported a stiff ankle and was told it was collapsing. The
// toe is the least stable landmark the model tracks, and on his clip it read
// 107, 145 and 137 at three touchdowns -- a 38 degree spread against bands
// 13 degrees wide. Numbers that disagree that much are not a measurement.
const wobble = (angles) => {
  const out = [];
  for (let i = 0; i < 24; i++) {
    const phase = i % 6;
    const mk = (down, k) => ({
      ank: [108, down ? 180 : 130], hip: [100, 100], legLen: 80,
      footVsShin: angles[k % angles.length], facing: 1, thighSwing: 20, knee: 120,
    });
    out.push({ midHip: [100, 100], legs: [mk(phase === 0 || phase === 1, i), mk(phase === 3 || phase === 4, i + 3)] });
  }
  return out;
};
const noisy = ctx.scoreGroundContact(wobble([107, 145, 137, 99, 149]));
const noisyAnkle = noisy.find((p) => p.name === 'Ankle at Touchdown');
check('an ankle whose touchdowns disagree wildly is not scored',
  noisyAnkle && noisyAnkle.score == null,
  JSON.stringify(noisy.map((p) => `${p.name}:${p.score}`)));
check('and says so rather than leaving a gap',
  noisyAnkle && /not measurable/i.test(noisyAnkle.note || ''),
  (noisyAnkle && noisyAnkle.note || '').slice(0, 70));
const steady = ctx.scoreGroundContact(wobble([112, 118, 115]));
check('an ankle that reads consistently still is',
  !!steady.find((p) => p.name === 'Ankle at Touchdown'));

const sane = ctx.scoreGroundContact(contactFrames(8));   // 10% of a leg ahead
const strikeSane = sane.find((p) => p.name === 'Foot Strike vs COM');
check('a plausible foot strike is reported', !!strikeSane, JSON.stringify(sane.map((p) => p.name)));

const mad = ctx.scoreGroundContact(contactFrames(-40));  // half a leg BEHIND
const strikeMad = mad.find((p) => p.name === 'Foot Strike vs COM');
check('an impossible foot strike is not scored well',
  strikeMad && strikeMad.score == null, strikeMad && `${strikeMad.score}/5 ${strikeMad.note}`);
check('and says why rather than vanishing',
  strikeMad && /not measurable/i.test(strikeMad.note || ''),
  strikeMad && (strikeMad.note || '').slice(0, 90));

// The same reading is not implausible during acceleration -- it is the drive
// phase. At top speed a foot half a leg length behind the hip is a mistrack;
// out of the blocks it is the athlete pushing the ground back, and every
// recorded start measured between 3% and 63% behind. One number, two
// meanings, so the clip type decides which bands it is read against.
const madAccel = ctx.scoreGroundContact(contactFrames(-40), 'Acceleration');
const strikeMadAccel = madAccel.find((p) => p.name === 'Foot Strike vs COM');
check('the same foot strike during acceleration is a drive step, and scores',
  strikeMadAccel && strikeMadAccel.score === 5,
  strikeMadAccel && `${strikeMadAccel.score}/5 ${strikeMadAccel.note}`);
check('and is described as behind the hips rather than as negative-ahead',
  strikeMadAccel && /behind the hips/.test(strikeMadAccel.note || ''),
  strikeMadAccel && (strikeMadAccel.note || '').slice(0, 80));
check('the rest of ground contact still reports', mad.some((p) => p.name === 'Ankle at Touchdown'));

check('a single contact is not enough to call it a measurement',
  ctx.MIN_CONTACTS >= 2, `${ctx.MIN_CONTACTS}`);
check('the plausible strike range allows landing slightly behind the hip',
  ctx.STRIKE_PLAUSIBLE_MIN < 0 && ctx.STRIKE_PLAUSIBLE_MIN > -0.3);

// ---------- the athlete is told what the score rests on ----------
check('strides are counted from touchdowns', ctx.stridesMeasured(contactFrames(8)) >= 3,
  `${ctx.stridesMeasured(contactFrames(8))}`);

// ---------- a short acceleration clip is judged on position, not change ----
// Over one stride there is no progression to see, and scoring one anyway
// punishes the athlete for how long he filmed: a first step held at 65
// degrees came back "body angle barely changed, 2/5" when that is what a
// good drive looks like.
const leanAt = (deg) => Array.from({ length: 10 }, () => ({
  torsoFromVertical: deg, legs: [], midHip: [100, 100],
}));
const firstStep = ctx.scoreDrivePosition(leanAt(66));
check('a hard forward lean off the first step scores well',
  firstStep && firstStep.score === 5, firstStep && `${firstStep.score}/5 ${firstStep.note}`);

const upright = ctx.scoreDrivePosition(leanAt(10));
check('being upright already in an acceleration clip does not',
  upright && upright.score <= 2, upright && `${upright.score}/5 ${upright.note}`);

const midAccel = ctx.scoreDrivePosition(leanAt(30));
check('a mid-acceleration lean sits in between',
  midAccel && midAccel.score === 3, midAccel && `${midAccel.score}/5`);

check('drive position is named for what it measures',
  firstStep.name === 'Drive Position');

// The progression is still the right measure once there is enough run.
check('a progression needs at least three strides to be judged',
  ctx.PROGRESSION_MIN_STRIDES >= 3);
const rising = Array.from({ length: 12 }, (_, i) => ({
  torsoFromVertical: 68 - i * 5, legs: [], midHip: [100, 100],
}));
const prog = ctx.scoreAcceleration(rising);
check('a smooth rise from the drive still scores well',
  prog && prog.score >= 4, prog && `${prog.score}/5 ${prog.note}`);

// ---------- support stiffness, from the hip rather than the toe ----------
// The athlete's own idea: if the foot collapses the hip comes down with it,
// and the hip and knee are landmarks the model tracks well where the toe is
// not. Built as a stride where the hip either holds or settles under load.
// Left foot planted for three frames, then the right, and the hip settles by
// the same amount across whichever stance it is in -- the feet have to agree,
// or the guard refuses to score and rightly so.
function loadedStride(dropPerContact) {
  const out = [];
  for (let i = 0; i < 30; i++) {
    const phase = i % 6;
    const leftStance = phase < 3;
    const settle = dropPerContact * ((phase % 3) / 2);
    const mk = (down) => ({
      ank: [100, down ? 180 : 130], hip: [100, 100], legLen: 80,
      footVsShin: 95, facing: 1, thighSwing: 20, knee: 120,
    });
    out.push({ midHip: [100, 100 + settle * 80], legs: [mk(leftStance), mk(!leftStance)] });
  }
  return out;
}
const stiff = ctx.scoreSupportStiffness(loadedStride(0));
check('a hip that holds through contact scores well',
  stiff && stiff.score === 5, stiff && `${stiff.score}/5 ${stiff.note}`);

const soft = ctx.scoreSupportStiffness(loadedStride(0.25));
check('a hip that drops onto the foot does not',
  soft && soft.score <= 2, soft && `${soft.score}/5 ${soft.note}`);

check('it is measured in leg lengths, so filming distance cannot move it',
  stiff && stiff.value >= 0 && stiff.value < 1);

// Contacts that disagree are noise, exactly as with the ankle.
// One stiff stretch and one collapsing one is not a measurement of either.
const mixed = loadedStride(0).concat(loadedStride(0.4));
// Withheld, not absent: a measure that disappears off the card reads as the
// app forgetting it. It comes back unscored, with the reason.
const mixedSupport = ctx.scoreSupportStiffness(mixed);
check('contacts that disagree with each other are not scored',
  mixedSupport && mixedSupport.score == null,
  JSON.stringify(ctx.supportDrops(mixed).map((x) => +x.toFixed(2))));
check('and the row says why rather than vanishing',
  mixedSupport && /not measurable/i.test(mixedSupport.note || '') && /disagreed/.test(mixedSupport.note),
  mixedSupport && (mixedSupport.note || '').slice(0, 80));

// ---------- which stretch of the clip gets measured ----------
// Picking where he is biggest alone hands back a block start's set position;
// picking where the tracked shape changes fastest hands back the far end of
// the clip, because a small distant body tracks noisily and noise looks like
// movement. On a relay run that put the window after the handoff and
// returned 161 degrees of hip angle for a runner who measures 94 mid-run.
function stretch(frames, bodyFrac, shapeStep, startX) {
  return Array.from({ length: frames }, (_, f) => {
    const lms = Array.from({ length: 33 }, (_, i) => ({
      x: startX + f * 0.004 + (i % 5) * 0.01,
      y: 0.3 + (i / 32) * bodyFrac,
      visibility: 0.95,
    }));
    const sig = ctx.poseSignature(lms, 480, 854);
    sig.norm = sig.norm.map(([p, q]) => [p + f * shapeStep, q]);
    return [{ sig, metrics: { bodyFrac, bodyPx: 400, bodyAtEdge: false, footAtEdge: false, legs: [] } }];
  });
}
// Near and running, then far and noisy: the noisy stretch changes shape
// faster, but the near one is the one worth measuring.
const near = stretch(20, 0.5, 0.1, 0.2);
const far = stretch(20, 0.12, 0.25, 0.6);
const chosen = ctx.bestWindow(near.concat(far), 1 / 30, 16);
check('the stretch where he is easiest to see is the one measured',
  chosen && chosen.from < 20, chosen && `frames ${chosen.from}-${chosen.to}, body ${(chosen.seen * 100).toFixed(0)}%`);
check('and it reports how visible he was there',
  chosen && chosen.seen > 0.3, chosen && `${(chosen.seen * 100).toFixed(0)}%`);

// A body barely changing shape is not running, however clearly it is seen.
const parked = stretch(30, 0.6, 0.001, 0.2);
const movingLater = stretch(30, 0.35, 0.1, 0.5);
const picked = ctx.bestWindow(parked.concat(movingLater), 1 / 30, 16);
check('a big stationary body is not preferred over a smaller running one',
  picked && picked.from >= 25, picked && `frames ${picked.from}-${picked.to}`);

check('too short a track has no window to choose',
  ctx.bestWindow(stretch(4, 0.5, 0.1, 0.2), 1 / 30, 16) === null);

// A stationary athlete is EASY to follow, so a set position reliably produces
// the longest track in the clip; the sprint moves fast enough to break
// association and comes back shorter. Searching only the longest track
// therefore grades the blocks every time. On a real block start that was 61
// frames of him set (35% of frame, 1.32/s) against 44 frames of the run (45%,
// 4.09/s) -- and it graded the set position.
//
// Separated by a few frames where he is not detected at all, which is how the
// two tracks come to exist in the real clip: association gives up after three
// missed frames. Placing them far apart in the frame is not enough on its own
// -- the earlier parked/moving pair above stays close enough to associate,
// which is why that test exercises one track and this one exercises two.
const lost = Array.from({ length: 4 }, () => []);
const setPosition = stretch(60, 0.35, 0.001, 0.05);
const theRun = stretch(20, 0.45, 0.1, 0.75);
const overBoth = ctx.bestWindow(setPosition.concat(lost, theRun), 1 / 30, 16);
check('the run is measured even though the set position tracks for longer',
  overBoth && overBoth.from >= 64,
  overBoth && `frames ${overBoth.from}-${overBoth.to}, body ${(overBoth.seen * 100).toFixed(0)}%`);

// And the movement test has to beat size ACROSS tracks, not just within one:
// a stationary stretch that is both longer and bigger still must not win.
const bigSet = stretch(60, 0.6, 0.001, 0.05);
const smallRun = stretch(20, 0.3, 0.1, 0.75);
const overBoth2 = ctx.bestWindow(bigSet.concat(lost, smallRun), 1 / 30, 16);
check('a longer AND bigger stationary track still loses to a running one',
  overBoth2 && overBoth2.from >= 64,
  overBoth2 && `frames ${overBoth2.from}-${overBoth2.to}`);

// With nothing running anywhere, the fallback still has to work -- and it must
// not fire while some other track is running, which is why both passes run
// over every track before either concludes.
const twoStills = stretch(30, 0.5, 0.001, 0.05).concat(lost, stretch(30, 0.2, 0.001, 0.75));
const stillOnly = ctx.bestWindow(twoStills, 1 / 30, 16);
check('with nobody running it falls back to wherever he is biggest',
  stillOnly && stillOnly.from < 30, stillOnly && `frames ${stillOnly.from}-${stillOnly.to}`);

// ---------- a "contact" the foot was never on the ground for ----------
// legLen is measured along the limb, so a planted foot can never sit more
// than one leg length below the hip -- that is a straight leg. Readings past
// that are flight frames footContacts mistook for touchdowns, and they were
// what made Hip Height report a 48% collapse on a clip whose support settled
// a measured 5% per contact: two metrics contradicting each other on one card.
function touchdownAt(depth) {
  return {
    torsoFromVertical: 6,
    midHip: [100, 100],
    legs: [
      { ank: [100, 100 + depth * 80], legLen: 80, thighSwing: 20, facing: 1, kneeAngle: 150, hip: [100, 100] },
      { ank: [100, 100 + 0.5 * 80], legLen: 80, thighSwing: -20, facing: 1, kneeAngle: 90, hip: [100, 100] },
    ],
  };
}
// Six frames per touchdown so footContacts sees a plant rather than a blip.
// It keys on the deepest touchdowns, so every fixture here varies only the
// depth of those -- a shallower "sinking" contact is not something this
// fixture can express, and the low end is covered by real footage instead
// (see the five-clip table in tools/CALIBRATION.md).
const plantedRun = (depths) => depths.flatMap((d) => [
  touchdownAt(d), touchdownAt(d), touchdownAt(0.5), touchdownAt(0.5), touchdownAt(0.5), touchdownAt(0.5),
]);
check('the impossible-depth bound is one leg length plus noise',
  ctx.CONTACT_DEPTH_MAX > 1 && ctx.CONTACT_DEPTH_MAX < 1.15, 'got ' + ctx.CONTACT_DEPTH_MAX);

// Same shape, same count -- only the last two touchdowns differ, between
// plausible depths and ones past a straight leg.
const realOnly = ctx.scoreHipSink(plantedRun([0.98, 0.95, 0.93, 0.96]));
const withGhosts = ctx.scoreHipSink(plantedRun([0.98, 0.95, 1.27, 1.24]));
check('a run of real touchdowns is scored', realOnly && realOnly.value < 0.15,
  realOnly && `${realOnly.score}/5 spread ${(realOnly.value * 100).toFixed(0)}%`);
// Filtering may only withhold or match -- never inflate. Withholding is a
// legitimate outcome here and not a weaker one: the ghosts are deeper than
// the real touchdowns, so footContacts prefers them and they displace real
// contacts from the list. Dropping them afterwards can leave too few to
// judge, which is the honest answer rather than a spread built from frames
// the foot was never on the ground for.
check('impossible depths can never inflate the hip-height spread',
  withGhosts === null || withGhosts.value <= realOnly.value + 0.02,
  realOnly && `real ${(realOnly.value * 100).toFixed(0)}%, with ghosts ${withGhosts ? (withGhosts.value * 100).toFixed(0) + '%' : 'withheld'}`);

// The bound must not eat real contacts either: a leg at full extension reads
// right at 1.0 and is the most ordinary touchdown there is.
const extended = ctx.scoreHipSink(plantedRun([1.00, 0.97, 1.02, 0.99]));
check('a fully extended leg at touchdown is still counted',
  extended !== null && extended.value < 0.1,
  extended && `spread ${(extended.value * 100).toFixed(0)}%`);

// Too few plausible contacts is withheld rather than guessed from one --
// withheld meaning unscored and explained, not missing.
const ghostly = ctx.scoreHipSink(plantedRun([0.95, 1.27, 1.24, 1.30]));
check('with almost every contact impossible, no number is reported',
  ghostly && ghostly.score == null, ghostly && `${ghostly.score}/5`);
check('and the athlete is told why',
  ghostly && /not measurable/i.test(ghostly.note || ''),
  ghostly && (ghostly.note || '').slice(0, 80));

// ---------- passing position ----------
// The fold at the instant the thigh swings through vertical. The stance leg
// crosses vertical every stride too, nearly straight with the foot planted,
// and counting those dragged a real 62 degrees up to a reported 108.
function cycle(recoveryFold, frames = 40) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    const ph = (i % 10) / 10;                  // one stride per ten frames
    // recovery leg sweeps -40 -> +80, folded; stance leg sweeps the other
    // way, straight, with its foot on the ground
    const swing = -40 + ph * 120;
    out.push({
      t: i / 30,
      midHip: [100, 100],
      legs: [
        { thighSwing: swing, kneeAngle: recoveryFold, ank: [100, 100 + 0.35 * 80],
          hip: [100, 100], legLen: 80, facing: 1 },
        { thighSwing: 40 - ph * 120, kneeAngle: 168, ank: [100, 100 + 0.97 * 80],
          hip: [100, 100], legLen: 80, facing: 1 },
      ],
    });
  }
  return out;
}
const tight = ctx.scorePassingPosition(cycle(64));
check('a leg gathered at passing scores well', tight && tight.score === 5,
  tight && `${tight.score}/5 ${tight.note}`);
const late = ctx.scorePassingPosition(cycle(130));
check('a leg still long at passing does not', late && late.score === 2,
  late && `${late.score}/5 ${late.note}`);

// The planted leg must never contribute -- it is straight, and including it
// is what invented a gap between the athlete and the reference.
const folds = ctx.passingFolds(cycle(64));
check('the stance leg is excluded from passing',
  folds.length > 0 && Math.max(...folds) < 100, JSON.stringify(folds.map(Math.round)));
check('a planted foot is not read as a recovery',
  ctx.PASSING_FOOT_MAX_DEPTH < 0.8);

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
