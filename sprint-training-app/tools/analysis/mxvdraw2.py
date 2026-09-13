import cv2, json, numpy as np, sys
d=json.load(open('/tmp/pose/mxv2.json')); rows=d['rows']; face=d['face']
F='/root/.claude/uploads/961e20ff-2122-5f80-8e50-942d67de74dd/d1db74ca-ScreenRecording_09082026_134558_1.mp4'
X0,Y0,X1,Y1=1215,228,1970,1410
cap=cv2.VideoCapture(F); fps=cap.get(5); tiles=[]
for spec in sys.argv[1].split(','):
    t,side=spec.split(':'); t=float(t); side=int(side)
    r=min(rows,key=lambda r:abs(r['t']-t))
    cap.set(cv2.CAP_PROP_POS_FRAMES,int(r['t']*fps)); ok,fr=cap.read()
    if not ok: continue
    c=fr[Y0:Y1,X0:X1]; k=640/max(c.shape[:2])
    cs=cv2.resize(c,(int(c.shape[1]*k),int(c.shape[0]*k)))
    meas=r['legs'][side]; other=r['legs'][1-side]
    for l,col,w in ((other,(140,140,140),3),(meas,(0,255,0),5)):
        h,kk,a=[tuple(map(int,q)) for q in (l['h'],l['k'],l['a'])]
        cv2.line(cs,h,kk,col,w); cv2.line(cs,kk,a,col,w); cv2.circle(cs,kk,9,col,-1)
    mh=tuple(map(int,r['mh'])); ms=tuple(map(int,r['ms']))
    cv2.line(cs,mh,ms,(0,200,255),4)
    cv2.line(cs,(mh[0],mh[1]-60),(mh[0],mh[1]+320),(255,255,255),2)
    cv2.putText(cs,f"{r['t']:.2f}s  {'L' if side==0 else 'R'} leg",(10,36),0,0.95,(255,255,255),3)
    cv2.putText(cs,f"fold {meas['fold']:.0f}",(int(meas['k'][0])+16,int(meas['k'][1])+8),0,1.1,(0,255,0),3)
    cv2.putText(cs,f"thigh {meas['swing']*face:+.0f}",(mh[0]-180,mh[1]-72),0,0.85,(0,200,255),2)
    tiles.append(cv2.resize(cs,(430,570)))
cv2.imwrite('/tmp/pose/mxvdraw2.jpg',np.hstack(tiles)); print(len(tiles),"tiles")
