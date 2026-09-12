# Does the app's auto-crop lift these clips over the size threshold?
import cv2, math, sys, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
MINC=0.5; PAD=2.2; MAXEDGE=480
path,t0,t1,label=sys.argv[1],float(sys.argv[2]),float(sys.argv[3]),sys.argv[4]
cap=cv2.VideoCapture(path); W=int(cap.get(3)); H=int(cap.get(4)); fps=cap.get(5)
k=MAXEDGE/max(W,H); CW,CH=round(W*k),round(H*k)
o=vision.PoseLandmarkerOptions(base_options=python.BaseOptions(model_asset_path='/tmp/pose_landmarker.task'),
    running_mode=vision.RunningMode.IMAGE,num_poses=1,min_pose_detection_confidence=0.5)
lm=vision.PoseLandmarker.create_from_options(o)
def frac(p):
    ys=[q.y for q in p if q.visibility>=MINC]
    return (max(ys)-min(ys)) if len(ys)>=6 else None
full=[];crop=[];lastbox=None;side=None
t=t0
while t<=t1:
    cap.set(cv2.CAP_PROP_POS_MSEC,t*1000); ok,fr=cap.read()
    if not ok: break
    sm=cv2.resize(fr,(CW,CH),interpolation=cv2.INTER_AREA)
    r=lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(sm,cv2.COLOR_BGR2RGB)))
    if r.pose_landmarks:
        p=r.pose_landmarks[0]; f=frac(p)
        if f:
            full.append(f)
            xs=[q.x for q in p if q.visibility>=MINC]; ys=[q.y for q in p if q.visibility>=MINC]
            lastbox=(min(xs),min(ys),max(xs),max(ys)); side=f*H*PAD
    if lastbox and side:
        cx=((lastbox[0]+lastbox[2])/2)*W; cy=((lastbox[1]+lastbox[3])/2)*H
        sx=max(0,min(W-1,cx-side/2)); sy=max(0,min(H-1,cy-side/2))
        sw=min(W-sx,side); sh=min(H-sy,side)
        if sw>16 and sh>16 and sw*sh < W*H*0.8:
            c=fr[int(sy):int(sy+sh),int(sx):int(sx+sw)]
            if c.size:
                kk=MAXEDGE/max(c.shape[1],c.shape[0])
                c=cv2.resize(c,(max(1,int(c.shape[1]*kk)),max(1,int(c.shape[0]*kk))))
                r2=lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(c,cv2.COLOR_BGR2RGB)))
                if r2.pose_landmarks:
                    f2=frac(r2.pose_landmarks[0])
                    if f2: crop.append(f2)
    t+=1/15
med=lambda v: sorted(v)[len(v)//2] if v else None
print(f"{label:16s} full frame {med(full)*100 if full else 0:5.1f}%  ->  cropped {med(crop)*100 if crop else 0:5.1f}%   (n={len(full)}/{len(crop)})")
