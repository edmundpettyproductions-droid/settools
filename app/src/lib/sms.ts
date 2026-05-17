// sms.ts — Thin client wrapper around the twilio-sms Supabase Edge Function.
//
// Frontend never sees Twilio credentials — the edge function holds them.
// We just POST { to, body, fromSlot } and the server signs + dispatches.

const SUPABASE_URL = 'https://qywzcaghcyueegxnkhjj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5d3pjYWdoY3l1ZWVneG5raGpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0ODA2MTAsImV4cCI6MjA5NDA1NjYxMH0.is6qHpLiDI-fi2z30bjs4LReBFvWLB3yPoo4XypTLsA';
const SMS_URL = `${SUPABASE_URL}/functions/v1/twilio-sms`;

export type FromSlot = 'A' | 'B' | 'C' | 'D';

export interface SendSmsArgs {
  to: string;        // E.164 — e.g. "+13105551234"
  body: string;
  fromSlot?: FromSlot;
}

export interface SendSmsResult {
  ok: boolean;
  error?: string;
  sid?: string;
}

/** Normalize a phone string to E.164 best-effort. US-default if no country code. */
export function normalizeE164(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export function isValidE164(s: string): boolean {
  return /^\+\d{8,15}$/.test(s);
}

export async function sendSms(args: SendSmsArgs): Promise<SendSmsResult> {
  if (!isValidE164(args.to)) return { ok: false, error: 'Invalid recipient (must be E.164)' };
  if (!args.body.trim()) return { ok: false, error: 'Empty body' };

  let resp: Response;
  try {
    resp = await fetch(SMS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        to: args.to,
        body: args.body.slice(0, 1500),
        fromSlot: args.fromSlot ?? 'A',
      }),
    });
  } catch (e) {
    return { ok: false, error: `Network: ${e instanceof Error ? e.message : String(e)}` };
  }

  const text = await resp.text();
  if (!resp.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { error?: string; detail?: string };
      detail = j.error ?? j.detail ?? detail;
    } catch { /* keep raw */ }
    return { ok: false, error: `${resp.status}: ${detail}` };
  }

  try {
    const j = JSON.parse(text) as { sid?: string };
    return { ok: true, sid: j.sid };
  } catch {
    return { ok: true };
  }
}
