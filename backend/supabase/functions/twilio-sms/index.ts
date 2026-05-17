// Twilio SMS Edge Function — sends a single SMS via Twilio's Messages API.
//
// Setup:
//   1. Sign up at twilio.com. Buy a phone number ($1.15/mo). Optionally buy more
//      (up to 4) — one per event type you want to assign a custom iOS vibration to.
//   2. From Twilio console grab: Account SID, Auth Token, and your number(s).
//   3. Set Supabase secrets:
//        npx supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxx
//        npx supabase secrets set TWILIO_AUTH_TOKEN=xxxxx
//        npx supabase secrets set TWILIO_FROM_A=+13105551234
//        npx supabase secrets set TWILIO_FROM_B=+13105555678   (optional)
//        npx supabase secrets set TWILIO_FROM_C=+13105559012   (optional)
//        npx supabase secrets set TWILIO_FROM_D=+13105553456   (optional)
//   4. Deploy:
//        npx supabase functions deploy twilio-sms
//   5. On your iPhone, save each FROM number as its own contact ("Set Tools — Pre-call",
//      "Set Tools — Late", etc.) and assign each a unique custom vibration:
//        Contacts → Edit → Vibration → Create New Vibration
//
// Request shape:
//   POST { to: "+13105551234", body: "...", fromSlot: "A" | "B" | "C" | "D" }
//   Authorization: Bearer <SUPABASE_ANON_KEY>

const ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const FROM_NUMBERS: Record<string, string | undefined> = {
  A: Deno.env.get("TWILIO_FROM_A"),
  B: Deno.env.get("TWILIO_FROM_B"),
  C: Deno.env.get("TWILIO_FROM_C"),
  D: Deno.env.get("TWILIO_FROM_D"),
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    return json({ error: "Server misconfigured: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set" }, 500);
  }

  let body: { to?: string; body?: string; fromSlot?: string };
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const to = (body.to ?? "").trim();
  const msg = (body.body ?? "").trim();
  const slot = (body.fromSlot ?? "A").toUpperCase();

  if (!/^\+\d{8,15}$/.test(to)) {
    return json({ error: "to must be E.164 (e.g. +13105551234)" }, 400);
  }
  if (!msg) return json({ error: "body required" }, 400);
  if (msg.length > 1600) return json({ error: "body too long (max 1600)" }, 400);

  const from = FROM_NUMBERS[slot];
  if (!from) {
    return json({ error: `No FROM number configured for slot ${slot}. Set TWILIO_FROM_${slot} secret.` }, 400);
  }

  const auth = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`);
  const form = new URLSearchParams({ From: from, To: to, Body: msg });

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
  } catch (e) {
    return json({ error: `Twilio network error: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return json({ error: `Twilio HTTP ${upstream.status}`, detail: text.slice(0, 500) }, upstream.status);
  }
  return new Response(text, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
