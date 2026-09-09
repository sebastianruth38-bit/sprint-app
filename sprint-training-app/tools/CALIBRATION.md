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

## Front/back swing balance (UNCALIBRATED — measured, not scored)

Every athlete measured lands in the same place, and the bands call all of
them the worst score:

| Clip | Front | Back | Ratio |
|---|---|---|---|
| Wide shot on grass | 88° | 23° | 0.26 |
| Fast run | 85° | 29° | 0.34 |
| Drive phase | 54° | 23° | 0.43 |
| Block start | 75° | 27° | 0.36 |

The bands were written when `thighSwing` was measured from the wrong pole and
every value sat near 180°. The measurement was fixed; the bands were not.
Asking for a ratio of 0.85 asks the thigh to travel as far behind the body as
it comes in front, which no sprinter does — the thigh extends perhaps 20-30°
past vertical at toe-off while reaching 85-90° in front at peak lift.

Now returned without a score, so the numbers keep accumulating without being
acted on. What is missing is a reference for what the ratio *should* be. The
one comparison that survives is band-free and still fires: a thigh travelling
further behind than in front is a fault whatever the right ratio is.

**Lesson worth keeping: fixing a measurement means recalibrating everything
that reads it.** This is the second time a repaired measurement left stale
bands behind it.

## Passing position — the elite reference (2 verified samples)

Measured from a slow-motion top-speed clip of Bolt: single athlete, side-on,
plain backdrop, body filling 40% of the player. Each leg followed straight
through its own cycle, and the fold read at the instant its thigh crosses
vertical — no leg-picking heuristic, which is what went wrong on the first
two attempts.

| Moment | Thigh | Fold | Foot height |
|---|---|---|---|
| 4.38s, right leg | +3° | **62°** | 0.31 leg-lengths below hip |
| 7.28s, left leg | +0° | **81°** | 0.45 |
| 1.02s, left leg | +17° | (75° interpolated, 160° in frame) | 0.38 |

The first two are visually confirmed — heel clearly tucked under him, knee
coming through. The third is discarded: the fold jumped from ~75 to 160
between consecutive frames, which is a tracking discontinuity, and the frame
itself reads +17° rather than vertical.

**Bolt at passing: roughly 62-81°.**

The athlete's own clips were first reported at 108-113° — a 30-45° gap. **That
comparison was wrong and there is no gap.** His figure came from an earlier
pass that had no foot-height filter, so it counted the stance leg's crossings
too: on one clip the raw list was 126, 123, 176, 62, 70, 55, 56, 98, 115, 171,
175, 175, 63, 55, 124, 101 — the values above 120 are the support leg, nearly
straight, and they dragged the median to 108. Filtered the same way Bolt's
were, the same clip gives 63, 55, 62, 55, 56, 98, 101: a median of **62°**.

Measured alike, he is at Bolt's passing fold and possibly tighter. The lesson
is the obvious one and it was still nearly missed: a reference and a subject
have to go through the identical pipeline before their numbers are compared.

Two other events must be kept apart from this, and mixing them is what made
the first pass read 62-160°:

- The **stance** leg also crosses vertical each stride, as the body rotates
  over a planted foot, and it is nearly straight there: measured 152° and
  160°, foot 0.91-0.98 leg-lengths below the hip. Filter on foot height.
- Near the end of a clip the crossings bunch up (three inside 0.16s) and the
  folds drift high. Real passing moments are spread a stride apart.

### Also from the same clip — peak knee lift

Unambiguous, since it is an extremum rather than a crossing:

| | Bolt |
|---|---|
| Thigh from vertical | +86° |
| Hip-to-thigh | **95°** |
| Scissor | **112°** |
| Fold | 67° |

Hip-to-thigh 95° is a third independent athlete landing on the ~90° standard,
after 87° and 88.9° measured earlier. Scissor 112° sits inside the existing
5/5 band of 105-125. Both existing calibrations hold.

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

## Which stretch of the clip gets graded

`bestWindow` searched only the longest track. That is exactly backwards: a
stationary athlete is easy to follow, so a set position reliably produces the
longest track in the clip, while the sprint moves fast enough to break
association and comes back as a shorter one.

Measured on a real block start, tracks across the whole clip:

| track | time | frames | subject size | motion |
|---|---|---|---|---|
| 0 | 0.05–2.03s | **61** | 35% | 1.32/s — set in the blocks |
| 1 | 2.27–3.73s | 44 | 45% | 4.09/s — the actual run |
| 2 | 1.97–2.23s | 7 | 71% | 4.25/s — the transition |

Track 0 won on length, and the run was discarded before the size preference
ever saw it. The clip graded the set position: torso 69° from vertical, 1.21/s
motion against a floor of 0.90 — 34% of headroom on a clip that contains a
perfectly good sprint at 4.09/s.

Two consequences, and the second is the worse one:

- **Refusals.** A start filmed slightly further away drops that 1.21 under
  0.90 and the clip is refused with "nobody in this clip is moving like a
  sprinter" — while the sprint the athlete actually filmed sits untouched in
  another track.
- **Silently wrong grades.** A clip that stays above the floor is graded on
  the set position and says nothing about it. That is worse than a refusal,
  because the athlete gets a plausible-looking score for a second of footage
  in which he has not moved.

Now every track of at least `MIN_TRACK_FRAMES` is searched, and the existing
preference — among stretches where he is moving like a sprinter, take the one
where he is easiest to see — decides between them. The fix needed no new
heuristic; the existing one was right and was being shown one track.

Re-measured across all five clips available, only the block start changes:

| clip | before | after |
|---|---|---|
| block start | 0.27–1.27s @ 1.21/s | **2.27–3.33s @ 4.23/s** |
| relay run | 1.37–2.40s @ 3.58/s | unchanged |
| wide grass | 2.47–3.50s @ 3.81/s | unchanged |
| start 1246 | 0.05–1.03s @ 3.22/s | unchanged |
| start 1247 | 0.30–0.80s @ 4.14/s | unchanged |

The relay clip is the regression to watch: it is the one whose post-handoff
noise motivated preferring size in the first place, and it still grades the
run rather than the noisy tail (tracks of 13, 12, 4 and 2 frames at 5.8–6.9s,
one of them reading 42/s, all correctly below the track-length floor).

**Foot contacts do not discriminate here.** The obvious alternative was to
prefer windows containing strides, on the reasoning that a set position has
none. Measured, the set position reports 2.5 strides — the same as the run.
`footContacts` invents contacts from a stationary athlete, so stride count
cannot be used to tell running from standing.

## Contacts the foot was never on the ground for

Hip Height and Support Stiffness contradicted each other on the same card:
the relay clip scored 2/5 "hips collapsing" (48% of a leg length) alongside
5/5 "stiff support" (5% settle per contact).

Both were reading real numbers. Hip Height is the spread ACROSS the clip's
touchdowns; Support Stiffness is the settle WITHIN one contact. They can
legitimately differ. But 48% was still wrong, and the reason is visible in
the per-touchdown hip heights:

| clip | hip above foot at each detected touchdown (leg lengths) |
|---|---|
| relay | 1.267, 0.973, **1.243**, 0.786, 1.030 |
| block start | 1.002, 0.958, 0.876, 0.876, 0.876 |
| wide grass | 0.775, 0.776, 0.747, 0.885 |
| start 1246 | 0.792, 0.915, 0.864, 0.875 |
| start 1247 | 1.010, 0.984, 1.000, **1.079**, 0.925, **1.158** |

`legLen` is measured along the limb, so it is always at least the
straight-line hip-to-ankle distance. A planted foot therefore cannot sit more
than **1.0** leg lengths below the hip — that is a fully straight leg.
Readings of 1.08, 1.16, 1.24 and 1.27 are not touchdowns at all; they are
flight frames `footContacts` mistook for contacts.

Note which clips they appear in: the relay and 1247 are precisely the two
clips that scored badly on Hip Height. Every other clip's worst reading is
1.002.

`CONTACT_DEPTH_MAX = 1.05` (one leg length plus landmark noise) now drops
them, in both Hip Height and Support Stiffness:

| clip | Hip Height before | after |
|---|---|---|
| relay | 2/5, 48% | 2/5, **24%** |
| start 1247 | 2/5, 23% | **4/5, 8%** |
| block start | 4/5, 13% | unchanged |
| wide grass | 3/5, 14% | unchanged |
| start 1246 | 4/5, 12% | unchanged |

**Only the impossible end is filtered.** A LOW reading is the hip genuinely
sinking, which is the entire point of the measurement — clipping that would
delete the fault the metric exists to find. The bound is one-sided on
purpose.

One consequence worth knowing: the ghosts are *deeper* than real touchdowns,
so `footContacts` prefers them and they displace real contacts from the list.
Filtering afterwards can leave fewer than three, in which case Hip Height is
withheld. That is the honest outcome, and better than a spread computed from
frames the foot was in the air for.

The bands were also reworded. They said "hips collapsing -- sitting in the
stride", which claims Support Stiffness's subject and reads as a flat
contradiction next to it. They now say what is actually measured: how much
hip height varies between steps.
