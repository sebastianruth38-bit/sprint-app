# Emits the scout samples the app would take, plus a full 30/s sampling of the
# whole clip so the dense window can be sliced in JS by the app's own logic.
import cv2, json, sys, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
SCOUT_RATE, SCOUT_MAX, DENSE_RATE = 10, 40, 30
path, outp = sys.argv[1], sys.argv[2]
cap=cv2.VideoCapture(path); W=int(cap.get(3)); H=int(cap.get(4)); fps=cap.get(5); n=cap.get(7)
dur=n/fps
k=480/max(W,H); CW,CH=round(W*k),round(H*k)
o=vision.PoseLandmarkerOptions(base_options=python.BaseOptions(model_asset_path='/tmp/pose_landmarker.task'),
    running_mode=vision.RunningMode.IMAGE,num_poses=4,min_pose_detection_confidence=0.5)
lm=vision.PoseLandmarker.create_from_options(o)
def grab(t):
    cap.set(cv2.CAP_PROP_POS_MSEC,t*1000); ok,fr=cap.read()
    if not ok: return None
    sm=cv2.resize(fr,(CW,CH),interpolation=cv2.INTER_AREA)
    r=lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(sm,cv2.COLOR_BGR2RGB)))
    return [[{'x':round(p[q].x,5),'y':round(p[q].y,5),'visibility':round(p[q].visibility,3)}
             for q in range(33)] for p in r.pose_landmarks]
clamp=lambda t: min(max(t,0.05),max(dur-0.05,0))
count=max(16,min(SCOUT_MAX,round(dur*SCOUT_RATE)))
scout_t=[clamp(dur*i/max(count-1,1)) for i in range(count)]
scout=[grab(t) or [] for t in scout_t]
dense_t=[clamp(i/DENSE_RATE) for i in range(int(dur*DENSE_RATE))]
dense=[grab(t) or [] for t in dense_t]
json.dump({'cw':CW,'ch':CH,'srcH':H,'duration':dur,
           'secondsPerFrame':dur/max(count-1,1),
           'scoutTimes':scout_t,'scout':scout,'denseTimes':dense_t,'dense':dense},open(outp,'w'))
print(f"{path.split('/')[-1]}: scout {count} ({sum(1 for f in scout if f)} posed), "
      f"dense {len(dense_t)} ({sum(1 for f in dense if f)} posed)")
