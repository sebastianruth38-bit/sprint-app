# Sprintr

A training app for sprinters. Upload a clip of yourself running and it grades
your mechanics — foot strike, hip height, thigh separation, heel recovery,
posture — then keeps the scores next to your workouts, lifts and times so you
can see whether any of it is moving.

Live at **<https://sebastianruth38-bit.github.io/sprint-app/>**.

No framework and no build step. `index.html`, `app.js`, `styles.css` and a
`config.js` are copied to a branch and served as static files. Accounts and
storage are Supabase.

## How the grading works

**The pose model runs in your browser, on your phone.** MediaPipe Tasks reads
the video off the device, finds the joints, and the measurements happen
locally. **The video is never uploaded at all** — not to be graded, and not
afterwards. What gets kept is a handful of stills.

Everything measured is **scale-free**: angles, or lengths expressed as a
fraction of the athlete's own leg. Nobody knows how far the camera was or how
tall you are, so a measurement that depends on either is a measurement that
cannot be trusted. Motion is measured over a fixed time gap rather than
per-frame, so a clip captured at 8fps and one at 30fps give the same answer.

Depending on the clip type you get some of:

| Clip type | What it is scored on |
|---|---|
| **Every clip** | Foot Strike vs Hips, Hip Height, Support Stiffness — or Ankle at Touchdown, when support cannot be read |
| **Acceleration** | Drive Position, or Acceleration Posture once there are enough strides to see the rise |
| **Max Velocity** and **Speed Endurance** | Torso-to-Thigh at Peak Lift, Thigh Separation, Heel Recovery, Passing Position, Front/Back Swing Balance, Upright Posture |
| **Speed Endurance** | …and Smoothness / Consistency, which is the whole point of the clip type |

The top-speed measures are deliberately not asked of an acceleration clip: the
leg legitimately stays long through the swing out of the blocks, and the same
numbers that mean a fault at top speed would be read as one there.

Each is scored 1–5 against bands in `tools/CALIBRATION.md`, every one of which
came from measuring real footage rather than from a textbook.

### It refuses clips it cannot read

This is the part that matters most and the part that took longest to get
right. A confident score from a bad read is worse than no score. So the app
checks that it found a single athlete, that they were in shot long enough,
that they were actually sprinting and not walking back to the blocks, that
their feet were not clamped to the bottom edge of the frame, and that the
device managed enough frames a second to measure anything at all — and says
which of those failed when it will not grade.

The `How to film it` panel above the Analyze button exists because every one
of those refusals is decided before the phone starts recording.

### What it keeps: the moments, not the clip

Storing the video meant storing 3MB to show the athlete a few tenths of a
second that mattered, and then leaving them to find those tenths by scrubbing.
So the clip is not kept. `keyMoments()` picks the instants the scores were
actually read at — the deepest touchdown, the peak of the thigh carry, the
tightest heel fold, the extreme of the torso angle — and those frames are
saved, captioned with the measure each one belongs to.

Three or four stills at ~40KB against 3MB of video, and each is the moment a
number is talking about. Every metric row carries the timestamp it was
captured at, which is what makes the match exact; two moments landing closer
than `KEY_FRAME_MIN_GAP_S` are one photograph with two captions, so they
collapse.

### AI coach notes are opt-in and off by default

Tick the box and six still frames go through an edge function to Anthropic's
API, which writes the notes. Only frames leave the device, never the video,
and never at all if the box is unticked. Ten a day per account.

## Accounts and data

Sign in with email + password, a magic link, or Google. Every table is scoped
to `auth.uid()` by Row Level Security, so the database itself refuses to hand
one athlete's rows to another regardless of what the client asks for. Key
frames live in a private bucket reached through short-lived signed URLs, and
are loaded only when the athlete taps to see them — attaching them to every
row cost 2MB of egress to open a history of twenty.

**Key frames, scores and training data are kept** until you delete them.
There is no video to expire. Clips uploaded before 10 September 2026, when the
app still stored them, are cleared 30 days after upload by `purgeExpiredVideos`
— which is all `VIDEO_RETENTION_DAYS` is still for. Settings → Delete Account
removes everything via the `delete-account` function.

`privacy.html` and `terms.html` describe exactly this, and `tests/legal_test.js`
reads the constants out of `app.js` to check they still agree — a policy that
misdescribes the app is worse than no policy.

### The warm-up is built from the scores

The app knows an athlete's latest score for every measure, which is exactly
what a targeted warm-up needs. `buildWarmup()` takes the two weakest measures
scoring 3/5 or below and prescribes the standard drills for each, then finishes
with whatever suits today's session — accelerations before a block day,
build-ups before a fly day, nothing at all on a rest day.

Rule-based on purpose. The drills for a weak heel recovery are the same drills
every time, so asking a model would spend the athlete's daily quota to
re-derive a constant and give a different answer on Tuesday than on Monday.
This runs offline, costs nothing, and `tests/warmup_test.js` can check it —
including that every drill is keyed to a measure the grader actually emits,
since a mistyped key is a drill that silently can never appear.

## The rest of the app

- **Form Analysis** — upload, grade, and a history of past clips with score trends.
- **Workouts** — a session type per day of the week, with the lifts that go with it, and somewhere to log what you actually ran and lifted.
- **Reference** — sprint-complementary lifts and plyos with how-to videos.
- **Times** — times per distance with a trend, a goal broken into small goals, and a board of the marks you're chasing.
- **Warm-up** — the general work, then drills aimed at whatever your clips scored worst, then a finish matched to today's session.

## Running it locally

The pose model and camera need a secure context, so serve it rather than
opening `file://`:

```
cd sprint-training-app
python3 -m http.server 8000
# http://localhost:8000
```

It will talk to the real Supabase project in `config.js`. The anon key there
is public by design; Row Level Security is what protects the data, not the key.

## Tests

```
./tests/run.sh           # everything that needs no clips
./tests/run.sh --clips   # also the ones that need tests/clips/
```

27 suites. The pure-logic ones run the grader's maths against recorded pose
data; the rest drive the real page in headless Chromium with the network
stubbed. `tests/setup.sh` builds the fixture copy of the app — **it runs
automatically from `run.sh`, but if you test by hand after editing `app.js`,
`index.html` or `styles.css`, run it first.** A stale fixture has produced
false greens more than once.

## Deploying

```
./tools/deploy.sh
```

Copies the app to the `gh-pages` branch and stamps the current commit onto
every asset URL, because `?v=` on the page alone does not stop Safari serving
a cached `app.js`.

## Offline analysis tools

`tools/` holds Python scripts that run the same pose model outside the browser
so a clip can be inspected frame by frame — draw the skeleton, isolate one
athlete from a pack, measure a band. See `tools/README.md`.

Look at the pictures before believing any number. Every bug worth fixing so
far was found there first and explained afterwards.
