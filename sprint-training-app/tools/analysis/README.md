# Analysis scripts

Throwaway scripts that turned out not to be throwaway. Every band in
`../CALIBRATION.md` came out of one of these, and every bug worth the name in
the pose grader was found by running one and looking at what it printed.

They are kept because the numbers in CALIBRATION.md are worthless without the
means to reproduce them. If a band ever looks wrong, re-measure it with the
script that produced it rather than adjusting it by feel.

## The two kinds

**Python (`.py`)** run MediaPipe directly over a video with OpenCV. Used
wherever the browser could not go: measuring reference footage, testing crops,
drawing skeletons over real frames. They need `opencv-python` and
`mediapipe`, plus the model file (see Paths).

**Node (`.js`)** pull the real scoring functions out of `app.js` by name into
a `vm` context and run them over landmarks a Python script already dumped to
JSON. This is the important property: they score with the shipping code, not a
reimplementation of it. Every time the harness drifted from the app it
produced a confident wrong answer.

## What each one is for

| script | question it answers |
| --- | --- |
| `appsim.py` | mirrors `extractFrames` including the auto-crop; dumps coarse + dense landmarks for scoring in Node |
| `bothpasses.py` | scout samples plus a full 30/s sampling, so the dense window can be sliced by the app's own logic |
| `cropcheck.py` | does the auto-crop lift a clip over the subject-size threshold? |
| `bolt2.py` | isolating one athlete from a race pack: find the bright kit, then crop tight and re-run pose on the crop alone |
| `mxvmeasure.py` | the clean single-athlete reference at top speed that the passing-position bands are calibrated against |
| `mxvdraw2.py` | draws the measured skeleton back over the source frames, tiled |
| `onepass.js` | scores the single-playback capture that actually ships |
| `fullrun.js` | the older coarse-then-dense shape, kept because CALIBRATION numbers cite it |
| `passing.js` | passing position: how folded is the leg as it swings under the hip |
| `hipdrop.js` | can hip drop through contact replace the ankle angle, which the toe landmark is too noisy to support |
| `ankle.js` | which frames the ankle angle was actually read from, when it scored 2/5 on a stiff ankle |
| `motioncal.js` | is the motion measure rate-invariant, and where do the sprinter bands sit |
| `densecheck.js` | does the dense pass give the same answer wherever the window lands |
| `reproduce.js` | re-runs a specific clip end to end after a change |
| `profile.js` | where the time goes: decoding or pose inference (it was decoding, 100% of it) |

## Paths

These were written against scratch directories and still name them:

- `/tmp/pose/*.json` -- intermediate landmark dumps. Any directory works;
  the Python script writes it and the Node script reads it.
- `/tmp/pose_landmarker.task` -- the MediaPipe model. Download
  `pose_landmarker_lite.task` from Google's model garden and point the script
  at it.
- `/root/.claude/uploads/...` in `mxvmeasure.py` and `mxvdraw2.py` -- the Bolt
  max-velocity reference clip, along with the pixel box `X0,Y0,X1,Y1` that
  crops the video player out of the screen recording. Both need editing for
  any other source.

Paths to `app.js` are resolved relative to this directory, so the Node
scripts work from a fresh clone.

## The rule these scripts exist to enforce

Draw the skeleton and look at it before believing any number. Every
significant bug here was seen by eye first and explained afterwards -- the
227% hip collapse, the track that wandered onto a bystander, the crop that
inflated 32% a frame, the ankle read from a toe landmark swinging 45 degrees
between consecutive frames. None of them looked wrong as a number.

And: a reference and a subject must go through an identical pipeline before
any comparison between them means anything. Comparing a filtered measurement
against an unfiltered one invented a 45-degree gap that did not exist.
