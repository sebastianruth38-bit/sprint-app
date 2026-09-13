# Backend setup (Supabase)

The project is already stood up and its URL and anon key are in `config.js`.
This page is how you would build it again from nothing — a second project for
testing, or a rebuild after something goes wrong.

## Steps

1. **Create a project** at [supabase.com](https://supabase.com). Any name and
   region; it takes a couple of minutes to provision.
2. **Run the schema**: *SQL Editor → New query*, paste `schema.sql` from this
   folder, run it. That creates every table, locks each row to its owner with
   Row Level Security, and creates the private `diagnosis-videos` bucket.
3. **Turn on the sign-in methods**: *Authentication → Providers*.
   - **Email** is on by default. Magic links are the same provider.
   - **Google** needs a client ID and secret from
     [Google Cloud](https://console.cloud.google.com/auth/clients), with
     Supabase's callback URL added as an authorised redirect URI. Set the
     consent screen's **App name** while you are there, or the sign-in prompt
     names the raw `*.supabase.co` host instead of Sprintr.
4. **Deploy the functions**: `analyze-form` and `delete-account`, both under
   `functions/`. Both set `verify_jwt: false` and check the caller's token
   themselves — the platform's own check rejects the CORS preflight, which
   presents as the browser reporting a network failure with nothing in the
   function logs. They still refuse anonymous callers.
   `AI_SETUP.md` covers the API key and quota that `analyze-form` needs.
5. **Point the app at it**: copy the **Project URL** and **anon public key**
   from *Project Settings → API* into `config.js`.

The anon key belongs in client-side code and is committed on purpose. Row
Level Security is what protects the data; the key only decides which project
you are talking to.

## Retention

Nothing here expires clips on its own — `VIDEO_RETENTION_DAYS` in `app.js`
drives the purge, and the app runs it every time the Form Analysis tab
renders. If that number changes, the
privacy policy and terms have to change with it; `tests/legal_test.js` fails
until they do.
