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
locally. The video is not uploaded in order to be graded — it is uploaded
afterwards only so you can watch it back from the history list.

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

### AI coach notes are opt-in and off by default

Tick the box and six still frames go through an edge function to Anthropic's
API, which writes the notes. Only frames leave the device, never the video,
and never at all if the box is unticked. Ten a day per account.

## Accounts and data

Sign in with email + password, a magic link, or Google. Every table is scoped
to `auth.uid()` by Row Level Security, so the database itself refuses to hand
one athlete's rows to another regardless of what the client asks for. Clips
live in a private bucket reached through short-lived signed URLs.

**Video is deleted after 30 days.** Scores and training data are kept, so the
history stays useful once the clip is gone. Settings → Delete Account removes
everything, including the clips, via the `delete-account` function.

`privacy.html` and `terms.html` describe exactly this, and `tests/legal_test.js`
reads the constants out of `app.js` to check they still agree — a policy that
misdescribes the app is worse than no policy.

## The rest of the app

- **Form Analysis** — upload, grade, and a history of past clips with score trends.
- **Workouts** — a session type per day of the week, with the lifts that go with it, and somewhere to log what you actually ran and lifted.
- **Reference** — sprint-complementary lifts and plyos with how-to videos.
- **Times** — times per distance, with a trend, and a goal broken into small goals.
- **Hype** — quotes, elite race footage, and a board of the marks you're chasing.

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

26 suites. The pure-logic ones run the grader's maths against recorded pose
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
