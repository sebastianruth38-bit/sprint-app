#!/usr/bin/env python3
"""Draw the tracked skeleton over a clip so a human can check it.

Every measurement the app reports is only as good as where these dots land,
and numbers alone hide that -- a hip angle of 107 degrees looks reasonable
whether it came from the athlete or from a spectator behind him. Rendering
the skeleton is what caught the tracker running on over the bystanders, the
feet leaving the bottom of the frame, and the leg lengths swinging 10x.

The two legs are drawn in different colours on purpose. Left is green, right
is magenta, so a left/right swap -- which MediaPipe does often on a side-on
view, where the legs overlap -- is obvious at a glance instead of hiding
inside an averaged angle. Torso and arms stay amber so the legs read clearly.

Usage:
    python3 skeleton_overlay.py CLIP.mov out.jpg 1.76,1.79,1.83,1.86
    python3 skeleton_overlay.py CLIP.mov out.jpg 1.0:2.0:0.1     # start:end:step

Each tile is captioned with the timestamp and the two leg lengths in pixels.
Those should track each other and change smoothly; a sudden 2x jump between
neighbouring frames means the pose is wrong, not that the athlete changed.
"""
import cv2, math, sys
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

MODEL = '/tmp/pose_landmarker.task'
TILE = 360
# hip->knee->ankle->foot for each side, plus the torso and arms
EDGES = [(11, 13), (13, 15), (12, 14), (14, 16), (11, 12), (11, 23), (12, 24), (23, 24),
         (23, 25), (25, 27), (27, 31), (24, 26), (26, 28), (28, 32)]
LEFT, RIGHT = {23, 25, 27, 31}, {24, 26, 28, 32}
GREEN, MAGENTA, AMBER, WHITE = (0, 255, 0), (255, 0, 255), (0, 200, 255), (255, 255, 255)


def parse_times(spec):
    if ':' in spec:
        a, b, step = (float(x) for x in spec.split(':'))
        out, t = [], a
        while t <= b + 1e-9:
            out.append(round(t, 3))
            t += step
        return out
    return [float(x) for x in spec.split(',')]


def colour_for(a, b):
    if a in LEFT or b in LEFT:
        return GREEN
    if a in RIGHT or b in RIGHT:
        return MAGENTA
    return AMBER


def main(path, out_path, times):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    W, H = int(cap.get(3)), int(cap.get(4))
    opts = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=MODEL),
        running_mode=vision.RunningMode.IMAGE, num_poses=2,
        min_pose_detection_confidence=0.5)
    landmarker = vision.PoseLandmarker.create_from_options(opts)

    tiles = []
    for t in times:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ok, frame = cap.read()
        if not ok:
            continue
        res = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                                         data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
        if not res.pose_landmarks:
            continue
        # the biggest torso is the nearest person, which is the one being graded
        p = max(res.pose_landmarks, key=lambda q: abs(q[23].y - q[11].y))
        px = lambda i: (int(p[i].x * W), int(p[i].y * H))

        for a, b in EDGES:
            cv2.line(frame, px(a), px(b), colour_for(a, b), 3)
        for i in (25, 27):
            cv2.circle(frame, px(i), 5, GREEN, -1)
        for i in (26, 28):
            cv2.circle(frame, px(i), 5, MAGENTA, -1)

        xs = [p[i].x * W for i in range(33)]
        ys = [p[i].y * H for i in range(33)]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        side = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.5
        x0, y0 = int(max(0, cx - side / 2)), int(max(0, cy - side / 2))
        x1, y1 = int(min(W, cx + side / 2)), int(min(H, cy + side / 2))
        crop = frame[y0:y1, x0:x1]
        if crop.size == 0:
            continue
        crop = cv2.resize(crop, (TILE, TILE))

        seg = lambda a, b: math.dist(px(a), px(b))
        left = seg(23, 25) + seg(25, 27)
        right = seg(24, 26) + seg(26, 28)
        cv2.putText(crop, f'{t:.2f}s', (6, 22), 0, 0.6, WHITE, 2)
        cv2.putText(crop, f'L{left:.0f} R{right:.0f}', (6, TILE - 12), 0, 0.55, WHITE, 2)
        tiles.append(crop)

    if not tiles:
        print('no pose found at any of those times')
        return 1
    cv2.imwrite(out_path, np.hstack(tiles))
    print(f'{out_path}: {len(tiles)} frames')
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2], parse_times(sys.argv[3])))
