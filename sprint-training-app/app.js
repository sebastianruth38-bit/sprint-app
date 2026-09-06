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
    const { data, error } = await supabaseClient
      .from('availability')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('week_key', weekKey)
      .maybeSingle();
    if (error) throw error;
    sprintDaysSelected = new Set((data && data.sprint_days) || []);
    gymDaysSelected = new Set((data && data.gym_days) || []);
    renderDayPicker(sprintDayPicker, sprintDaysSelected);
    renderDayPicker(gymDayPicker, gymDaysSelected);
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
  availabilityModal.hidden = true;
  renderWeekBoard();
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

async function extractFrames(videoBlob, count = 8, maxWidth = 480) {
  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  // Some mobile browsers (notably iOS Safari) won't reliably decode frames
  // for a <video> that's never attached to the page, even if hidden.
  video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);

  try {
    await waitForEvent(video, 'loadedmetadata', 4000);

    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) {
      throw new Error('Video has no readable duration');
    }

    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale) || maxWidth;
    canvas.height = Math.round(video.videoHeight * scale) || maxWidth;
    const ctx = canvas.getContext('2d');

    const frames = [];
    for (let i = 0; i < count; i++) {
      // Nudge the very first timestamp off zero -- setting currentTime to
      // the value it's already at can silently no-op the seek.
      const raw = (duration * i) / Math.max(count - 1, 1);
      const t = Math.min(Math.max(raw, 0.05), Math.max(duration - 0.05, 0));
      video.currentTime = t;
      await waitForEvent(video, 'seeked', 2000);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.7));
    }
    return frames;
  } finally {
    document.body.removeChild(video);
    URL.revokeObjectURL(url);
  }
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
  try {
    const id = crypto.randomUUID();
    saveBtn.textContent = 'Uploading…';
    const videoPath = `${currentUser.id}/${id}.webm`;
    const { error: uploadError } = await supabaseClient.storage
      .from('diagnosis-videos')
      .upload(videoPath, pendingBlob, { contentType: pendingBlob.type || 'video/webm' });
    if (uploadError) {
      alert('Video upload failed: ' + uploadError.message);
      return;
    }

    let analysis = null;
    try {
      saveBtn.textContent = 'Analyzing…';
      const frames = await extractFrames(pendingBlob);
      const invokePromise = supabaseClient.functions.invoke('analyze-form', {
        body: { clipType, distance, effort, frames },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Analysis timed out after 45s')), 45000)
      );
      const { data: analysisData, error: analysisError } = await Promise.race([invokePromise, timeoutPromise]);
      if (analysisError) throw analysisError;
      analysis = analysisData;
    } catch (analysisErr) {
      console.error('Analysis failed:', analysisErr);
      alert('Clip saved, but AI analysis failed: ' + (analysisErr.message || analysisErr));
    }

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
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
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
  return `
    ${analysis.summary ? `<div>${escapeHtml(analysis.summary)}</div>` : ''}
    ${rows}
    ${flags}
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

document.getElementById('saveWorkout').addEventListener('click', async () => {
  const day = document.getElementById('workoutDay').value;
  const type = document.getElementById('workoutType').value;
  const details = document.getElementById('workoutDetails').value.trim();
  const { error } = await supabaseClient
    .from('workouts')
    .upsert({ user_id: currentUser.id, day, type, details }, { onConflict: 'user_id,day' });
  if (error) { alert('Save failed: ' + error.message); return; }
  document.getElementById('workoutDetails').value = '';
  renderWeekBoard();
});

async function renderWeekBoard() {
  const weekKey = getWeekKey();
  const [{ data, error }, { data: avail }] = await Promise.all([
    supabaseClient.from('workouts').select('*').eq('user_id', currentUser.id),
    supabaseClient.from('availability').select('*').eq('user_id', currentUser.id).eq('week_key', weekKey).maybeSingle(),
  ]);
  if (error) { console.error(error); return; }

  const byDay = {};
  data.forEach((w) => { byDay[w.day] = w; });
  const sprintDays = new Set((avail && avail.sprint_days) || []);
  const gymDays = new Set((avail && avail.gym_days) || []);

  const board = document.getElementById('weekBoard');
  board.innerHTML = '';
  DAYS.forEach((day) => {
    const w = byDay[day];
    const badges = [];
    if (sprintDays.has(day)) badges.push('<span class="day-badge">🏃 Sprint OK</span>');
    if (gymDays.has(day)) badges.push('<span class="day-badge">💪 Gym OK</span>');

    const card = document.createElement('div');
    card.className = 'day-card' + (w ? '' : ' empty');
    card.innerHTML = `
      <h4>${day}</h4>
      ${w ? `<div class="type">${escapeHtml(w.type)}</div><div class="details">${escapeHtml(w.details || '')}</div>`
          : `<div class="details">No session set</div>`}
      ${badges.length ? `<div class="day-badges">${badges.join('')}</div>` : ''}
      ${w ? `<button class="delete-btn">Clear</button>` : ''}
    `;
    if (w) {
      card.querySelector('.delete-btn').addEventListener('click', async () => {
        await supabaseClient.from('workouts').delete().eq('id', w.id);
        renderWeekBoard();
      });
    }
    board.appendChild(card);
  });
}

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

async function renderWeights() {
  await ensureDefaultExercises();
  const weekKey = getWeekKey();

  const [{ data: list, error: exError }, { data: checks, error: checkError }] = await Promise.all([
    supabaseClient.from('exercises').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: true }),
    supabaseClient.from('weight_checks').select('*').eq('user_id', currentUser.id).eq('week_key', weekKey),
  ]);
  if (exError || checkError) { console.error(exError || checkError); return; }

  const checkMap = {};
  checks.forEach((c) => { checkMap[c.exercise_id] = c.done; });

  const container = document.getElementById('weightsList');
  container.innerHTML = '';
  list.forEach((ex) => {
    const row = document.createElement('div');
    row.className = 'ex-row';
    row.innerHTML = `
      <input type="checkbox" ${checkMap[ex.id] ? 'checked' : ''} />
      <span class="ex-name">${escapeHtml(ex.name)}${ex.url ? `<a href="${ex.url}" target="_blank" rel="noopener">▶ how-to</a>` : ''}</span>
      ${ex.is_custom ? `<button class="delete-btn">Remove</button>` : ''}
    `;
    row.querySelector('input').addEventListener('change', async (e) => {
      await supabaseClient
        .from('weight_checks')
        .upsert(
          { user_id: currentUser.id, exercise_id: ex.id, week_key: weekKey, done: e.target.checked },
          { onConflict: 'user_id,exercise_id,week_key' }
        );
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
