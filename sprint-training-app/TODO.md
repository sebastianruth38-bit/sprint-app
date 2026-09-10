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

## Deferred on purpose

- **Add to Home Screen (PWA)** — asked for it to wait.
- **Sign in with Apple** — needs the $99 developer account first.
