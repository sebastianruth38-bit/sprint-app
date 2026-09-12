const POSE_LM = {
  nose: 0, lSho: 11, rSho: 12, lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28, lHeel: 29, rHeel: 30,
};

// A landmark this uncertain is a guess. The model still returns coordinates
// for a limb it cannot see -- confidently, and wrong -- so anything under
// this is treated as missing rather than scored.
const MIN_LANDMARK_CONFIDENCE = 0.5;

// All three band sets were calibrated by running elite reference clips
// through this same model, so the numbers are in the units it reports.
// An elite top-speed clip measured: hip 84.7-91.3 at peak lift, scissor
// 107-119, tightest knee fold 47.3. An acceleration clip measured hip
// ~117 and a fold of only 68.4, which is why fold is not scored there.

// PRIMARY max-velocity metric: the angle between torso and front thigh at
// peak knee lift. Closes to ~90 in elite sprinting and stops there.
const HIP_BANDS = [
  { min: 82, max: 95, score: 5, note: 'Textbook hip angle at peak lift' },
  { min: 95, max: 105, score: 4, note: 'Hip slightly open -- thigh could come through more' },
  { min: 75, max: 82, score: 4, note: 'Hip closing just past ideal' },
  { min: 105, max: 118, score: 3, note: 'Hip staying open -- not enough front-side knee drive' },
  { min: 72, max: 75, score: 3, note: 'Hip closing well past ideal' },
  { min: 118, max: Infinity, score: 2, note: 'Thigh barely coming through at top speed' },
  { min: -Infinity, max: 72, score: 2, note: 'Hip over-closed at peak lift' },
];

// Secondary: how wide the legs split at that same instant.
const SCISSOR_BANDS = [
  { min: 105, max: 125, score: 5, note: 'Full scissor' },
  { min: 95, max: 105, score: 4, note: 'Good separation, a touch under elite' },
  { min: 85, max: 95, score: 3, note: 'Needs more front-side separation' },
  { min: -Infinity, max: 85, score: 2, note: 'Legs not separating enough' },
  { min: 125, max: Infinity, score: 3, note: 'Over-separated -- watch for reaching' },
];

// How tightly the heel folds under during recovery. Measured at its own
// instant -- the tightest fold anywhere in the swing -- NOT at peak lift,
// where the knee is high and the shin necessarily hangs below it.
const FOLD_BANDS = [
  { min: -Infinity, max: 55, score: 5, note: 'Heel folds tight to the glute' },
  { min: 55, max: 65, score: 4, note: 'Good heel recovery' },
  { min: 65, max: 75, score: 3, note: 'Heel recovery a little lazy' },
  { min: 75, max: Infinity, score: 2, note: 'Heel trailing -- long lever swinging through' },
];

// ---------- Who to grade, and when to refuse ----------
// Calibrated on reference clips sampled at ~13fps, then expressed per
// second so a different sample rate doesn't move the thresholds. Measured:
// a sprinting athlete 2.9/s, a standing bystander 1.2/s, and a skeleton
// jumping between runners in a pack 4.9/s -- limbs cannot really move that
// fast, so anything above the ceiling means the tracker lost the plot.
const MAX_PEOPLE_IN_FRAME = 3;
const MIN_TRACK_FRAMES = 8;
const ATHLETE_MOTION_MIN = 1.8;
const ATHLETE_MOTION_MAX = 4.0;

const SIG_JOINTS = ['lSho', 'rSho', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnk', 'rAnk'];

// A pose reduced to joint positions relative to its own hips and body size,
// so it can be compared across frames regardless of where the athlete is on
// screen or how far away they are. That's what makes this survive a camera
// panning with the runner, which defeats any position-based approach.
function poseSignature(landmarks, width, height) {
  const { pt } = toPoints(landmarks, width, height);
  const p = SIG_JOINTS.map((k) => pt(POSE_LM[k]));
  const hip = midpoint(p[2], p[3]);
  const sho = midpoint(p[0], p[1]);
  const size = Math.hypot(sho[0] - hip[0], sho[1] - hip[1]) || 1;
  return { hip, size, norm: p.map((q) => [(q[0] - hip[0]) / size, (q[1] - hip[1]) / size]) };
}

function signatureDistance(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
  return total / a.length;
}

// Greedy nearest-neighbour association. The gate is scaled by body size, so
// it behaves the same whether the athlete fills the frame or is distant.
function buildTracks(framePoses) {
  const tracks = [];
  framePoses.forEach((poses, fi) => {
    poses.forEach((pose) => {
      let best = null;
      let bestD = Infinity;
      for (const t of tracks) {
        if (fi - t.lastFrame > 3) continue;
        const d = Math.hypot(t.hip[0] - pose.sig.hip[0], t.hip[1] - pose.sig.hip[1]) / pose.sig.size;
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best && bestD < 2.5) {
        best.motion.push(signatureDistance(best.norm, pose.sig.norm));
        best.hip = pose.sig.hip;
        best.norm = pose.sig.norm;
        best.lastFrame = fi;
        best.metrics.push(pose.metrics);
      } else {
        tracks.push({
          hip: pose.sig.hip, norm: pose.sig.norm, lastFrame: fi,
          motion: [], metrics: [pose.metrics],
        });
      }
    });
  });
  return tracks;
}

// Returns the frames belonging to the one athlete worth grading, or a
// reason to refuse. Refusing beats grading merged skeletons: a race clip
// produces a confident score built from one runner's torso and another's
// legs, and the athlete has no way to know it's nonsense.
function selectSubject(framePoses, secondsPerFrame) {
  const counts = framePoses.map((p) => p.length).filter((n) => n > 0);
  if (!counts.length) {
    return { metrics: [], rejection: 'No athlete detected in this clip.' };
  }
  if (median(counts) > MAX_PEOPLE_IN_FRAME) {
    return { metrics: [], rejection: 'Too many people in frame to tell who to grade — film the athlete on their own.' };
  }

  const perSecond = secondsPerFrame > 0 ? 1 / secondsPerFrame : 1;
  const tracks = buildTracks(framePoses)
    .filter((t) => t.metrics.length >= MIN_TRACK_FRAMES && t.motion.length)
    .map((t) => ({
      metrics: t.metrics,
      motionPerSec: (t.motion.reduce((a, b) => a + b, 0) / t.motion.length) * perSecond,
    }));
  if (!tracks.length) {
    return { metrics: [], rejection: 'Could not follow anyone through this clip.' };
  }

  const running = tracks.filter((t) => t.motionPerSec >= ATHLETE_MOTION_MIN && t.motionPerSec <= ATHLETE_MOTION_MAX);
  if (running.length > 1) {
    return { metrics: [], rejection: 'More than one athlete is running here — grade one at a time.' };
  }
  if (!running.length) {
    const scrambled = tracks.some((t) => t.motionPerSec > ATHLETE_MOTION_MAX);
    return {
      metrics: [],
      rejection: scrambled
        ? 'Tracking jumped between overlapping people — film one athlete alone, side-on.'
        : 'Nobody in this clip is moving like a sprinter.',
    };
  }

  const subject = running.reduce((a, b) => (b.metrics.length > a.metrics.length ? b : a));
  return { metrics: subject.metrics, rejection: null };
}

// A frame reporting one of these is a tracking failure, not a position any
// athlete reaches. Clip 2's highest-lift frame returned a 164 degree
// scissor, which would otherwise have set the whole grade.
function plausibleFrame(m) {
  return m.scissor != null && m.scissor < 150
    && m.hipAngle != null && m.hipAngle < 175
    && m.leadKnee != null && m.leadKnee < 175;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function angleAt(a, b, c) {
  const ba = [a[0] - b[0], a[1] - b[1]];
  const bc = [c[0] - b[0], c[1] - b[1]];
  const dot = ba[0] * bc[0] + ba[1] * bc[1];
  const mag = Math.hypot(...ba) * Math.hypot(...bc);
  if (!mag) return NaN;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

// 0 = perfectly upright, 90 = horizontal.
function angleFromVertical(p, q) {
  return (Math.atan2(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) * 180) / Math.PI;
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// Landmarks arrive normalized to [0,1] against width and height separately,
// so they must be scaled back to pixels before any angle is computed --
// otherwise a non-square frame skews every result.
function toPoints(landmarks, width, height) {
  const pt = (i) => [landmarks[i].x * width, landmarks[i].y * height];
  const conf = (i) => (landmarks[i].visibility ?? 1);
  return { pt, conf };
}

// How high one thigh is carried, and whether that leg is folded into the
// figure-4. Both are scaled by thigh length so they don't change with how
// big the athlete is in frame.
function legMetrics(pt, conf, midSho, hipI, kneeI, ankI) {
  if (![hipI, kneeI, ankI].every((i) => conf(i) >= MIN_LANDMARK_CONFIDENCE)) return null;
  const hip = pt(hipI), knee = pt(kneeI), ank = pt(ankI);
  const thighLen = Math.hypot(knee[0] - hip[0], knee[1] - hip[1]) || 1;
  return {
    // y grows downward, so knee above hip gives a positive rise. Used only
    // to find which frame is the peak, never scored on its own.
    rise: (hip[1] - knee[1]) / thighLen,
    // The angle the athlete described: torso against the front thigh.
    hipAngle: angleAt(midSho, hip, knee),
    // Thigh against shin. Its minimum across the swing is the heel fold.
    knee: angleAt(hip, knee, ank),
  };
}

function frameMetrics(landmarks, width, height) {
  const { pt, conf } = toPoints(landmarks, width, height);
  const need = (...idx) => idx.every((i) => conf(i) >= MIN_LANDMARK_CONFIDENCE);

  const midHip = midpoint(pt(POSE_LM.lHip), pt(POSE_LM.rHip));
  const midSho = midpoint(pt(POSE_LM.lSho), pt(POSE_LM.rSho));

  const torsoOk = need(POSE_LM.lHip, POSE_LM.rHip, POSE_LM.lSho, POSE_LM.rSho);
  const scissorOk = need(POSE_LM.lHip, POSE_LM.rHip, POSE_LM.lKnee, POSE_LM.rKnee);

  // The lead leg is whichever thigh is carried highest -- that's the one the
  // hip angle and scissor are read against.
  const legs = [
    legMetrics(pt, conf, midSho, POSE_LM.lHip, POSE_LM.lKnee, POSE_LM.lAnk),
    legMetrics(pt, conf, midSho, POSE_LM.rHip, POSE_LM.rKnee, POSE_LM.rAnk),
  ].filter(Boolean);
  const lead = legs.length ? legs.reduce((a, b) => (b.rise > a.rise ? b : a)) : null;

  return {
    torsoFromVertical: torsoOk ? angleFromVertical(midHip, midSho) : null,
    scissor: scissorOk ? angleAt(pt(POSE_LM.lKnee), midHip, pt(POSE_LM.rKnee)) : null,
    thighRise: lead ? lead.rise : null,
    hipAngle: lead ? lead.hipAngle : null,
    leadKnee: lead ? lead.knee : null,
    // The tightest fold available this frame, across both legs.
    kneeFold: legs.length ? Math.min(...legs.map((l) => l.knee)) : null,
  };
}

function bandFor(value, bands) {
  return bands.find((b) => value >= b.min && value < b.max) || bands[bands.length - 1];
}

// The scissor is read at the instant the thigh is carried highest -- not
// the widest split anywhere in the clip, which lands mid-cycle and reads
// low. It's only trusted if the figure-4 is achieved (or close) at that
// same instant: a wide split with a trailing, unfolded leg isn't the
// position the number is meant to describe.
// Reads the top-speed position from the three highest thigh-carry frames
// rather than the single highest -- one bad detection shouldn't decide a
// grade. Implausible frames are dropped before the peak is chosen at all.
function peakLiftFrames(metrics, howMany = 3) {
  const usable = metrics.filter((m) => m.thighRise != null && plausibleFrame(m));
  if (!usable.length) return [];
  return [...usable].sort((a, b) => b.thighRise - a.thighRise).slice(0, howMany);
}

function scoreMaxVelocity(metrics, surface) {
  const peak = peakLiftFrames(metrics);
  if (!peak.length) return null;

  const hip = median(peak.map((m) => m.hipAngle));
  const scissor = median(peak.map((m) => m.scissor));
  // Grass is slower and the angles are genuinely smaller on it, so the
  // bands ease rather than the athlete being marked down for the ground.
  const ease = surface === 'Grass' ? 4 : 0;

  const hipBand = bandFor(hip, HIP_BANDS);
  const scissorBand = bandFor(scissor + ease, SCISSOR_BANDS);
  const suffix = surface === 'Grass' ? ' (grass — eased)' : '';

  return {
    hip: { name: 'Torso-to-Thigh at Peak Lift', score: hipBand.score,
           note: `${hipBand.note} (${hip.toFixed(0)}°)${suffix}` },
    scissor: { name: 'Thigh Separation (scissor)', score: scissorBand.score,
               note: `${scissorBand.note} (${scissor.toFixed(0)}°)${suffix}` },
    hipValue: hip,
    scissorValue: scissor,
  };
}

// The heel fold is read at its own instant -- the tightest knee angle
// anywhere in the swing. Reading it at peak lift (as this used to) fails
// every athlete, because a high knee necessarily hangs the shin below it.
function scoreKneeFold(metrics) {
  const folds = metrics.map((m) => m.kneeFold).filter((v) => v != null && v > 15);
  if (folds.length < 3) return null;
  const tightest = Math.min(...folds);
  const band = bandFor(tightest, FOLD_BANDS);
  return { name: 'Heel Recovery (knee fold)', score: band.score,
           note: `${band.note} (${tightest.toFixed(0)}° tightest)`, tightest };
}

// Acceleration isn't one target posture -- it's a progression. The torso
// starts near horizontal out of the blocks and rises gradually toward
// upright, so what's scored is the shape of that rise, not any one frame.
function scoreAcceleration(metrics) {
  const series = metrics.map((m) => m.torsoFromVertical).filter((v) => v != null);
  if (series.length < 3) return null;

  const start = series[0];
  const end = series[series.length - 1];
  const drop = start - end;

  let steps = 0;
  let rising = 0;
  for (let i = 1; i < series.length; i++) {
    steps++;
    if (series[i] <= series[i - 1] + 3) rising++; // small tolerance for jitter
  }
  const smoothness = steps ? rising / steps : 0;

  const third = Math.max(1, Math.floor(series.length / 3));
  const earlyDrop = start - series[third];
  const earlyShare = drop > 0 ? earlyDrop / drop : 0;

  if (drop < 10) {
    return { name: 'Acceleration Posture', score: 2,
      note: `Body angle barely changed (${start.toFixed(0)}° to ${end.toFixed(0)}°)`, start, end };
  }
  if (earlyShare > 0.7) {
    return { name: 'Acceleration Posture', score: 3,
      note: `Stood up too early -- most of the rise happened at once`, start, end };
  }
  if (smoothness >= 0.7) {
    return { name: 'Acceleration Posture', score: 5,
      note: `Smooth progressive rise (${start.toFixed(0)}° to ${end.toFixed(0)}°)`, start, end };
  }
  return { name: 'Acceleration Posture', score: 4,
    note: `Rises overall but unevenly (${start.toFixed(0)}° to ${end.toFixed(0)}°)`, start, end };
}

// Speed endurance is the max-velocity shape plus whether it survives to the
// end of the rep, so the scissor is compared early-half against late-half.

// Assembles the same JSON the AI path returns, so nothing downstream cares
// which engine produced it.
function buildLocalAnalysis(metrics, clipType, surface) {
  const usable = metrics.filter((m) => m.torsoFromVertical != null || m.scissor != null);
  if (usable.length < 3) {
    return {
      summary: 'Could not read the athlete clearly enough to score this clip.',
      pinpoints: [],
      flags: [],
      filming_note: 'Film side-on with the whole body in frame and the athlete filling more of the shot.',
    };
  }

  const pinpoints = [];
  const flags = [];

  if (clipType === 'Acceleration') {
    const accel = scoreAcceleration(metrics);
    if (accel) {
      pinpoints.push({ name: accel.name, score: accel.score, note: accel.note });
      if (accel.start < 30) flags.push('Already upright at the start -- little drive phase visible');
    }
  } else {
    const maxv = scoreMaxVelocity(metrics, surface);
    if (maxv) {
      pinpoints.push(maxv.hip, maxv.scissor);
      if (maxv.hipValue > 118) flags.push('Thigh is not coming through at top speed');
      if (maxv.scissorValue < 85) flags.push('Insufficient thigh separation at top speed');
      if (maxv.scissorValue > 125) flags.push('Possible over-striding -- reaching in front of the hips');
    }
    const fold = scoreKneeFold(metrics);
    if (fold) {
      pinpoints.push({ name: fold.name, score: fold.score, note: fold.note });
      if (fold.tightest > 75) flags.push('Heel is not recovering up under the hip');
    }
  }

  const posture = metrics.map((m) => m.torsoFromVertical).filter((v) => v != null);
  if (clipType !== 'Acceleration' && posture.length) {
    const avg = posture.reduce((a, b) => a + b, 0) / posture.length;
    pinpoints.push({
      name: 'Upright Posture',
      score: avg <= 12 ? 5 : avg <= 20 ? 4 : 3,
      note: `Torso averaged ${avg.toFixed(0)}° from vertical`,
    });
  }

  const best = pinpoints.reduce((a, b) => (b.score > a.score ? b : a), pinpoints[0]);
  const worst = pinpoints.reduce((a, b) => (b.score < a.score ? b : a), pinpoints[0]);
  const summary = pinpoints.length
    ? (best === worst
        ? `${best.name.toLowerCase()} scored ${best.score}/5.`
        : `Strongest: ${best.name.toLowerCase()}. Work on: ${worst.name.toLowerCase()}.`)
    : 'No scoreable positions found in this clip.';

  const readRate = usable.length / metrics.length;
  return {
    summary,
    pinpoints,
    flags,
    filming_note: readRate < 0.6
      ? 'Only part of the clip was readable -- film side-on with the full body in frame.'
      : null,
  };
}

let p=0,f=0; const A=(c,m)=>{c?(console.log('PASS: '+m),p++):(console.error('FAIL: '+m),f++)};
const SPF = 1/13.5;   // the rate the thresholds were calibrated at

// Build a synthetic track whose frame-to-frame articulation equals `art`,
// by walking one joint a fixed distance each frame.
function track(nFrames, art, startX=0, id=0){
  const out=[];
  for(let i=0;i<nFrames;i++){
    const norm=[[0,-1],[0,-1],[-0.2,0],[0.2,0],[-0.2,1],[0.2,1],[-0.2,2],[0.2,2]]
      .map(([x,y],j)=> j===4 ? [x + art*8*i, y] : [x,y]);
    out.push({sig:{hip:[startX+id*500,0],size:1,norm}, metrics:{torsoFromVertical:6,scissor:110,thighRise:0.05,hipAngle:87,leadKnee:80,kneeFold:50}});
  }
  return out;
}
const zip=(...ts)=>ts[0].map((_,i)=>ts.map(t=>t[i]).filter(Boolean));

// CLIP 3: one athlete, articulation 0.220/frame at 13.5fps = 2.97/s
let r=selectSubject(track(40,0.220).map(x=>[x]), SPF);
A(r.rejection===null, 'clip 3 (single athlete, panned) is accepted: '+(r.rejection||'accepted'));
A(r.metrics.length===40, 'and all 40 of its frames are used for scoring');

// CLIP 2: athlete 0.215 + bystander 0.092, both present all clip
r=selectSubject(zip(track(40,0.215,0,0), track(40,0.092,0,1)), SPF);
A(r.rejection===null, 'clip 2 (athlete + standing bystander) is accepted');
A(r.metrics.length===40, 'the bystander is filtered out, athlete kept: '+r.metrics.length+' frames');

// CLIP 1: race pack -- one merged track at 0.364/frame = 4.91/s
r=selectSubject(track(40,0.364).map(x=>[x]), SPF);
A(r.rejection!==null && /jumped between/.test(r.rejection), 'clip 1 (race pack) is REJECTED: "'+r.rejection+'"');

// Two genuine runners in frame
r=selectSubject(zip(track(40,0.220,0,0), track(40,0.215,0,1)), SPF);
A(/More than one athlete/.test(r.rejection||''), 'two runners rejected: "'+r.rejection+'"');

// A crowd
r=selectSubject(zip(track(30,0.22,0,0),track(30,0.09,0,1),track(30,0.09,0,2),track(30,0.09,0,3)), SPF);
A(/Too many people/.test(r.rejection||''), 'four people rejected on count: "'+r.rejection+'"');

// Nobody moving like a sprinter
r=selectSubject(track(40,0.05).map(x=>[x]), SPF);
A(/moving like a sprinter/.test(r.rejection||''), 'a clip of someone standing still is rejected: "'+r.rejection+'"');

// Short spurious track (clip 2 had one: n=5, articulation 0.551) is ignored
r=selectSubject(zip(track(40,0.215,0,0), track(5,0.551,0,1)), SPF);
A(r.rejection===null, 'a 5-frame spurious detection does not reject the clip: '+(r.rejection||'accepted'));

// Rate independence: same athlete sampled at half the rate scores the same verdict
const halfRate = selectSubject(track(20,0.440).map(x=>[x]), 1/6.75);
A(halfRate.rejection===null, 'the same athlete sampled at 6.75fps is still accepted (per-second thresholds hold)');

A(selectSubject([], SPF).rejection!==null,'an empty clip is rejected, not scored');
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
