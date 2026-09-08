# Measured numbers, and what is still wrong

Everything here was measured against real clips with the shipping model.
Written down so it does not have to be re-derived.

## Subject size (settled)

An athlete composited into a phone-shaped frame at a series of sizes, then
re-measured:

| Share of frame height | Frames detected | Hip angle error |
|---|---|---|
| 35% | 15/15 | 8° |
| 28% | 15/15 | 8° |
| 22% | 14/15 | 27° |
| 18% | 12/15 | 29° |
| 14% | 6/15 | 16° |
| 10% | 2/15 | 27° |

8° is the model's noise floor. It does **not** improve at higher render
resolution — MediaPipe resizes internally, so the athlete's *share* of the
picture is what matters, not its pixel count. Hence `SUBJECT_FRAC_MIN = 0.25`.

Cropping to roughly 3x his height restored 15/15 detection at every size down
to 7%, at the same 8° floor — so a distant athlete is cropped to, not
refused. Separately, shrinking the source while holding his share constant
held accuracy to ~8° down to about 110px of athlete; below ~90 there is no
detail left to enlarge, hence `SUBJECT_PX_MIN`.

## Sampling rate (settled)

A stride is ~0.22s and peak thigh lift lasts about one frame of 30fps video.
One clip re-sampled at four rates, nothing else changed:

| Rate | Scissor | Hip angle |
|---|---|---|
| 29.5/s | 105° | 100° |
| 14.8/s | 69° | 110° |
| 9.8/s | 105° | 100° |
| 7.4/s | 88° | 119° |

36° of spread from sampling phase alone, against an 8° noise floor. Hence the
dense pass. After it, the same clip with the window slid to four different
start times gave hip 122/124/124/124 and scissor 86/84/84/84 — a 2° spread.

## Athlete-motion band (fixed)

`ATHLETE_MOTION_MIN/MAX` were expressed per second but moved with the
sampling rate. Motion per frame is signal/rate + tracker jitter; the jitter
does not shrink with the interval, so multiplying by the rate left the jitter
scaled by it. Motion is now measured across pairs of frames a fixed **time**
apart (`MOTION_GAP_S`), which divides a much larger real change by a known
interval.

Same tracks, both methods, at two sampling rates:

| Track | Rate | New | Old |
|---|---|---|---|
| Block start | 6/s → 30/s | 0.86 → 1.06 | 1.11 → **2.61** |
| Fast run | 9.5/s → 30/s | 4.34 → 4.14 | 4.30 → 5.43 |
| Drive phase | 9.6/s → 30/s | 3.11 → 3.22 | 2.98 → 4.85 |

The old figure moved up to 2.4x on sampling alone; the new one holds to
within ~5% on the two clips sampled densely enough for a real fixed gap.

### The band, measured

| Track | Motion |
|---|---|
| Block start, driving out | 4.20 |
| Fast run | 4.14 |
| Drive phase | 3.22 |
| Same athlete still set in the blocks | 1.06 |
| Runner inside a race pack | 3.27 |
| Skeleton jumping between people in a crowd | 7.97 |

Set to **0.9 – 6.0**.

The **ceiling** is the part that works. The old 4.0 sat *underneath* two of
three real athletes, which is why a genuine block start and a genuinely fast
run were both refused as overlapping people. 6.0 clears every athlete
measured and still catches a tracker that has jumped between bodies.

The **floor does much less than it appears to**. The first steps out of the
blocks read 1.24; the same athlete motionless in the set position reads 1.06.
Seventeen per cent apart is noise, so no floor can admit a real start and
still exclude someone standing about. It is placed to admit the athlete,
because refusing a real block start is the worse error and the other guards
(track length, people count, subject size, feet in frame) still apply.

Doing this properly needs either the clip type — acceleration legitimately
turns over slowly, top speed does not — or a different signal altogether,
such as whether the hips travel rather than how fast the limbs move. Noted as
open rather than solved.

Motion alone cannot separate a lone sprinter from one in a pack — a runner
in a race reads 3.27, squarely among the athletes — so that is left to the
people-count check.

A second track in the band is only treated as a second athlete if it is at
least `SECOND_ATHLETE_SHARE` of the longest. One block start came back as a
27-frame track plus a 9-frame stub of the same runner, and refusing that as
"more than one athlete" would have been wrong.

## Aiming the dense window

Centre it on where the athlete is **running**, not on the middle of the
detections. A runner is easiest to detect when stationary and hardest once
he is moving away, so on a block start the detections cluster around the set
position: the window landed there, the only track in it read 0.75/s, and the
clip came back "nobody in this clip is moving like a sprinter" — while he was
running three tenths of a second later.

`busiestTime` picks the middle of the fastest-changing stretch of the longest
coarse track. On the block start that moved the window from 1.46–2.52s to
0.63–1.69s, and the track in it from 10 frames at 0.75/s to 25 at 1.24/s.

## Support stiffness (PROVISIONAL — two clips)

The athlete's suggestion, and a better signal than the ankle angle for the
same property: if the foot collapses the hip comes down with it, and the hip
and knee are landmarks the model tracks well where the toe is neither. It is
also in leg lengths, so filming distance does not move it — which the ankle
angle cannot claim.

Hip height above the planted foot, from touchdown to the lowest point while
that foot is still down:

| Clip | Drop | Contacts |
|---|---|---|
| Fast run (top speed) | 0.00 | 3 |
| Drive phase (accelerating) | 0.09 | 3 |

Those sit the right way round — contact at top speed is short and stiff, the
drive phase longer with more give — but **two clips is not a calibration**.
The bands are deliberately coarse until there are more.

Two implementation notes that cost real accuracy before they were found:

- The end of a contact must be found from the **foot**, not from hip height.
  Hip height falls both when the support collapses and when the foot lifts,
  so stopping on it truncates the measurement exactly when the collapse is
  worst — a synthetic hip dropping 0.25 of a leg length came back as 0.125.
- Contacts must agree before it is reported, same as the ankle. Two clips
  disagreeing by more than `SUPPORT_AGREEMENT_MAX` is noise, not a soft foot.

## The toe-based ankle angle (demoted)

Not shown when support stiffness is available. The athlete reported a stiff
ankle on a clip that scored it 2/5 "landing toes-down". Across six
consecutive frames a thirtieth of a second apart it read 115, 126, 139, 129,
122 and 94 degrees, and the three touchdowns it settled on read 107, 145 and
137 — a 38 degree spread against bands 13 degrees wide.

It still fires when nothing better is available and the contacts agree, but
two numbers for one property, one of them known to be shaky, is worse than
one.

## Sampling structure

Two passes, not one:

1. **Coarse sweep** (`SCOUT_RATE`, 12–30 samples) — locates the athlete in
   time and finds shot cuts. It does not have to track him.
2. **Dense pass** (`DENSE_RATE`, up to `DENSE_MAX_SAMPLES`) over the stretch
   he is actually on screen — subject selection *and* measurement.

Across three clips the athlete filmed himself he was in shot for 0.4–1.2s of
clips running 2.1–6.5s. Spreading a thin rate over the whole clip gave about
five frames of him — under the track-length floor, so every clip was refused
with "could not follow anyone through this clip".

## Auto-crop, verified

Previously unverified. Measured on the two clips that failed the size check
on the full frame:

| Clip | Full frame | After crop |
|---|---|---|
| Block start | 15.9% | 46.6% |
| Drive phase | 17.5% | 44.5% |

Both clear the 25% threshold comfortably, so the size refusal on those two
was an artefact of the offline harness (which does not crop), not the app.
