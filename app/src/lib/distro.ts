// distro.ts — Distribution list + email composition
// Builds recipient lists from contacts, generates email body from next-day call.

import * as sync from './sync';
import * as contactsLib from './contacts';
import * as NC from './nextCall';

// ─── Types ───────────────────────────────────────────────────────────
export interface Recipient {
  name: string;
  email: string;
  dept: string;
  included: boolean;
}

export interface DistroState {
  recipients: Recipient[];
  subject: string;
  bodyPrefix: string;   // text before the call sheet
  bodySuffix: string;   // text after the call sheet
  bodyCache: string;    // last generated / AI-updated email body (persists across navigation)
  lastSent: string | null;
}

export const STORAGE_KEY = 'settools_distro';

// ─── Load / Save ─────────────────────────────────────────────────────
export function loadDistro(): DistroState {
  const raw = sync.getJSON<DistroState>(STORAGE_KEY);
  if (raw?.recipients) return raw;
  return {
    recipients: [],
    subject: '',
    bodyPrefix: '',
    bodySuffix: '',
    bodyCache: '',
    lastSent: null,
  };
}

export async function saveDistro(data: DistroState): Promise<void> {
  await sync.set(STORAGE_KEY, JSON.stringify(data));
}

// ─── Build from contacts ─────────────────────────────────────────────
export function buildRecipients(): Recipient[] {
  const contacts = contactsLib.loadAllContacts();
  const recipients: Recipient[] = [];
  const seen = new Set<string>();

  for (const c of contacts) {
    if (!c.email || seen.has(c.email.toLowerCase())) continue;
    seen.add(c.email.toLowerCase());
    recipients.push({
      name: c.name,
      email: c.email,
      dept: c.department ?? c.category ?? '',
      included: true,
    });
  }

  // Sort by dept then name
  recipients.sort((a, b) => {
    const d = a.dept.localeCompare(b.dept);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });

  return recipients;
}

// ─── Email generation ────────────────────────────────────────────────
export function generateSubject(data: NC.NextCallData): string {
  const uh = sync.getJSON<{ production?: string; episode?: string }>('settools_uh');
  const prod = uh?.production ?? 'Production';
  const ep = uh?.episode ? ` Ep ${uh.episode}` : '';
  return `${prod}${ep} — Call Sheet ${data.date}`;
}

export function generateEmailBody(data: NC.NextCallData, prefix: string, suffix: string): string {
  const parts: string[] = [];
  if (prefix.trim()) parts.push(prefix.trim());
  parts.push('');
  parts.push(NC.generatePreview(data));
  parts.push('');
  if (suffix.trim()) parts.push(suffix.trim());
  return parts.join('\n');
}

/** Build a mailto: URI for the included recipients */
export function buildMailto(
  recipients: Recipient[],
  subject: string,
  body: string,
): string {
  const to = recipients
    .filter((r) => r.included && r.email)
    .map((r) => r.email)
    .join(',');
  // URLSearchParams encodes spaces as +, but RFC 6068 mailto: requires %20
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Get a comma-separated email list for clipboard */
export function emailList(recipients: Recipient[]): string {
  return recipients
    .filter((r) => r.included && r.email)
    .map((r) => `${r.name} <${r.email}>`)
    .join('; ');
}
