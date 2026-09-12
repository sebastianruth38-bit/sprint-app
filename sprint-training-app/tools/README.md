# Analysis tools

Offline scripts for checking the grader against real footage. They are not
part of the app -- the app measures in the browser with MediaPipe Tasks; these
run the same model from Python so a clip can be inspected frame by frame.

They need `mediapipe`, `opencv-python-headless`, and the model file at
`/tmp/pose_landmarker.task` (the same `pose_landmarker_lite.task` the app
loads).

## skeleton_overlay.py

Draws the tracked skeleton over chosen frames, left leg green and right leg
magenta, captioned with each leg's length in pixels.

    python3 skeleton_overlay.py clip.mov out.jpg 1.76,1.79,1.83,1.86
    python3 skeleton_overlay.py clip.mov out.jpg 1.0:2.0:0.1

Look at this before believing any number. Every bug worth fixing so far was
found here first and only explained afterwards:

- leg lengths jumping 2x between neighbouring frames -- the tracker had moved
  onto a different person
- the skeleton spanning from the athlete to a bench behind him
- feet sitting exactly on the bottom edge of the picture, where MediaPipe
  clamps anything out of shot and ground contact gets invented from it
- left and right swapping on a side-on view, where the legs overlap

A left/right swap is invisible in the numbers and obvious in the colours,
which is the reason for the two-colour scheme.

## isolate_in_pack.py

Isolating one athlete from a race pack. Its limits are documented in the
script itself -- read them before trusting a number off a race clip.

## analysis/

The measurement scripts every band in `CALIBRATION.md` came out of. See
`analysis/README.md`.

## deploy.sh

Publishes to the `gh-pages` branch, stamping the commit SHA onto the asset
URLs. Without that stamp a browser keeps serving the cached `app.js` and the
deploy silently does nothing.

## ../tests/

`../tests/run.sh` runs every suite. Run it before deploying.
