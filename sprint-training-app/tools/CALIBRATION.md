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

## Athlete-motion band (BROKEN — next job)

`ATHLETE_MOTION_MIN/MAX` are expressed per second but are not independent of
the sampling rate. Motion per frame is signal/rate + tracker jitter; the
jitter does not shrink with the interval, so multiplying by the rate leaves
the jitter scaled by it.

Three clips the athlete filmed himself, all properly framed, side-on, single
athlete, real camera. All three were refused:

| Clip | Duration | Scout rate | Tracked | Motion | Size | Refused with |
|---|---|---|---|---|---|---|
| Block start | 6.47s | 6.0/s | 11 frames | **1.11/s** | 15% | "nobody moving like a sprinter" |
| Fast run | 2.10s | 9.5/s | **5 frames** | 4.30/s | 24% | "could not follow anyone" |
| Drive phase | 3.43s | 9.6/s | 10 frames | 2.98/s | **17%** | "athlete too small" |

Sampled at 30/s instead, the same tracks read 2.61/s, 5.43/s and 4.85/s. The
block start's motion figure moves 2.4x on sampling rate alone and straddles
the 1.8 floor.

Both ends misfire:

- **Floor too high / rate too low.** A real block start sampled at 6/s reads
  1.11 and is refused. Mitigated for now by pinning `SCOUT_MAX_SAMPLES` back
  to 60 so a normal clip really is sampled at `SCOUT_RATE`; a clip longer
  than ~6s still degrades.
- **Ceiling too low.** A genuinely fast athlete reads 4.3/s at scout rate and
  5.4/s dense, both above the 4.0 ceiling, and is refused as overlapping
  people. This is a false rejection of exactly the athletes the app is for.
- **`MIN_TRACK_FRAMES` = 8 vs. short visibility.** Across these three the
  athlete was on screen for 0.4-1.2s of clips running 2.1-6.5s. At 10/s a
  0.5s appearance yields 5 frames and can never reach 8, though at 30/s the
  same clip yields 16.

### The fix

Measure motion between frames a fixed *time* apart (~0.1s) rather than
between adjacent samples, which makes the number rate-invariant by
construction. Then recalibrate both ends against the reference tracks —
athlete, standing bystander, and a skeleton jumping between runners in a
pack — rather than tuning until these three clips pass.

The drive-phase clip's "too small" refusal is **unverified**: the offline
harness does not simulate the auto-crop, which should lift 17% above the
threshold in the real app. Check that before treating it as a fourth bug.
