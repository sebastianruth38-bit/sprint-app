# Open items

Things that are decided but not done. Kept in the repo because the machine
this gets built on is wiped between sessions.

## Set the Google consent-screen app name  — Sebastian, 10 Sep

The Google sign-in screen currently reads *"Choose an account to continue to
`xxxx.supabase.co`"*. It should say **Sprintr**.

- <https://console.cloud.google.com/auth/branding>
- Set **App name** to `Sprintr`, and **User support email** to
  `yeetpeppayeet@gmail.com` (same address as the legal pages).
- A logo is optional; without one Google shows the app name as text, which is
  already a large improvement on a raw hostname.

Nothing in this repo changes — it is entirely a Google Cloud console setting,
and it takes effect on the next sign-in.

## Decide on Supabase Pro before 11 Sep

The free plan's cached-egress allowance is spent and the project gets paused
on the 11th otherwise. Egress per history open is already down from ~310 MB
to ~150 KB (tap-to-play previews + memoized signed URLs) and stored video from
310 MB to 120 MB, so the ongoing burn is fixed — this is about the overage
already run up. Either pay the $25 or get the overage waived by support.

## The README describes an app that no longer exists

`README.md` still calls the app "Sprint Lab" and says there is no account and
no server, and that everything lives in localStorage. All three are now false:
there are Supabase accounts, an edge function, and hosted clips. Rewrite it
before anyone outside reads it.

## Deferred on purpose

- **Add to Home Screen (PWA)** — asked for it to wait.
- **Sign in with Apple** — needs the $99 developer account first.
