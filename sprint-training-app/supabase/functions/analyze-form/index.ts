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
ACCELERATION / START (drive phase, first 10-30m). First identify BLOCKS vs. STANDING start and name it in the summary -- it changes what good form looks like (blocks: more acute initial shin/hip angle; standing: more upright at push-off). Score 1-5, one-sentence why:
1. Foot/Ankle Stiffness — heel drop on contact (stiff/active = high, collapsing = low)
2. Foot Positioning — landing point relative to hips, toe alignment
3. Shin Angle — forward lean at contact through the drive phase, judged against the start type above
4. Head Position & Trajectory — neutral neck/gaze, gradual rise (not an early pop-up)
Add anything else relevant (arm drive, torso lean, push-off angle) to additional_observations. Flag clear technical faults.
`.trim(),

  "Max Velocity": `
MAX VELOCITY (top speed, not the start). Score 1-5, one-sentence why:
1. Foot/Ankle Stiffness — heel drop on contact
2. Ground Contact Time — qualitative read of dwell/reactivity from the frames you have
3. Recovery Mechanics / Figure-4 — thigh driven up and forward, heel near glute. Flag explicitly if not achieved.
Add anything else relevant (posture, arm action, knee drive) to additional_observations.
`.trim(),

  "Speed Endurance": `
SPEED ENDURANCE (sub-max effort, holding form under fatigue). Score 1-5, one-sentence why:
1. Smoothness / Consistency — early frames vs. late frames, any degradation
2. Hip Extension — full extension at toe-off
3. Recovery Mechanics — same figure-4 check; still matters. Flag if not achieved.
Ground contact time is not scored here. Add anything else relevant to additional_observations.
`.trim(),
};

const SYSTEM_PROMPT = `You're an expert sprint coach scoring still frames sampled evenly from one clip.

Judge only the athlete's body and mechanics -- never the filming (distance, angle, blur, lighting). Commit to your best read from whatever's visible every time. Never hedge about frame count or data limitations (e.g. "not enough frames to assess ground contact") -- work with what you're given. Use "filming_note" only for a genuine visibility problem (subject out of frame, extreme blur), never as a general disclaimer.

Respond with ONLY valid JSON, no markdown, no extra text:
{
  "summary": string,
  "pinpoints": [ { "name": string, "score": number, "note": string } ],
  "additional_observations": [ { "name": string, "score": number, "note": string } ],
  "flags": [ string ],
  "filming_note": string | null
}
score is an integer 1-5. Omit a pinpoint only if truly unassessable.`;

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
    // Sonnet 5 thinks by default, so content[0] is often a thinking block
    // (no .text field) rather than the actual answer -- find the real
    // text block instead of assuming it's first.
    const textBlock = (result.content || []).find((block: { type: string }) => block.type === "text");
    const rawText = (textBlock as { text?: string } | undefined)?.text ?? "";

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
