// Cast Bible — extraction + storage helpers.
// Wraps the Claude proxy in extract.ts with the Cast-Bible-specific prompt
// and shape parsing. Persists results to kv_store via sync.ts so all devices
// see the same roster.

import * as sync from './sync';
import * as extract from './extract';
import type { CastBibleEntry, CastBibleState, CastBibleUpload, CastRole, CastStatus } from './types';

const STORAGE_KEY = 'settools_cast_bible';

const ALLOWED_ROLES: ReadonlySet<CastRole> = new Set<CastRole>([
  'Lead', 'Co-Lead', 'Supporting', 'Recurring', 'Guest Star',
  'Day Player', 'Background', 'Stunt', 'Stand-In', 'Voice', 'Other',
]);

const ALLOWED_STATUSES: ReadonlySet<CastStatus> = new Set<CastStatus>([
  'Locked', 'Tentative', 'Cancelled', 'Wrapped', 'Shooting', 'Pending',
]);

const SYSTEM_PROMPT =
  'You are a precise film/TV production document parser. Cast Bibles vary wildly: pure cast rosters, multi-tab production bibles (Cast on its own tab alongside Crew/Locations/Vendors), spreadsheets with section-divider rows like "LEAD"/"SUPPORTING" that are NOT entries, day-by-day logistics docs with NO cast at all. Be careful and discriminating. You return ONLY valid JSON — no Markdown, no explanation.';

const USER_PROMPT = `Extract the CAST ROSTER from this document.

Return ONLY valid JSON in this exact shape:
{
  "entries": [
    {
      "actor": "Haley Lohrli",
      "actor_legal": "Haley Anne Lohrli",
      "character": "Sophia Rossini",
      "role": "Lead",
      "status": "Locked",
      "phone": "(661) 343-4236",
      "email": "haleylohrli2@gmail.com",
      "agency_name": "CESD",
      "agent_name": "Jane Doe",
      "agent_phone": "(310) 555-9876",
      "agent_email": "jane@cesd.com",
      "guardian_name": "Ashley (mom)",
      "guardian_phone": "(818) 555-1111",
      "hours": 12,
      "rate": "$440/day",
      "diet": "Celiac — gluten-free",
      "notes": "Plays piano in S2E5"
    }
  ],
  "format_summary": "1-2 sentence description of the source format and which sheet(s)/tab(s) you extracted from",
  "skipped_rows": 0
}

RULES — what counts as a cast entry:
- CAST ONLY: actors, talent, principal/supporting performers, day players, stunts, stand-ins, voice.
- NEVER include crew, department heads, producers, directors, DPs, PAs, vendors, or office staff.
- If unsure cast vs crew, EXCLUDE — false positives are worse than missing one.

RULES — rows to SKIP (very important):
- "Section divider" rows where the name/actor field literally says a category like "LEAD", "SUPPORTING", "PRINCIPAL CAST", "DAY PLAYERS", "BACKGROUND", "STUNTS" with no actual person → SKIP these, but USE them as context for the role of the following rows.
- Rows that have an ID number but blank name → SKIP (placeholder).
- Header rows like "ID | CHARACTER | TALENT NAME" → SKIP.
- Rows with #REF! or other spreadsheet errors → SKIP.
- Photo/image-only cells → SKIP.

RULES — field handling:
- "role" must be one of: Lead, Co-Lead, Supporting, Recurring, Guest Star, Day Player, Background, Stunt, Stand-In, Voice, Other. Infer from section dividers when explicit role column is missing. If ambiguous → "Other".
- "status" must be one of: Locked, Tentative, Cancelled, Wrapped, Shooting, Pending. Common synonyms: "Confirmed" → Locked, "Hold" → Tentative.
- Normalize phone numbers to (XXX) XXX-XXXX when possible.
- Two-name handling: if you see BOTH a stage/theatrical name AND a legal name (often labeled "Name - LEGAL" / "Name - THEATRICAL", or "Billing Name" vs "Direct/Character Name"), put the working/billing name in "actor" and the legal/full name in "actor_legal".
- Minors: text like "Sophie Lafleche (9)" → "Sophie Lafleche" in actor, "(9)" age dropped (it's noise, not a notes field). Text like "Logan William Cader | Ashley(mom)" → actor: "Logan William Cader", guardian_name: "Ashley (mom)".
- "hours" must be a number (12, 10.5). If not numeric, omit.
- "rate" stays as a string ("$440/day", "440", "scale +10%") because formats vary.
- Agent info: if you only have an email but no agent_name, that's fine — include just agent_email.
- DIET / ALLERGIES → "diet" field.

RULES — output shape:
- Omit any field not present — DO NOT include null, "", "N/A", "-", "x", "TBD", or "(blank)".
- Multi-tab/multi-page: extract from ALL relevant sheets, deduplicate by primary name.
- "skipped_rows" = count of rows you intentionally skipped (section dividers, blank IDs, errors) — gives the user confidence the prompt is working.
- Return entries: [] if no cast found. Set "format_summary" to explain why ("This is a day-by-day shooting logistics doc, not a cast roster").

NO Markdown fences. NO commentary. ONLY the JSON object.`;

interface RawExtractResponse {
  entries?: unknown;
  format_summary?: unknown;
  skipped_rows?: unknown;
}

/** Strip non-meaningful strings: empty, "N/A", "-", "x", "TBD", "(blank)", etc. */
function cleanStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  if (['n/a', '-', '—', 'x', 'tbd', '(blank)', 'none', 'null'].includes(lower)) return undefined;
  return t;
}

/** Coerce to a number; return undefined for non-numeric input. */
function cleanNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Normalize an unknown entry from Claude into a clean CastBibleEntry.
 *  Drops invalid types, trims strings, enforces enums.
 */
function normalizeEntry(raw: unknown): CastBibleEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const actor = cleanStr(r.actor);
  if (!actor) return null;

  const role = typeof r.role === 'string' && ALLOWED_ROLES.has(r.role as CastRole)
    ? (r.role as CastRole)
    : undefined;
  const status = typeof r.status === 'string' && ALLOWED_STATUSES.has(r.status as CastStatus)
    ? (r.status as CastStatus)
    : undefined;

  const entry: CastBibleEntry = { actor };
  const stringFields: Array<keyof CastBibleEntry> = [
    'actor_legal', 'character',
    'phone', 'email',
    'agency_name', 'agent_name', 'agent_phone', 'agent_email',
    'manager_name', 'manager_phone', 'manager_email',
    'guardian_name', 'guardian_phone',
    'rate', 'diet', 'notes',
  ];
  for (const f of stringFields) {
    const v = cleanStr(r[f]);
    if (v) (entry as unknown as Record<string, unknown>)[f] = v;
  }
  const hours = cleanNum(r.hours);
  if (hours !== undefined) entry.hours = hours;
  if (role) entry.role = role;
  if (status) entry.status = status;
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
    formatSummary: cleanStr(parsed.format_summary),
    skippedRows: typeof parsed.skipped_rows === 'number' ? parsed.skipped_rows : undefined,
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
