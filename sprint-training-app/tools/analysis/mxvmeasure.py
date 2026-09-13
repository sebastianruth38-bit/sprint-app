# Bolt at top speed, slow motion, single athlete, plain backdrop: the clean
# reference the passing-position metric has been missing.
import cv2, math, json, numpy as np, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
F='/root/.claude/uploads/961e20ff-2122-5f80-8e50-942d67de74dd/d1db74ca-ScreenRecording_09082026_134558_1.mp4'
X0,Y0,X1,Y1=1215,228,1970,1410          # the player, inside the browser window
cap=cv2.VideoCapture(F); fps=cap.get(5)
lm=vision.PoseLandmarker.create_from_options(
  vision.PoseLandmarkerOptions(base_options=python.BaseOptions(model_asset_path='/tmp/pose_landmarker.task'),
  running_mode=vision.RunningMode.VIDEO,num_poses=1,
  min_pose_detection_confidence=0.5,min_tracking_confidence=0.5))
def ang(a,b,c):
    ba=(a[0]-b[0],a[1]-b[1]);bc=(c[0]-b[0],c[1]-b[1])
    d=ba[0]*bc[0]+ba[1]*bc[1];n=math.hypot(*ba)*math.hypot(*bc)
    return math.degrees(math.acos(max(-1,min(1,d/n)))) if n else float('nan')
rows=[];i=0
while True:
    ok,fr=cap.read()
    if not ok: break
    t=i/fps
    if t>10.6: break                     # before the sidebar slides over it
    if t>=1.0:
        c=fr[Y0:Y1,X0:X1]
        k=640/max(c.shape[:2])
        cs=cv2.resize(c,(int(c.shape[1]*k),int(c.shape[0]*k)))
        r=lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,
            data=cv2.cvtColor(cs,cv2.COLOR_BGR2RGB)),int(t*1000))
        if r.pose_landmarks:
            p=r.pose_landmarks[0]; cw,ch=cs.shape[1],cs.shape[0]
            if min(p[q].visibility for q in (11,12,23,24,25,26,27,28))>=0.5:
                P=lambda q:(p[q].x*cw,p[q].y*ch)
                ms=((P(11)[0]+P(12)[0])/2,(P(11)[1]+P(12)[1])/2)
                mh=((P(23)[0]+P(24)[0])/2,(P(23)[1]+P(24)[1])/2)
                legs=[]
                for hip,knee,ankl in ((23,25,27),(24,26,28)):
                    h,kk,a=P(hip),P(knee),P(ankl)
                    th=math.dist(h,kk); L=th+math.dist(kk,a)
                    legs.append(dict(h=h,k=kk,a=a,L=L,th=th,fold=ang(h,kk,a),
                        swing=math.degrees(math.atan2(kk[0]-h[0],kk[1]-h[1])),
                        hipAng=ang(ms,h,kk)))
                La,Lb=legs[0]['L'],legs[1]['L']
                if max(La,Lb)/max(1e-6,min(La,Lb))<1.4:
                    rows.append(dict(t=t,legs=legs,ms=ms,mh=mh,
                        scissor=ang(legs[0]['k'],mh,legs[1]['k']),
                        torso=math.degrees(math.atan2(abs(ms[0]-mh[0]),abs(ms[1]-mh[1]))),
                        body=(max(p[q].y for q in range(33))-min(p[q].y for q in range(33)))))
    i+=1
json.dump(rows,open('/tmp/pose/mxvrows.json','w'))
print(f"{len(rows)} clean frames, {rows[0]['t']:.2f}-{rows[-1]['t']:.2f}s, "
      f"body fills {np.median([r['body'] for r in rows])*100:.0f}% of the player")
