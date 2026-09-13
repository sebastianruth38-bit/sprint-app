# Tests

Plain Node scripts. No runner, no framework, no dependencies to install --
`node tests/framing_test.js` and read the output. Each one prints `PASS:` /
`FAIL:` lines and exits non-zero if anything failed.

They were written alongside the bugs they catch, so the comments in them are
usually worth more than the assertions. Most say, in the test body, what went
wrong and what the wrong number was.

## Running them

The pure-logic suites need nothing:

    node tests/framing_test.js

The browser suites drive a real Chromium through Playwright and need the
served fixture built first:

    ./tests/setup.sh
    node tests/local_flow_test.js

Re-run `setup.sh` after any edit to `app.js`, `index.html` or `styles.css` --
it copies them into `tests/fixtures/app/`. A stale fixture is the single
easiest way to get a green run on code you did not test.

Paths are overridable by environment variable if you want to point a suite
somewhere else: `APP_DIR`, `CLIPS_DIR`, `OUT_DIR`.

## Why there is a fixture at all

`index.html` loads supabase-js from jsdelivr, and the sandbox these were
written in blocks every CDN. `setup.sh` copies the app and rewrites that one
`<script>` tag to the vendored `tests/vendor/supabase.js`. Everything else is
the shipped file, so a browser test exercises the code that actually deploys.

## The suites

Pose grading -- the local MediaPipe pipeline:

| file | what it pins down |
| --- | --- |
| `tracking_test.js` | track association, subject selection, stride counting, passing position |
| `framing_test.js` | the toe-landmark crash, subject size, shot-cut splitting, feet-in-frame |
| `motion_test.js` | rate-invariant motion measurement and the sprinter band |
| `gait_test.js` | foot contacts, hip sink, ankle stiffness, the scoring bands |
| `subject_test.js` | picking the athlete out of several people in frame |
| `dense_test.js` | dense re-measurement of the graded window |
| `frames_test.js` | frame extraction and sampling |
| `coverage_test.js` | how much of a clip is usable |
| `v2_test.js` | the scoring rollup |
| `local_flow_test.js` | the whole local path in a browser, model stubbed |
| `crop_flow_test.js` | cropping and shot-splitting against real clips (see below) |

App logic -- scheduling, logging, UI:

`logic_test.js`, `split_test.js`, `bodyweight_test.js`, `sched_test.js`,
`e2e_sched.js`, `avail_test.js`, `ref_test.js`, `btn_test.js`,
`quota_ui_test.js`, `expand_test2.js`, `ui_test4.js`.

Four earlier suites (`ui_test`, `ui_test2`, `ui_test3`, `expand_test`) are
not here. They asserted against the per-rep logging UI that the compact
combo-row design replaced, so they failed on a design decision rather than a
regression. `ui_test4.js` and `expand_test2.js` are their replacements and
cover a strict superset -- including the 375px overlap check.

## Clips

`crop_flow_test.js` runs against real uploaded clips in `tests/clips/`, which
is not committed -- they are ~17 MB each and they are footage of a person.
Put two clips there to run it:

- `blockStart.webm` -- a single athlete, small in frame, with the iOS control
  centre pulled down over the last half second
- `scrolled.webm` -- a recording that scrolls to a second reel partway through

Chromium in the sandbox has no proprietary codecs, so `.mov` off a phone has
to be transcoded to VP8 webm first. Half resolution is fine: aspect ratio, the
athlete's share of the frame and the shot cuts all survive it, and those are
what the test measures.

Everything listed above passes. If one goes red, it is a regression.
