# Backend setup (Supabase)

This gets Sprint Lab off local-only storage and onto a real account, so your
data follows you across your phone and laptop. Supabase's free tier covers
this comfortably for one user.

## Steps

1. **Create a project** at [supabase.com](https://supabase.com) (free tier). Pick any name/region — takes about 2 minutes to provision.
2. **Run the schema**: open your project's *SQL Editor*, paste the contents of `schema.sql` (in this folder), and run it. This creates all the tables, locks every row to its owner (Row Level Security), and sets up a private storage bucket for diagnosis video clips.
3. **Turn on email sign-in**: *Authentication → Providers* — email is on by default, so this is just a check. (Magic-link/passwordless is enabled the same way if you'd rather skip passwords entirely.)
4. **Grab your API keys**: *Project Settings → API* — copy the **Project URL** and the **`anon` public key**. Paste both back to me here.

That's it on your end — the anon key is meant to be used from client-side code (that's what the Row Level Security policies in `schema.sql` are for), so it's safe to share.

## What happens once I have the keys

I'll wire the app to Supabase: a sign-in screen (email/password or magic link), and swap every `localStorage`/`IndexedDB` call for a Supabase read/write — same UI, same features, just synced. Existing local data won't auto-migrate; once you're signed in you'd re-enter anything you want to keep (or say the word and I'll add a one-time "import my local data" button instead).
