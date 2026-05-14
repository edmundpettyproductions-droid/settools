// Cast Bible — extraction + storage helpers.
// Wraps the Claude proxy in extract.ts with the Cast-Bible-specific prompt
// and shape parsing. Persists results to kv_store via sync.ts so all devices
// see the same roster.

import * as sync from './sync';
import * as extract from './extract';
import type { CastBibleEntry, CastBibleState, CastBibleUpload, CastRole } from './types';

const STORAGE_KEY = 'settools_cast_bible';

const ALLOWED_ROLES: ReadonlySet<CastRole> = new Set<CastRole>([
  'Lead', 'Co-Lead', 'Supporting', 'Recurring', 'Guest Star',
  'Day Player', 'Background', 'Stunt', 'Stand-In', 'Voice', 'Other',
]);

const SYSTEM_PROMPT =
  'You are a precise film/TV production document parser. Extract cast/talent rosters from Cast Bibles, which vary in format (separate sheets, mixed with crew, multi-tab spreadsheets, PDF tables, etc.). You return ONLY valid JSON — no Markdown, no explanation.';

const USER_PROMPT = `Extract the CAST ROSTER from this document.

Return ONLY valid JSON in this exact shape:
{
  "entries": [
    {
      "actor": "John Smith",
      "character": "Detective Garcia",
      "role": "Lead",
      "phone": "(310) 555-1234",
      "email": "john@example.com",
      "agent_name": "Jane Doe",
      "agent_phone": "(310) 555-9876",
      "agent_email": "jane@agency.com",
      "manager_name": "Bob Brown",
      "manager_phone": "(310) 555-0001",
      "manager_email": "bob@mgmt.com",
      "notes": "Plays piano in S2E5"
    }
  ],
  "format_summary": "1-2 sentence description of the source format"
}

RULES:
- CAST ONLY, never crew/department-heads/PA/director/etc.
- If unsure cast vs crew, EXCLUDE.
- "role" must be one of: "Lead", "Co-Lead", "Supporting", "Recurring", "Guest Star", "Day Player", "Background", "Stunt", "Stand-In", "Voice", "Other". If ambiguous → "Other".
- Omit any field not present in the source — DO NOT include null, empty strings, or "N/A".
- Normalize phone numbers to (XXX) XXX-XXXX format when possible.
- If a document has multiple tabs/pages, extract from all of them. Deduplicate by actor name.
- Ignore images/headshots — extract only text data.
- Return entries: [] if no cast found.

NO Markdown fences. NO commentary. ONLY the JSON object.`;

interface RawExtractResponse {
  entries?: unknown;
  format_summary?: unknown;
}

/** Normalize an unknown entry from Claude into a clean CastBibleEntry.
 *  Drops invalid types, trims strings, enforces the role enum.
 */
function normalizeEntry(raw: unknown): CastBibleEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const actor = typeof r.actor === 'string' ? r.actor.trim() : '';
  if (!actor) return null;

  const str = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t && t.toLowerCase() !== 'n/a' && t !== '-' ? t : undefined;
  };
  const role = typeof r.role === 'string' && ALLOWED_ROLES.has(r.role as CastRole)
    ? (r.role as CastRole)
    : undefined;

  const entry: CastBibleEntry = { actor };
  const fields: Array<keyof CastBibleEntry> = [
    'character', 'phone', 'email',
    'agent_name', 'agent_phone', 'agent_email',
    'manager_name', 'manager_phone', 'manager_email',
    'notes',
  ];
  for (const f of fields) {
    const v = str(r[f]);
    if (v) (entry as Record<string, unknown>)[f] = v;
  }
  if (role) entry.role = role;
  return entry;
}

/** Run extraction on a PDF or text input. Returns parsed entries + metadata. */
export async function extractCastBible(input: { kind: 'pdf'; pdfBase64: string } | { kind: 'text'; text: string }) {
  const raw = input.kind === 'pdf'
    ? await extract.extractFromPdf(input.pdfBase64, USER_PROMPT, { system: SYSTEM_PROMPT })
    : await extract.extractFromText(input.text, USER_PROMPT, { system: SYSTEM_PROMPT });

  const parsed = extract.parseJsonResponse<RawExtractResponse>(raw);
  const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];

  const seen = new Set<string>();
  const entries: CastBibleEntry[] = [];
  for (const r of rawEntries) {
    const e = normalizeEntry(r);
    if (!e) continue;
    const key = e.actor.toLowerCase();
    if (seen.has(key)) continue;  // dedupe by actor name
    seen.add(key);
    entries.push(e);
  }

  return {
    entries,
    formatSummary: typeof parsed.format_summary === 'string' ? parsed.format_summary : undefined,
  };
}

/** Load the current Cast Bible from kv_store. Always returns a valid state object. */
export function loadCastBible(): CastBibleState {
  const state = sync.getJSON<CastBibleState>(STORAGE_KEY);
  if (!state || typeof state !== 'object') return { entries: [], uploads: [] };
  return {
    entries: Array.isArray(state.entries) ? state.entries : [],
    uploads: Array.isArray(state.uploads) ? state.uploads : [],
    last_updated: typeof state.last_updated === 'string' ? state.last_updated : undefined,
  };
}

/** Replace the current roster. Records the upload event. */
export async function saveCastBible(entries: CastBibleEntry[], upload: CastBibleUpload): Promise<void> {
  const existing = loadCastBible();
  const next: CastBibleState = {
    entries,
    uploads: [...existing.uploads, upload].slice(-10),  // keep last 10 uploads
    last_updated: new Date().toISOString(),
  };
  await sync.set(STORAGE_KEY, JSON.stringify(next));
}

/** Wipe the roster. */
export async function clearCastBible(): Promise<void> {
  await sync.set(STORAGE_KEY, JSON.stringify({ entries: [], uploads: [] } satisfies CastBibleState));
}

/** Counts by role for stats display. */
export function countByRole(entries: CastBibleEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    const k = e.role ?? 'Unspecified';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
