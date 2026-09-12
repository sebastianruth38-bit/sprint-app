// End-to-end test of the new framing pipeline against the athlete's REAL
// uploaded clips, decoded by a real browser.
//
// MediaPipe itself can't load here (its CDN is blocked in this sandbox), so
// the landmarker is stubbed with a detector that records exactly what image
// it was handed. That is the part this change touches: whether the athlete
// is found, whether pose is given a crop of him instead of the whole phone
// screen, and whether a clip containing two shots gets split. The accuracy
// claim behind the crop was measured separately, against the real model.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const SRC = process.env.APP_DIR || require('path').join(__dirname, 'fixtures/app');
// Chromium here has no proprietary codecs, so the same clips are served
// transcoded to VP8 at half resolution -- the aspect ratio, the athlete's
// share of the frame and the shot cuts all survive that untouched.
const UP = process.env.CLIPS_DIR || require('path').join(__dirname, 'clips');
const CLIPS = {
  blockStart: 'blockStart.webm', // single athlete, tiny in frame, control centre at the end
  scrolled: 'scrolled.webm',     // scrolls to a second reel at 0.5s
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.webm': 'video/webm' };

function serve() {
  return new Promise((r) => {
    const s = http.createServer((rq, rs) => {
      const url = rq.url.split('?')[0];
      const fp = url.startsWith('/clip/') ? path.join(UP, url.slice(6)) : path.join(SRC, url === '/' ? '/index.html' : url);
      fs.readFile(fp, (e, d) => {
        if (e) { rs.writeHead(404); rs.end(); return; }
        rs.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
        rs.end(d);
      });
    });
    s.listen(0, () => r(s));
  });
}

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { console.log('PASS: ' + m); pass++; } else { console.error('FAIL: ' + m); fail++; } };

(async () => {
  const server = await serve(), port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => typeof window.extractFrames === 'function' || typeof extractFrames === 'function');

  // Stub the model to behave the way the real one measurably does: on the
  // whole phone frame the athlete is a small fraction of the picture, and on
  // a crop aimed at him he fills it. Records every image it is handed so the
  // test can tell a crop from a full frame.
  await page.evaluate(() => {
    window.__seen = [];
    window.__n = 0;
    window.getPoseLandmarker = async () => ({
      detect: (source) => {
        window.__seen.push({ w: source.width, h: source.height });
        const n = window.__n++;
        // The source clip is portrait 0.46; anything squarer is a crop.
        const isCrop = source.width / source.height > 0.6;
        // Distant athlete: 12% of frame height, sitting in the video band.
        // Cropped athlete: 60%, centred.
        const span = isCrop ? 0.6 : 0.12;
        const top = isCrop ? 0.2 : 0.4;
        // The legs have to actually swing. A frozen pose reads as nobody
        // moving like a sprinter, the clip gets refused, and everything
        // downstream of that silently never runs.
        //
        // Not a simple alternation: a cropped frame costs two detect() calls,
        // so anything keyed on call parity comes out with the same phase on
        // consecutive graded frames and the athlete looks motionless. An
        // irrational-ish frequency moves between any two calls, whether they
        // are one apart or two. Amplitude solved so the resulting motion sits
        // inside the sprinter band for both test clips.
        const swing = Math.sin(n * 0.9) * 0.25 * span;
        const lm = [];
        for (let i = 0; i < 33; i++) {
          const isLeg = i >= 25;
          lm.push({
            x: (isCrop ? 0.35 : 0.10) + (i % 5) * span * 0.04,
            y: top + (i / 32) * span + (isLeg ? swing : 0),
            visibility: 0.95,
          });
        }
        return { landmarks: [lm] };
      },
    });
  });

  const run = async (name) => {
    const url = `http://localhost:${port}/clip/${CLIPS[name]}`;
    return page.evaluate(async (u) => {
      window.__seen = [];
      const blob = await (await fetch(u)).blob();
      const t0 = performance.now();
      const out = await extractFrames(blob, 6, 480, () => {});
      return {
        ms: Math.round(performance.now() - t0),
        frames: out.frames.length,
        metrics: out.metrics.length,
        rejection: out.rejection,
        shotTrimmed: out.shotTrimmed,
        cropped: out.cropped,
        denseFrames: out.denseFrames,
        seen: window.__seen,
      };
    }, url);
  };

  // ---------- the tiny-athlete screen recording ----------
  const bs = await run('blockStart');
  assert(errors.length === 0, 'no page errors during extraction: ' + JSON.stringify(errors));
  assert(bs.frames > 0, `frames were extracted (${bs.frames})`);
  // Assert this explicitly: a refusal here would skip everything below it
  // and the suite would still look green.
  assert(!bs.rejection, `the clip was accepted for grading (${bs.rejection || 'no rejection'})`);
  assert(bs.seen.length > 0, `pose was called (${bs.seen.length} times)`);

  // The source clip is 1290x2796 -> a full frame at maxEdge 480 is 221x480.
  // Anything with different dimensions is a crop aimed at the athlete.
  const fullFrames = bs.seen.filter((s) => s.w === 221 && s.h === 480).length;
  const crops = bs.seen.length - fullFrames;
  assert(crops > 0, `pose was handed cropped regions, not just whole phone screens (${crops} of ${bs.seen.length} inferences; ${bs.cropped} crops accepted)`);
  // Every frame costs one full-frame inference, plus one more when it gets
  // cropped -- so the frame count is the inferences minus the crops, and the
  // crop rate must be measured against that, not against inferences.
  const framesScanned = bs.seen.length - bs.cropped;
  assert(bs.cropped > framesScanned * 0.5,
    `cropping holds for the whole clip rather than spiralling out (${bs.cropped} crops over ${framesScanned} frames)`);

  // A crop is square-ish by construction (padded box), unlike the 0.46 aspect
  // of the phone frame -- a good signal the geometry is right.
  const aspects = bs.seen.filter((s) => !(s.w === 221 && s.h === 480)).map((s) => s.w / s.h);
  const squarish = aspects.filter((a) => a > 0.6 && a < 1.7).length;
  assert(aspects.length > 0 && squarish === aspects.length,
    `every crop is a square-ish padded box (${squarish}/${aspects.length})`);
  assert(bs.seen.every((s) => Math.max(s.w, s.h) <= 480),
    'crops respect the same pixel budget as full frames (longest edge <= 480)');

  // The strides that get graded are re-measured densely, not read off the
  // thin scout pass.
  assert(bs.denseFrames >= 8, `the graded strides were re-measured densely (${bs.denseFrames} frames)`);

  // The control centre pulled down over the last half-second is a second shot.
  assert(bs.shotTrimmed === true, 'the control-centre pull-down was detected and trimmed off');

  // ---------- the clip that scrolls to a different reel ----------
  const sc = await run('scrolled');
  assert(sc.shotTrimmed === true, 'the scroll to a second reel was detected and trimmed off');
  assert(errors.length === 0, 'still no page errors: ' + JSON.stringify(errors));

  // ---------- what each captured frame costs ----------
  // Pose inference is the capture rate. Two runs a frame at ~50ms is 100ms,
  // and the athlete's iPad measured exactly the 10 frames a second that
  // implies -- where his clip needs 15/s to grade (at 10/s the longest
  // continuous track is 7 frames against a minimum of 8). Once the crop is
  // aimed and sized, most frames run the crop alone.
  const cost = await page.evaluate(async (u) => {
    let calls = 0;
    const real = window.getPoseLandmarker;
    let n = 0;
    window.getPoseLandmarker = async () => ({
      detect: (src) => {
        calls++;
        const isCrop = src.width / src.height > 0.6;
        const span = isCrop ? 0.6 : 0.12, top = isCrop ? 0.2 : 0.4;
        const swing = Math.sin(n++ * 0.9) * 0.25 * span;
        const lm = [];
        for (let i = 0; i < 33; i++) {
          lm.push({ x: (isCrop ? 0.35 : 0.10) + (i % 5) * span * 0.04,
                    y: top + (i / 32) * span + (i >= 25 ? swing : 0), visibility: 0.95 });
        }
        return { landmarks: [lm] };
      },
    });
    const blob = await (await fetch(u)).blob();
    const out = await extractFrames(blob, 6, 480, () => {});
    window.getPoseLandmarker = real;
    return { calls, frames: out.capture.frames, withPose: out.capture.withPose,
             cropped: out.cropped, rejection: out.rejection };
  }, `http://localhost:${port}/clip/${CLIPS.blockStart}`);

  const perFrame = cost.calls / cost.frames;
  assert(perFrame < 1.6,
    `most frames cost one inference, not two (${perFrame.toFixed(2)} per frame over ${cost.frames} frames)`);
  // The saving must not come from simply losing him.
  assert(cost.withPose === cost.frames,
    `and every frame still comes back with a pose (${cost.withPose} of ${cost.frames})`);
  assert(cost.cropped > cost.frames * 0.5,
    `cropping still happens on most frames (${cost.cropped} of ${cost.frames})`);
  assert(!cost.rejection, `and the clip is still graded (${cost.rejection || 'no rejection'})`);

  // ---------- a clip the athlete only crosses briefly ----------
  // The fallback used to be gated on how many frames were CAPTURED, not how
  // many had anyone in them. On a 7.9s clip where the athlete runs through in
  // about a second, 236 captured frames sails past the minimum of 8, so the
  // clip was declared fine while pose had found him in five of them -- and
  // the slower, more thorough path never ran. Stub pose to find nobody in
  // most frames and check the capture stage does not call that a success.
  const sparse = await page.evaluate(async (u) => {
    const seen = [];
    const real = window.getPoseLandmarker;
    let n = 0;
    window.getPoseLandmarker = async () => ({
      detect: (source) => {
        // Anyone at all in only a handful of frames, spread thinly.
        const hit = (n++ % 40) === 0;
        seen.push(hit);
        if (!hit) return { landmarks: [] };
        const lm = [];
        for (let i = 0; i < 33; i++) {
          lm.push({ x: 0.4 + (i % 5) * 0.02, y: 0.3 + (i / 32) * 0.4, visibility: 0.95 });
        }
        return { landmarks: [lm] };
      },
    });
    const blob = await (await fetch(u)).blob();
    const out = await extractFrames(blob, 6, 480, () => {});
    window.getPoseLandmarker = real;
    return { frames: out.capture.frames, withPose: out.capture.withPose, played: out.capture.played };
  }, `http://localhost:${port}/clip/${CLIPS.blockStart}`);

  assert(sparse.frames > sparse.withPose * 3,
    `the stub leaves most frames empty, as the real clip did (${sparse.withPose} of ${sparse.frames})`);
  assert(sparse.played === false,
    `plenty of captured frames with almost nobody in them is not counted as a good read (${sparse.withPose} posed of ${sparse.frames} captured, played=${sparse.played})`);

  // Just over the bare track minimum is still not enough. A real refusal read
  // "10 of 71 frames over 7.1s had anyone in them" -- that clears a minimum of
  // 8 and still could not follow anyone, because the athlete needs that many
  // CONTINUOUS frames and scattered detections do not join up. Accepting the
  // fast pass at the bare minimum means never retrying on the clips that need
  // it most.
  const justOver = await page.evaluate(async (u) => {
    const real = window.getPoseLandmarker;
    let hits = 0;
    const target = MIN_TRACK_FRAMES + 1;
    window.getPoseLandmarker = async () => ({
      detect: () => {
        if (hits >= target) return { landmarks: [] };
        hits++;
        const lm = [];
        for (let i = 0; i < 33; i++) {
          lm.push({ x: 0.4 + (i % 5) * 0.02, y: 0.3 + (i / 32) * 0.4, visibility: 0.95 });
        }
        return { landmarks: [lm] };
      },
    });
    const blob = await (await fetch(u)).blob();
    const out = await extractFrames(blob, 6, 480, () => {});
    window.getPoseLandmarker = real;
    return { withPose: out.capture.withPose, played: out.capture.played,
             min: MIN_TRACK_FRAMES };
  }, `http://localhost:${port}/clip/${CLIPS.blockStart}`);

  assert(justOver.withPose > justOver.min,
    `the stub clears the bare track minimum (${justOver.withPose} posed vs minimum ${justOver.min})`);
  assert(justOver.played === false,
    `but scraping past the minimum is not treated as a good read (${justOver.withPose} posed, played=${justOver.played})`);

  // ---------- the copy that gets stored ----------
  // Storage, not egress, is the free tier's real ceiling: clips average 9.5MB
  // off the phone and the 1GB limit arrives in about five weeks at a few a
  // day. The grader downsamples to 480px internally, so shrinking the stored
  // copy costs nothing in scoring -- this only has to stay watchable.
  const shrunk = await page.evaluate(async (u) => {
    const src = await (await fetch(u)).blob();
    const { blob, note } = await compressForStorage(src, () => {});
    const v = document.createElement('video');
    v.src = URL.createObjectURL(blob); v.muted = true;
    await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 5000); });
    return { inB: src.size, outB: blob.size, note, w: v.videoWidth, h: v.videoHeight,
             dur: v.duration, srcDur: 4.27 };
  }, `http://localhost:${port}/clip/${CLIPS.blockStart}`);
  assert(shrunk.outB < shrunk.inB / 4,
    `the stored copy is much smaller than the upload (${(shrunk.inB/1048576).toFixed(1)}MB -> ${(shrunk.outB/1048576).toFixed(2)}MB)`);
  assert(shrunk.w > 0 && shrunk.h > 0, `and is still a playable video (${shrunk.w}x${shrunk.h})`);
  assert(Math.max(shrunk.w, shrunk.h) <= 720, `capped at 720 on the long edge (${shrunk.w}x${shrunk.h})`);
  // Recording runs in real time for exactly this reason: playing the source
  // faster to save time would shorten the recording and hand back a clip that
  // plays at double speed, which is useless for watching your own mechanics.
  assert(Math.abs(shrunk.dur - shrunk.srcDur) < 0.5,
    `and plays at the original speed, not faster (${shrunk.dur.toFixed(2)}s vs ${shrunk.srcDur}s)`);

  console.log(`\ntiming: blockStart ${bs.ms}ms, scrolled ${sc.ms}ms`);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
