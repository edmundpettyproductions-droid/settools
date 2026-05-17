---
name: twilio-setup
description: Configure Twilio SMS for the Set Tools notification system. Sets Supabase secrets (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_A..D) and deploys the twilio-sms Edge Function. Use when the user wants to set up, reconfigure, or rotate Twilio credentials for SMS notifications.
---

# Twilio Setup for Set Tools

You are configuring Twilio SMS for the Set Tools notification system. The Edge Function lives at `backend/supabase/functions/twilio-sms/index.ts`. It uses these Supabase secrets:

- `TWILIO_ACCOUNT_SID` — Account SID from Twilio console (starts with `AC`)
- `TWILIO_AUTH_TOKEN` — Auth Token from Twilio console
- `TWILIO_FROM_A` — First Twilio number in E.164 format (e.g. `+13105551234`) — required
- `TWILIO_FROM_B` — Second Twilio number (optional)
- `TWILIO_FROM_C` — Third Twilio number (optional)
- `TWILIO_FROM_D` — Fourth Twilio number (optional)

## Arguments

Arguments may be passed in this order, space-separated:
1. account_sid
2. auth_token
3. from_a (E.164)
4. from_b (optional)
5. from_c (optional)
6. from_d (optional)

If arguments are empty or partial, ask the user for the missing pieces before proceeding. Never invent values.

## Steps

1. **Verify args.** Parse the arguments. If account_sid, auth_token, or from_a is missing, ask the user for them and stop until they reply. Sanity checks:
   - account_sid must match `^AC[a-f0-9]{32}$`
   - auth_token must be 32+ chars
   - each from-number must match `^\+\d{8,15}$` (E.164)
   - if a value fails validation, report it clearly and ask the user to re-enter

2. **Verify the Edge Function source exists** by reading `backend/supabase/functions/twilio-sms/index.ts`. If missing, stop and tell the user to run this on a branch that has the function.

3. **Check the supabase CLI is available.** Run `npx supabase --version`. If it errors, stop and report.

4. **Set secrets**, one per call so a single failure is visible. Run from the `backend/` directory:
   ```
   cd backend && npx supabase secrets set TWILIO_ACCOUNT_SID=<value>
   cd backend && npx supabase secrets set TWILIO_AUTH_TOKEN=<value>
   cd backend && npx supabase secrets set TWILIO_FROM_A=<value>
   ```
   Then only for the slots the user provided:
   ```
   cd backend && npx supabase secrets set TWILIO_FROM_B=<value>
   cd backend && npx supabase secrets set TWILIO_FROM_C=<value>
   cd backend && npx supabase secrets set TWILIO_FROM_D=<value>
   ```
   **Important:** Do NOT log or echo the auth_token. When you run the command, do not include the value in any user-visible message — only confirm "set" or "failed" per secret.

5. **Deploy the function**:
   ```
   cd backend && npx supabase functions deploy twilio-sms
   ```
   If the deploy fails because the project isn't linked, run `cd backend && npx supabase link --project-ref qywzcaghcyueegxnkhjj` and retry once. If link prompts interactively, stop and tell the user to run it themselves.

6. **Report a summary** to the user:
   - Which slots are now configured (A only / A+B / etc.)
   - Function deploy status
   - Next steps:
     - In Set Tools → Cast or Crew tab → 🔔 Notifs → enable SMS, enter your phone, assign A/B/C/D to events, hit Send Test
     - On the iPhone, save each Twilio number as a contact with a unique custom vibration so each event type vibrates differently

## Safety rules

- Never write the auth_token to a file, comment, or commit message
- Never run `git commit` or `git push` as part of this skill — the secrets are server-side only, no repo changes
- If a step fails, stop and report; do not continue with partial state
- If the user has already set some of these secrets, overwriting is fine (Twilio numbers don't change often) — just confirm the action in the summary
