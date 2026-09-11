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

Five measures per clip, not nine. The old set double-counted: Torso-to-Thigh
and Thigh Separation are read at the same instant off the same frames, Passing
Position and Heel Recovery are both the fold, Front/Back Balance moves with
Foot Strike, and Upright Posture tracks Hip Height. An athlete reading nine
scores where four restate the other five cannot tell which to work on, which
is the only thing the scores are for. Those four are still computed, for the
flags they raise, and no longer scored.

| Clip type | What it is scored on |
|---|---|
| **Acceleration** | Drive Position (or Acceleration Posture), Shin Angle at Touchdown, Ankle at Touchdown, Foot Strike vs COM, Support Stiffness, Hip Height |
| **Max Velocity** | Thigh Separation, Heel Recovery, Foot Strike vs COM, Support Stiffness, Hip Height |
| **Speed Endurance** | the same five, and Smoothness / Consistency, which is the whole point of the clip type |

**Foot Strike vs COM** is where the foot lands relative to your centre of
mass, as a fraction of your own leg length. The mid-hip is the COM proxy a
single camera can see. Landing under the hips scores 5; nothing rewards
landing behind them, which elite sprinters do and developing ones should not
chase.

**Shin Angle at Touchdown** is acceleration only, because the same number
means opposite things at the two ends of a run: the shin is angled hard
forward out of the blocks and close to vertical by top speed.

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

### The warm-up is four phases, with your weak points starred

Every session gets the same warm-up: **I Mobility, II Movement, III
Activation, IV Workout Specific**. Phases I–III never change. Phase IV is
the session the athlete picks. There are six, one per session actually on the
schedule — acceleration, max velocity, speed endurance (which special
endurance shares), tempo, pre-meet and a lift day. A warm-up written for a
session nobody runs is one nobody notices going stale, so there are none.

Phases I–III follow how sprint programmes actually run a warm-up rather than a
general fitness template, which cost two things in the first version. There
are no static holds — pre-session mobility is done walking down the track,
because the point is range under control, not range at rest. And the drill
series runs **march → skip → run**: the A-march sets the position, the A-skip
adds rhythm and arms, the A-run puts it at speed. Having A-skips with no
A-march in front of them skipped the step that makes the skip mean anything.
`warmup_test.js` asserts both — the order, and that nothing in the general
warm-up is a timed static hold.

A lift day is the exception to the four phases. There is no room to run
indoors, so it takes phase I and skips the running drills in II and III;
phase IV is the loading ramp instead — the movement empty, then 25%, 50%,
75%, 90%, then the working sets. The
picker chooses the **workout**, not the day, and defaults to whatever is on the
plan for today: you already know what session you are about to do, and finding
the day it falls on is a step that adds nothing.

Nothing in it needs equipment. Every drill works on a track with an empty kit
bag, so bands, hurdles, sleds and blocks are out and `warmup_test.js` fails if
one creeps back in — a drill the athlete skips leaves a hole in the warm-up,
which is worse than a shorter one that is whole.

The scores do not change the warm-up. Every item is tagged with the measures
it addresses, and the ones addressing a measure the athlete scored 3/5 or
below are starred, with a link to something explaining how to fix it.

The first version of this built the whole tab out of weak points and showed
almost nothing to an athlete who had none — the one furthest along got the
least. So when nothing is scoring badly it stars the lowest score instead and
calls it sharpening rather than a fault, and `warmup_test.js` asserts directly
that it never comes back empty.

Rule-based on purpose. The drills for a weak heel recovery are the same drills
every time, so asking a model would spend the athlete's daily quota to
re-derive a constant and answer differently on Tuesday than on Monday. This
runs offline and can be tested — including that every measure tagged on an
item is one the grader emits (a star that can never light), and that every
measure an athlete can be weak at stars something (a fault with nowhere to fix
it).

### No gym, no problem

Settings → Training Setup has a **weight room** toggle. Turn it off and the
week's lifts are written as bodyweight work instead of barbell work — jumps in
place of cleans, push-ups and rows off a bar or table in place of benching,
single-leg squats in place of loaded ones.

The substitutions keep the quality each day existed for rather than just
removing the load: the acceleration day is about producing force fast, so
cleans become jumps rather than becoming squats for reps, and `gym_test.js`
asserts that a bodyweight accel day still contains jumping.

It is its own column defaulting to `true`, not an entry in the `equipment`
set, because in that set absent means "does not have it" — a Gym chip would
have moved every existing athlete to bodyweight the moment it shipped without
anyone touching a setting.

## The rest of the app

- **Form Analysis** — upload, grade, and a history of past clips with score trends.
- **Workouts** — a session type per day of the week, with the lifts that go with it, and somewhere to log what you actually ran and lifted.
- **Reference** — sprint-complementary lifts and plyos with how-to videos.
- **Times** — times per distance with a trend, a goal broken into small goals, and a board of the marks you're chasing.
- **Warm-up** — four phases for whichever workout you pick, needing no equipment, with the parts that fix your weak points starred.

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

29 suites. The pure-logic ones run the grader's maths against recorded pose
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
