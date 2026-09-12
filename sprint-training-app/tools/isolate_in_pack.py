#!/usr/bin/env python3
"""Try to isolate one athlete in a race pack, by the brightness of his kit.

EXPERIMENTAL, and it does not currently work well enough to grade from. Kept
because the first half does work and race analysis is a someday feature.

What works: finding the right athlete. Running pose over the whole frame and
picking the body whose torso patch is brightest reliably located Bolt in a
white singlet among runners in dark kit, across a whole 12-second clip.

What does not: measuring his legs. In a pack the runners overlap, and pose
merges them -- Bolt's torso with the trailing athlete's leg. Cropping tightly
to him and re-running with num_poses=1 does not fix it, because a competitor
is inside the crop too. After a geometry filter (foot within 0.65 of a leg
length of the hip, thigh 38-62% of the leg, hips together) 24 of 219 frames
survived, and inspecting those showed the surviving "legs" were his extended
stance leg plus a stranger's -- while his RECOVERING leg, the one worth
measuring, is the part hidden behind his body.

So: the athlete can be identified in a pack, but not measured in one. What
would be needed is either per-athlete segmentation rather than pose alone, or
a camera angle where the runners do not overlap.

    python3 isolate_in_pack.py CLIP.mp4 START_SECONDS END_SECONDS
"""
import cv2, math, sys, json, numpy as np, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
MINC=0.5
F=sys.argv[1]; T0=float(sys.argv[2]); T1=float(sys.argv[3])
cap=cv2.VideoCapture(F); W=int(cap.get(3));H=int(cap.get(4));fps=cap.get(5)
mk=lambda n,mode: vision.PoseLandmarker.create_from_options(
    vision.PoseLandmarkerOptions(base_options=python.BaseOptions(model_asset_path='/tmp/pose_landmarker.task'),
    running_mode=mode,num_poses=n,min_pose_detection_confidence=0.4))
find=mk(6,vision.RunningMode.IMAGE); solo=mk(1,vision.RunningMode.IMAGE)
def ang(a,b,c):
    ba=(a[0]-b[0],a[1]-b[1]);bc=(c[0]-b[0],c[1]-b[1])
    d=ba[0]*bc[0]+ba[1]*bc[1];n=math.hypot(*ba)*math.hypot(*bc)
    return math.degrees(math.acos(max(-1,min(1,d/n)))) if n else float('nan')
rows=[];i=0;kept=0;tried=0
while True:
    ok,fr=cap.read()
    if not ok: break
    t=i/fps
    if t>T1: break
    if t>=T0:
        tried+=1
        res=find.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(fr,cv2.COLOR_BGR2RGB)))
        best=None
        for p in res.pose_landmarks:
            if min(p[k].visibility for k in (11,12,23,24))<MINC: continue
            P=lambda k:(p[k].x*W,p[k].y*H)
            ms=((P(11)[0]+P(12)[0])/2,(P(11)[1]+P(12)[1])/2)
            mh=((P(23)[0]+P(24)[0])/2,(P(23)[1]+P(24)[1])/2)
            x0,x1=int(min(ms[0],mh[0])-12),int(max(ms[0],mh[0])+12)
            y0,y1=int(min(ms[1],mh[1])),int(max(ms[1],mh[1]))
            if x1<=x0 or y1<=y0 or x0<0 or y0<0 or x1>W or y1>H: continue
            patch=fr[y0:y1,x0:x1]
            if patch.size==0: continue
            torso=math.dist(ms,mh)
            if torso<25: continue
            b=float(patch.mean())
            if best is None or b>best[0]: best=(b,ms,mh,torso)
        if best:
            _,ms,mh,torso=best
            # a body is about 4 torso lengths tall; crop him alone
            cx=(ms[0]+mh[0])/2; cy=(ms[1]+mh[1])/2
            half=torso*2.1
            X0,Y0=int(max(0,cx-half)),int(max(0,cy-half*0.9))
            X1,Y1=int(min(W,cx+half)),int(min(H,cy+half*1.5))
            crop=fr[Y0:Y1,X0:X1]
            if crop.size:
                k=480/max(crop.shape[:2])
                cs=cv2.resize(crop,(max(1,int(crop.shape[1]*k)),max(1,int(crop.shape[0]*k))))
                r2=solo.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(cs,cv2.COLOR_BGR2RGB)))
                if r2.pose_landmarks:
                    p=r2.pose_landmarks[0]
                    cw,ch=cs.shape[1],cs.shape[0]
                    Q=lambda q:(X0+p[q].x*(X1-X0), Y0+p[q].y*(Y1-Y0))
                    if min(p[q].visibility for q in (11,12,23,24,25,26,27,28))>=MINC:
                        ms2=((Q(11)[0]+Q(12)[0])/2,(Q(11)[1]+Q(12)[1])/2)
                        mh2=((Q(23)[0]+Q(24)[0])/2,(Q(23)[1]+Q(24)[1])/2)
                        legs=[]
                        for hip,knee,ankl in ((23,25,27),(24,26,28)):
                            h,kk,a=Q(hip),Q(knee),Q(ankl)
                            th=math.dist(h,kk); L=th+math.dist(kk,a)
                            legs.append(dict(h=h,k=kk,a=a,L=L,th=th,
                                fold=ang(h,kk,a),
                                swing=math.degrees(math.atan2(kk[0]-h[0],kk[1]-h[1]))))
                        # both legs must look like legs of the same body
                        La,Lb=legs[0]['L'],legs[1]['L']
                        if max(La,Lb)/max(1e-6,min(La,Lb))<1.45:
                            kept+=1
                            rows.append(dict(t=t,legs=legs,mh=mh2,ms=ms2,
                                box=[X0,Y0,X1,Y1],torso=math.dist(ms2,mh2)))
    i+=1
json.dump(rows,open('/tmp/pose/boltrows2.json','w'))
print(f"{kept}/{tried} frames kept after cropping to him alone and checking both legs match")
