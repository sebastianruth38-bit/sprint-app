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

## Storage, not egress, is the free tier's ceiling

After the egress fixes, browsing costs ~150KB. Storage is what runs out:
clips average **9.5MB** straight off the phone, and at a few a day the 1GB
free limit arrives in about five weeks.

The grader downsamples every frame to 480px on the longest edge before pose
runs, so the stored copy has no effect whatsoever on scoring. It only has to
stay watchable. Re-encoded at 720px and 1.5Mbps:

| | before | after |
|---|---|---|
| block start clip | 16.5MB | **0.7MB** |

Twenty-plus times smaller, still playable, still portrait, still 4.27s.

**Recording runs in real time on purpose.** MediaRecorder captures a canvas
against the wall clock, so playing the source at 2x to save a few seconds
hands back a clip that plays at double speed — useless for watching your own
mechanics. The cost is that compressing takes roughly as long as the clip.

**Every failure path returns the original file.** MediaRecorder codec support
and `captureStream` availability vary by browser and by iOS version, and an
unwatchable clip is far worse than a large one. Anything unexpected — no
supported mime type, no canvas capture, an unreadable duration, output that
came back bigger or implausibly small — keeps the upload as it was. Verified
against a file that is large enough to compress but is not a video at all.

Retention also went 60 days to 30, which halves the ceiling. The UI text and
the purge had to be changed together; the test now reads
`VIDEO_RETENTION_DAYS` out of the page rather than hard-coding a number, since
the two had already drifted once.

**Not verified on iOS Safari.** These numbers are Chromium. Safari picks a
different container and codec, and the fallback exists precisely because that
path cannot be tested from here.

## Counting the wrong frames

Two clips graded cleanly offline but were refused in the app. The athlete
reported one as "I was visible for 4 seconds and it said only 5 frames".

He was visible for **1.2 seconds**, not four: on a 7.88s clip filmed from
across the infield he enters at about 1.5s and is gone by 2.7s. Offline the
pipeline finds him in 36 of 236 frames and grades 13 of them at 2.07-2.90s.

The refusal came from the gate that decides whether playback capture worked:

    playedThrough = framePoses.length >= MIN_TRACK_FRAMES;

`framePoses.length` is frames CAPTURED, not frames the athlete is in. 236
captured sails past the minimum of 8, so the read was declared good and the
slower fallback never ran — while pose had found him in a handful. Measured
with a stub that finds nobody in most frames: **3 posed of 95 captured, and
the old code returns played=true.**

Fixed by counting posed frames. Two further changes follow from it:

- **A second play-through at 1x when 2x came back thin.** At double speed the
  decoder has half as long per frame to decode *and* run pose, and what it
  drops comes out of the small number of frames that contain the athlete.
  Costs one extra pass, only on clips that needed it.
- **The seek fallback samples densely where he was seen.** It swept the whole
  clip at `SCOUT_RATE` — about four samples a second — which on a 1.2s run is
  five frames, under the track minimum, refused again. It now sweeps, then
  re-samples the stretch he appeared in at `DENSE_RATE`, keeping whichever
  pass found more of him.

**Framing note for the athlete, independent of any of this:** 1.2 seconds in
shot is thin. The grader wants a few strides of continuous tracking, and every
guard downstream is working from that second of footage. Filming from closer,
or panning to hold him in frame, is worth more than any of these fixes.

## Every capture strategy is an attempt, and the best one wins

A refusal from the athlete's iPad read:

> Could not follow anyone through this clip. (10 of 71 frames over 7.1s had
> anyone in them)

Two things in that one line.

**71 frames over 7.1s is 10 a second**, against a `CAPTURE_RATE` of 30. The
device dropped two thirds of the frames while decoding and running pose at
2x speed — confirmation that the fast pass is where the loss happens.

**10 posed frames cleared the new gate and still failed.** `MIN_TRACK_FRAMES`
is 8, so 10 passed, the retry never ran, and grading then failed anyway
because those 8 frames have to be *continuous* and ten scattered detections do
not join up. The acceptance bar is now `MIN_TRACK_FRAMES * 2`: a bare pass
means retry, not proceed.

Then the tests found the deeper problem. Each strategy had been written to
**replace** the one before it, which threw away good work three separate ways:

- the 1x retry cleared `framePoses` before running, so a worse second pass
  overwrote a better first one;
- the seek fallback cleared it again, so a clip the fast pass had half-read
  came back with whatever the sweep managed;
- and `candidates` — the stills the AI sees and the motion trace the shot
  splitter reads — could end up describing a different pass than the poses.

Caught by a stub that finds the athlete in 9 frames and then nobody: the
result came back **0 posed**, because two later attempts had wiped the 9.

There is now one rule, `keepIfBetter()`, applied after every attempt: 2x
playback, 1x playback, the seek sweep, and the dense seek. Poses and stills
are only ever offered together, so they cannot be mismatched. Same stub now
returns 9 and correctly refuses to call it a good read.

The refusal message also leads with seconds in shot rather than frame counts,
since that is the part the athlete can act on. Frame counts stay because they
separate a device that could not decode from an athlete who was barely in the
picture — and the frames-per-second line appears only when the device is
clearly the problem.

## The capture rate is pose inference, and it decides everything

The athlete's iPad reported "10 frames a second" on a clip he is in shot for
1.3 of 7.1 seconds. Subsampling his real clip's landmarks to simulate slower
capture shows exactly where that lands:

| capture | frames | posed | longest continuous track | verdict |
|---|---|---|---|---|
| 30/s | 236 | 36 | 24 | graded on 13 frames |
| 15/s | 118 | 18 | 14 | graded on 13 frames |
| **10/s** | 79 | 12 | **7** | **no window** |
| 7/s | 59 | 8 | 6 | no window |

`MIN_TRACK_FRAMES` is 8. **He misses by one frame.** And the cliff is between
10/s and 15/s, so the answer is not to loosen the guard — it is to get the
device above 15.

Every captured frame cost TWO pose runs: once on the whole picture, then again
on a crop aimed at him when he came back too small. At roughly 50ms each that
is 100ms a frame, which is precisely the 10/s he measured.

Once the crop is aimed and sized it can stand on its own, so the whole-frame
pass now runs every `WHOLE_FRAME_EVERY` (4) frames rather than every frame.
Measured in a browser against a real clip:

| | inferences per captured frame |
|---|---|
| before | **2.00** |
| after | **1.20** |

1.65x, which should put that iPad near 16/s — over the line. Every frame still
comes back with a pose (83 of 83) and every frame is still cropped, so the
saving is not coming from losing him.

Two rules keep the old crop-feedback bug dead:

- **Only a whole-frame detection may set the crop's SIZE.** Unchanged, and the
  reason the periodic whole-frame pass exists at all rather than being dropped
  entirely.
- **A crop-only frame that finds nobody immediately pays for a whole-frame
  pass.** He has moved out of the box, changed size, or left — and silently
  losing him is exactly how the track fragments that cause these refusals.

## The bands assume 30fps, and a slow phone breaks them

An alt-account clip was refused with "nobody in this clip is moving like a
sprinter" on a device that managed **4 frames a second** — 34 frames across
9.0s, the athlete in shot for 4.3 of them.

Subsampling real clips to simulate slower capture, keeping everything else
identical:

| capture | gap actually used | blockStart motion/s | relay motion/s |
|---|---|---|---|
| 30/s | 3fr = 0.10s | 1.32 | 3.13 |
| 15/s | 1fr = 0.07s | 1.67 | 3.77 |
| 10/s | 1fr = 0.10s | 2.95 | 3.22 |
| 6/s | 1fr = 0.17s | 2.51 | 2.32 |
| 4/s | 1fr = 0.27s | **1.31** | **1.40** |

`MOTION_GAP_S` is 0.1s, and the fixed-time-gap fix that made this measure
rate-invariant only works while the capture rate can actually deliver that
gap. Below about 10/s the gap is already one frame and cannot get smaller, so
the measurement stretches across a growing slice of the stride and the figure
falls with the rate. The relay clip halves, 3.13 to 1.40, against a floor of
0.9 — nothing about the running changed.

So a modest clip captured slowly drops under the floor and is refused for not
sprinting, which is a claim about the athlete drawn from a shortage of frames.

**Refusing is still correct at that rate.** A stride is roughly 0.45s, so 4/s
is about two samples per stride; a touchdown angle cannot be measured from
that, and grading it would produce confident nonsense. What was wrong was the
reason. Below `MEASURABLE_FPS_MIN` (10/s, about four samples per stride) the
refusal now names the device and suggests a shorter or lower-resolution clip,
instead of repeating whichever guard happened to trip first.

The second clip from the same session, at 12/s, correctly kept its real
reason: tracking jumping between overlapping people.
