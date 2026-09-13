# Mirrors app.js extractFrames INCLUDING the auto-crop, which the earlier
# harness could not do. Emits coarse + dense landmarks for scoring in Node.
import cv2, json, sys, math, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
SCOUT_RATE,SCOUT_MIN,SCOUT_MAX = 6,12,30
DENSE_RATE,DENSE_MAX = 30,32
SUBJECT_FRAC_MIN, CROP_PADDING, MINC, MAXEDGE = 0.25, 2.2, 0.5, 480
path,outp = sys.argv[1],sys.argv[2]
cap=cv2.VideoCapture(path); W=int(cap.get(3));H=int(cap.get(4));fps=cap.get(5);n=cap.get(7)
dur=n/fps
k=MAXEDGE/max(W,H); CW,CH=round(W*k),round(H*k)
o=vision.PoseLandmarkerOptions(base_options=python.BaseOptions(model_asset_path='/tmp/pose_landmarker.task'),
    running_mode=vision.RunningMode.IMAGE,num_poses=4,min_pose_detection_confidence=0.5)
lm=vision.PoseLandmarker.create_from_options(o)
def dump(p): return [{'x':round(q.x,5),'y':round(q.y,5),'visibility':round(q.visibility,3)} for q in p]
def frac(p):
    ys=[q.y for q in p if q.visibility>=MINC]
    return (max(ys)-min(ys)) if len(ys)>=6 else None
def bounds(p):
    xs=[q.x for q in p if q.visibility>=MINC]; ys=[q.y for q in p if q.visibility>=MINC]
    return (min(xs),min(ys),max(xs),max(ys)) if len(xs)>=6 else None
EDGE=0.02
def at_edge(p):
    b=bounds(p)
    return b is None or b[0]<=EDGE or b[1]<=EDGE or b[2]>=1-EDGE or b[3]>=1-EDGE

state={'lastBox':None,'cropSide':0.0,'crops':0}
def measure(fr,t):
    """One frame, exactly as the app does it: whole frame first, then a crop
    aimed at where he was last seen if he came back too small."""
    sm=cv2.resize(fr,(CW,CH),interpolation=cv2.INTER_AREA)
    r=lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(sm,cv2.COLOR_BGR2RGB)))
    poses=list(r.pose_landmarks)
    lead=max(poses,key=lambda p:(frac(p) or 0)) if poses else None
    leadfrac=frac(lead) if lead else 0
    if lead and leadfrac:
        # only size the crop from a body wholly inside the picture
        if not at_edge(lead):
            state['cropSide']=leadfrac*H*CROP_PADDING
        bb=bounds(lead)
        if bb: state['lastBox']=bb
    if (not lead or (leadfrac or 0)<SUBJECT_FRAC_MIN) and state['lastBox'] and state['cropSide']>0:
        x0,y0,x1,y1=state['lastBox']
        cx=((x0+x1)/2)*W; cy=((y0+y1)/2)*H; side=state['cropSide']
        sx=max(0,min(W-1,cx-side/2)); sy=max(0,min(H-1,cy-side/2))
        sw=min(W-sx,side); sh=min(H-sy,side)
        if sw>16 and sh>16 and sw*sh < W*H*0.8:
            c=fr[int(sy):int(sy+sh),int(sx):int(sx+sw)]
            if c.size:
                kk=MAXEDGE/max(c.shape[1],c.shape[0])
                c=cv2.resize(c,(max(1,int(c.shape[1]*kk)),max(1,int(c.shape[0]*kk))))
                r2=lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(c,cv2.COLOR_BGR2RGB)))
                cl=max(r2.pose_landmarks,key=lambda p:(frac(p) or 0)) if r2.pose_landmarks else None
                if cl and (frac(cl) or 0) > (leadfrac or 0):
                    state['crops']+=1
                    bb=bounds(cl)
                    if bb:
                        state['lastBox']=(sx/W+bb[0]*sw/W, sy/H+bb[1]*sh/H,
                                          sx/W+bb[2]*sw/W, sy/H+bb[3]*sh/H)
                    return ([dump(p) for p in r2.pose_landmarks], sh,
                            {'x':sx/W,'y':sy/H,'w':sw/W,'h':sh/H})
    return [dump(p) for p in poses], H, None

clamp=lambda t: min(max(t,0.05),max(dur-0.05,0))
count=max(SCOUT_MIN,min(SCOUT_MAX,round(dur*SCOUT_RATE)))
scout_t=[clamp(dur*i/max(count-1,1)) for i in range(count)]
scout=[];scoutH=[];scoutR=[]
for t in scout_t:
    cap.set(cv2.CAP_PROP_POS_MSEC,t*1000); ok,fr=cap.read()
    if not ok: scout.append([]); scoutH.append(H); scoutR.append(None); continue
    p,h,rg=measure(fr,t); scout.append(p); scoutH.append(h); scoutR.append(rg)
dense_t=[clamp(i/DENSE_RATE) for i in range(int(dur*DENSE_RATE))]
dense=[];denseH=[];denseR=[]
for t in dense_t:
    cap.set(cv2.CAP_PROP_POS_MSEC,t*1000); ok,fr=cap.read()
    if not ok: dense.append([]); denseH.append(H); denseR.append(None); continue
    p,h,rg=measure(fr,t); dense.append(p); denseH.append(h); denseR.append(rg)
json.dump({'cw':CW,'ch':CH,'srcH':H,'duration':dur,'secondsPerFrame':dur/max(count-1,1),
           'scoutTimes':scout_t,'scout':scout,'scoutH':scoutH,'scoutR':scoutR,
           'denseTimes':dense_t,'dense':dense,'denseH':denseH,'denseR':denseR},open(outp,'w'))
print(f"{path.split('/')[-1]}: scout {count} ({sum(1 for f in scout if f)} posed), "
      f"dense {len(dense_t)} ({sum(1 for f in dense if f)} posed), {state['crops']} crops used")
