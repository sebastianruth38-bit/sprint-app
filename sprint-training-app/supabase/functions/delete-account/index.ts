// Supabase Edge Function: delete-account
//
// Deletes the calling athlete's account and everything belonging to it.
//
// This runs server-side because removing a row from auth.users needs the
// service role, which must never reach a browser. The caller proves who they
// are with their own JWT; the function deletes THAT user and no other. There
// is no user id in the request body on purpose -- accepting one would let any
// signed-in athlete delete anybody's account.
//
// Order matters. Every public table cascades from auth.users, so deleting the
// user wipes the rows for free. Storage does NOT: storage.objects has no
// foreign key to auth.users, so files deleted after the user is gone become
// unreachable orphans that nothing in the app can ever find again. Files
// first, then the user.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "diagnosis-videos";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Same pattern as analyze-form: platform JWT verification is off so that CORS
// is handled before auth, and the check happens here instead.
async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await getAuthedUser(req);
  if (!user) return json({ error: "Not signed in" }, 401);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    // Fail closed and say so. Half-deleting an account -- files gone, login
    // still working -- is a worse state than not starting.
    console.error("SUPABASE_SERVICE_ROLE_KEY is not set -- cannot delete accounts");
    return json({ error: "Account deletion is not configured on the server." }, 500);
  }

  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  // 1. The athlete's clips. Their folder is named after their user id, which
  //    is why this cannot touch anyone else's files.
  let filesRemoved = 0;
  const { data: files, error: listError } = await admin.storage
    .from(BUCKET)
    .list(user.id, { limit: 1000 });

  if (listError) {
    console.error("Could not list clips for deletion:", listError.message);
    return json({ error: "Could not reach your clips. Nothing was deleted." }, 500);
  }

  if (files && files.length) {
    const paths = files.map((f: { name: string }) => `${user.id}/${f.name}`);
    const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
    if (removeError) {
      // Stop here rather than deleting the user: with the user gone these
      // files could never be found or removed by anything again.
      console.error("Could not remove clips:", removeError.message);
      return json({ error: "Could not delete your clips. Nothing was deleted." }, 500);
    }
    filesRemoved = paths.length;
  }

  // 2. The account itself. Every public table has ON DELETE CASCADE against
  //    auth.users, so this removes the workouts, times, goals, settings,
  //    diagnosis entries and quota counters along with it.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("Could not delete user:", deleteError.message);
    return json({
      error: "Your clips were deleted but the account itself could not be. Please get in touch.",
    }, 500);
  }

  return json({ ok: true, filesRemoved });
});
