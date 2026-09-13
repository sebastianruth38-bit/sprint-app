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

let pass=0, fail=0;
const assert=(c,m)=>{ if(c){console.log('PASS: '+m);pass++;} else {console.error('FAIL: '+m);fail++;} };

// Build a fake 16-candidate clip: frames 0-3 empty track (no athlete),
// 4-11 athlete sprinting through (high motion), 12-15 empty again.
const W=48,H=27;
function flat(v){ const g=new Float32Array(W*H); g.fill(v); return g; }
function textured(seed){ const g=new Float32Array(W*H); for(let i=0;i<g.length;i++) g[i]=90+40*Math.sin(i*0.3+seed); return g; }
function withAthlete(seed){ const g=textured(0); for(let i=0;i<g.length;i++){ const x=i%W; if(Math.abs(x-(seed*3)%W)<4) g[i]=20; } return g; }

const candidates=[]; let prev=null;
for(let i=0;i<16;i++){
  let gray;
  if(i<4 || i>=12) gray = textured(0);          // static empty track
  else gray = withAthlete(i);                    // athlete moving across
  const {detail,motion}=scoreThumbnail(gray,prev);
  prev=gray;
  candidates.push({dataUrl:'frame'+i, detail, motion, idx:i});
}

const chosen = chooseBestFrames(candidates, 6);
const idxs = chosen.map(c=>c.idx);
console.log('chose frames:', JSON.stringify(idxs));

assert(chosen.length === 6, 'returns the requested number of frames, got ' + chosen.length);
const inAthleteWindow = idxs.filter(i => i>=4 && i<12).length;
assert(inAthleteWindow >= 4, 'majority of chosen frames come from the window where the athlete is moving (' + inAthleteWindow + '/6)');
assert(idxs.every((v,i,a)=> i===0 || v>a[i-1]), 'frames stay in chronological order: ' + JSON.stringify(idxs));
assert(new Set(idxs).size === idxs.length, 'no duplicate frames');

// All-blank clip: must still return frames rather than nothing.
const blanks=[]; let p2=null;
for(let i=0;i<16;i++){ const g=flat(0); const s=scoreThumbnail(g,p2); p2=g; blanks.push({dataUrl:'b'+i, ...s, idx:i}); }
const blankChosen = chooseBestFrames(blanks, 6);
assert(blankChosen.length === 6, 'a clip with no detectable content still yields frames (fallback), got ' + blankChosen.length);

// Detail scoring: a black frame scores ~0, a real scene scores high.
assert(scoreThumbnail(flat(0), null).detail < 1, 'black frame has ~zero detail');
assert(scoreThumbnail(flat(255), null).detail < 1, 'blown-out white frame has ~zero detail');
assert(scoreThumbnail(textured(0), null).detail > 8, 'a real scene scores above the blank threshold');

// Motion scoring
assert(scoreThumbnail(textured(0), textured(0)).motion === 0, 'identical frames report zero motion');
assert(scoreThumbnail(withAthlete(5), withAthlete(1)).motion > 1, 'athlete moving across frame reports motion');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
