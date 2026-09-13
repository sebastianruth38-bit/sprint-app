# Setting up the form-analysis AI

The app now sends clips to a Supabase Edge Function (`analyze-form`), which
calls the Anthropic API server-side and scores the clip against a rubric.
This needs a couple of one-time steps on your end — I can't deploy an Edge
Function or hold API keys from inside this session.

## 1. Get an Anthropic API key

This is separate from your Claude.ai account — it's a pay-as-you-go API key
for calling Claude programmatically.

1. Go to [console.anthropic.com](https://console.anthropic.com), sign in/up.
2. Add billing (Settings → Billing) — API usage is metered, not part of any
   Claude subscription.
3. Create a key under **API Keys**. Copy it (starts with `sk-ant-...`).

## 2. Install the Supabase CLI and deploy the function

Run these on your own machine (needs Node.js installed):

```bash
npm install -g supabase

# from inside your cloned repo:
cd sprint-training-app
supabase login
supabase link --project-ref ukcmgoyqxbcxqfjgttyb

# give the function your Anthropic key (stored as a Supabase secret, never in the repo)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here

# deploy
supabase functions deploy analyze-form
```

`supabase login` opens a browser window to authorize the CLI against your
Supabase account. `link` connects this local checkout to your actual
project (the ref above is from your project URL,
`https://ukcmgoyqxbcxqfjgttyb.supabase.co`).

## 3. Run the schema update

New column on `diagnosis_entries` for the AI's output — SQL Editor, same as before:

```sql
alter table public.diagnosis_entries add column if not exists analysis jsonb;
```

## 4. Try it

Upload a clip, pick a clip type, hit Analyze. The button will say
"Uploading…" then "Analyzing…" — expect the AI step to take a few seconds.
Results (score/5 per pinpoint, notes, and any flags) show under that
session in Past Sessions.

## Cost and tuning

Each analysis call sends ~8 frames (downscaled to 480px wide) to the API.
Anthropic bills per-token including images, so cost scales with frame count
and resolution — check current pricing at
[anthropic.com/pricing](https://www.anthropic.com/pricing). If it's too
pricey or too slow, the frame count/size is one line to change in
`app.js` (`extractFrames(pendingBlob)` — pass a different count/maxWidth),
and the model used is one line in `supabase/functions/analyze-form/index.ts`
(currently `claude-sonnet-5`; a smaller/cheaper model trades off some
analysis quality).

## Redeploying after changes

Any time `supabase/functions/analyze-form/index.ts` changes, re-run:

```bash
supabase functions deploy analyze-form
```

The secret only needs to be set once (it persists across deploys).
