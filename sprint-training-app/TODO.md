# Open items

Things that are decided but not done. Kept in the repo because the machine
this gets built on is wiped between sessions.

## The Google sign-in screen says a supabase URL — parked

Tried on 10 Sep, does not work the obvious way. Setting **App name** in
Google's Branding page does not change what the sign-in prompt says: Google
shows the **root domain of the OAuth callback** until the app is
brand-verified, and the callback is `ukcmgoyqxbcxqfjgttyb.supabase.co`.
Supabase's own docs list this exact case.

What was tried: App name set (correctly, and worth keeping). Publishing to
production from *Google Auth Platform → Audience*. The branding form's Save
stays greyed out, most likely because **Authorized domains** will not accept
`sebastianruth38-bit.github.io` — that domain belongs to GitHub, not us.

Three real fixes, none of them free:

- **Own a domain** (`sprintr.app`, ~$15/yr). Fixes it permanently, gives the
  privacy policy and terms a real home, and the App Store will want that
  anyway. The clean answer.
- **Supabase vanity subdomain** → `sprintr.supabase.co`. Needs Pro (we have
  it) and the Supabase CLI. Better, still not our name.
- **Google brand verification.** Free, days of review, and it needs an
  authorized domain we can prove we own — so it depends on the first one.

**Current plan: leave it.** Sign in with Apple is coming with the developer
account and takes its name from the Services ID rather than the callback
domain, so it should show "Sprintr" without any of this. Apple also requires
it once the app offers other third-party sign-in.

## Monetisation — thinking, nothing decided

No code has been written for this and none should be until the shape is
picked. Recorded so the reasoning survives the session.

What is already true, from the database on 11 Sep: 3 accounts, 18 clips
graded, 4 times logged, **0 AI analyses ever run**.

- **Grading is free to run.** Every score comes from MediaPipe in the
  browser (`buildLocalAnalysis`). No network, no per-use cost.
- **AI coach notes are opt-in** (`index.html` `#aiAssist`, off by default)
  and cost ~1.5–2c per call on Sonnet 5. Nobody has ever ticked the box.
- **The only real cost is Supabase Pro, $25/mo**, flat at any user count.
  Roughly 8–10 subscribers at $5/mo covers it.
- Staying a web app keeps Stripe's ~3% instead of Apple's 15–30%.

The open question is not *how* to charge, it is *what* people would be
sorry to lose. Paywalling the AI notes is easy to build and would earn
nothing, because zero of 18 clips used them. That is worth knowing before
building it.

## Deferred on purpose

- **Add to Home Screen (PWA)** — asked for it to wait.
- **Sign in with Apple** — needs the $99 developer account first.
