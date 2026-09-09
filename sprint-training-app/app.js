// ---------- Supabase client + auth ----------
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;

const authGate = document.getElementById('authGate');
const appShell = document.getElementById('appShell');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authMessage = document.getElementById('authMessage');

function setAuthMessage(msg, isError = false) {
  authMessage.textContent = msg;
  authMessage.style.color = isError ? 'var(--accent)' : 'var(--muted)';
}

document.getElementById('authSignIn').addEventListener('click', async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) return setAuthMessage('Enter an email and password.', true);
  setAuthMessage('Signing in...');
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) setAuthMessage(error.message, true);
});

document.getElementById('authSignUp').addEventListener('click', async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) return setAuthMessage('Enter an email and password.', true);
  if (password.length < 6) return setAuthMessage('Password must be at least 6 characters.', true);
  setAuthMessage('Creating account...');
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) return setAuthMessage(error.message, true);
  setAuthMessage("Account created — you're signed in, or check your email if confirmation is required.");
});

document.getElementById('authMagicLink').addEventListener('click', async () => {
  const email = authEmail.value.trim();
  if (!email) return setAuthMessage('Enter your email first.', true);
  setAuthMessage('Sending link...');
  const { error } = await supabaseClient.auth.signInWithOtp({ email });
  if (error) setAuthMessage(error.message, true);
  else setAuthMessage('Check your email for a sign-in link.');
});

document.getElementById('signOutBtn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
});

// ---------- Settings menu ----------
const settingsBtn = document.getElementById('settingsBtn');
const settingsMenu = document.getElementById('settingsMenu');

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = settingsMenu.hidden;
  settingsMenu.hidden = !willOpen;
  settingsBtn.setAttribute('aria-expanded', String(willOpen));
});

document.addEventListener('click', (e) => {
  if (!settingsMenu.hidden && !settingsMenu.contains(e.target) && e.target !== settingsBtn) {
    settingsMenu.hidden = true;
    settingsBtn.setAttribute('aria-expanded', 'false');
  }
});

// ---------- Weekly availability ----------
const DAY_ABBR = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
const calendarBtn = document.getElementById('calendarBtn');
const availabilityModal = document.getElementById('availabilityModal');
const sprintDayPicker = document.getElementById('sprintDayPicker');
const gymDayPicker = document.getElementById('gymDayPicker');

let sprintDaysSelected = new Set();
let gymDaysSelected = new Set();

function renderDayPicker(container, selectedSet) {
  container.innerHTML = '';
  DAYS.forEach((day) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-chip' + (selectedSet.has(day) ? ' selected' : '');
    btn.textContent = DAY_ABBR[day];
    btn.addEventListener('click', () => {
      if (selectedSet.has(day)) selectedSet.delete(day); else selectedSet.add(day);
      btn.classList.toggle('selected');
    });
    container.appendChild(btn);
  });
}

calendarBtn.addEventListener('click', async () => {
  settingsMenu.hidden = true;

  // Open immediately with whatever we last had, so a slow/failed fetch
  // never leaves the button looking like it did nothing.
  renderDayPicker(sprintDayPicker, sprintDaysSelected);
  renderDayPicker(gymDayPicker, gymDaysSelected);
  availabilityModal.hidden = false;

  if (!currentUser) return;
  try {
    const weekKey = getWeekKey();
    const [{ data, error }, { data: season, error: seasonError }] = await Promise.all([
      supabaseClient.from('availability').select('*').eq('user_id', currentUser.id).eq('week_key', weekKey).maybeSingle(),
      supabaseClient.from('competition_seasons').select('*').eq('user_id', currentUser.id).maybeSingle(),
    ]);
    if (error) throw error;
    sprintDaysSelected = new Set((data && data.sprint_days) || []);
    gymDaysSelected = new Set((data && data.gym_days) || []);
    renderDayPicker(sprintDayPicker, sprintDaysSelected);
    renderDayPicker(gymDayPicker, gymDaysSelected);

    if (!seasonError && season) {
      document.getElementById('indoorStart').value = season.indoor_start || '';
      document.getElementById('indoorEnd').value = season.indoor_end || '';
      document.getElementById('outdoorStart').value = season.outdoor_start || '';
      document.getElementById('outdoorEnd').value = season.outdoor_end || '';
    }
  } catch (err) {
    console.error('Failed to load availability:', err);
  }
});

document.getElementById('closeAvailability').addEventListener('click', () => {
  availabilityModal.hidden = true;
});

availabilityModal.addEventListener('click', (e) => {
  if (e.target === availabilityModal) availabilityModal.hidden = true;
});

document.getElementById('saveAvailability').addEventListener('click', async () => {
  if (!currentUser) return;
  const weekKey = getWeekKey();
  const { error } = await supabaseClient.from('availability').upsert(
    {
      user_id: currentUser.id,
      week_key: weekKey,
      sprint_days: Array.from(sprintDaysSelected),
      gym_days: Array.from(gymDaysSelected),
    },
    { onConflict: 'user_id,week_key' }
  );
  if (error) {
    alert('Could not save availability: ' + error.message);
    return;
  }

  const { error: seasonError } = await supabaseClient.from('competition_seasons').upsert(
    {
      user_id: currentUser.id,
      indoor_start: document.getElementById('indoorStart').value || null,
      indoor_end: document.getElementById('indoorEnd').value || null,
      outdoor_start: document.getElementById('outdoorStart').value || null,
      outdoor_end: document.getElementById('outdoorEnd').value || null,
    },
    { onConflict: 'user_id' }
  );
  if (seasonError) {
    alert('Could not save competition season: ' + seasonError.message);
    return;
  }

  availabilityModal.hidden = true;
  await reapplyAvailabilityToSavedPlan();
  renderWeekBoard();
});

function hasLoggedData(row) {
  return !!(row.logged_result && Object.keys(row.logged_result).length)
    || !!(row.lift_log && Object.keys(row.lift_log).length);
}

// Availability changed, so shuffle the week that's already saved onto the
// days the athlete can now train. Anything they've already logged is left
// alone -- that session happened, on that day.
async function reapplyAvailabilityToSavedPlan() {
  if (!currentUser) return;
  const weekKey = getWeekKey();
  const [{ data: rows }, { data: avail }] = await Promise.all([
    supabaseClient.from('workouts').select('*').eq('user_id', currentUser.id),
    supabaseClient.from('availability').select('*').eq('user_id', currentUser.id).eq('week_key', weekKey).maybeSingle(),
  ]);
  if (!rows || !rows.length) return;

  const sprintDays = new Set((avail && avail.sprint_days) || []);
  const gymDays = new Set((avail && avail.gym_days) || []);
  if (!sprintDays.size && !gymDays.size) return;

  const byDay = {};
  rows.forEach((r) => { byDay[r.day] = r; });
  const current = DAYS.map((day) => {
    const r = byDay[day];
    return r
      ? { day, type: r.type, details: r.details, timed: r.timed, liftDetails: r.lift_details, loggedResult: r.logged_result, liftLog: r.lift_log }
      : { day, type: 'Rest Day', details: '' };
  });
  const locked = new Set(rows.filter(hasLoggedData).map((r) => r.day));

  const { plan, dropped } = reschedulePlan(current, sprintDays, gymDays, locked);
  lastPlanNote = describeDropped(dropped);

  const { error } = await supabaseClient.from('workouts').upsert(
    plan.map((entry) => ({
      user_id: currentUser.id,
      day: entry.day,
      type: entry.type,
      details: entry.details || '',
      timed: entry.timed || null,
      lift_details: entry.liftDetails || null,
      logged_result: entry.loggedResult || null,
      lift_log: entry.liftLog || null,
    })),
    { onConflict: 'user_id,day' }
  );
  if (error) console.error('Could not re-place the week:', error);
}

// ---------- Athlete profile ----------
const profileModal = document.getElementById('profileModal');

function scoreColor(score) {
  return { 1: '#e5484d', 2: '#f5a623', 3: '#f5d90a', 4: '#8bc34a', 5: '#2e7d32' }[score] || '#666';
}

async function renderProfile() {
  const content = document.getElementById('profileContent');
  content.innerHTML = '<p class="hint">Loading…</p>';

  const { data, error } = await supabaseClient
    .from('diagnosis_entries')
    .select('clip_type, analysis, created_at')
    .eq('user_id', currentUser.id)
    .not('analysis', 'is', null)
    .order('created_at', { ascending: false });

  if (error || !data || !data.length) {
    content.innerHTML = '<p class="hint">No analyzed clips yet.</p>';
    return;
  }

  // Most recent score wins per (clip type, pinpoint name) -- data is
  // already newest-first, so the first hit for a key is the latest one.
  const byType = {};
  data.forEach((entry) => {
    if (!entry.clip_type || !entry.analysis) return;
    (entry.analysis.pinpoints || []).forEach((p) => {
      if (typeof p.score !== 'number') return;
      byType[entry.clip_type] = byType[entry.clip_type] || {};
      if (!(p.name in byType[entry.clip_type])) {
        byType[entry.clip_type][p.name] = p.score;
      }
    });
  });

  const types = Object.keys(byType);
  if (!types.length) {
    content.innerHTML = '<p class="hint">No scored categories yet.</p>';
    return;
  }

  content.innerHTML = types
    .map(
      (type) => `
    <h3>${escapeHtml(type)}</h3>
    ${Object.entries(byType[type])
      .map(
        ([name, score]) => `
      <div class="profile-row">
        <div class="entry-top">
          <span>${escapeHtml(name)}</span>
          <span class="score-pill">${score}/5</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${(score / 5) * 100}%;background:${scoreColor(score)}"></div>
        </div>
      </div>
    `
      )
      .join('')}
  `
    )
    .join('');
}

document.getElementById('profileBtn').addEventListener('click', async () => {
  settingsMenu.hidden = true;
  profileModal.hidden = false;
  await renderProfile();
});

document.getElementById('closeProfile').addEventListener('click', () => {
  profileModal.hidden = true;
});

profileModal.addEventListener('click', (e) => {
  if (e.target === profileModal) profileModal.hidden = true;
});

function handleSession(session) {
  if (session && session.user) {
    currentUser = session.user;
    authGate.hidden = true;
    appShell.hidden = false;
    refreshAllData();
  } else {
    currentUser = null;
    authGate.hidden = false;
    appShell.hidden = true;
  }
}

supabaseClient.auth.getSession().then(({ data }) => handleSession(data.session));
supabaseClient.auth.onAuthStateChange((_event, session) => handleSession(session));

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function ytSearch(query) {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
}

// ---------- Tabs ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
});

async function refreshAllData() {
  renderWeekBoard();
  renderWeights();
  renderTimes();
  renderBigGoals();
  renderDiagnosis();
  renderFavorites();
  renderMotivationLinks();
  document.getElementById('newQuote').click();
}

// =====================================================
// FORM DIAGNOSIS
// =====================================================
let pendingBlob = null;

const videoUpload = document.getElementById('videoUpload');

videoUpload.addEventListener('change', () => {
  const file = videoUpload.files[0];
  if (file) pendingBlob = file;
});

// Pulls N evenly-spaced frames out of a video file as small JPEG data URLs,
// for sending to the analysis model. Runs entirely client-side (canvas).
// Waits for an event, but never hangs forever -- some mobile browsers
// silently skip firing 'seeked' (e.g. seeking to the same time twice), so
// every wait here has a timeout fallback that just moves on.
function waitForEvent(target, eventName, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      target.removeEventListener(eventName, onEvent);
      resolve();
    };
    const onEvent = () => finish();
    target.addEventListener(eventName, onEvent, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

// Waits for a video frame to actually be decoded/painted, not just for the
// 'seeked' event -- 'seeked' can fire slightly before a frame is available
// to copy into a canvas, which is how you get all-black captures.
function videoFramePainted(video, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // requestVideoFrameCallback isn't guaranteed to fire on a paused/seeking
    // video in every browser -- never leave this un-timed-out.
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(finish);
    } else {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    }
    setTimeout(finish, timeoutMs);
  });
}

// Scores a small greyscale thumbnail of a frame so we can tell "the athlete
// is running through this frame" from "empty track" or "black frame".
//   detail = how much is in the shot at all (a blank/blown-out frame is ~0)
//   motion = how much changed since the previous candidate (the athlete is
//            the thing that moves, so this is the strongest signal we get
//            without running a pose model)
function scoreThumbnail(gray, prevGray) {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const mean = sum / gray.length;

  let variance = 0;
  for (let i = 0; i < gray.length; i++) variance += (gray[i] - mean) ** 2;
  const detail = Math.sqrt(variance / gray.length);

  let motion = 0;
  if (prevGray) {
    let diff = 0;
    for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - prevGray[i]);
    motion = diff / gray.length;
  }
  return { detail, motion };
}

function toGrayscale(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

// Samples more frames than we need, then keeps the best one from each slice
// of the clip -- so we send frames with the athlete actually in them rather
// than the empty track at the start and the walk-back at the end. Frames
// stay in chronological order and spread across the clip; a frame with no
// content at all is dropped rather than sent.
function chooseBestFrames(candidates, count) {
  // Drop frames with nothing in them at all -- black, or blown out.
  let pool = candidates.filter((c) => c.detail > 8);
  if (pool.length < 3) pool = candidates.slice();

  // Then drop the static stretches: the empty track before the athlete
  // enters and after they've gone. Those frames are a real scene, so they
  // survive the detail check, but nothing moves in them. Keeping them
  // would spend tokens on pictures of an empty track.
  const peakMotion = pool.reduce((m, c) => Math.max(m, c.motion), 0);
  if (peakMotion > 0) {
    const active = pool.filter((c) => c.motion >= peakMotion * 0.25);
    if (active.length >= Math.min(count, 3)) pool = active;
  }

  if (pool.length <= count) return pool;

  const chosen = [];
  const bucketSize = pool.length / count;
  for (let b = 0; b < count; b++) {
    const slice = pool.slice(Math.floor(b * bucketSize), Math.floor((b + 1) * bucketSize));
    if (!slice.length) continue;
    chosen.push(slice.reduce((best, c) => (c.motion > best.motion ? c : best), slice[0]));
  }
  return chosen;
}

// =====================================================
// LOCAL FORM ANALYSIS (pose landmarks, no API, no cost)
// =====================================================
// Runs MediaPipe's pose model on the athlete's own device and scores the
// clip from joint geometry. Emits the same shape the AI path does
// ({ summary, pinpoints, flags, filming_note }) so rendering, storage and
// the Athlete Profile all work unchanged.
//
// Thresholds live here on purpose -- they're coaching judgement, not code,
// and they were measured from reference clips with this same model, so
// they're already in the units the model reports.

const POSE_LM = {
  nose: 0, lSho: 11, rSho: 12, lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28, lHeel: 29, rHeel: 30,
  // MediaPipe's foot_index landmarks. These were missing, which made
  // legMetrics read landmarks[undefined] and throw on every frame where
  // the heel was visible -- the throw was swallowed by the per-frame
  // catch in extractFrames, so every clip came back "No athlete detected".
  lToe: 31, rToe: 32,
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

// ---------- Framing: is the athlete big enough, and is this one shot? ----------
// Calibrated twice, by compositing a known-good athlete into a phone-shaped
// frame and re-measuring him.
//
// First: how much of the frame he has to cover. While he spans at least ~25%
// of frame height, every frame detects and the hip angle lands within ~8
// degrees of the full-size read -- that 8 degrees is the model's own noise
// floor, and it does not improve at higher render resolutions, because
// MediaPipe resizes to a fixed internal size regardless. Below 25% it comes
// apart fast: at 20% only 12 of 15 frames detect and the error triples to 26
// degrees; at 10%, one frame in fifteen.
//
// Second: whether cropping rescues him. It does, completely -- a padded crop
// around the athlete restored 15/15 detection at every size down to 7%, at
// that same ~8 degree floor. What matters is his SHARE of the picture, not
// its resolution, so cropping is the whole fix.
//
// Third: how few real pixels he can be made of. Shrinking the source video
// while keeping his share of it constant, measurement held to ~8 degrees
// down to about 110 pixels of athlete. Below roughly 90 there is no detail
// left to enlarge, and that is the one case worth refusing outright.
const SUBJECT_FRAC_MIN = 0.25;
const SUBJECT_PX_MIN = 90;
const CROP_PADDING = 2.2;
// A scroll between two videos, or a pull-down of the phone's control centre,
// registers as a frame-to-frame change several times larger than anything
// sprinting produces. Measured on the athlete's own uploads: normal running
// motion sat at the clip median, an Instagram scroll spiked 8-10x it, a
// control-centre pull 6.6x.
// Sampling. The scout pass only has to find the shot, the athlete and the
// framing, so it stays thin. The angles are measured by the dense pass over
// the strides that get graded -- about six samples per stride instead of two.
// Playing the clip and taking frames as the decoder delivers them, rather
// than seeking to each one. Measured: 95 seconds to analyse a 4-second clip,
// of which 94.7 was seek-and-decode and 0.3 was pose -- about 1.6 seconds per
// seek, because the decoder rebuilds a frame from scratch each time. Played
// back it hands them over continuously for nothing.
//
// Faster than real time where the decoder keeps up; it drops frames rather
// than lagging, and a dropped frame is just one we do not measure. The
// capture rate is what a stride needs -- about six samples across one.
const PLAYBACK_RATE = 2;
const CAPTURE_RATE = 30;

// The fallback path, for a browser without requestVideoFrameCallback. Slow,
// because it seeks, so it stays thin.
const SCOUT_RATE = 6;
const SCOUT_MIN_SAMPLES = 12;
const SCOUT_MAX_SAMPLES = 30;
const DENSE_RATE = 30;
const DENSE_WINDOW_S = 0.9;   // ~3 strides at sprint turnover
const DENSE_MAX_SAMPLES = 32;
// A cut has to clear BOTH a ratio against the clip's own median difference
// and an absolute floor. The ratio alone is not stable: it falls as the
// sweep thins (measured 8.7x at 10 samples/s, 6.3x at 6/s, because sparser
// frames differ more from each other), and the canvas resamples thumbnails
// differently than the offline harness does, which moves it again. The
// absolute floor sits well clear of ordinary running -- measured cuts came
// in at 39-60 against clip medians of 4.5-9.7.
const SHOT_CUT_RATIO = 4;
const SHOT_CUT_FLOOR = 20;
const MIN_SHOT_FRAMES = 8;
// MediaPipe clamps a landmark that leaves the picture to the frame edge, so
// an ankle pinned to the boundary is not a low foot -- it's a foot that isn't
// in shot. Grading ground contact off those invents touchdowns.
const EDGE_MARGIN = 0.02;
const MAX_EDGE_FRACTION = 0.4;

// Longest stretch of frames with no cut in it. Returns [start, end).
function longestShot(motions) {
  const usable = motions.filter((m) => m > 0);
  if (usable.length < 4) return [0, motions.length];
  const sorted = usable.slice().sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)] || 0;
  if (mid <= 0) return [0, motions.length];

  const cuts = [0];
  for (let i = 1; i < motions.length; i++) {
    if (motions[i] > mid * SHOT_CUT_RATIO && motions[i] >= SHOT_CUT_FLOOR) cuts.push(i);
  }
  cuts.push(motions.length);
  // Seeded with the first segment, not the whole clip -- seeding it with the
  // whole clip means no individual shot can ever beat it and nothing splits.
  let best = [cuts[0], cuts[1]];
  for (let i = 1; i < cuts.length - 1; i++) {
    if (cuts[i + 1] - cuts[i] > best[1] - best[0]) best = [cuts[i], cuts[i + 1]];
  }
  return best[1] - best[0] >= MIN_SHOT_FRAMES ? best : [0, motions.length];
}

// The box a set of landmarks occupies, normalized to the image they were
// measured in. Used to aim the next frame's crop.
function poseBounds(landmarks) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0, n = 0;
  for (let i = 0; i < landmarks.length; i++) {
    if ((landmarks[i].visibility ?? 1) < MIN_LANDMARK_CONFIDENCE) continue;
    const { x, y } = landmarks[i];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    n++;
  }
  return n >= 6 && x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

// How much of the frame the athlete's own body covers, how many real pixels
// that was, and whether his feet are inside the picture.
function framingCheck(metricsList) {
  const fracs = [];
  const pxs = [];
  let edge = 0;
  let counted = 0;
  metricsList.forEach((m) => {
    if (!m || !m.bodyFrac) return;
    fracs.push(m.bodyFrac);
    if (m.bodyPx) pxs.push(m.bodyPx);
    counted++;
    if (m.footAtEdge) edge++;
  });
  if (!counted) return { frac: null, px: null, edgeFraction: 0 };
  return { frac: median(fracs), px: pxs.length ? median(pxs) : null, edgeFraction: edge / counted };
}

// ---------- Who to grade, and when to refuse ----------
// Calibrated on reference clips sampled at ~13fps, then expressed per
// second so a different sample rate doesn't move the thresholds. Measured:
// a sprinting athlete 2.9/s, a standing bystander 1.2/s, and a skeleton
// jumping between runners in a pack 4.9/s -- limbs cannot really move that
// fast, so anything above the ceiling means the tracker lost the plot.
const MAX_PEOPLE_IN_FRAME = 3;
const MIN_TRACK_FRAMES = 8;
// Whatever the athlete filmed is what gets graded -- a short clip is not a
// reason to refuse, only a reason to say less about it. Each measure carries
// its own evidence requirement instead, so a clip that only supports posture
// reports posture and stays quiet about ground contact.
//
// Touchdown is the one that needed a real minimum. It was reporting from a
// single contact, and one bad contact put the foot strike 48% of a leg
// length BEHIND the hip -- impossible, and indistinguishable from a real
// score on the page. Two contacts is one full stride, the least that can be
// called a measurement rather than an instant.
const MIN_CONTACTS = 2;
// A touchdown can land a little behind the hip -- that is what good looks
// like -- but not half a leg length behind it. Beyond this the "contact" is
// not one: it is the lowest frame in a window where the foot never actually
// planted, and because the good end of the strike band is open, such a value
// scored 5/5. Garbage reading as perfect is worse than garbage reading as
// bad, so a strike outside the plausible range is dropped, not scored.
// A real touchdown puts the foot near its full reach below the hip -- about
// one leg length. Below this the "contact" is the lowest frame in a window
// where the foot never actually planted.
const CONTACT_DEPTH_MIN = 0.8;
// A planted foot cannot sit more than one leg length below the hip -- that is
// a fully straight leg, and legLen is measured along the limb so it is always
// at least the straight-line hip-to-ankle distance. Anything past this is not
// a contact at all: it is a flight frame that footContacts mistook for one.
// Measured across five clips, real touchdowns land at 0.75-1.03; the readings
// above this bound were 1.08, 1.16, 1.24 and 1.27, and they were what made
// Hip Height report a 48% collapse on a clip whose support was measurably
// stiff (5% settle per contact).
const CONTACT_DEPTH_MAX = 1.05;
// The ankle angle comes from the toe, the smallest and least stable landmark
// the model tracks. On one clip it moved 115, 126, 139, 129, 122, 94 across
// six consecutive frames a thirtieth of a second apart -- an ankle cannot do
// that, and the bands it is scored against are only ~13 degrees wide. When
// the contacts disagree by more than this the number is noise, and reporting
// it told an athlete his stiff ankle was collapsing.
const ANKLE_AGREEMENT_MAX = 25;

// How far the hips settle while the foot is on the ground, in leg lengths.
//
// The athlete's own suggestion, and a better signal than the ankle angle for
// the same thing: if the foot collapses the hip comes down with it, and the
// hip and knee are large stable landmarks where the toe is neither. It is
// also scale-free, so filming from further away does not move it -- which
// the ankle angle cannot claim.
//
// PROVISIONAL. Anchored on two clips only: a top-speed run settled 0.00 of a
// leg length across its contacts, an acceleration drive phase 0.09. Those sit
// the right way round -- contact at top speed is short and stiff, the drive
// phase is longer with more give -- but two clips is not a calibration, and
// the bands are deliberately coarse until there are more.
const SUPPORT_BANDS = [
  { min: -Infinity, max: 0.06, score: 5, note: 'Hips stay up through contact -- stiff support' },
  { min: 0.06, max: 0.12, score: 4, note: 'Hips settle slightly through contact' },
  { min: 0.12, max: 0.20, score: 3, note: 'Noticeable give through contact' },
  { min: 0.20, max: Infinity, score: 2, note: 'Support collapsing -- the hip drops onto the foot' },
];
// Contacts must agree before this is worth reporting, same as the ankle.
const SUPPORT_AGREEMENT_MAX = 0.09;
// A contact seen for fewer frames than this never showed the hip settle.
const SUPPORT_MIN_FRAMES = 2;
// How far the ankle may move and still count as planted, in leg lengths.
const FOOT_PLANTED_TOLERANCE = 0.12;
const STRIKE_PLAUSIBLE_MIN = -0.2;
const STRIKE_PLAUSIBLE_MAX = 0.8;
// How fast a sprinter's shape changes, measured with the fixed-gap method
// above so the numbers do not move with the sampling rate. Real tracks
// (tools/CALIBRATION.md):
//
//   drive phase, upright and turning over    3.22
//   fast run                                 4.14
//   runner inside a race pack                3.27
//   first steps out of the blocks            1.24
//   same athlete still set in the blocks     1.06
//   skeleton jumping between people          7.97
//
// The ceiling is the part that works: 6.0 sits clear above every real
// athlete measured and below a tracker that has lost the plot.
//
// The floor does much less than it looks like it does, and the numbers above
// say why. A block start legitimately changes shape slowly -- the first steps
// out of the blocks read 1.24, while the same athlete sitting motionless in
// the set position reads 1.06. Those are 17% apart, which is noise. This
// measure cannot tell "driving out of the blocks" from "not gone yet", so a
// floor placed to admit real starts cannot also exclude someone standing
// still. It is set to admit the athlete, because refusing a real block start
// is the worse error and the other guards -- track length, people count,
// subject size, feet in frame -- still apply.
//
// Nothing here is a substitute for a floor that understands the difference.
// Doing that properly needs the clip type, or a check on whether the hips
// travel rather than on how fast the limbs move.
// Frames this far apart are compared to measure motion; see trackMotionPerSec.
// Two sampled frames this alike are the same frame handed back twice.
const DUPLICATE_FRAME_MOTION = 0.35;
// Above this share of repeats, the clip was never really read, and any
// verdict about how the athlete moves would be a verdict about the decoder.
const DUPLICATE_SHARE_MAX = 0.4;
const MOTION_GAP_S = 0.1;
// A second track at least this share of the longest is a real second athlete,
// not a fragment broken off the first.
const SECOND_ATHLETE_SHARE = 0.6;
// How much of a candidate window has to be moving like a sprinter for it to
// be the stretch worth measuring.
const WINDOW_RUNNING_SHARE = 0.7;
const ATHLETE_MOTION_MIN = 0.9;
const ATHLETE_MOTION_MAX = 6.0;

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
function buildTracks(framePoses, secondsPerFrame) {
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
        best.hip = pose.sig.hip;
        best.lastFrame = fi;
        best.history.push({ fi, norm: pose.sig.norm });
        best.metrics.push(pose.metrics);
      } else {
        tracks.push({
          hip: pose.sig.hip, lastFrame: fi,
          history: [{ fi, norm: pose.sig.norm }],
          metrics: [pose.metrics],
        });
      }
    });
  });
  tracks.forEach((t) => { t.motionPerSec = trackMotionPerSec(t.history, secondsPerFrame); });
  return tracks;
}

// How fast the athlete's shape is changing, per second.
//
// Measured across pairs of frames a fixed TIME apart, not between adjacent
// samples. Adjacent-frame distance is signal/rate + tracker jitter, and the
// jitter does not shrink as the interval shortens, so multiplying by the rate
// leaves the jitter scaled by it -- the "per second" figure then moves with
// the sampling rate rather than with the athlete. Measured on one block
// start: 1.11/s sampled at 6/s and 2.61/s sampled at 30/s, the same runner in
// the same clip, straddling the floor that decides whether he is graded.
//
// Comparing frames ~MOTION_GAP_S apart divides a much larger real change by a
// known time, so the jitter is a small share of it at any sampling rate.
function trackMotionPerSec(history, secondsPerFrame) {
  if (!history || history.length < 2 || !(secondsPerFrame > 0)) return null;
  const gapFrames = Math.max(1, Math.round(MOTION_GAP_S / secondsPerFrame));
  const rates = [];
  for (let i = 0; i + gapFrames < history.length; i++) {
    const a = history[i];
    const b = history[i + gapFrames];
    const seconds = (b.fi - a.fi) * secondsPerFrame;
    if (seconds > 0) rates.push(signatureDistance(a.norm, b.norm) / seconds);
  }
  // Not enough span for a full gap: fall back to the widest pair available,
  // which is still a fixed time rather than one sample interval.
  if (!rates.length) {
    const a = history[0];
    const b = history[history.length - 1];
    const seconds = (b.fi - a.fi) * secondsPerFrame;
    return seconds > 0 ? signatureDistance(a.norm, b.norm) / seconds : null;
  }
  return median(rates);
}

// Splits a track wherever it stops describing the same body, and keeps the
// longest piece.
//
// Filtering frame by frame against their neighbours does not work, because
// once the athlete runs out of shot the tracker settles on the bystanders
// behind him and stays there -- a contiguous run of wrong frames is
// perfectly self-consistent. What gives it away is the seam: apparent body
// size steps, and the torso angle jumps further in one sample than a running
// body can rotate. On a real upload the seam was a torso going from 6 to 44
// degrees between consecutive samples, with the spectators at the rail
// graded as the athlete for the last eight frames.
const BODY_SIZE_STEP = 1.6;
const TORSO_STEP_DEG = 30;

function longestConsistentRun(metrics) {
  if (metrics.length < 6) return metrics;
  const sizeOf = (m) => (m && m.legs && m.legs.length ? median(m.legs.map((l) => l.legLen)) : null);

  const cuts = [0];
  for (let i = 1; i < metrics.length; i++) {
    const prevSize = sizeOf(metrics[i - 1]);
    const size = sizeOf(metrics[i]);
    const prevTorso = metrics[i - 1].torsoFromVertical;
    const torso = metrics[i].torsoFromVertical;
    const sizeJump = prevSize && size && Math.max(size / prevSize, prevSize / size) > BODY_SIZE_STEP;
    const torsoJump = prevTorso != null && torso != null && Math.abs(torso - prevTorso) > TORSO_STEP_DEG;
    if (sizeJump || torsoJump) cuts.push(i);
  }
  if (cuts.length === 1) return metrics;
  cuts.push(metrics.length);

  let best = [cuts[0], cuts[1]];
  for (let i = 1; i < cuts.length - 1; i++) {
    if (cuts[i + 1] - cuts[i] > best[1] - best[0]) best = [cuts[i], cuts[i + 1]];
  }
  const run = metrics.slice(best[0], best[1]);
  return run.length >= 5 ? run : metrics;
}

// Which stretch of the clip to measure.
//
// Two things have to be true at once, and picking either alone goes wrong.
// Measure where he is BIGGEST and a block start hands back the set position,
// because he is nearest the camera before he has gone anywhere. Measure where
// the tracked shape changes FASTEST and you get the far end of the clip,
// because a small distant body tracks noisily and noise looks like movement:
// on a relay run that put the graded window at 4.5-5.6 seconds, after the
// handoff, and returned 161 degrees of hip angle for a runner who measures 94
// during the run itself.
//
// So: among the stretches where he is moving like a sprinter, take the one
// where he is easiest to see. Size is a direct proxy for how much the
// measurement can be trusted, which is the whole argument of the framing
// work above.
//
// Every track gets searched, not just the longest one. Taking the longest
// looks reasonable and is exactly backwards: a stationary athlete is easy to
// follow, so a standing or set phase reliably produces the LONGEST track in
// the clip, while the sprint -- which moves fast enough to break association
// and be re-acquired -- comes back as a shorter one. On a block start that
// measured 61 frames of him set in the blocks (35% of frame, 1.32/s) against
// 44 frames of the actual run (45% of frame, 4.09/s), and graded the blocks.
// The size preference below would have chosen the run; it never saw it.
function bestWindow(framePoses, secondsPerFrame, maxFrames) {
  if (!(secondsPerFrame > 0)) return null;
  const tracks = buildTracks(framePoses, secondsPerFrame)
    .filter((t) => t.history.length >= MIN_TRACK_FRAMES);
  if (!tracks.length) return null;

  const gap = Math.max(1, Math.round(MOTION_GAP_S / secondsPerFrame));
  let best = null;

  // Two passes over every track: windows where he is moving like a sprinter,
  // and -- only if none of them are -- windows anywhere at all. Both passes
  // have to finish across all tracks before falling back, or a clip whose
  // first track never runs would settle for that track's best stretch while a
  // later track is running through the whole thing.
  const scan = (requireRunning) => {
    tracks.forEach((track) => {
      const n = track.history.length;
      const span = Math.max(MIN_TRACK_FRAMES, Math.min(maxFrames, n));
      if (span > n) return;

      // Local rate of change and local visibility, per position along the track.
      const rate = [];
      const size = [];
      for (let i = 0; i < n; i++) {
        const j = Math.min(n - 1, i + gap);
        const seconds = (track.history[j].fi - track.history[i].fi) * secondsPerFrame;
        const partial = track.metrics[i].bodyAtEdge || track.metrics[j].bodyAtEdge;
        rate.push(seconds > 0 && !partial
          ? signatureDistance(track.history[i].norm, track.history[j].norm) / seconds
          : null);
        size.push(track.metrics[i].bodyFrac || 0);
      }

      for (let start = 0; start + span <= n; start++) {
        const rates = rate.slice(start, start + span).filter((r) => r != null);
        let moving = null;
        if (requireRunning) {
          if (rates.length < span / 2) continue;
          // Most of the window has to be running, not just its middle value. A
          // median alone lets a window straddle a standing stretch and a running
          // one and still pass, which measures half of each.
          const inBand = rates.filter((r) => r >= ATHLETE_MOTION_MIN && r <= ATHLETE_MOTION_MAX);
          if (inBand.length < rates.length * WINDOW_RUNNING_SHARE) continue;
          moving = median(inBand);
        }
        const seen = median(size.slice(start, start + span));
        if (!best || seen > best.seen) best = { track, start, span, seen, moving };
      }
    });
  };

  scan(true);
  // Nothing anywhere met the movement test -- fall back to wherever he is
  // biggest, which is still the most measurable stretch on offer.
  if (!best) scan(false);
  if (!best) return null;

  const h = best.track.history;
  return {
    from: h[best.start].fi,
    to: h[Math.min(h.length - 1, best.start + best.span - 1)].fi,
    seen: best.seen,
  };
}

// Returns the frames belonging to the one athlete worth grading, or a
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

  const tracks = buildTracks(framePoses, secondsPerFrame)
    .filter((t) => t.metrics.length >= MIN_TRACK_FRAMES && t.motionPerSec != null)
    .map((t) => ({ metrics: t.metrics, motionPerSec: t.motionPerSec }));
  if (!tracks.length) {
    return { metrics: [], rejection: 'Could not follow anyone through this clip.' };
  }

  const running = tracks.filter((t) => t.motionPerSec >= ATHLETE_MOTION_MIN && t.motionPerSec <= ATHLETE_MOTION_MAX);
  // Two tracks in the band usually means one athlete whose track broke and
  // restarted, not two people racing. A real second athlete is followed for
  // about as long as the first; a fragment is much shorter. On one block
  // start the athlete came back as a 27-frame track plus a 9-frame stub, and
  // refusing that as "more than one athlete" would have been wrong.
  if (running.length > 1) {
    const longest = running.reduce((a, b) => (b.metrics.length > a.metrics.length ? b : a));
    const rivals = running.filter(
      (t) => t !== longest && t.metrics.length >= longest.metrics.length * SECOND_ATHLETE_SHARE
    );
    if (rivals.length) {
      return { metrics: [], rejection: 'More than one athlete is running here — grade one at a time.' };
    }
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

  let subject = running.reduce((a, b) => (b.metrics.length > a.metrics.length ? b : a));

  // Trim the track back to the stretch that is actually one body.
  subject = { metrics: longestConsistentRun(subject.metrics) };

  // Framing is checked last, on the athlete we actually settled on, and
  // against the picture pose was given -- which by this point is usually a
  // crop, so a distant athlete has already been rescued rather than refused.
  // What's left here is footage no crop can fix.
  const { frac, px, edgeFraction } = framingCheck(subject.metrics);
  // Two different ways of being too far away. A small share of the frame is
  // recoverable -- the extraction pass will already have tried cropping to
  // him -- but too few real pixels of athlete is not: there is no detail
  // left to enlarge, and any angle read off him is invented.
  if (px != null && px < SUBJECT_PX_MIN) {
    return {
      metrics: [],
      rejection: 'The athlete is too far away to measure — there isn\'t enough of him in the picture. Film closer.',
    };
  }
  if (frac != null && frac < SUBJECT_FRAC_MIN) {
    return {
      metrics: [],
      rejection: 'The athlete is too small in the frame to measure — film closer, or crop the clip to him before uploading.',
    };
  }
  if (edgeFraction > MAX_EDGE_FRACTION) {
    return {
      metrics: [],
      rejection: 'His feet leave the picture for much of this clip — ground contact can\'t be read. Keep the whole body in frame.',
    };
  }

  return { metrics: subject.metrics, rejection: null };
}

// ---------- Ground contact, and the checks that hang off it ----------
// Everything below is measured at touchdown, so touchdown has to be found
// first: the frames where a foot is at its lowest on screen.

// Where the foot lands relative to the hip, as a fraction of leg length.
// Positive means the foot touches down in front of the hip -- the further
// in front, the more braking. This is the overstriding measure.
const STRIKE_BANDS = [
  { min: -Infinity, max: 0.12, score: 5, note: 'Foot lands under the hips' },
  { min: 0.12, max: 0.22, score: 4, note: 'Foot lands slightly ahead of the hips' },
  { min: 0.22, max: 0.32, score: 3, note: 'Reaching -- foot landing ahead of the hips' },
  { min: 0.32, max: Infinity, score: 2, note: 'Overstriding badly -- braking on every step' },
];

// Ankle angle at touchdown. Under ~95 the toes are up and the foot is
// ready to be stiff; well over that it lands pointed and collapses.
const DORSI_BANDS = [
  { min: -Infinity, max: 95, score: 5, note: 'Toes up on landing' },
  { min: 95, max: 108, score: 4, note: 'Ankle close to neutral on landing' },
  { min: 108, max: 120, score: 3, note: 'Toes dropping before landing' },
  { min: 120, max: Infinity, score: 2, note: 'Landing toes-down -- no stiff platform' },
];

// How much the hips drop through the stride, as a fraction of leg length.
// This is the spread in hip height ACROSS the clip's touchdowns, not the
// settle within one contact -- Support Stiffness measures that. Worded to say
// so: the two read the same clip and can legitimately disagree, and the old
// wording ("hips collapsing through contact") claimed the other metric's
// subject and flatly contradicted it on the same card.
const SINK_BANDS = [
  { min: -Infinity, max: 0.08, score: 5, note: 'Hips ride at the same height every step' },
  { min: 0.08, max: 0.13, score: 4, note: 'Hip height varies a little between steps' },
  { min: 0.13, max: 0.2, score: 3, note: 'Hip height varies between steps' },
  { min: 0.2, max: Infinity, score: 2, note: 'Riding much lower on some steps than others' },
];

// Front swing vs back swing. 1.0 is balanced; below ~0.7 the leg is being
// left behind the body instead of cycling through.
// UNCALIBRATED -- not currently scored. See scoreSwingBalance.
//
// These bands were written when thighSwing was measured from the wrong pole
// and every value sat near 180 degrees. The measurement was fixed; these were
// not, and asking for near-parity turns out to ask the thigh to travel as far
// behind the body as it comes in front, which no sprinter does. Measured on
// four clips, the thigh reached 54-88 degrees in front and 23-29 behind --
// ratios of 0.27 to 0.43, all of which these bands call the worst score.
const BALANCE_BANDS = [
  { min: 0.85, max: Infinity, score: 5, note: 'Front and back swing balanced' },
  { min: 0.7, max: 0.85, score: 4, note: 'Slightly more backside than frontside' },
  { min: 0.55, max: 0.7, score: 3, note: 'Too much backside -- heel kicking out behind' },
  { min: -Infinity, max: 0.55, score: 2, note: 'Leg left behind -- long backside recovery' },
];

// A foot is on the ground when its ankle is within this much of its lowest
// point in the clip, measured in leg lengths.
const CONTACT_TOLERANCE = 0.06;

function footContacts(metrics, sideIndex) {
  const rows = metrics
    .map((m, i) => ({ i, leg: m.legs && m.legs[sideIndex], frameHipY: m.midHip ? m.midHip[1] : null }))
    .filter((r) => r.leg && r.frameHipY != null);
  if (rows.length < 4) return [];
  // How far the foot is below the athlete's own hip, in his own leg lengths.
  // Comparing raw image Y across frames instead means a camera that pans or
  // tilts decides where the ground is: on a hand-held upload it put every
  // "contact" in the first second and found none afterwards, which then took
  // hip height and ground contact down with it.
  const depth = (r) => (r.leg.ank[1] - r.frameHipY) / (r.leg.legLen || 1);
  const deepest = Math.max(...rows.map(depth));
  const down = rows.filter((r) => deepest - depth(r) < CONTACT_TOLERANCE);

  // Collapse runs of adjacent frames into one contact, keeping the lowest.
  const contacts = [];
  let run = [];
  down.forEach((r, k) => {
    if (k && r.i - down[k - 1].i > 2) { contacts.push(run); run = []; }
    run.push(r);
  });
  if (run.length) contacts.push(run);
  return contacts.map((g) => g.reduce((a, b) => (depth(b) > depth(a) ? b : a)));
}

// Two strides is both feet twice over -- enough to see left/right and a
// full cycle, without averaging over a whole run where the athlete is
// still accelerating. Trims to the window around the earliest strides.
function limitToStrides(metrics, strides = 3) {
  const contacts = [...footContacts(metrics, 0), ...footContacts(metrics, 1)]
    .map((c) => c.i)
    .sort((a, b) => a - b);
  if (contacts.length < 3) return metrics;
  const wanted = Math.min(contacts.length - 1, strides * 2);
  const from = contacts[0];
  const to = contacts[wanted];
  return metrics.slice(Math.max(0, from - 1), Math.min(metrics.length, to + 2));
}

function scoreGroundContact(metrics) {
  const facing = median(
    metrics.flatMap((m) => (m.legs || []).map((l) => l.facing)).filter((v) => v)
  ) || 1;

  const strikes = [];
  const dorsi = [];
  [0, 1].forEach((side) => {
    footContacts(metrics, side).forEach((c) => {
      const leg = c.leg;
      const row = metrics[c.i];
      if (!row || !row.midHip) return;
      // Only frames where the foot really is down. Otherwise this measures
      // whichever moment happened to be lowest, mid-flight included.
      const depth = (leg.ank[1] - row.midHip[1]) / (leg.legLen || 1);
      if (depth < CONTACT_DEPTH_MIN) return;
      strikes.push(((leg.ank[0] - row.midHip[0]) * facing) / leg.legLen);
      if (leg.footVsShin != null) dorsi.push(leg.footVsShin);
    });
  });

  const out = [];
  if (strikes.length >= MIN_CONTACTS) {
    const strike = median(strikes);
    if (strike >= STRIKE_PLAUSIBLE_MIN && strike <= STRIKE_PLAUSIBLE_MAX) {
      const band = bandFor(strike, STRIKE_BANDS);
      out.push({ name: 'Foot Strike vs Hips', score: band.score,
                 note: `${band.note} (${(strike * 100).toFixed(0)}% of leg length ahead)`, value: strike });
    }
  }
  // Only when the touchdowns agree. A spread wider than the bands themselves
  // means the toe landmark was wandering, not the ankle.
  if (dorsi.length >= MIN_CONTACTS &&
      Math.max(...dorsi) - Math.min(...dorsi) <= ANKLE_AGREEMENT_MAX) {
    const d = median(dorsi);
    const band = bandFor(d, DORSI_BANDS);
    out.push({ name: 'Ankle at Touchdown', score: band.score, note: `${band.note} (${d.toFixed(0)}°)`, value: d });
  }
  return out;
}

// How far the hips drop through the stride.
//
// Measured as the hip's height above the athlete's own lowest foot, in his
// own leg lengths -- both points read from the same frame, so it survives a
// camera that pans, tilts, or lets him change distance. The old version
// compared raw image Y across frames, which on a hand-held clip measures the
// camera operator rather than the athlete: a real upload came back with the
// hips "sinking" 227% of a leg length, which would put them underground.
function scoreHipSink(metrics) {
  const rows = metrics.filter((m) => m.midHip && m.legs && m.legs.length);
  if (rows.length < 5) return null;
  const legLen = median(rows.map((m) => median(m.legs.map((l) => l.legLen)))) || 1;
  // Only at touchdown. Off the ground the lowest foot is a recovering heel
  // somewhere behind him, not the track, so hip-above-foot swings wildly
  // through the flight phase and reads as a collapse that never happened.
  const contactRows = [...footContacts(metrics, 0), ...footContacts(metrics, 1)]
    .map((c) => metrics[c.i])
    .filter((m) => m && m.midHip && m.legs && m.legs.length);
  if (contactRows.length < 3) return null;
  const heights = contactRows.map((m) => {
    const lowestFoot = Math.max(...m.legs.map((l) => l.ank[1]));
    return (lowestFoot - m.midHip[1]) / (median(m.legs.map((l) => l.legLen)) || legLen);
  // Only the impossible end is filtered. A LOW reading is the hip actually
  // sinking, which is the whole measurement -- clipping that would delete the
  // fault this is here to find.
  }).filter((h) => h <= CONTACT_DEPTH_MAX);
  if (heights.length < 3) return null;
  // Percentiles, not min/max: one mistracked frame should not define the
  // athlete's whole range of hip height.
  const sorted = heights.slice().sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
  const sink = at(0.95) - at(0.05);
  const band = bandFor(sink, SINK_BANDS);
  return { name: 'Hip Height', score: band.score,
           note: `${band.note} (${(sink * 100).toFixed(0)}% of a leg length between the highest and lowest touchdown)`,
           value: sink };
}

// High knees on their own mean nothing -- an athlete can spin their legs
// quickly and go nowhere. This pairs the front swing against the back
// swing so turnover without range gets caught.
function scoreSwingBalance(metrics) {
  const facing = median(
    metrics.flatMap((m) => (m.legs || []).map((l) => l.facing)).filter((v) => v)
  ) || 1;
  const swings = metrics.flatMap((m) => (m.legs || []).map((l) => l.thighSwing * facing));
  if (swings.length < 6) return null;
  const front = Math.max(...swings);
  const back = Math.abs(Math.min(...swings));
  if (front <= 0 || back <= 0) return null;
  const ratio = Math.min(front, back) / Math.max(front, back);
  // Measured but not scored. Every athlete measured so far -- four clips,
  // three of them different phases of the same runner -- lands between 0.27
  // and 0.43, which these bands all call "leg left behind, 2/5". A number
  // that comes out the same for everyone is not telling the athlete
  // anything, and telling all of them their worst fault is one they may not
  // have is worse than staying quiet.
  //
  // What is missing is a reference for what front-to-back balance should be
  // in these terms. Until there is one this returns the measurement without
  // a score, so it can be gathered without being acted on.
  return { name: 'Front/Back Swing Balance', score: null, measured: true,
           note: `front ${front.toFixed(0)}°, back ${back.toFixed(0)}°`,
           ratio, front, back };
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
function legMetrics(pt, conf, midSho, hipI, kneeI, ankI, heelI, toeI) {
  if (![hipI, kneeI, ankI].every((i) => conf(i) >= MIN_LANDMARK_CONFIDENCE)) return null;
  const hip = pt(hipI), knee = pt(kneeI), ank = pt(ankI);
  const thighLen = Math.hypot(knee[0] - hip[0], knee[1] - hip[1]) || 1;
  const legLen = thighLen + (Math.hypot(ank[0] - knee[0], ank[1] - knee[1]) || 1);
  const footOk = conf(heelI) >= MIN_LANDMARK_CONFIDENCE && conf(toeI) >= MIN_LANDMARK_CONFIDENCE;
  const heel = pt(heelI), toe = pt(toeI);
  return {
    // `knee` is the joint's position; the ANGLE at it is kneeAngle below.
    // These were both called `knee` in one object literal, so the position
    // was silently overwritten by the angle and could not be read at all.
    hip, knee, ank, legLen,
    // Ankle vertex, rays to knee and toe. Standing neutral is about 90;
    // below that the toes are pulled up (dorsiflexed), above is pointed.
    footVsShin: footOk ? angleAt(knee, ank, toe) : null,
    // Which way the athlete faces, from the foot itself.
    facing: footOk ? Math.sign(toe[0] - heel[0]) : 0,
    // y grows downward, so knee above hip gives a positive rise. Used only
    // to find which frame is the peak, never scored on its own.
    rise: (hip[1] - knee[1]) / thighLen,
    // The angle the athlete described: torso against the front thigh.
    hipAngle: angleAt(midSho, hip, knee),
    // Thigh against shin. Its minimum across the swing is the heel fold.
    kneeAngle: angleAt(hip, knee, ank),
    // Signed thigh angle off straight-down: caller flips it so + is always in
    // front of the hip and - is behind. Drives the front/back balance check.
    //
    // Measured from DOWN, not up. y grows downward, so a leg hanging under
    // the hip has knee[1] > hip[1]; the old form put that near +/-180 and,
    // since a runner's knee is below his hip nearly all the time, the whole
    // metric sat at 180 and handed out a free 5/5 for "balanced".
    thighSwing: (Math.atan2(knee[0] - hip[0], knee[1] - hip[1]) * 180) / Math.PI,
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
    legMetrics(pt, conf, midSho, POSE_LM.lHip, POSE_LM.lKnee, POSE_LM.lAnk, POSE_LM.lHeel, POSE_LM.lToe),
    legMetrics(pt, conf, midSho, POSE_LM.rHip, POSE_LM.rKnee, POSE_LM.rAnk, POSE_LM.rHeel, POSE_LM.rToe),
  ].filter(Boolean);
  const lead = legs.length ? legs.reduce((a, b) => (b.rise > a.rise ? b : a)) : null;

  // Framing, read off the same landmarks: how tall the athlete stands in
  // this image, and whether either foot is pinned to its edge. Both are in
  // the coordinates of whatever was handed to pose -- the full frame, or a
  // crop of it -- which is exactly the picture the model actually saw.
  const ys = [];
  const xs = [];
  for (let i = 0; i < landmarks.length; i++) {
    if (conf(i) < MIN_LANDMARK_CONFIDENCE) continue;
    const [x, y] = pt(i);
    xs.push(x / width);
    ys.push(y / height);
  }
  const bodyFrac = ys.length >= 6 ? Math.max(...ys) - Math.min(...ys) : null;
  // Any part of him touching the boundary means we are looking at a partial
  // body. Its apparent size is meaningless, so it must not be used to size a
  // crop or to judge how fast he is moving.
  const bodyAtEdge = xs.length >= 6 && (
    Math.min(...xs) <= EDGE_MARGIN || Math.max(...xs) >= 1 - EDGE_MARGIN ||
    Math.min(...ys) <= EDGE_MARGIN || Math.max(...ys) >= 1 - EDGE_MARGIN
  );
  const footAtEdge = [POSE_LM.lAnk, POSE_LM.rAnk, POSE_LM.lToe, POSE_LM.rToe].some((i) => {
    if (conf(i) < MIN_LANDMARK_CONFIDENCE) return false;
    const [x, y] = pt(i);
    const nx = x / width;
    const ny = y / height;
    return nx <= EDGE_MARGIN || nx >= 1 - EDGE_MARGIN || ny <= EDGE_MARGIN || ny >= 1 - EDGE_MARGIN;
  });

  return {
    bodyFrac,
    bodyAtEdge,
    footAtEdge,
    torsoFromVertical: torsoOk ? angleFromVertical(midHip, midSho) : null,
    scissor: scissorOk ? angleAt(pt(POSE_LM.lKnee), midHip, pt(POSE_LM.rKnee)) : null,
    thighRise: lead ? lead.rise : null,
    hipAngle: lead ? lead.hipAngle : null,
    leadKnee: lead ? lead.kneeAngle : null,
    // The tightest fold available this frame, across both legs.
    kneeFold: legs.length ? Math.min(...legs.map((l) => l.kneeAngle)) : null,
    legs,
    midHip,
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
// Torso lean when there isn't enough run to watch it change.
//
// Acceleration is normally scored on the PROGRESSION -- the torso rising
// smoothly from the drive out to upright. Over one stride there is no
// progression to see, and scoring one anyway punishes the athlete for the
// length of his clip: a first step held at 65 degrees came back "body angle
// barely changed, 2/5" when 65 degrees off vertical on the first step is
// what a good drive looks like.
//
// So when the clip is too short for a progression, the POSITION is scored
// instead. Anchored on the elite acceleration references measured earlier,
// which came out of the blocks at 68 and 59 degrees and were upright by 6.
const DRIVE_BANDS = [
  { min: 45, max: 78, score: 5, note: 'Strong forward drive angle' },
  { min: 78, max: Infinity, score: 4, note: 'Very low -- driving hard, watch for over-reaching' },
  { min: 35, max: 45, score: 4, note: 'Good lean, coming up out of the drive' },
  { min: 25, max: 35, score: 3, note: 'Mid-acceleration lean' },
  { min: -Infinity, max: 25, score: 2, note: 'Already upright -- little drive angle left' },
];

// A progression needs both enough strides to see one and enough run for the
// torso to have actually travelled.
const PROGRESSION_MIN_STRIDES = 3;

function scoreDrivePosition(metrics) {
  const series = metrics.map((m) => m.torsoFromVertical).filter((v) => v != null);
  if (series.length < 3) return null;
  const lean = median(series);
  const band = bandFor(lean, DRIVE_BANDS);
  return {
    name: 'Drive Position',
    score: band.score,
    note: `${band.note} (torso ${lean.toFixed(0)}° from vertical)`,
    value: lean,
  };
}

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
function scoreConsistency(metrics) {
  const values = metrics.map((m) => m.scissor);
  const half = Math.floor(values.length / 2);
  const first = values.slice(0, half).filter((v) => v != null);
  const second = values.slice(half).filter((v) => v != null);
  if (!first.length || !second.length) return null;

  const peakFirst = Math.max(...first);
  const peakSecond = Math.max(...second);
  const lost = peakFirst - peakSecond;

  if (lost <= 3) {
    return { name: 'Smoothness / Consistency', score: 5, note: 'Held form to the end of the rep' };
  }
  if (lost <= 8) {
    return { name: 'Smoothness / Consistency', score: 4, note: `Slight fade late (-${lost.toFixed(0)}°)` };
  }
  return { name: 'Smoothness / Consistency', score: 2, note: `Form dropped off under fatigue (-${lost.toFixed(0)}°)` };
}

// Assembles the same JSON the AI path returns, so nothing downstream cares
// which engine produced it.
// How folded the leg is at the instant it swings through under the hip.
//
// The athlete's coaching point, and his coach's: backside mechanics are not
// the enemy and frontside are not the hero -- you get both. So the question
// is not how far the thigh travels each way, which is what the old front/back
// ratio asked and why it scored every athlete the same. It is whether the leg
// has GATHERED by the time it has to travel. A short pendulum swings fast; a
// long one swings slow, for the same effort.
//
// Measured from a slow-motion top-speed clip of Bolt: 62 and 81 degrees at
// passing, both confirmed by eye with the heel tucked under him. The
// athlete's own clips read 108-113 at the same instant.
const PASSING_BANDS = [
  { min: -Infinity, max: 85, score: 5, note: 'Leg gathered as it swings through' },
  { min: 85, max: 100, score: 4, note: 'Folding well, a touch late' },
  { min: 100, max: 115, score: 3, note: 'Folding late -- long lever coming through' },
  { min: 115, max: Infinity, score: 2, note: 'Leg still long as it passes under the hip' },
];
// The stance leg crosses vertical every stride too, as the body rotates over
// a planted foot, and it is nearly straight there -- 152 and 160 degrees on
// the reference clip. Only a foot clearly off the ground is a recovery.
const PASSING_FOOT_MAX_DEPTH = 0.6;
// Passing moments are a stride apart. Crossings bunched closer than this are
// the tracker flickering, not strides -- three inside 0.16s on the reference.
const PASSING_MIN_GAP_S = 0.12;
const PASSING_AGREEMENT_MAX = 35;

function passingFolds(metrics) {
  const facing = median(
    metrics.flatMap((m) => (m.legs || []).map((l) => l.facing)).filter((v) => v)
  ) || 1;
  const found = [];
  [0, 1].forEach((side) => {
    for (let i = 1; i < metrics.length; i++) {
      const prev = metrics[i - 1].legs && metrics[i - 1].legs[side];
      const cur = metrics[i].legs && metrics[i].legs[side];
      if (!prev || !cur || !metrics[i].midHip) continue;
      const before = prev.thighSwing * facing;
      const after = cur.thighSwing * facing;
      if (!(before < 0 && after >= 0)) continue;      // thigh swinging through vertical
      const depth = (cur.ank[1] - metrics[i].midHip[1]) / (cur.legLen || 1);
      if (depth > PASSING_FOOT_MAX_DEPTH) continue;   // that is the stance leg
      if (cur.kneeAngle == null) continue;
      found.push({ t: metrics[i].t, fold: cur.kneeAngle });
    }
  });
  found.sort((a, b) => (a.t || 0) - (b.t || 0));
  // Drop crossings that arrive too soon after the last one.
  const spaced = [];
  found.forEach((f) => {
    const last = spaced[spaced.length - 1];
    if (!last || f.t == null || last.t == null || f.t - last.t >= PASSING_MIN_GAP_S) spaced.push(f);
  });
  return spaced.map((f) => f.fold);
}

function scorePassingPosition(metrics) {
  const folds = passingFolds(metrics);
  if (folds.length < 2) return null;
  if (Math.max(...folds) - Math.min(...folds) > PASSING_AGREEMENT_MAX) return null;
  const fold = median(folds);
  const band = bandFor(fold, PASSING_BANDS);
  return {
    name: 'Passing Position',
    score: band.score,
    note: `${band.note} (knee ${fold.toFixed(0)}° as it passes under the hip)`,
    value: fold,
  };
}

// How far the hips settle while the foot is planted, per contact.
//
// Followed only while that foot is STILL down: running past toe-off measures
// the leg swinging through rather than the hip settling, which produced drops
// of half a leg length on footage where the real figure was near zero.
function supportDrops(metrics) {
  const drops = [];
  [0, 1].forEach((side) => {
    footContacts(metrics, side).forEach((c) => {
      const row = metrics[c.i];
      if (!row || !row.midHip) return;
      const height = (m, leg) => (leg.ank[1] - m.midHip[1]) / (leg.legLen || 1);
      const at = height(row, c.leg);
      if (at < CONTACT_DEPTH_MIN || at > CONTACT_DEPTH_MAX) return;
      // Follow the FOOT, not the hip height, to know when the contact ends.
      // Hip height falls both when the support collapses and when the foot
      // lifts off, so stopping on it cuts the measurement off exactly when
      // the collapse is worst -- a hip dropping a quarter of a leg length
      // came back as an eighth. A planted ankle stays put; at toe-off it
      // rises. Over the three or four frames of a contact the camera cannot
      // move far enough to confuse the two.
      const plantedY = c.leg.ank[1];
      let lowest = at;
      let held = 0;
      for (let j = c.i; j < Math.min(metrics.length, c.i + 5); j++) {
        const leg = metrics[j].legs && metrics[j].legs[side];
        if (!leg || !metrics[j].midHip) break;
        if (Math.abs(leg.ank[1] - plantedY) / (leg.legLen || 1) > FOOT_PLANTED_TOLERANCE) break;
        lowest = Math.min(lowest, height(metrics[j], leg));
        held++;
      }
      if (held >= SUPPORT_MIN_FRAMES) drops.push(at - lowest);
    });
  });
  return drops;
}

function scoreSupportStiffness(metrics) {
  const drops = supportDrops(metrics);
  if (drops.length < MIN_CONTACTS) return null;
  if (Math.max(...drops) - Math.min(...drops) > SUPPORT_AGREEMENT_MAX) return null;
  const drop = median(drops);
  const band = bandFor(drop, SUPPORT_BANDS);
  return {
    name: 'Support Stiffness',
    score: band.score,
    note: `${band.note} (hips drop ${(drop * 100).toFixed(0)}% of a leg length)`,
    value: drop,
  };
}

// How many strides the graded frames actually cover: each foot touching down
// once is one stride.
function stridesMeasured(metrics) {
  const contacts = footContacts(metrics, 0).length + footContacts(metrics, 1).length;
  return contacts / 2;
}

function buildLocalAnalysis(allMetrics, clipType, surface) {
  // Grade a few strides, not the whole run -- over a long clip the athlete
  // is still changing gear, and averaging across that hides both faults.
  const metrics = limitToStrides(allMetrics);
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
    // Only judge the rise when there is enough of the run to see it rise.
    const accel = stridesMeasured(metrics) >= PROGRESSION_MIN_STRIDES
      ? scoreAcceleration(metrics)
      : scoreDrivePosition(metrics);
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
    // Anchored on a top-speed reference, so it is only asked of top-speed
    // running. During acceleration the leg legitimately stays longer through
    // the swing and the same numbers would read as a fault.
    const passing = scorePassingPosition(metrics);
    if (passing) {
      pinpoints.push({ name: passing.name, score: passing.score, note: passing.note });
      if (passing.value > 115) {
        flags.push('Leg is still long as it swings through -- it gathers after the moment it helps');
      }
    }
    const balance = scoreSwingBalance(metrics);
    if (balance && balance.score != null) {
      pinpoints.push({ name: balance.name, score: balance.score, note: balance.note });
    }
    if (balance) {
      // This comparison stands on its own: it needs no band, only the two
      // numbers, and a thigh travelling further behind than in front is a
      // fault whatever the right ratio turns out to be.
      if (balance.back > balance.front * 1.4) {
        flags.push('Kicking too far back -- backside recovery is longer than the front side');
      }
    }
    if (clipType === 'Speed Endurance') {
      const consistency = scoreConsistency(metrics);
      if (consistency) pinpoints.push(consistency);
    }
  }

  // Support stiffness and the ankle angle are two readings of the same
  // thing -- whether the foot holds its shape under load -- and the hip-based
  // one is measured from landmarks the model actually tracks well. When it is
  // available the toe-based angle is not also shown: it disagreed with the
  // athlete on his own footage, and two numbers for one property, one of them
  // known to be shaky, is worse than one.
  const support = scoreSupportStiffness(metrics);
  if (support) pinpoints.push(support);
  scoreGroundContact(metrics).forEach((p) => {
    if (support && p.name === 'Ankle at Touchdown') return;
    pinpoints.push({ name: p.name, score: p.score, note: p.note });
    if (p.name === 'Foot Strike vs Hips' && p.value > 0.32) {
      flags.push(clipType === 'Acceleration'
        ? 'Overstriding out of the start -- reaching instead of pushing the ground back'
        : 'Overstriding -- the foot is landing well in front of the hips');
    }
    if (p.name === 'Ankle at Touchdown' && p.value > 120) {
      flags.push('Landing with the toes down -- the foot has no stiff platform to push from');
    }
  });
  const sink = scoreHipSink(metrics);
  if (sink) {
    pinpoints.push({ name: sink.name, score: sink.score, note: sink.note });
    if (sink.value > 0.2) flags.push('Hips sinking through contact');
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
  const strides = stridesMeasured(metrics);
  // Say what the score rests on. A grade off one stride is a real reading of
  // one stride, not a weaker version of a grade off four, and the athlete
  // should be able to tell the difference at a glance.
  const basis = strides >= 1
    ? `Measured over ${strides < 2 ? 'about 1' : Math.round(strides)} stride${strides < 2 ? '' : 's'}.`
    : 'Measured over less than a full stride — treat this as a snapshot.';
  return {
    summary,
    pinpoints,
    flags,
    strides,
    basis,
    filming_note: readRate < 0.6
      ? 'Only part of the clip was readable -- film side-on with the full body in frame.'
      : null,
  };
}

// ---------- MediaPipe loader (device-side, downloaded once then cached) ----------
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const POSE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
let poseLandmarkerPromise = null;

function getPoseLandmarker() {
  if (!poseLandmarkerPromise) {
    poseLandmarkerPromise = (async () => {
      const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
      const fileset = await vision.FilesetResolver.forVisionTasks(POSE_WASM_URL);
      return vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numPoses: 4,
      });
    })().catch((err) => {
      poseLandmarkerPromise = null; // let a later attempt retry
      throw err;
    });
  }
  return poseLandmarkerPromise;
}

// Stored clips are the app's dominant storage cost -- they're 20-30MB each
// and accumulate forever, while an analysis is a few hundred bytes. After
// the retention window the video file is dropped and the entry keeps its
// scores, so history survives and storage stops growing without bound.
const VIDEO_RETENTION_DAYS = 30;

async function purgeExpiredVideos() {
  if (!currentUser) return;
  const cutoff = new Date(Date.now() - VIDEO_RETENTION_DAYS * 86400000).toISOString();
  const { data, error } = await supabaseClient
    .from('diagnosis_entries')
    .select('id, video_path')
    .eq('user_id', currentUser.id)
    .not('video_path', 'is', null)
    .lt('created_at', cutoff);
  if (error || !data || !data.length) return;

  const { error: removeError } = await supabaseClient.storage
    .from('diagnosis-videos')
    .remove(data.map((e) => e.video_path));
  // Only forget the path once the file is actually gone, so a failed
  // delete doesn't orphan the file with nothing left pointing at it.
  if (removeError) { console.error('Could not expire old clips:', removeError); return; }

  await supabaseClient
    .from('diagnosis_entries')
    .update({ video_path: null })
    .in('id', data.map((e) => e.id));
}

// Re-encode a clip down before it goes into storage.
//
// Storage is the free tier's real ceiling, not egress: clips average 9.5MB
// straight off the phone, and at a few a day the 1GB limit arrives in about
// five weeks. Nothing is lost by shrinking them -- the grader downsamples to
// 480px internally, so the measurements are identical either way, and this is
// only about what gets kept for the athlete to watch back.
//
// Analysis runs on the ORIGINAL blob, before this. Only the stored copy is
// re-encoded.
//
// Every failure path returns the original file. A save must never break
// because the compressor could not run: MediaRecorder and captureStream
// support varies across browsers and iOS versions, and an unwatchable clip is
// a far worse outcome than a large one.
const COMPRESS_MAX_EDGE = 720;
const COMPRESS_BITRATE = 1_500_000;
const COMPRESS_MIN_BYTES = 3 * 1024 * 1024;   // below this, not worth the wait
const COMPRESS_TIMEOUT_MS = 90_000;

function compressorMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  // Safari records mp4; everything else webm. Ask in preference order and let
  // the browser say what it can actually write.
  const types = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || null;
}

async function compressForStorage(blob, onProgress) {
  if (!blob || blob.size < COMPRESS_MIN_BYTES) return { blob, note: 'left as-is' };
  const mimeType = compressorMimeType();
  const video = document.createElement('video');
  if (!mimeType || typeof video.captureStream !== 'function'
      && typeof document.createElement('canvas').captureStream !== 'function') {
    return { blob, note: 'compression unavailable on this browser' };
  }

  const url = URL.createObjectURL(blob);
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-10000px;width:1px;height:1px;';
  document.body.appendChild(video);

  try {
    await waitForEvent(video, 'loadedmetadata', 6000);
    if (!isFinite(video.duration) || video.duration <= 0) return { blob, note: 'unreadable duration' };

    const longest = Math.max(video.videoWidth, video.videoHeight);
    if (!longest) return { blob, note: 'no video track' };
    const scale = Math.min(1, COMPRESS_MAX_EDGE / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx2d = canvas.getContext('2d');
    if (typeof canvas.captureStream !== 'function') return { blob, note: 'canvas capture unavailable' };

    // Recorded in real time, so the clip plays back at its true speed. Running
    // the video faster would shorten the recording and speed up the result --
    // useless for watching your own mechanics back.
    const stream = canvas.captureStream();
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: COMPRESS_BITRATE });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    let painting = true;
    const paint = () => {
      if (!painting) return;
      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
      requestAnimationFrame(paint);
    };

    recorder.start();
    video.currentTime = 0;
    await video.play();
    paint();
    if (onProgress) onProgress('Shrinking clip for storage…');

    await Promise.race([
      waitForEvent(video, 'ended', Math.min(COMPRESS_TIMEOUT_MS, video.duration * 1000 + 5000)),
      new Promise((r) => setTimeout(r, COMPRESS_TIMEOUT_MS)),
    ]);
    painting = false;
    if (recorder.state !== 'inactive') recorder.stop();
    await done;

    const out = new Blob(chunks, { type: mimeType.split(';')[0] });
    // A "compressed" file that came back bigger, or suspiciously tiny, means
    // the recording went wrong. Keep the original.
    if (!out.size || out.size >= blob.size || out.size < 20000) {
      return { blob, note: `re-encode gave ${Math.round(out.size / 1024)}KB, kept original` };
    }
    return { blob: out, note: `${Math.round(blob.size / 1024 / 1024 * 10) / 10}MB to ${Math.round(out.size / 1024 / 1024 * 10) / 10}MB` };
  } catch (e) {
    return { blob, note: 'compression failed: ' + (e && e.message ? e.message : e) };
  } finally {
    try { video.pause(); } catch (e) { /* already gone */ }
    document.body.removeChild(video);
    URL.revokeObjectURL(url);
  }
}

// Files in the bucket with no entry pointing at them.
//
// The retention purge walks entries, so a file that never got a row is
// invisible to it and would sit there for good. They come from anything that
// interrupted a save between the upload and the insert -- a closed tab, a
// dropped connection. Reordering the save (analyse, then upload, then insert,
// removing the file if the insert fails) closes the window; this clears what
// is already there, and catches the case where the tab dies mid-save.
//
// Deliberately compares against ALL of the athlete's entries rather than a
// date range: a file is orphaned or it is not, and the only safe test is that
// nothing references it.
const ORPHAN_GRACE_MS = 10 * 60 * 1000;

async function purgeOrphanedVideos() {
  if (!currentUser) return;
  const { data: files, error: listError } = await supabaseClient.storage
    .from('diagnosis-videos')
    .list(currentUser.id, { limit: 1000 });
  if (listError || !files || !files.length) return;

  const { data: rows, error: rowError } = await supabaseClient
    .from('diagnosis_entries')
    .select('video_path')
    .eq('user_id', currentUser.id)
    .not('video_path', 'is', null);
  // A failed read here would make every file look unreferenced. Never delete
  // on a query that did not come back.
  if (rowError || !rows) return;

  const referenced = new Set(rows.map((r) => r.video_path));
  // A file uploaded seconds ago may simply be a save still in flight -- its
  // row is written after the upload, and a render in another tab (or this
  // one, on the way back from the save) would otherwise catch it in that
  // window and delete the clip out from under a save that then succeeds.
  // Nothing is a genuine orphan until it has had time to get its row.
  const settled = Date.now() - ORPHAN_GRACE_MS;
  const orphans = files
    .filter((f) => {
      const at = Date.parse(f.created_at || f.updated_at || '');
      return !isFinite(at) || at < settled;
    })
    .map((f) => `${currentUser.id}/${f.name}`)
    .filter((p) => !referenced.has(p));
  if (!orphans.length) return;

  const { error: removeError } = await supabaseClient.storage
    .from('diagnosis-videos')
    .remove(orphans);
  if (removeError) console.error('Could not clear orphaned clips:', removeError);
}

// A small still for the history list, stored in the entry row.
//
// The frame is already in hand from the analysis pass at 480px; this is only
// a downscale. 240px at quality 0.5 lands around 10KB, which is the whole
// point -- the alternative is letting the browser draw its own poster from
// the <video>, and a phone clip puts its index at the end of the file, so
// that costs most of a 20-30MB download per entry shown.
const THUMB_WIDTH = 240;
const THUMB_QUALITY = 0.5;

function makeThumb(dataUrl) {
  if (!dataUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, THUMB_WIDTH / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
      } catch (e) {
        resolve(null);   // a preview is never worth failing a save over
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// supabase-js reports any non-2xx from an Edge Function as the same opaque
// "non-2xx status code" message, with the real body hidden on .context.
// Dig the server's own message out so the athlete sees "Daily limit
// reached" rather than an HTTP grumble.
async function readFunctionError(err) {
  try {
    if (err && err.context && typeof err.context.json === 'function') {
      const body = await err.context.json();
      if (body && body.error) return body.error;
    }
  } catch {
    // fall through to the generic message
  }
  return (err && err.message) || String(err);
}

async function extractFrames(videoBlob, count = 6, maxEdge = 480, onProgress = () => {}) {
  // The pose model is optional: if it can't load (offline, blocked CDN) the
  // clip is still extracted, just without measurements.
  let landmarker = null;
  try {
    onProgress('Loading pose model…');
    landmarker = await getPoseLandmarker();
  } catch (err) {
    console.warn('Pose model unavailable, continuing without measurements:', err);
  }

  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  // Some mobile browsers won't reliably decode frames for a <video> that's
  // never attached to the page -- and some skip decoding entirely for
  // opacity:0/zero-size elements as a perf optimization. Placed off-screen
  // instead, at a real size, so it's "visible" as far as decode is concerned.
  video.style.cssText = 'position:fixed;top:0;left:-10000px;width:320px;height:240px;pointer-events:none;';
  document.body.appendChild(video);

  try {
    onProgress('Reading video metadata…');
    await waitForEvent(video, 'loadedmetadata', 4000);
    if (video.readyState < 2) {
      onProgress('Waiting for video data…');
      await waitForEvent(video, 'loadeddata', 4000);
    }

    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) {
      throw new Error('Video has no readable duration (readyState=' + video.readyState + ')');
    }

    // Scale by the LONGEST edge, not the width. Scaling by width alone left
    // a portrait phone clip at 480x853 -- more than 3x the pixels of the
    // same cap applied to landscape, and image cost scales with pixel area.
    const longestEdge = Math.max(video.videoWidth, video.videoHeight) || maxEdge;
    const scale = Math.min(1, maxEdge / longestEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale) || maxEdge;
    canvas.height = Math.round(video.videoHeight * scale) || maxEdge;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // A tiny greyscale copy of each frame, used only for scoring.
    const thumb = document.createElement('canvas');
    thumb.width = 48;
    thumb.height = Math.max(1, Math.round(48 * (canvas.height / canvas.width)));
    const thumbCtx = thumb.getContext('2d', { willReadFrequently: true });

    // The crop handed to pose. Kept at the same budget as the full frame, so
    // cropping spends nothing extra -- it just spends the pixels on the
    // athlete instead of on the track and the phone UI around him.
    const poseCanvas = document.createElement('canvas');
    const poseCtx = poseCanvas.getContext('2d', { willReadFrequently: true });

    // Seeking can quietly fail to land. Both waits below resolve on timeout
    // rather than hanging, which is right, but it means a slow decode leaves
    // the PREVIOUS frame on screen and we measure that instead. Sample enough
    // repeats and the athlete stops appearing to move at all -- which reads,
    // wrongly, as nobody in the clip moving like a sprinter.
    const seekTo = async (t) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        video.currentTime = t;
        await waitForEvent(video, 'seeked', 2000);
        await videoFramePainted(video);
        // A frame's worth of tolerance: the decoder lands on the nearest one
        // it has, not exactly where it was asked.
        if (Math.abs(video.currentTime - t) < 0.06) return;
      }
    };

    const candidates = [];
    let prevGray = null;
    let cropped = 0;
    let duplicates = 0;
    let sampled = 0;
    // Where the athlete was last seen, normalized to the full video frame,
    // and how big the crop aimed at him was.
    let lastBox = null;
    let cropSidePx = 0;

    // Walks a list of timestamps, measuring each one. Used twice: once
    // spread over the whole clip, once packed into the few strides that get
    // graded.
    // Plays the clip once and processes frames as the decoder delivers them.
    //
    // Seeking is the entire cost of an analysis: measured at 95 seconds for a
    // 4-second clip, of which 94.7 was seek-and-decode and 0.3 was pose. Each
    // seek costs about 1.6 seconds because the decoder has to find and build
    // a frame from scratch; played back, it hands them over continuously for
    // nothing. The work per frame is identical -- only the way frames arrive
    // changes.
    //
    // Needs requestVideoFrameCallback to know which frame it is looking at.
    // Without it there is no way to timestamp a painted frame, so the seeking
    // path stays as the fallback.
    const canPlayThrough = typeof video.requestVideoFrameCallback === 'function';

    const playThrough = (onFrame, targetRate, label) => new Promise((resolve) => {
      const minGap = 1 / targetRate;
      let last = -Infinity;
      let stop = false;
      const finish = () => { if (!stop) { stop = true; video.pause(); resolve(); } };
      video.addEventListener('ended', finish, { once: true });
      // Never let a stalled decoder hang the analysis.
      const guard = setTimeout(finish, Math.max(8000, (duration / video.playbackRate) * 3000));
      const onTick = (now, meta) => {
        if (stop) return;
        const t = meta && meta.mediaTime != null ? meta.mediaTime : video.currentTime;
        if (t - last >= minGap) {
          last = t;
          onFrame(t);
          onProgress(`${label} ${(t / duration * 100).toFixed(0)}%…`);
        }
        if (video.ended || t >= duration - 0.02) { clearTimeout(guard); finish(); return; }
        video.requestVideoFrameCallback(onTick);
      };
      video.requestVideoFrameCallback(onTick);
      video.play().catch(finish);
    });

    // The work done on one frame, once it is on screen. Identical whether the
    // frame arrived by seeking to it or by the decoder playing it to us.
    const processFrame = (t, collect) => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      thumbCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      const gray = toGrayscale(thumbCtx, thumb.width, thumb.height);
      const { detail, motion } = scoreThumbnail(gray, prevGray);
      // A frame identical to the one before it is the decoder handing back
      // what was already on screen, not a still moment in the clip.
      if (prevGray && motion < DUPLICATE_FRAME_MOTION) duplicates++;
      sampled++;
      prevGray = gray;

      // Measure every person in the frame.
      //
      // Pose runs on the whole frame first. If the athlete comes back too
      // small to measure well -- or doesn't come back at all -- it runs a
      // second time on a padded crop aimed at where he was last seen, drawn
      // from the video at full resolution. That costs one extra inference on
      // the frames that need it and no extra seeking, and it is the whole
      // difference between reading a distant athlete and refusing him.
      //
      // The crop is aimed by the previous detection rather than by looking
      // for movement: on a re-encoded social clip most of what "moves" is
      // compression noise along the horizon and the caption, not the runner.
      const poses = [];
      if (landmarker) {
        // `region` maps a crop back onto the whole frame, as fractions of it.
        // Everything geometric is measured in WHOLE-FRAME coordinates even
        // when the model was shown a crop, because those numbers are compared
        // across frames: hip position associates one frame's body with the
        // next, and leg length decides whether the track is still the same
        // person. Leaving a cropped frame in its own coordinates makes the
        // hip appear to teleport and the leg to change length whenever
        // cropping switches on or off, which shatters the track into stubs --
        // and then nothing is moving like a sprinter, because nothing is
        // being followed long enough to tell.
        //
        // Only the framing flags stay in the coordinates the model actually
        // saw: how much of THAT picture he filled is what decided whether it
        // could be read, and a limb clamped to the edge of a crop is just as
        // invented as one clamped to the edge of the frame.
        const measure = (source, sourcePxHeight, region) => {
          try {
            const result = landmarker.detect(source);
            return (result.landmarks || []).map((lms) => {
              const seen = frameMetrics(lms, source.width, source.height);
              const whole = region
                ? lms.map((p) => Object.assign({}, p, {
                    x: region.x + p.x * region.w,
                    y: region.y + p.y * region.h,
                  }))
                : lms;
              const metrics = region ? frameMetrics(whole, canvas.width, canvas.height) : seen;
              metrics.bodyFrac = seen.bodyFrac;
              metrics.footAtEdge = seen.footAtEdge;
              metrics.bodyAtEdge = seen.bodyAtEdge;
              metrics.bodyPx = null;
              return {
                lms,
                sig: poseSignature(whole, canvas.width, canvas.height),
                metrics,
                sourcePxHeight,
              };
            });
          } catch (poseErr) {
            console.warn('Pose detection failed on a frame:', poseErr);
            return [];
          }
        };
        const biggest = (list) =>
          list.reduce((a, b) => ((b.metrics.bodyFrac || 0) > (a.metrics.bodyFrac || 0) ? b : a), list[0]);

        let found = measure(canvas, video.videoHeight);
        let lead = found.length ? biggest(found) : null;

        // How big the crop should be is taken ONLY from a whole-frame
        // detection, where the athlete's size is in known frame units. Sizing
        // it from a detection made inside a crop feeds the crop back into
        // itself: the model reports the body as some fraction of whatever it
        // was shown, padding multiplies that, and the box grows every frame
        // until it swallows the picture and cropping quietly stops. Position
        // still follows the athlete frame to frame; only the scale is pinned.
        // Only from a body wholly inside the picture. As he runs out of
        // frame the visible part shrinks, and sizing the crop from that
        // zooms further and further into a fragment of him: on one clip the
        // measured leg went 196px, 188, 82, 33 over four frames, which then
        // split the track and left only the frames before he started running.
        if (lead && lead.metrics.bodyFrac && !lead.metrics.bodyAtEdge) {
          cropSidePx = lead.metrics.bodyFrac * video.videoHeight * CROP_PADDING;
        }
        if (lead) {
          const b = poseBounds(lead.lms);
          if (b) lastBox = b;
        }

        if ((!lead || (lead.metrics.bodyFrac || 0) < SUBJECT_FRAC_MIN) && lastBox && cropSidePx > 0) {
          const bw = video.videoWidth;
          const bh = video.videoHeight;
          const cx = ((lastBox.x0 + lastBox.x1) / 2) * bw;
          const cy = ((lastBox.y0 + lastBox.y1) / 2) * bh;
          const side = cropSidePx;
          const sx = Math.max(0, Math.min(bw - 1, cx - side / 2));
          const sy = Math.max(0, Math.min(bh - 1, cy - side / 2));
          const sw = Math.min(bw - sx, side);
          const sh = Math.min(bh - sy, side);
          if (sw > 16 && sh > 16 && sw * sh < bw * bh * 0.8) {
            const k = Math.min(1, maxEdge / Math.max(sw, sh));
            poseCanvas.width = Math.max(1, Math.round(sw * k));
            poseCanvas.height = Math.max(1, Math.round(sh * k));
            poseCtx.drawImage(video, sx, sy, sw, sh, 0, 0, poseCanvas.width, poseCanvas.height);
            const inCrop = measure(poseCanvas, sh, {
              x: sx / bw, y: sy / bh, w: sw / bw, h: sh / bh,
            });
            const cropLead = inCrop.length ? biggest(inCrop) : null;
            if (cropLead && (cropLead.metrics.bodyFrac || 0) > (lead ? lead.metrics.bodyFrac || 0 : 0)) {
              found = inCrop;
              lead = cropLead;
              cropped++;
              // Aim only: the crop's coordinates map back to the full frame
              // so the next crop follows him, but its size stays pinned.
              const b = poseBounds(cropLead.lms);
              if (b) {
                lastBox = {
                  x0: (sx + b.x0 * sw) / bw, x1: (sx + b.x1 * sw) / bw,
                  y0: (sy + b.y0 * sh) / bh, y1: (sy + b.y1 * sh) / bh,
                };
              }
            }
          }
        }

        found.forEach((p) => {
          p.metrics.bodyPx = p.metrics.bodyFrac ? p.metrics.bodyFrac * p.sourcePxHeight : null;
          // Carried so the measuring pass can find WHEN the athlete was
          // actually on screen, rather than assuming he is mid-clip.
          p.metrics.t = t;
          poses.push({ sig: p.sig, metrics: p.metrics });
        });
      }
      if (collect) {
        candidates.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.7), detail, motion, t });
      }
      return poses;
    };

    const scan = async (times, label, collect) => {
      const poseRows = [];
      for (let i = 0; i < times.length; i++) {
        onProgress(`${label} ${i + 1}/${times.length}…`);
        const t = times[i];
        await seekTo(t);
        poseRows.push(processFrame(t, collect));
      }
      return poseRows;
    };

    // Nudge timestamps off the very ends -- setting currentTime to the value
    // it already holds can silently no-op the seek.
    const clampT = (t) => Math.min(Math.max(t, 0.05), Math.max(duration - 0.05, 0));

    // One play-through captures everything: locating the athlete, the shot
    // cuts, the stills for the AI, and the measurements themselves. There is
    // no second pass because there is nothing left to go back for -- which is
    // the point, since going back is what used to cost ninety seconds.
    let framePoses = [];
    let playedThrough = false;
    // Frames the athlete is actually IN, which is the only count that decides
    // whether there is enough to grade. Counting captured frames instead
    // meant a clip where he crosses the shot in a second declared success on
    // the strength of two hundred frames of empty track: 236 captured is far
    // past the minimum, so the fallback never ran, while pose had found him
    // in five of them. That is exactly the clip the athlete reported.
    const posedCount = (rows) => rows.filter((p) => p.length).length;

    if (landmarker && canPlayThrough) {
      // Faster than real time where the decoder can keep up, then real time
      // if that came back thin. At 2x the decoder has half as long per frame
      // to decode AND run pose, and what it drops are frames we never
      // measure -- costly on a clip where the athlete is only in shot
      // briefly, since the drops come out of the handful that contain him.
      for (const rate of [PLAYBACK_RATE, 1]) {
        try {
          framePoses = [];
          candidates.length = 0;
          video.playbackRate = rate;
          video.currentTime = 0;
          await waitForEvent(video, 'seeked', 2000);
          await playThrough((t) => { framePoses.push(processFrame(t, true)); },
                            CAPTURE_RATE, rate === 1 ? 'Watching again, more slowly' : 'Watching the run');
          playedThrough = posedCount(framePoses) >= MIN_TRACK_FRAMES;
        } catch (playErr) {
          console.warn(`Playback capture at ${rate}x failed:`, playErr);
          playedThrough = false;
        }
        if (playedThrough) break;
      }
      video.playbackRate = 1;
    }

    if (!playedThrough) {
      // No requestVideoFrameCallback, or playback gave us too little. Seek
      // frame by frame instead: slow, but it works everywhere.
      framePoses = [];
      candidates.length = 0;
      const sampleCount = landmarker
        ? Math.max(SCOUT_MIN_SAMPLES, Math.min(SCOUT_MAX_SAMPLES, Math.round(duration * SCOUT_RATE)))
        : Math.min(16, count * 2 + 2);
      const times = [];
      for (let i = 0; i < sampleCount; i++) {
        times.push(clampT((duration * i) / Math.max(sampleCount - 1, 1)));
      }
      framePoses = await scan(times, 'Scanning clip', true);

      // A sweep spread over the whole clip is far too thin when the athlete
      // crosses the shot in about a second: on a 7.9s clip that is roughly
      // four samples a second, so a 1.2s run yields five frames -- under the
      // track minimum, and refused. Once the sweep has found roughly where he
      // is, go back and sample only that stretch densely. Seeking is slow,
      // which is why this is a fallback and why it is aimed at one second of
      // clip rather than all of it.
      const seenTimes = times.filter((t, i) => framePoses[i] && framePoses[i].length);
      if (landmarker && seenTimes.length && posedCount(framePoses) < MIN_TRACK_FRAMES) {
        const pad = 1 / SCOUT_RATE;
        const from = Math.max(0, Math.min(...seenTimes) - pad);
        const to = Math.min(duration, Math.max(...seenTimes) + pad);
        const step = 1 / DENSE_RATE;
        const dense = [];
        for (let t = from; t <= to && dense.length < DENSE_MAX_SAMPLES; t += step) dense.push(clampT(t));
        if (dense.length) {
          candidates.length = 0;
          const denseRows = await scan(dense, 'Looking closer', true);
          // Keep whichever pass actually found him. The dense pass is aimed
          // at where he was seen, so it normally wins by a wide margin, but
          // a bad seek run must not lose what the sweep already had.
          if (posedCount(denseRows) > posedCount(framePoses)) framePoses = denseRows;
        }
      }
    }
    const secondsPerFrame = candidates.length > 1
      ? (candidates[candidates.length - 1].t - candidates[0].t) / (candidates.length - 1)
      : duration / Math.max(candidates.length - 1, 1);

    // A screen recording often holds more than one video -- a scroll to the
    // next reel, or the control centre pulled down over the end. Grading
    // across a cut averages two different clips into one score, so only the
    // longest unbroken shot is measured.
    const [shotStart, shotEnd] = longestShot(candidates.map((c) => c.motion));
    const cutOut = candidates.length - (shotEnd - shotStart);

    const chosen = chooseBestFrames(candidates.slice(shotStart, shotEnd), count);
    const shotPoses = framePoses.slice(shotStart, shotEnd);

    // ---- Pick the stretch to grade, out of what was already captured.
    //
    // A stride is ~0.22s and peak thigh lift lasts about one frame of 30fps
    // video, so the frames must be close together or the instant every
    // peak-lift angle is defined at is simply missed: the same clip sampled
    // at four thin rates gave scissor 105, 69, 105 and 88 degrees. Captured
    // at CAPTURE_RATE that is ~6 samples per stride, and sliding the window
    // gave a 2 degree spread.
    //
    // Which stretch matters too. The athlete is often on screen for a
    // fraction of the clip -- across three the athlete filmed himself, 0.4 to
    // 1.2s of clips running 2.1 to 6.5s -- and a runner is easiest to detect
    // while stationary, so aiming at where detections are densest lands on
    // him waiting in the blocks.
    let subject = { metrics: [], rejection: null };
    let denseFrames = 0;

    if (landmarker && shotPoses.length) {
      const seenIdx = [];
      shotPoses.forEach((poses, i) => { if (poses.length) seenIdx.push(i); });

      if (seenIdx.length) {
        const maxFrames = Math.min(DENSE_MAX_SAMPLES, seenIdx.length);
        const win = bestWindow(shotPoses, secondsPerFrame, maxFrames);
        const lo = win ? win.from : seenIdx[0];
        const hi = win ? win.to + 1 : Math.min(seenIdx[seenIdx.length - 1] + 1, lo + maxFrames);
        const windowPoses = shotPoses.slice(Math.max(0, lo), hi);

        if (windowPoses.length >= MIN_TRACK_FRAMES) {
          subject = selectSubject(windowPoses, secondsPerFrame);
          if (!subject.rejection) {
            const trimmed = longestConsistentRun(subject.metrics);
            if (trimmed.length >= MIN_TRACK_FRAMES) subject = { metrics: trimmed, rejection: null };
            denseFrames = subject.metrics.length;
          }
        }
      }
      if (!denseFrames && !subject.rejection) {
        // The window was too short to judge; fall back to the whole shot so a
        // clip is still graded rather than coming back silently empty.
        subject = selectSubject(shotPoses, secondsPerFrame);
      }
    }
    const measured = subject.metrics;

    return {
      frames: chosen.map((c) => c.dataUrl),
      // Only the chosen athlete's frames inform the score. Every frame they
      // appear in counts -- there's no per-frame cost locally.
      metrics: measured,
      denseFrames,
      rejection: subject.rejection,
      shotTrimmed: cutOut > 0,
      // How much of the clip the decoder gave us twice. Reported so a device
      // that cannot keep up shows up as a number rather than as an athlete
      // who appears not to be moving.
      duplicateShare: sampled ? duplicates / sampled : 0,
      // How often pose got a crop of the athlete rather than the whole
      // frame. Surfaced so a regression here shows up as a number rather
      // than as quietly worse scores.
      cropped,
      // What the decoder actually handed over on THIS device. A refusal is
      // otherwise indistinguishable between "the clip is unusable" and "this
      // phone only managed a handful of frames", and those want opposite
      // fixes. Two clips that graded cleanly offline were refused on the
      // athlete's phone with no way to tell which had happened.
      capture: {
        frames: framePoses.length,
        withPose: framePoses.filter((p) => p.length).length,
        played: playedThrough,
        duration,
      },
    };
  } finally {
    document.body.removeChild(video);
    URL.revokeObjectURL(url);
  }
}

function setAnalysisStatus(msg) {
  const el = document.getElementById('analysisStatus');
  if (!el) return;
  const time = new Date().toLocaleTimeString();
  el.textContent = msg ? `[${time}] ${msg}` : '';
  console.log(`[analysis ${time}]`, msg);
}

document.getElementById('saveDiagnosis').addEventListener('click', async () => {
  const clipType = document.getElementById('clipType').value;
  const distance = document.getElementById('clipDistance').value.trim();
  const effort = document.getElementById('clipEffort').value.trim();
  if (!pendingBlob) {
    alert('Upload a clip first.');
    return;
  }
  const saveBtn = document.getElementById('saveDiagnosis');
  saveBtn.disabled = true;
  const originalLabel = saveBtn.textContent;

  // Hard outer ceiling: no matter what goes wrong above, the button and
  // status always get released after this. This is a last-resort net on
  // top of the per-step timeouts already inside extractFrames/the
  // analysis call, not a replacement for them.
  let finished = false;
  const hardTimeout = setTimeout(() => {
    if (finished) return;
    finished = true;
    setAnalysisStatus('Gave up after 2 minutes -- something is stuck. Send a screenshot of this status line.');
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
  }, 120000);

  try {
    const id = crypto.randomUUID();
    // pendingBlob is the actual uploaded File -- use its real extension/type
    // instead of hardcoding one. Naming/labeling it wrong (e.g. a phone's
    // .mov as "video/webm") makes the browser unable to decode it at all,
    // for both playback and frame extraction. iOS sometimes reports an
    // empty File.type for video picked from the photo library, so fall
    // back to guessing from the filename extension.
    const EXT_TO_MIME = {
      mov: 'video/quicktime', qt: 'video/quicktime',
      mp4: 'video/mp4', m4v: 'video/mp4',
      webm: 'video/webm', ogv: 'video/ogg',
      '3gp': 'video/3gpp', avi: 'video/x-msvideo',
    };
    const nameExt = pendingBlob.name && pendingBlob.name.includes('.')
      ? pendingBlob.name.split('.').pop().toLowerCase()
      : null;
    const sourceType = pendingBlob.type || (nameExt && EXT_TO_MIME[nameExt]) || 'video/mp4';

    // Analysis runs BEFORE the upload. It reads pendingBlob off this device
    // and never needed the file to be in storage first; uploading first only
    // meant that anything failing afterwards -- the insert, a closed tab, a
    // dead connection -- left a 20-30MB file in the bucket with no row
    // pointing at it, invisible to the app and untouched by the retention
    // purge, which walks entries. Six of those had accumulated, 101MB.
    let analysis = null;
    let thumb = null;
    try {
      saveBtn.textContent = 'Analyzing…';
      const { frames, metrics, rejection, shotTrimmed, duplicateShare, capture } =
        await extractFrames(pendingBlob, 6, 480, setAnalysisStatus);
      thumb = await makeThumb(frames[0]);

      // If most sampled frames came back identical, the clip was never really
      // read and nothing measured from it means anything. Say that, rather
      // than reporting the athlete as motionless -- which is what it looks
      // like from the inside, and is a much more confusing thing to be told.
      const starved = duplicateShare > DUPLICATE_SHARE_MAX;

      // Local measurement is the default engine: it runs on this device, so
      // it costs nothing and works offline.
      setAnalysisStatus('Measuring form…');
      analysis = starved
        ? {
            summary: 'This clip could not be read on this device.',
            pinpoints: [], flags: [],
            filming_note: `${Math.round(duplicateShare * 100)}% of the frames came back identical — this device could not decode the clip quickly enough. A shorter clip, or one recorded at a lower resolution, should work.`,
          }
        : rejection
          ? {
              summary: 'This clip could not be graded.',
              pinpoints: [], flags: [],
              // The capture counts ride along with the refusal so a
              // screenshot of it is enough to tell an unusable clip from a
              // phone that only decoded a handful of frames -- those want
              // opposite fixes, and the message alone distinguished neither.
              // Two clips that graded cleanly offline were refused on the
              // athlete's phone with no way to tell which had happened.
              filming_note: `${rejection} (${capture.withPose} of ${capture.frames} frames over ${capture.duration.toFixed(1)}s had anyone in them${capture.played ? '' : '; the clip would not play through'})`,
            }
          : buildLocalAnalysis(metrics, clipType, document.getElementById('clipSurface').value);
      if (shotTrimmed && !rejection) {
        analysis.flags = [
          ...(analysis.flags || []),
          'This clip contained more than one shot — only the longest continuous run was graded.',
        ];
      }

      // The AI read is opt-in, because that's the part that costs money.
      if (document.getElementById('aiAssist').checked) {
        setAnalysisStatus(`Sending ${frames.length} frames to the AI…`);
        const invokePromise = supabaseClient.functions.invoke('analyze-form', {
          body: { clipType, distance, effort, frames },
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Analysis timed out after 45s')), 45000)
        );
        const { data: aiData, error: analysisError } = await Promise.race([invokePromise, timeoutPromise]);
        if (analysisError) throw new Error(await readFunctionError(analysisError));
        // Kept alongside the measurements rather than replacing them, so the
        // two engines can be compared on the same clip.
        analysis.ai_summary = aiData.summary || null;
        analysis.additional_observations = aiData.pinpoints || [];
        analysis.flags = [...(analysis.flags || []), ...(aiData.flags || [])];
      }
      setAnalysisStatus('Analysis complete.');
    } catch (analysisErr) {
      console.error('Analysis failed:', analysisErr);
      const detail = analysisErr.message || analysisErr;
      // The local measurements may already have succeeded before the AI
      // step failed -- don't tell the athlete they lost scores they have.
      const gotLocal = analysis && (analysis.pinpoints || []).length;
      setAnalysisStatus((gotLocal ? 'Measured, but the AI read failed: ' : 'Analysis failed: ') + detail);
      alert(gotLocal
        ? 'Your form measurements were saved. The AI coach notes failed: ' + detail
        : 'Clip saved, but analysis failed: ' + detail);
    }

    // Shrink only the copy that gets kept. The grader has already run, on the
    // original, at full quality.
    saveBtn.textContent = 'Shrinking…';
    const { blob: storedBlob, note: sizeNote } = await compressForStorage(pendingBlob, setAnalysisStatus);
    console.info('clip for storage:', sizeNote);

    // Name the file after what is actually being uploaded -- the compressor
    // may have handed back mp4 or webm regardless of what came off the phone,
    // and a .mov holding webm will not play.
    const contentType = storedBlob.type || sourceType;
    const typeExt = contentType.includes('/') ? contentType.split('/').pop() : null;
    const ext = (storedBlob === pendingBlob ? nameExt : null) || typeExt || 'mp4';
    const videoPath = `${currentUser.id}/${id}.${ext}`;

    setAnalysisStatus(`Uploading video… (${sizeNote})`);
    saveBtn.textContent = 'Uploading…';
    const { error: uploadError } = await supabaseClient.storage
      .from('diagnosis-videos')
      .upload(videoPath, storedBlob, { contentType });
    if (uploadError) {
      setAnalysisStatus('Upload failed: ' + uploadError.message);
      alert('Video upload failed: ' + uploadError.message);
      return;
    }

    setAnalysisStatus('Saving session…');
    const { error } = await supabaseClient
      .from('diagnosis_entries')
      .insert({
        id,
        user_id: currentUser.id,
        video_path: videoPath,
        clip_type: clipType || null,
        distance: distance || null,
        effort: effort || null,
        analysis,
        thumb,
      });
    if (error) {
      // Take the file back out. The row is what makes a clip reachable, so
      // without this the upload above is exactly the orphan this reordering
      // was meant to stop.
      await supabaseClient.storage.from('diagnosis-videos').remove([videoPath]);
      setAnalysisStatus('Save failed: ' + error.message);
      alert('Save failed: ' + error.message);
      return;
    }
    document.getElementById('clipType').value = '';
    document.getElementById('clipDistance').value = '';
    document.getElementById('clipEffort').value = '';
    pendingBlob = null;
    videoUpload.value = '';
    renderDiagnosis();
  } finally {
    if (!finished) {
      finished = true;
      clearTimeout(hardTimeout);
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    }
  }
});

function renderAnalysisHtml(analysis) {
  if (!analysis || (!analysis.summary && !(analysis.pinpoints || []).length)) {
    return `<div class="hint">Weak points: analysis coming soon</div>`;
  }
  const rows = [...(analysis.pinpoints || []), ...(analysis.additional_observations || [])]
    .map((p) => {
      // The same bar the profile uses, so a score means the same thing in
      // both places. Some rows are measured but deliberately not scored
      // (swing balance) -- those get the note and no bar, rather than a bar
      // sitting at zero, which reads as the worst possible mark.
      const scored = typeof p.score === 'number' && isFinite(p.score);
      return `
      <div class="score-row">
        <span>${escapeHtml(p.name)}</span>
        ${scored ? `<span class="score-pill">${escapeHtml(String(p.score))}/5</span>` : ''}
      </div>
      ${scored ? `<div class="progress-bar score-bar">
        <div class="progress-fill" style="width:${(p.score / 5) * 100}%;background:${scoreColor(p.score)}"></div>
      </div>` : ''}
      ${p.note ? `<div class="hint score-note">${escapeHtml(p.note)}</div>` : ''}
    `;
    })
    .join('');
  const flags = (analysis.flags || [])
    .map((f) => `<div class="hint">⚠️ ${escapeHtml(f)}</div>`)
    .join('');
  const filmingNote = analysis.filming_note
    ? `<div class="hint">🎥 ${escapeHtml(analysis.filming_note)}</div>`
    : '';
  const surfaceNote = `<div class="surface-note">⚠️ Ground and footwear change these numbers. Spikes and a stiff track let the foot stay rigid and bounce; trainers and grass absorb force, so the foot collapses more, contact is longer and angles read flatter. Compare like with like.</div>`;
  const aiSummary = analysis.ai_summary
    ? `<div class="hint ai-note">🤖 ${escapeHtml(analysis.ai_summary)}</div>`
    : '';
  // What the score rests on. A grade off one stride is a real reading of one
  // stride, and the athlete should see which he is looking at.
  const basis = analysis.basis && rows
    ? `<div class="hint basis-note">${escapeHtml(analysis.basis)}</div>`
    : '';
  return `
    ${analysis.summary ? `<div>${escapeHtml(analysis.summary)}</div>` : ''}
    ${basis}
    ${rows}
    ${aiSummary}
    ${flags}
    ${filmingNote}
    ${rows ? surfaceNote : ''}
  `;
}

// Signed URLs, reused rather than reissued.
//
// createSignedUrl mints a NEW url with a new token every call, and a url the
// CDN has never seen cannot be a cache hit -- so re-signing on every render
// turned every playback into a fresh origin fetch, billed as egress. Holding
// each url until shortly before it expires lets the CDN serve the repeats.
const signedUrlCache = new Map();
const SIGNED_URL_TTL_S = 3600;
const SIGNED_URL_REUSE_MS = (SIGNED_URL_TTL_S - 300) * 1000; // re-sign 5 min early

async function signedVideoUrl(path) {
  const hit = signedUrlCache.get(path);
  if (hit && Date.now() - hit.at < SIGNED_URL_REUSE_MS) return hit.url;
  const { data } = await supabaseClient.storage
    .from('diagnosis-videos')
    .createSignedUrl(path, SIGNED_URL_TTL_S);
  if (!data) return null;
  signedUrlCache.set(path, { url: data.signedUrl, at: Date.now() });
  return data.signedUrl;
}

// A clip is 20-30MB and a phone records the index at the END of the file, so
// a browser asked to show even a still frame downloads most of it. Attaching
// <video src> for every entry meant opening this tab downloaded every clip in
// the history -- the whole month's egress allowance in a few visits.
//
// So: nothing is fetched until the athlete asks for a specific clip. The
// element carries no src at all until the tap, and preload="none" keeps the
// browser from going after it once it has one.
function videoPlaceholder(path, thumb) {
  const holder = document.createElement('div');
  holder.className = 'video-holder';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'video-load-btn';
  btn.textContent = '▶  Play clip';
  // The preview is a ~10KB still that came down with the list query. Entries
  // saved before thumbnails existed simply get the plain button.
  if (thumb) {
    btn.classList.add('has-thumb');
    btn.style.backgroundImage = `url("${thumb}")`;
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Loading…';
    const url = await signedVideoUrl(path);
    if (!url) { btn.disabled = false; btn.textContent = '▶  Play clip'; return; }
    const video = document.createElement('video');
    video.controls = true;
    video.preload = 'none';
    video.playsInline = true;
    video.src = url;
    holder.replaceChildren(video);
    video.play().catch(() => {});   // a blocked autoplay still leaves controls
  });
  holder.appendChild(btn);
  return holder;
}

async function renderDiagnosis() {
  await purgeExpiredVideos();
  await purgeOrphanedVideos();
  const { data, error } = await supabaseClient
    .from('diagnosis_entries')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }

  const list = document.getElementById('diagnosisList');
  list.innerHTML = '';
  for (const entry of data) {
    const div = document.createElement('div');
    div.className = 'entry';
    const dateStr = new Date(entry.created_at).toLocaleString();
    const tags = [entry.clip_type, entry.distance, entry.effort].filter(Boolean).join(' · ');
    div.innerHTML = `
      <div class="entry-top">
        <span class="date">${dateStr}</span>
        <button class="delete-btn">Delete</button>
      </div>
      ${tags ? `<div class="day-badges"><span class="day-badge">${escapeHtml(tags)}</span></div>` : ''}
      ${renderAnalysisHtml(entry.analysis)}
    `;
    if (entry.video_path) {
      div.appendChild(videoPlaceholder(entry.video_path, entry.thumb));
    }
    div.querySelector('.delete-btn').addEventListener('click', async () => {
      if (entry.video_path) {
        await supabaseClient.storage.from('diagnosis-videos').remove([entry.video_path]);
      }
      await supabaseClient.from('diagnosis_entries').delete().eq('id', entry.id);
      renderDiagnosis();
    });
    list.appendChild(div);
  }
}

// =====================================================
// WORKOUTS
// =====================================================
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

// Once a week is on the board, regenerating throws it away -- so the button
// stops being the obvious primary action and starts looking like something
// you only press deliberately. It stays enabled; the confirm still guards it.
function setGenerateButtonState(hasPlan) {
  const btn = document.getElementById('generateWeekPlan');
  const note = document.getElementById('regenNote');
  btn.textContent = hasPlan ? 'Regenerate week' : "Generate This Week's Plan";
  btn.classList.toggle('primary', !hasPlan);
  btn.classList.toggle('regen', hasPlan);
  note.textContent = hasPlan ? 'Erases this week and builds a new one.' : '';
}

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

// Splits a plan description into its individual exercises/reps so each can
// get its own weight/time input -- e.g. "Power Cleans 3x3-5, Broad Jumps 3x3"
// becomes two items. Commas inside parentheses stay grouped, e.g.
// "(2x20,2x25,2x30,1x40)" is kept as one item rather than exploding it.
function splitExercises(str) {
  if (!str) return [];
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

// Breaks one sprint item down into its individual reps, each getting its
// own stable key (tied to the item's text) and a short display label --
// e.g. "8x200" becomes 8 rows, "(2x20,2x25,2x30,1x40)" becomes 6. Falls
// back to a single row when no rep count is recognized (a single ladder
// rung like "150", or free text).
function expandSprintItem(item) {
  const trimmed = item.trim();

  // "3x3x100" -- sets x reps x distance.
  let m = /^(\d+)\s*x\s*(\d+)\s*x\s*(.+)$/i.exec(trimmed);
  if (m) {
    const sets = parseInt(m[1], 10);
    const reps = parseInt(m[2], 10);
    const rows = [];
    for (let s = 1; s <= sets; s++) {
      for (let r = 1; r <= reps; r++) rows.push({ key: `${item} :: set ${s} rep ${r}`, display: `Set ${s}, rep ${r}` });
    }
    return rows;
  }

  // "2x(10,20,30)" -- repeat an inner ladder N times.
  m = /^(\d+)\s*x\s*\((.+)\)$/i.exec(trimmed);
  if (m) {
    const rounds = parseInt(m[1], 10);
    const legs = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    const rows = [];
    for (let r = 1; r <= rounds; r++) {
      legs.forEach((leg) => rows.push({ key: `${item} :: round ${r} - ${leg}`, display: `Round ${r}, ${leg}` }));
    }
    return rows;
  }

  // A trailing parenthesized ladder, with or without a name prefix --
  // "(2x20,2x25,2x30,1x40)" or "Sleds (2x10,20,30)". Only treated as a
  // ladder when the parenthesized part actually looks like one (multiple
  // comma legs, or a single "NxM" leg) -- otherwise it's just a
  // descriptive suffix like "4x float sprint (40-60-90)" and falls
  // through to the simple leading-multiplier case below.
  m = /^(.*?)\(([^()]+)\)\s*$/.exec(trimmed);
  if (m) {
    const prefix = m[1].trim();
    const legs = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    const looksLikeLadder = legs.length > 1 || /^\d+\s*x/i.test(legs[0] || '');
    if (looksLikeLadder) {
      const rows = [];
      legs.forEach((leg) => {
        const lm = /^(\d+)\s*x\s*(.+)$/i.exec(leg);
        if (lm) {
          const reps = parseInt(lm[1], 10);
          for (let r = 1; r <= reps; r++) rows.push({ key: `${item} :: ${leg} rep ${r}`, display: `${prefix ? prefix + ' ' : ''}${lm[2]} rep ${r}` });
        } else {
          rows.push({ key: `${item} :: ${leg}`, display: `${prefix ? prefix + ' ' : ''}${leg}` });
        }
      });
      return rows;
    }
  }

  // Simple "8x200" -- N reps of one distance.
  m = /^(\d+)\s*x\s*(.+)$/i.exec(trimmed);
  if (m) {
    const reps = parseInt(m[1], 10);
    const rows = [];
    for (let r = 1; r <= reps; r++) rows.push({ key: `${item} :: rep ${r}`, display: `Rep ${r}` });
    return rows;
  }

  return [{ key: item, display: item }];
}

// Breaks one lift item down into its individual sets -- e.g.
// "Power Cleans 3x3-5" becomes 3 rows so each set can carry its own weight.
// A range on the set count ("2-3x6") uses the low end. Falls back to a
// single row when no set count is recognized (e.g. free-typed text).
function expandLiftItem(item) {
  const m = /^(.*?)\s+(\d+)(?:-\d+)?\s*x/i.exec(item.trim());
  if (m) {
    const sets = parseInt(m[2], 10);
    const rows = [];
    for (let s = 1; s <= sets; s++) rows.push({ key: `${item} :: Set ${s}`, display: `Set ${s}` });
    return rows;
  }
  return [{ key: item, display: item }];
}

// Renders a plan description with each set/rep's logged value appended in
// parentheses where any were logged, e.g. "Power Cleans 3x3-5 (135, 145, 155)".
function withLoggedValues(planText, log, expandFn) {
  const items = splitExercises(planText);
  if (!items.length) return escapeHtml(planText || '');
  const log2 = log || {};
  return items.map((item) => {
    const values = expandFn(item).map((row) => log2[row.key]).filter(Boolean);
    return values.length ? `${escapeHtml(item)} (${values.map(escapeHtml).join(', ')})` : escapeHtml(item);
  }).join(', ');
}

// Lifts that don't take an external load -- no weight box is offered for these.
const BODYWEIGHT_LIFT_KEYWORDS = ['core', 'broad jump', 'hurdle hop', 'pull-up', 'pull up'];
function isBodyweightExercise(item) {
  const name = item.toLowerCase();
  return BODYWEIGHT_LIFT_KEYWORDS.some((kw) => name.includes(kw));
}

// Reads whatever's currently logged for one kind ('sprint' or 'lift'), from
// both simple single-value rows (data-key directly on the input) and
// compact dropdown rows (each set/rep's value lives on its <option>).
function getCurrentLog(kind) {
  const log = {};
  document.querySelectorAll(`#exerciseLog .explog-input[data-kind="${kind}"][data-key]`).forEach((input) => {
    if (input.value.trim()) log[input.dataset.key] = input.value.trim();
  });
  document.querySelectorAll(`#exerciseLog select.explog-set-select[data-kind="${kind}"] option`).forEach((option) => {
    if (option.dataset.value && option.dataset.value.trim()) log[option.dataset.key] = option.dataset.value.trim();
  });
  return log;
}

// Rebuilds the per-exercise log rows from the current plan text in
// workoutDetails/workoutLift, prefilling from the given saved logs (or from
// whatever's already in the inputs, when called to preserve in-progress edits).
// An exercise with 2+ sets/reps gets ONE compact row -- a dropdown to pick
// which set/rep, plus a single input that saves back to whichever is
// selected -- instead of a separate row per set/rep.
function renderExerciseLog(sprintLog, liftLog) {
  const sprintItems = splitExercises(document.getElementById('workoutDetails').value);
  const liftItems = splitExercises(document.getElementById('workoutLift').value).filter((item) => !isBodyweightExercise(item));
  sprintLog = sprintLog || {};
  liftLog = liftLog || {};

  const groupHtml = (items, expandFn, log, kind, placeholder) => items.map((item) => {
    const rows = expandFn(item);
    const header = (rows.length > 1 || rows[0].display !== item)
      ? `<p class="explog-group-label">${escapeHtml(item)}</p>` : '';

    if (rows.length === 1) {
      const row = rows[0];
      return header + `
        <div class="ex-row explog-row">
          <span class="ex-name">${escapeHtml(row.display)}</span>
          <input type="text" class="explog-input" data-kind="${kind}" data-key="${escapeHtml(row.key)}" placeholder="${placeholder}" value="${escapeHtml(log[row.key] || '')}" />
        </div>
      `;
    }

    const options = rows.map((row, i) => `<option value="${i}" data-key="${escapeHtml(row.key)}" data-value="${escapeHtml(log[row.key] || '')}">${escapeHtml(row.display)}</option>`).join('');
    return header + `
      <div class="ex-row explog-row explog-combo-row">
        <select class="explog-set-select" data-kind="${kind}">${options}</select>
        <input type="text" class="explog-input" data-kind="${kind}" placeholder="${placeholder}" value="${escapeHtml(log[rows[0].key] || '')}" />
      </div>
    `;
  }).join('');

  let html = '';
  if (sprintItems.length) {
    html += `<p class="hint" style="margin-bottom:0.2rem">⏱️ Log each rep's time</p>${groupHtml(sprintItems, expandSprintItem, sprintLog, 'sprint', 'time')}`;
  }
  if (liftItems.length) {
    html += `<p class="hint" style="margin:0.6rem 0 0.2rem">🏋️ Log each set's weight</p>${groupHtml(liftItems, expandLiftItem, liftLog, 'lift', 'weight')}`;
  }
  document.getElementById('exerciseLog').innerHTML = html;

  // Wire up the compact dropdown+input combos: switching the dropdown loads
  // that set/rep's stored value into the input, and typing saves back into
  // whichever option is currently selected -- so nothing is lost switching.
  document.querySelectorAll('.explog-combo-row').forEach((row) => {
    const select = row.querySelector('.explog-set-select');
    const input = row.querySelector('.explog-input');
    select.addEventListener('change', () => {
      input.value = select.options[select.selectedIndex].dataset.value || '';
    });
    input.addEventListener('input', () => {
      select.options[select.selectedIndex].dataset.value = input.value;
    });
  });
}

function refreshExerciseLog() {
  renderExerciseLog(getCurrentLog('sprint'), getCurrentLog('lift'));
}
document.getElementById('workoutDetails').addEventListener('input', refreshExerciseLog);
document.getElementById('workoutLift').addEventListener('input', refreshExerciseLog);

document.getElementById('saveWorkout').addEventListener('click', async () => {
  const day = document.getElementById('workoutDay').value;
  const type = document.getElementById('workoutType').value;
  const details = document.getElementById('workoutDetails').value.trim();
  const timed = document.getElementById('workoutTimed').value || null;
  const liftDetails = document.getElementById('workoutLift').value.trim();
  const loggedResult = getCurrentLog('sprint');
  const liftLog = getCurrentLog('lift');
  const { error } = await supabaseClient
    .from('workouts')
    .upsert(
      {
        user_id: currentUser.id,
        day,
        type,
        details,
        timed,
        lift_details: liftDetails || null,
        logged_result: Object.keys(loggedResult).length ? loggedResult : null,
        lift_log: Object.keys(liftLog).length ? liftLog : null,
      },
      { onConflict: 'user_id,day' }
    );
  if (error) { alert('Save failed: ' + error.message); return; }
  document.getElementById('workoutDetails').value = '';
  document.getElementById('workoutLift').value = '';
  document.getElementById('exerciseLog').innerHTML = '';
  renderWeekBoard();
});

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

document.getElementById('generateWeekPlan').addEventListener('click', async () => {
  if (!currentUser) return;
  const [equipment, primaryEvents, seasonAndMeet, { data: existing }, { data: avail }] = await Promise.all([
    getEquipment(),
    getPrimaryEvents(),
    getSeasonAndMeet(),
    supabaseClient.from('workouts').select('day').eq('user_id', currentUser.id),
    supabaseClient.from('availability').select('*').eq('user_id', currentUser.id).eq('week_key', getWeekKey()).maybeSingle(),
  ]);

  if (existing && existing.length && !confirm('This will DELETE everything currently shown for this week (all sessions and lifts) and replace it with a new plan. This cannot be undone. Continue?')) {
    return;
  }

  const phase = computeTrainingPhase(seasonAndMeet.season, seasonAndMeet.nextMeetDate);
  const ideal = buildWeekPlan(phase, equipment, primaryEvents);
  const { plan, dropped } = reschedulePlan(
    ideal,
    new Set((avail && avail.sprint_days) || []),
    new Set((avail && avail.gym_days) || [])
  );
  lastPlanNote = describeDropped(dropped);

  const { error } = await supabaseClient.from('workouts').upsert(
    plan.map((entry) => ({
      user_id: currentUser.id,
      day: entry.day,
      type: entry.type,
      details: entry.details,
      timed: entry.timed || null,
      lift_details: entry.liftDetails || null,
      logged_result: null,
      lift_log: null,
    })),
    { onConflict: 'user_id,day' }
  );
  if (error) { alert('Could not generate plan: ' + error.message); return; }
  renderWeekBoard();
});

async function renderWeekBoard() {
  const weekKey = getWeekKey();
  const [{ data, error }, { data: avail }, { season, nextMeetDate }] = await Promise.all([
    supabaseClient.from('workouts').select('*').eq('user_id', currentUser.id),
    supabaseClient.from('availability').select('*').eq('user_id', currentUser.id).eq('week_key', weekKey).maybeSingle(),
    getSeasonAndMeet(),
  ]);
  if (error) { console.error(error); return; }

  const phase = computeTrainingPhase(season, nextMeetDate);
  const badge = document.getElementById('phaseBadge');
  badge.textContent = phase.label;
  badge.className = 'phase-badge' + (phase.className ? ' ' + phase.className : '');
  document.getElementById('planNote').textContent = lastPlanNote;
  setGenerateButtonState(data.length > 0);

  const byDay = {};
  data.forEach((w) => { byDay[w.day] = w; });
  const sprintDays = new Set((avail && avail.sprint_days) || []);
  const gymDays = new Set((avail && avail.gym_days) || []);
  // Availability only filters once the athlete has actually marked days --
  // an untouched week means "nothing said yet", not "available for nothing".
  const sprintFiltered = sprintDays.size > 0;
  const gymFiltered = gymDays.size > 0;

  const board = document.getElementById('weekBoard');
  board.innerHTML = '';
  DAYS.forEach((day) => {
    const w = byDay[day];
    const badges = [];
    if (sprintDays.has(day)) badges.push('<span class="day-badge">🏃 Sprint OK</span>');
    if (gymDays.has(day)) badges.push('<span class="day-badge">💪 Gym OK</span>');

    // A session is only hidden if it actually needs the thing the athlete
    // can't get to. The plan itself is left untouched in the database, so
    // marking the day available again brings the session straight back.
    // Generating a plan (or changing availability) already moves sessions
    // onto days the athlete can train, so this only catches a session they
    // placed by hand on a day they can't -- and never one they've logged,
    // since logging it means they did it.
    const canSprint = !sprintFiltered || sprintDays.has(day);
    const canGym = !gymFiltered || gymDays.has(day);
    const logged = !!w && hasLoggedData(w);
    const sprintBlocked = !!w && !logged && !canSprint && !NO_TRACK_NEEDED.has(w.type);
    const liftBlocked = !!w && !logged && !!w.lift_details && !canGym;

    let body;
    if (!w) {
      body = '<div class="details">No session set</div>';
    } else if (sprintBlocked) {
      body = `<div class="type blocked">Can't sprint this day</div>
        <div class="details">${escapeHtml(w.type)} skipped — you marked yourself unavailable.</div>`;
    } else {
      body = `<div class="type">${escapeHtml(w.type)}${w.timed ? ` <span class="score-pill">${escapeHtml(w.timed)}</span>` : ''}</div>
        <div class="details">${escapeHtml(w.details || '')}</div>`;
    }

    let liftLine = '';
    if (w && w.lift_details) {
      liftLine = liftBlocked
        ? '<div class="hint blocked">🏋️ Lift skipped — no gym this day.</div>'
        : `<div class="hint">🏋️ ${withLoggedValues(w.lift_details, w.lift_log, expandLiftItem)}</div>`;
    }

    const card = document.createElement('div');
    card.className = 'day-card' + (w ? '' : ' empty') + (sprintBlocked || liftBlocked ? ' blocked-day' : '');
    card.innerHTML = `
      <h4>${day}</h4>
      ${body}
      ${liftLine}
      ${w && w.logged_result && Object.keys(w.logged_result).length ? `<div class="hint">⏱️ Ran: ${withLoggedValues(w.details, w.logged_result, expandSprintItem)}</div>` : ''}
      ${badges.length ? `<div class="day-badges">${badges.join('')}</div>` : ''}
      ${w ? `<button class="delete-btn">Clear</button>` : ''}
    `;
    // Click anywhere on the card (not the Clear button) to load it into
    // the form above for editing.
    card.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) return;
      document.getElementById('workoutDay').value = day;
      document.getElementById('workoutType').value = w ? w.type : '';
      document.getElementById('workoutDetails').value = w ? w.details || '' : '';
      document.getElementById('workoutTimed').value = w && w.timed ? w.timed : '';
      document.getElementById('workoutLift').value = w && w.lift_details ? w.lift_details : '';
      renderExerciseLog(w ? w.logged_result : null, w ? w.lift_log : null);
      document.getElementById('workoutDetails').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    if (w) {
      card.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await supabaseClient.from('workouts').delete().eq('id', w.id);
        renderWeekBoard();
      });
    }
    board.appendChild(card);
  });
}

// ---------- Training Setup (events, equipment, next meet) ----------
const EQUIPMENT_OPTIONS = ['Sleds', 'Hills', 'Blocks'];
let equipmentSelected = new Set();
const trainingSetupModal = document.getElementById('trainingSetupModal');

function renderEquipmentPicker() {
  const container = document.getElementById('equipmentPicker');
  container.innerHTML = '';
  EQUIPMENT_OPTIONS.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-chip' + (equipmentSelected.has(item) ? ' selected' : '');
    btn.textContent = item;
    btn.addEventListener('click', () => {
      if (equipmentSelected.has(item)) equipmentSelected.delete(item); else equipmentSelected.add(item);
      btn.classList.toggle('selected');
    });
    container.appendChild(btn);
  });
}

document.getElementById('trainingSetupBtn').addEventListener('click', async () => {
  settingsMenu.hidden = true;
  renderEquipmentPicker();
  trainingSetupModal.hidden = false;
  if (!currentUser) return;
  try {
    const { data, error } = await supabaseClient
      .from('athlete_settings')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      document.getElementById('primaryEvents').value = (data.primary_events || []).join(', ');
      equipmentSelected = new Set(data.equipment || []);
      renderEquipmentPicker();
      document.getElementById('nextMeetDate').value = data.next_meet_date || '';
      document.getElementById('nextMeetEvents').value = (data.next_meet_events || []).join(', ');
    }
  } catch (err) {
    console.error('Failed to load training setup:', err);
  }
});

document.getElementById('closeTrainingSetup').addEventListener('click', () => {
  trainingSetupModal.hidden = true;
});

trainingSetupModal.addEventListener('click', (e) => {
  if (e.target === trainingSetupModal) trainingSetupModal.hidden = true;
});

document.getElementById('saveTrainingSetup').addEventListener('click', async () => {
  if (!currentUser) return;
  const splitCsv = (val) => val.split(',').map((s) => s.trim()).filter(Boolean);
  const { error } = await supabaseClient.from('athlete_settings').upsert(
    {
      user_id: currentUser.id,
      primary_events: splitCsv(document.getElementById('primaryEvents').value),
      equipment: Array.from(equipmentSelected),
      next_meet_date: document.getElementById('nextMeetDate').value || null,
      next_meet_events: splitCsv(document.getElementById('nextMeetEvents').value),
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    alert('Could not save training setup: ' + error.message);
    return;
  }
  trainingSetupModal.hidden = true;
  renderWeekBoard();
});

// =====================================================
// WEIGHT ROOM
// =====================================================
// Every movement buildLiftDetails() can prescribe, in the order the week
// works through them, each with a form video. Keep this in step with
// buildLiftDetails -- if a lift is added there, it belongs here too.
const DEFAULT_EXERCISES = [
  // Olympic lifts -- acceleration and max-velocity days
  { name: 'Power Clean', url: 'https://www.youtube.com/watch?v=ORGBFvyUwGs' },
  { name: 'Hang Power Clean', url: 'https://www.youtube.com/watch?v=G4uPAxxJOAs' },
  { name: 'Hang Snatch', url: 'https://www.youtube.com/watch?v=JzOOEs-NyIE' },

  // Jumps and throws
  { name: 'Broad Jump', url: 'https://www.youtube.com/watch?v=q7851uL2M8c' },
  { name: 'Hurdle Hops', url: 'https://www.youtube.com/watch?v=6lj6jIszCgM' },
  { name: 'Med Ball Throw', url: 'https://www.youtube.com/watch?v=IAgyLUdva_c' },

  // Legs
  { name: 'Bulgarian Split Squat', url: 'https://www.youtube.com/watch?v=yewlXtRs3K4' },
  { name: 'Quarter Squat', url: 'https://www.youtube.com/watch?v=-mNpHNEXvFQ' },
  { name: 'Step Up', url: 'https://www.youtube.com/watch?v=tqECKZxlCKE' },
  { name: 'Back Squat', url: 'https://www.youtube.com/watch?v=8PMjqgR8Wa8' },

  // Upper body -- tempo days
  { name: 'Flat Bench Press', url: 'https://www.youtube.com/watch?v=gRVjAtPip0Y' },
  { name: 'Incline Bench Press', url: 'https://www.youtube.com/watch?v=O9x7xRhtA9Q' },
  { name: 'Shoulder Press', url: 'https://www.youtube.com/watch?v=F3QY5vMz_6I' },
  { name: 'Barbell Back Row', url: 'https://www.youtube.com/watch?v=rqTOAM8WoeM' },
  { name: 'Pull-Up', url: 'https://www.youtube.com/watch?v=vw5Xmu5CIew' },
  { name: 'Tricep Pushdown', url: 'https://www.youtube.com/watch?v=-zLyUAo1gMw' },
  { name: 'Tricep Overhead Extension', url: 'https://www.youtube.com/watch?v=W6h3t9mkRrY' },
  { name: 'Lateral Raise', url: 'https://www.youtube.com/watch?v=Y29xKcze8Ik' },

  // Core -- paired with every lift day
  { name: 'Core Circuit', url: 'https://www.youtube.com/watch?v=wa_GXttvWLY' },
];

function getWeekKey() {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

async function ensureDefaultExercises() {
  const { data, error } = await supabaseClient
    .from('exercises')
    .select('id')
    .eq('user_id', currentUser.id)
    .limit(1);
  if (error) { console.error(error); return; }
  if (data.length === 0) {
    const rows = DEFAULT_EXERCISES.map((ex) => ({
      user_id: currentUser.id, name: ex.name, url: ex.url, is_custom: false,
    }));
    await supabaseClient.from('exercises').insert(rows);
  }
}

document.getElementById('addCustomEx').addEventListener('click', async () => {
  const name = document.getElementById('customExName').value.trim();
  const url = document.getElementById('customExUrl').value.trim();
  if (!name) return;
  await supabaseClient
    .from('exercises')
    .insert({ user_id: currentUser.id, name, url: normalizeUrl(url), is_custom: true });
  document.getElementById('customExName').value = '';
  document.getElementById('customExUrl').value = '';
  renderWeights();
});

// Only http(s) links are rendered -- these come from a text box, so don't
// hand the browser a `javascript:` href.
function safeUrl(url) {
  const trimmed = String(url || '').trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

// Accepts what someone actually pastes ("youtube.com/watch?v=..."), not just
// fully-qualified URLs. Empty input clears the link.
function normalizeUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// This is a reference list, not a checklist -- each row is a movement and
// the form video you've linked for it.
async function renderWeights() {
  await ensureDefaultExercises();

  const { data: list, error } = await supabaseClient
    .from('exercises')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });
  if (error) { console.error(error); return; }

  const container = document.getElementById('weightsList');
  container.innerHTML = '';
  list.forEach((ex) => {
    const url = safeUrl(ex.url);
    const row = document.createElement('div');
    row.className = 'ex-row';
    // With a video linked the movement's name is the link -- tap it to watch.
    row.innerHTML = `
      ${url
        ? `<a class="ex-name ex-name-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">▶ ${escapeHtml(ex.name)}</a>`
        : `<span class="ex-name">${escapeHtml(ex.name)}</span>`}
      <div class="ex-actions">
        <button class="ex-link-btn">${url ? 'Edit link' : 'Add link'}</button>
        ${ex.is_custom ? '<button class="delete-btn">Remove</button>' : ''}
      </div>
    `;

    row.querySelector('.ex-link-btn').addEventListener('click', async () => {
      const entered = prompt(`Form video link for ${ex.name}\n(leave blank to remove)`, ex.url || '');
      if (entered === null) return;
      const { error: updateError } = await supabaseClient
        .from('exercises')
        .update({ url: normalizeUrl(entered) })
        .eq('id', ex.id);
      if (updateError) { alert('Could not save that link: ' + updateError.message); return; }
      renderWeights();
    });

    const removeBtn = row.querySelector('.delete-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        await supabaseClient.from('exercises').delete().eq('id', ex.id);
        renderWeights();
      });
    }
    container.appendChild(row);
  });
}

// =====================================================
// TIMES & GOALS
// =====================================================
document.getElementById('timeDate').valueAsDate = new Date();

document.getElementById('saveTime').addEventListener('click', async () => {
  const distance = document.getElementById('timeDistance').value;
  const time = document.getElementById('timeValue').value.trim();
  const date = document.getElementById('timeDate').value;
  if (!time) return;
  await supabaseClient
    .from('times')
    .insert({ user_id: currentUser.id, distance, time, logged_date: date });
  document.getElementById('timeValue').value = '';
  renderTimes();
});

async function renderTimes() {
  const { data, error } = await supabaseClient
    .from('times')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('logged_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }

  const list = document.getElementById('timesList');
  list.innerHTML = '';
  data.forEach((t) => {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      <div class="entry-top">
        <span><strong>${escapeHtml(t.distance)}</strong> — ${escapeHtml(t.time)}s</span>
        <span class="date">${t.logged_date}</span>
        <button class="delete-btn">Delete</button>
      </div>
    `;
    div.querySelector('.delete-btn').addEventListener('click', async () => {
      await supabaseClient.from('times').delete().eq('id', t.id);
      renderTimes();
    });
    list.appendChild(div);
  });
}

document.getElementById('addBigGoal').addEventListener('click', async () => {
  const text = document.getElementById('bigGoalText').value.trim();
  if (!text) return;
  await supabaseClient.from('big_goals').insert({ user_id: currentUser.id, text });
  document.getElementById('bigGoalText').value = '';
  renderBigGoals();
});

async function renderBigGoals() {
  const [{ data: goals, error: goalsError }, { data: smallGoals, error: smallError }] = await Promise.all([
    supabaseClient.from('big_goals').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
    supabaseClient.from('small_goals').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: true }),
  ]);
  if (goalsError || smallError) { console.error(goalsError || smallError); return; }

  const container = document.getElementById('bigGoalsList');
  container.innerHTML = '';
  goals.forEach((goal) => {
    const mine = smallGoals.filter((s) => s.big_goal_id === goal.id);
    const done = mine.filter((s) => s.done).length;
    const total = mine.length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const div = document.createElement('div');
    div.className = 'goal';
    div.innerHTML = `
      <div class="goal-header">
        <span>🎯 ${escapeHtml(goal.text)}</span>
        <button class="delete-btn">Delete</button>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="date">${done}/${total} small goals complete</div>
      <div class="small-goals"></div>
      <div class="add-small-goal">
        <input type="text" placeholder="Add a small goal (a step toward this)" class="small-goal-input" />
        <button class="btn add-small-btn">Add</button>
      </div>
    `;
    const smallContainer = div.querySelector('.small-goals');
    mine.forEach((sg) => {
      const row = document.createElement('div');
      row.className = 'small-goal-row' + (sg.done ? ' done' : '');
      row.innerHTML = `
        <input type="checkbox" ${sg.done ? 'checked' : ''} />
        <span>${escapeHtml(sg.text)}</span>
        <button class="delete-btn" style="margin-left:auto">✕</button>
      `;
      row.querySelector('input').addEventListener('change', async (e) => {
        await supabaseClient.from('small_goals').update({ done: e.target.checked }).eq('id', sg.id);
        renderBigGoals();
      });
      row.querySelector('.delete-btn').addEventListener('click', async () => {
        await supabaseClient.from('small_goals').delete().eq('id', sg.id);
        renderBigGoals();
      });
      smallContainer.appendChild(row);
    });

    div.querySelector('.goal-header .delete-btn').addEventListener('click', async () => {
      await supabaseClient.from('big_goals').delete().eq('id', goal.id);
      renderBigGoals();
    });
    div.querySelector('.add-small-btn').addEventListener('click', async () => {
      const input = div.querySelector('.small-goal-input');
      const text = input.value.trim();
      if (!text) return;
      await supabaseClient.from('small_goals').insert({ big_goal_id: goal.id, user_id: currentUser.id, text });
      renderBigGoals();
    });
    container.appendChild(div);
  });
}

// =====================================================
// MOTIVATION
// =====================================================
const QUOTES = [
  '"I don\'t think limits." — Usain Bolt',
  '"I hated every minute of training, but I said, don\'t quit. Suffer now and live the rest of your life as a champion." — Muhammad Ali',
  '"Run when you can, walk if you have to, crawl if you must; just never give up." — Dean Karnazes',
  '"Speed is a gift, but explosive power is built in the weight room and paid for in practice."',
  '"The man who says it cannot be done should not interrupt the man doing it." — Chinese Proverb',
  '"You have to be able to accept failure to get better." — LeBron James',
  '"Champions keep playing until they get it right." — Billie Jean King',
  '"It\'s not whether you get knocked down, it\'s whether you get up." — Vince Lombardi',
  '"The only way to prove that you\'re a good sport is to lose." — Ernie Banks',
  '"Discipline is doing what needs to be done, even if you don\'t want to do it."',
  '"Every rep in the weight room is a deposit into your top-end speed."',
  '"Fast is not born. Fast is built, one session at a time."',
  '"Your only limit is the one you set in your own mind."',
];

document.getElementById('newQuote').addEventListener('click', () => {
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  document.getElementById('quoteBox').textContent = q;
});

const MOTIVATION_LINKS = [
  { title: 'Usain Bolt 100m World Record Race', url: ytSearch('Usain Bolt 100m world record 9.58') },
  { title: 'Usain Bolt Slow Motion Sprint Mechanics', url: ytSearch('Usain Bolt slow motion sprint mechanics') },
  { title: "Florence Griffith-Joyner (Flo-Jo) 100m WR", url: ytSearch('Flo Jo 100m world record 10.49') },
  { title: 'Noah Lyles 200m Races', url: ytSearch('Noah Lyles 200m race highlights') },
  { title: "Sha'Carri Richardson Highlights", url: ytSearch("Sha'Carri Richardson 100m highlights") },
  { title: 'Sprint Technique Breakdown (Elite Athletes)', url: ytSearch('elite sprint technique breakdown slow motion') },
];

function renderMotivationLinks() {
  const grid = document.getElementById('motivationLinks');
  grid.innerHTML = '';
  MOTIVATION_LINKS.forEach((link) => {
    const a = document.createElement('a');
    a.className = 'link-card';
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '▶ ' + link.title;
    grid.appendChild(a);
  });
}

document.getElementById('addFav').addEventListener('click', async () => {
  const title = document.getElementById('favTitle').value.trim();
  const url = document.getElementById('favUrl').value.trim();
  if (!title || !url) return;
  await supabaseClient.from('favorites').insert({ user_id: currentUser.id, title, url });
  document.getElementById('favTitle').value = '';
  document.getElementById('favUrl').value = '';
  renderFavorites();
});

async function renderFavorites() {
  const { data, error } = await supabaseClient
    .from('favorites')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }

  const list = document.getElementById('favList');
  list.innerHTML = '';
  data.forEach((f) => {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      <div class="entry-top">
        <a href="${escapeHtml(f.url)}" target="_blank" rel="noopener">▶ ${escapeHtml(f.title)}</a>
        <button class="delete-btn">Delete</button>
      </div>
    `;
    div.querySelector('.delete-btn').addEventListener('click', async () => {
      await supabaseClient.from('favorites').delete().eq('id', f.id);
      renderFavorites();
    });
    list.appendChild(div);
  });
}
