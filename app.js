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
  renderWeekBoard();
});

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

async function extractFrames(videoBlob, count = 8, maxWidth = 480, onProgress = () => {}) {
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

    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale) || maxWidth;
    canvas.height = Math.round(video.videoHeight * scale) || maxWidth;
    const ctx = canvas.getContext('2d');

    const frames = [];
    for (let i = 0; i < count; i++) {
      onProgress(`Extracting frame ${i + 1}/${count}…`);
      // Nudge the very first timestamp off zero -- setting currentTime to
      // the value it's already at can silently no-op the seek.
      const raw = (duration * i) / Math.max(count - 1, 1);
      const t = Math.min(Math.max(raw, 0.05), Math.max(duration - 0.05, 0));
      video.currentTime = t;
      await waitForEvent(video, 'seeked', 2000);
      await videoFramePainted(video);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.7));
    }
    return frames;
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
    setAnalysisStatus('Uploading video…');
    saveBtn.textContent = 'Uploading…';
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
    const contentType = pendingBlob.type || (nameExt && EXT_TO_MIME[nameExt]) || 'video/mp4';
    const typeExt = contentType.includes('/') ? contentType.split('/').pop() : null;
    const ext = nameExt || typeExt || 'mp4';
    const videoPath = `${currentUser.id}/${id}.${ext}`;
    const { error: uploadError } = await supabaseClient.storage
      .from('diagnosis-videos')
      .upload(videoPath, pendingBlob, { contentType });
    if (uploadError) {
      setAnalysisStatus('Upload failed: ' + uploadError.message);
      alert('Video upload failed: ' + uploadError.message);
      return;
    }

    let analysis = null;
    try {
      saveBtn.textContent = 'Analyzing…';
      const frames = await extractFrames(pendingBlob, 8, 480, setAnalysisStatus);
      setAnalysisStatus(`Sending ${frames.length} frames to the AI…`);
      const invokePromise = supabaseClient.functions.invoke('analyze-form', {
        body: { clipType, distance, effort, frames },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Analysis timed out after 45s')), 45000)
      );
      const { data: analysisData, error: analysisError } = await Promise.race([invokePromise, timeoutPromise]);
      if (analysisError) throw analysisError;
      analysis = analysisData;
      setAnalysisStatus('Analysis complete.');
    } catch (analysisErr) {
      console.error('Analysis failed:', analysisErr);
      setAnalysisStatus('Analysis failed: ' + (analysisErr.message || analysisErr));
      alert('Clip saved, but AI analysis failed: ' + (analysisErr.message || analysisErr));
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
      });
    if (error) {
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
    .map((p) => `
      <div class="score-row">
        <span>${escapeHtml(p.name)}</span>
        <span class="score-pill">${escapeHtml(String(p.score))}/5</span>
      </div>
      ${p.note ? `<div class="hint score-note">${escapeHtml(p.note)}</div>` : ''}
    `)
    .join('');
  const flags = (analysis.flags || [])
    .map((f) => `<div class="hint">⚠️ ${escapeHtml(f)}</div>`)
    .join('');
  const filmingNote = analysis.filming_note
    ? `<div class="hint">🎥 ${escapeHtml(analysis.filming_note)}</div>`
    : '';
  return `
    ${analysis.summary ? `<div>${escapeHtml(analysis.summary)}</div>` : ''}
    ${rows}
    ${flags}
    ${filmingNote}
  `;
}

async function renderDiagnosis() {
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
      const { data: signed } = await supabaseClient.storage
        .from('diagnosis-videos')
        .createSignedUrl(entry.video_path, 3600);
      if (signed) {
        const video = document.createElement('video');
        video.controls = true;
        video.src = signed.signedUrl;
        div.appendChild(video);
      }
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
// nothing to "do". Everything else hides when they can't sprint that day.
const NO_TRACK_NEEDED = new Set(['Rest Day', 'Recovery / Mobility', 'Meet Day', 'Pre-Meet']);

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
  const [equipment, primaryEvents, seasonAndMeet, { data: existing }] = await Promise.all([
    getEquipment(),
    getPrimaryEvents(),
    getSeasonAndMeet(),
    supabaseClient.from('workouts').select('day').eq('user_id', currentUser.id),
  ]);

  if (existing && existing.length && !confirm('This will DELETE everything currently shown for this week (all sessions and lifts) and replace it with a new plan. This cannot be undone. Continue?')) {
    return;
  }

  const phase = computeTrainingPhase(seasonAndMeet.season, seasonAndMeet.nextMeetDate);
  const plan = buildWeekPlan(phase, equipment, primaryEvents);

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
    const canSprint = !sprintFiltered || sprintDays.has(day);
    const canGym = !gymFiltered || gymDays.has(day);
    const sprintBlocked = !!w && !canSprint && !NO_TRACK_NEEDED.has(w.type);
    const liftBlocked = !!w && !!w.lift_details && !canGym;

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
const DEFAULT_EXERCISES = [
  { name: 'Back Squat', url: ytSearch('how to back squat proper form') },
  { name: 'Trap Bar Deadlift', url: ytSearch('trap bar deadlift technique') },
  { name: 'Bulgarian Split Squat', url: ytSearch('bulgarian split squat form') },
  { name: 'Hip Thrust', url: ytSearch('barbell hip thrust form') },
  { name: 'Power Clean', url: ytSearch('power clean technique for sprinters') },
  { name: 'Nordic Hamstring Curl', url: ytSearch('nordic hamstring curl technique') },
  { name: 'Broad Jump', url: ytSearch('standing broad jump technique') },
  { name: 'Box Jump', url: ytSearch('box jump technique') },
  { name: 'Medicine Ball Rotational Throw', url: ytSearch('medicine ball rotational throw for sprinters') },
  { name: 'Weighted Sled Push', url: ytSearch('sled push for sprint speed') },
  { name: 'Calf Raise', url: ytSearch('standing calf raise proper form') },
  { name: 'Copenhagen Plank', url: ytSearch('copenhagen plank groin exercise') },
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
    .insert({ user_id: currentUser.id, name, url: url || null, is_custom: true });
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
        ${ex.is_custom ? `<button class="delete-btn">Remove</button>` : ''}
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
