// Supabase Edge Function: analyze-form
//
// Scores a sprint clip's form against a rubric that depends on clip type.
// Runs server-side so the Anthropic API key never reaches the browser.
//
// Everything in the request comes from a browser we don't control, so the
// cost of a call is bounded here rather than trusted from the client:
// frame count, frame size, total payload, and a per-user daily quota are
// all enforced before the Anthropic call is made.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Cost ceilings. A 480px-wide JPEG at q0.7 is ~25-50KB, so ~70K base64
// chars; the per-frame cap is generous but finite. Without these, a client
// could post 500 full-resolution frames and turn a 2c call into a $5 one.
const MAX_FRAMES = 10;
const MAX_FRAME_CHARS = 300_000;   // ~225KB decoded per frame
const MAX_TOTAL_CHARS = 2_500_000; // ~1.9MB of image data per request
const MAX_BODY_BYTES = 8_000_000;
const DAILY_ANALYSIS_LIMIT = Number(Deno.env.get("DAILY_ANALYSIS_LIMIT") ?? "10");

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
};

const SYSTEM_PROMPT = `You're an expert sprint coach scoring still frames sampled from one clip.

Judge only the athlete's body and mechanics -- never the filming (distance, angle, blur, lighting). Commit to your best read from whatever's visible every time. Never hedge about frame count or data limitations (e.g. "not enough frames to assess ground contact") -- work with what you're given. Use "filming_note" only for a genuine visibility problem (subject out of frame, extreme blur), never as a general disclaimer.

Keep every note under 10 words. Only include additional_observations if something is clearly significant -- at most 2, otherwise omit the field entirely. summary is one short sentence.

Respond with ONLY valid JSON, no markdown fences, no code block, no text before or after the JSON:
{
  "summary": string,
  "pinpoints": [ { "name": string, "score": number, "note": string } ],
  "additional_observations": [ { "name": string, "score": number, "note": string } ],
  "flags": [ string ],
  "filming_note": string | null
}
score is an integer 1-5. Omit a pinpoint only if truly unassessable.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

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

// Spends one unit of the caller's daily quota. Uses the service role
// because the counter must not be writable by the user it limits -- the
// table has no client-facing write policy at all.
async function consumeQuota(userId: string) {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    // Fail closed: a missing key means the cap can't be enforced, and an
    // unenforceable cap on a paid API is worse than a rejected request.
    console.error("SUPABASE_SERVICE_ROLE_KEY is not set -- refusing to run unmetered");
    return { allowed: false, used: 0, quota: DAILY_ANALYSIS_LIMIT, misconfigured: true };
  }
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
  const { data, error } = await admin.rpc("consume_analysis_quota", {
    p_user_id: userId,
    p_limit: DAILY_ANALYSIS_LIMIT,
  });
  if (error) {
    console.error("quota check failed:", error.message);
    return { allowed: false, used: 0, quota: DAILY_ANALYSIS_LIMIT, misconfigured: true };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    used: row?.used ?? 0,
    quota: row?.quota ?? DAILY_ANALYSIS_LIMIT,
    misconfigured: false,
  };
}

// Frames are the only thing here that costs real money, so they're checked
// hard: how many, how big each, and how big in total.
function validateFrames(frames: unknown): { ok: true; frames: string[] } | { ok: false; error: string } {
  if (!Array.isArray(frames) || frames.length === 0) {
    return { ok: false, error: "No frames provided" };
  }
  if (frames.length > MAX_FRAMES) {
    return { ok: false, error: `Too many frames (max ${MAX_FRAMES})` };
  }
  let total = 0;
  for (const frame of frames) {
    if (typeof frame !== "string" || !frame.startsWith("data:image/")) {
      return { ok: false, error: "Frames must be image data URLs" };
    }
    if (frame.length > MAX_FRAME_CHARS) {
      return { ok: false, error: "A frame exceeds the size limit -- downscale before sending" };
    }
    total += frame.length;
    if (total > MAX_TOTAL_CHARS) {
      return { ok: false, error: "Frames exceed the total size limit" };
    }
  }
  return { ok: true, frames: frames as string[] };
}

// Claude sometimes wraps the JSON in ```fences``` or adds a stray sentence
// despite the instruction not to -- pull out the {...} object itself rather
// than assuming the reply is already pure JSON.
function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: "Request too large" }, 413);
  }

  const user = await getAuthedUser(req);
  if (!user) return json({ error: "Not signed in" }, 401);

  try {
    const body = await req.json();
    const check = validateFrames(body?.frames);
    if (!check.ok) return json({ error: check.error }, 400);
    const frames = check.frames;

    // Clamp the free-text fields: they're interpolated into the prompt, so
    // an unbounded string is both a cost and an instruction-injection vector.
    const clipType = Object.prototype.hasOwnProperty.call(RUBRICS, body?.clipType)
      ? String(body.clipType)
      : "Max Velocity";
    const distance = String(body?.distance ?? "").slice(0, 40);
    const effort = String(body?.effort ?? "").slice(0, 40);

    // Quota is spent only after the request is known to be well-formed, so
    // a malformed call doesn't cost the athlete one of their analyses.
    const quota = await consumeQuota(user.id);
    if (!quota.allowed) {
      return json(
        {
          error: quota.misconfigured
            ? "Analysis is temporarily unavailable. Please try again later."
            : `Daily limit reached (${quota.quota} analyses). Try again tomorrow.`,
          quota_exceeded: !quota.misconfigured,
          used: quota.used,
          quota: quota.quota,
        },
        429
      );
    }

    const rubric = RUBRICS[clipType] ?? RUBRICS["Max Velocity"];
    const contextLine = `Clip type: ${clipType}. Distance: ${distance || "unspecified"}. Effort: ${effort || "unspecified"}.`;

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
                text: `${contextLine}\n\n${rubric}\n\nFrames are attached in chronological order, sampled across the clip.`,
              },
              ...imageBlocks,
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", errText);
      return json({ error: "The analysis service is unavailable right now." }, 502);
    }

    const result = await anthropicRes.json();
    // Sonnet 5 thinks by default, so content[0] is often a thinking block
    // (no .text field) rather than the actual answer -- find the real
    // text block instead of assuming it's first.
    const textBlock = (result.content || []).find((block: { type: string }) => block.type === "text");
    const rawText = (textBlock as { text?: string } | undefined)?.text ?? "";

    let parsed;
    try {
      parsed = JSON.parse(extractJsonObject(rawText));
    } catch {
      parsed = { summary: rawText, pinpoints: [], additional_observations: [], flags: [] };
    }

    return json({ ...parsed, usage: { used: quota.used, quota: quota.quota } });
  } catch (err) {
    console.error("analyze-form failed:", err);
    return json({ error: "Something went wrong analyzing that clip." }, 500);
  }
});
