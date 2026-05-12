// Anthropic API proxy — keeps the API key on the server.
//
// Deploy: `npx supabase functions deploy claude-proxy`
// Secret: `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
//
// Auth model (MVP): callers must include `Authorization: Bearer <SUPABASE_ANON_KEY>`.
// Supabase's gateway rejects requests without this header (configured via verify_jwt=true
// in config.toml). The anon key is safe to embed in the frontend.
// Phase 3 upgrade: switch to user JWTs once we add Supabase Auth UI.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const ALLOWED_MODELS = new Set([
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5", // legacy callers in next-day.html
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }, 500);
  }

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { model, messages, system, max_tokens, beta } = body ?? {};
  if (typeof model !== "string" || !ALLOWED_MODELS.has(model)) {
    return json({ error: `Model not allowed: ${model}` }, 400);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages[] required" }, 400);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };
  if (beta) headers["anthropic-beta"] = String(beta);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      ...(system ? { system } : {}),
      max_tokens: typeof max_tokens === "number" ? Math.min(max_tokens, 32000) : 4096,
    }),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
