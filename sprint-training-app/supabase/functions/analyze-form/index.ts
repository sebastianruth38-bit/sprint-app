// Supabase Edge Function: analyze-form
//
// Scores a sprint clip's form against a rubric that depends on clip type.
// Runs server-side so the Anthropic API key never reaches the browser.
// Deployed with JWT verification on (the default), so only signed-in
// users of this app can call it -- supabaseClient.functions.invoke()
// attaches the caller's session token automatically.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RUBRICS: Record<string, string> = {
  Acceleration: `
This is an ACCELERATION / START clip (the drive phase, roughly the first 10-30m).
Score each of the following 1-5 (5 = excellent), with a one-sentence "why":
1. Foot/Ankle Stiffness — how little the heel drops toward the ground on contact; a stiff, active strike scores high, a heel that collapses/sinks scores low.
2. Foot Positioning — where the foot lands relative to the hips/center of mass, and toe alignment.
3. Shin Angle — forward shin lean at ground contact through the drive phase; a steep forward lean early on is expected and good.
4. Head Position & Trajectory — neck/gaze neutrality, and whether the head/torso rises gradually through the acceleration phase rather than popping up early.
Then add any OTHER positions or mechanics you find clearly relevant (e.g. arm drive, torso lean angle, push-off angle) as additional_observations, each scored 1-5 with a note.
Flag anything that looks like a clear technical fault under "flags".
`.trim(),

  "Max Velocity": `
This is a MAX VELOCITY clip (top-speed running, not the start).
Score each of the following 1-5 (5 = excellent), with a one-sentence "why":
1. Foot/Ankle Stiffness — how little the heel drops toward the ground on contact.
2. Ground Contact Time — a qualitative read of how short/quick the foot's ground contact looks (short and reactive scores high; any visible dwell/sinking scores low). This is an estimate from still frames, not a timed measurement -- say so if you can't tell.
3. Recovery Mechanics / Figure-4 Position — check whether the recovery leg reaches the "figure-4" position during swing (thigh driven up and forward, lower leg folded under, heel close to the glute). If the athlete does NOT clearly achieve figure-4, say so explicitly and add it to "flags" as a positions issue.
Then add any OTHER mechanics you find clearly relevant (e.g. posture/lean, arm action, knee drive height) as additional_observations, each scored 1-5 with a note.
`.trim(),

  "Speed Endurance": `
This is a SPEED ENDURANCE clip (longer, sub-maximal effort -- the point is holding form under fatigue, not raw top speed).
Score each of the following 1-5 (5 = excellent), with a one-sentence "why":
1. Smoothness / Consistency — compare the earliest frames to the latest frames: does form stay consistent through the run, or does it visibly degrade/get choppy? Score high if there's little change over the clip.
2. Hip Extension — full extension at the hip through toe-off.
3. Recovery Mechanics — same figure-4 check as max velocity; still matters here. Flag clearly if not achieved.
Ground contact time is NOT a priority for this clip type -- do not score it as a pinpoint (you may mention it in additional_observations only if something looks notably wrong).
Then add any OTHER mechanics you find clearly relevant as additional_observations, each scored 1-5 with a note.
`.trim(),
};

const SYSTEM_PROMPT = `You are an expert sprint coach reviewing still frames extracted from a single sprint clip, sampled evenly across its duration. You are precise, encouraging but honest, and you never invent detail you can't actually see in the frames -- if something isn't visible or clear, say so rather than guessing confidently.

Respond with ONLY valid JSON (no markdown fences, no commentary outside the JSON) matching exactly this shape:
{
  "summary": string,
  "pinpoints": [ { "name": string, "score": number, "note": string } ],
  "additional_observations": [ { "name": string, "score": number, "note": string } ],
  "flags": [ string ]
}
"score" is always an integer 1-5. If a pinpoint truly can't be assessed from the frames given, omit it rather than guessing.`;

// Verifies the caller is a signed-in user of this app. Done manually here
// (rather than relying on the platform's "Enforce JWT Verification" toggle)
// because that toggle also gates the CORS preflight (OPTIONS) request --
// if it fails, the browser never even sees a response with CORS headers,
// and the request looks like it failed to send at all. So: JWT
// verification is OFF at the platform level for this function, and
// enforced here instead, after CORS is already handled.
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const user = await getAuthedUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Not signed in" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { clipType, distance, effort, frames } = await req.json();

    if (!Array.isArray(frames) || frames.length === 0) {
      return new Response(JSON.stringify({ error: "No frames provided" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const rubric = RUBRICS[clipType] ?? RUBRICS["Max Velocity"];
    const contextLine = `Clip type: ${clipType || "unspecified"}. Distance: ${distance || "unspecified"}. Effort: ${effort || "unspecified"}.`;

    const imageBlocks = frames.map((dataUrl: string) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: dataUrl.split(",").pop(),
      },
    }));

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${contextLine}\n\n${rubric}\n\nFrames are attached in chronological order, evenly sampled across the clip.`,
              },
              ...imageBlocks,
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: `Anthropic API error: ${errText}` }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const result = await anthropicRes.json();
    const rawText = result.content?.[0]?.text ?? "";

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { summary: rawText, pinpoints: [], additional_observations: [], flags: [] };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
