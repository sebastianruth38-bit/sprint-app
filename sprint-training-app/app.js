// ---------- Tabs ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
});

// ---------- Storage helpers ----------
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- IndexedDB for video blobs ----------
let dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open('sprintLabDB', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('videos');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function saveVideoBlob(id, blob) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readwrite');
    tx.objectStore('videos').put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getVideoBlob(id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readonly');
    const req = tx.objectStore('videos').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteVideoBlob(id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readwrite');
    tx.objectStore('videos').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// =====================================================
// FORM DIAGNOSIS
// =====================================================
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let pendingBlob = null;

const camPreview = document.getElementById('camPreview');
const startCamBtn = document.getElementById('startCam');
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const videoUpload = document.getElementById('videoUpload');

startCamBtn.addEventListener('click', async () => {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    camPreview.srcObject = mediaStream;
    recordBtn.disabled = false;
    startCamBtn.disabled = true;
  } catch (err) {
    alert('Could not access camera: ' + err.message + '\nYou can still upload a video file below.');
  }
});

recordBtn.addEventListener('click', () => {
  if (!mediaStream) return;
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(mediaStream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    pendingBlob = new Blob(recordedChunks, { type: 'video/webm' });
  };
  mediaRecorder.start();
  recordBtn.disabled = true;
  stopBtn.disabled = false;
});

stopBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  recordBtn.disabled = false;
  stopBtn.disabled = true;
});

videoUpload.addEventListener('change', () => {
  const file = videoUpload.files[0];
  if (file) pendingBlob = file;
});

document.getElementById('saveDiagnosis').addEventListener('click', async () => {
  const notes = document.getElementById('diagnosisNotes').value.trim();
  if (!notes && !pendingBlob) {
    alert('Add some notes or a clip first.');
    return;
  }
  const id = uid();
  const entries = store.get('sprint_diagnosis', []);
  const entry = { id, date: new Date().toISOString(), notes, hasVideo: !!pendingBlob };
  if (pendingBlob) await saveVideoBlob(id, pendingBlob);
  entries.unshift(entry);
  store.set('sprint_diagnosis', entries);
  document.getElementById('diagnosisNotes').value = '';
  pendingBlob = null;
  videoUpload.value = '';
  renderDiagnosis();
});

async function renderDiagnosis() {
  const entries = store.get('sprint_diagnosis', []);
  const list = document.getElementById('diagnosisList');
  list.innerHTML = '';
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    const dateStr = new Date(entry.date).toLocaleString();
    div.innerHTML = `
      <div class="entry-top">
        <span class="date">${dateStr}</span>
        <button class="delete-btn" data-id="${entry.id}">Delete</button>
      </div>
      <div>${escapeHtml(entry.notes || '')}</div>
    `;
    if (entry.hasVideo) {
      const video = document.createElement('video');
      video.controls = true;
      const blob = await getVideoBlob(entry.id);
      if (blob) video.src = URL.createObjectURL(blob);
      div.appendChild(video);
    }
    div.querySelector('.delete-btn').addEventListener('click', async () => {
      const remaining = store.get('sprint_diagnosis', []).filter((e) => e.id !== entry.id);
      store.set('sprint_diagnosis', remaining);
      if (entry.hasVideo) await deleteVideoBlob(entry.id);
      renderDiagnosis();
    });
    list.appendChild(div);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =====================================================
// WORKOUTS
// =====================================================
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

document.getElementById('saveWorkout').addEventListener('click', () => {
  const day = document.getElementById('workoutDay').value;
  const type = document.getElementById('workoutType').value;
  const details = document.getElementById('workoutDetails').value.trim();
  const workouts = store.get('sprint_workouts', {});
  workouts[day] = { type, details };
  store.set('sprint_workouts', workouts);
  document.getElementById('workoutDetails').value = '';
  renderWeekBoard();
});

function renderWeekBoard() {
  const workouts = store.get('sprint_workouts', {});
  const board = document.getElementById('weekBoard');
  board.innerHTML = '';
  DAYS.forEach((day) => {
    const w = workouts[day];
    const card = document.createElement('div');
    card.className = 'day-card' + (w ? '' : ' empty');
    card.innerHTML = `
      <h4>${day}</h4>
      ${w ? `<div class="type">${escapeHtml(w.type)}</div><div class="details">${escapeHtml(w.details || '')}</div>`
          : `<div class="details">No session set</div>`}
      ${w ? `<button class="delete-btn" data-day="${day}">Clear</button>` : ''}
    `;
    if (w) {
      card.querySelector('.delete-btn').addEventListener('click', () => {
        const all = store.get('sprint_workouts', {});
        delete all[day];
        store.set('sprint_workouts', all);
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

function ytSearch(query) {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
}

function getWeekKey() {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

function initExercises() {
  let list = store.get('sprint_exercises', null);
  if (!list) {
    list = DEFAULT_EXERCISES.map((ex) => ({ id: uid(), ...ex, custom: false }));
    store.set('sprint_exercises', list);
  }
  return list;
}

document.getElementById('addCustomEx').addEventListener('click', () => {
  const name = document.getElementById('customExName').value.trim();
  const url = document.getElementById('customExUrl').value.trim();
  if (!name) return;
  const list = store.get('sprint_exercises', []);
  list.push({ id: uid(), name, url: url || null, custom: true });
  store.set('sprint_exercises', list);
  document.getElementById('customExName').value = '';
  document.getElementById('customExUrl').value = '';
  renderWeights();
});

function renderWeights() {
  const list = store.get('sprint_exercises', []) || initExercises();
  const weekKey = getWeekKey();
  const checks = store.get('sprint_weight_checks', {});
  const weekChecks = checks[weekKey] || {};

  const container = document.getElementById('weightsList');
  container.innerHTML = '';
  list.forEach((ex) => {
    const row = document.createElement('div');
    row.className = 'ex-row';
    row.innerHTML = `
      <input type="checkbox" ${weekChecks[ex.id] ? 'checked' : ''} data-id="${ex.id}" />
      <span class="ex-name">${escapeHtml(ex.name)}${ex.url ? `<a href="${ex.url}" target="_blank" rel="noopener">▶ how-to</a>` : ''}</span>
      ${ex.custom ? `<button class="delete-btn" data-remove="${ex.id}">Remove</button>` : ''}
    `;
    row.querySelector('input').addEventListener('change', (e) => {
      const c = store.get('sprint_weight_checks', {});
      c[weekKey] = c[weekKey] || {};
      c[weekKey][ex.id] = e.target.checked;
      store.set('sprint_weight_checks', c);
    });
    const removeBtn = row.querySelector('[data-remove]');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        const all = store.get('sprint_exercises', []).filter((e) => e.id !== ex.id);
        store.set('sprint_exercises', all);
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

document.getElementById('saveTime').addEventListener('click', () => {
  const distance = document.getElementById('timeDistance').value;
  const time = document.getElementById('timeValue').value.trim();
  const date = document.getElementById('timeDate').value;
  if (!time) return;
  const times = store.get('sprint_times', []);
  times.unshift({ id: uid(), distance, time, date });
  store.set('sprint_times', times);
  document.getElementById('timeValue').value = '';
  renderTimes();
});

function renderTimes() {
  const times = store.get('sprint_times', []);
  const list = document.getElementById('timesList');
  list.innerHTML = '';
  times.forEach((t) => {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      <div class="entry-top">
        <span><strong>${escapeHtml(t.distance)}</strong> — ${escapeHtml(t.time)}s</span>
        <span class="date">${t.date}</span>
        <button class="delete-btn" data-id="${t.id}">Delete</button>
      </div>
    `;
    div.querySelector('.delete-btn').addEventListener('click', () => {
      store.set('sprint_times', store.get('sprint_times', []).filter((x) => x.id !== t.id));
      renderTimes();
    });
    list.appendChild(div);
  });
}

document.getElementById('addBigGoal').addEventListener('click', () => {
  const text = document.getElementById('bigGoalText').value.trim();
  if (!text) return;
  const goals = store.get('sprint_big_goals', []);
  goals.unshift({ id: uid(), text, smallGoals: [] });
  store.set('sprint_big_goals', goals);
  document.getElementById('bigGoalText').value = '';
  renderBigGoals();
});

function renderBigGoals() {
  const goals = store.get('sprint_big_goals', []);
  const container = document.getElementById('bigGoalsList');
  container.innerHTML = '';
  goals.forEach((goal) => {
    const done = goal.smallGoals.filter((s) => s.done).length;
    const total = goal.smallGoals.length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const div = document.createElement('div');
    div.className = 'goal';
    div.innerHTML = `
      <div class="goal-header">
        <span>🎯 ${escapeHtml(goal.text)}</span>
        <button class="delete-btn" data-id="${goal.id}">Delete</button>
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
    goal.smallGoals.forEach((sg) => {
      const row = document.createElement('div');
      row.className = 'small-goal-row' + (sg.done ? ' done' : '');
      row.innerHTML = `
        <input type="checkbox" ${sg.done ? 'checked' : ''} />
        <span>${escapeHtml(sg.text)}</span>
        <button class="delete-btn" style="margin-left:auto">✕</button>
      `;
      row.querySelector('input').addEventListener('change', (e) => {
        const all = store.get('sprint_big_goals', []);
        const g = all.find((x) => x.id === goal.id);
        const s = g.smallGoals.find((x) => x.id === sg.id);
        s.done = e.target.checked;
        store.set('sprint_big_goals', all);
        renderBigGoals();
      });
      row.querySelector('.delete-btn').addEventListener('click', () => {
        const all = store.get('sprint_big_goals', []);
        const g = all.find((x) => x.id === goal.id);
        g.smallGoals = g.smallGoals.filter((x) => x.id !== sg.id);
        store.set('sprint_big_goals', all);
        renderBigGoals();
      });
      smallContainer.appendChild(row);
    });

    div.querySelector('.delete-btn[data-id]').addEventListener('click', () => {
      store.set('sprint_big_goals', store.get('sprint_big_goals', []).filter((g) => g.id !== goal.id));
      renderBigGoals();
    });
    div.querySelector('.add-small-btn').addEventListener('click', () => {
      const input = div.querySelector('.small-goal-input');
      const text = input.value.trim();
      if (!text) return;
      const all = store.get('sprint_big_goals', []);
      const g = all.find((x) => x.id === goal.id);
      g.smallGoals.push({ id: uid(), text, done: false });
      store.set('sprint_big_goals', all);
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
  { title: 'Sha\'Carri Richardson Highlights', url: ytSearch("Sha'Carri Richardson 100m highlights") },
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

document.getElementById('addFav').addEventListener('click', () => {
  const title = document.getElementById('favTitle').value.trim();
  const url = document.getElementById('favUrl').value.trim();
  if (!title || !url) return;
  const favs = store.get('sprint_favorites', []);
  favs.unshift({ id: uid(), title, url });
  store.set('sprint_favorites', favs);
  document.getElementById('favTitle').value = '';
  document.getElementById('favUrl').value = '';
  renderFavorites();
});

function renderFavorites() {
  const favs = store.get('sprint_favorites', []);
  const list = document.getElementById('favList');
  list.innerHTML = '';
  favs.forEach((f) => {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      <div class="entry-top">
        <a href="${escapeHtml(f.url)}" target="_blank" rel="noopener">▶ ${escapeHtml(f.title)}</a>
        <button class="delete-btn" data-id="${f.id}">Delete</button>
      </div>
    `;
    div.querySelector('.delete-btn').addEventListener('click', () => {
      store.set('sprint_favorites', store.get('sprint_favorites', []).filter((x) => x.id !== f.id));
      renderFavorites();
    });
    list.appendChild(div);
  });
}

// ---------- Init ----------
renderDiagnosis();
renderWeekBoard();
initExercises();
renderWeights();
renderTimes();
renderBigGoals();
renderMotivationLinks();
renderFavorites();
document.getElementById('newQuote').click();
