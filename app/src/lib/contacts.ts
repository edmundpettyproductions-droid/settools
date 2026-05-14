// Unified contact directory + cross-source conflict detection + DOOD coverage.
// Reads every contact-bearing key sync.ts knows about, merges by normalized
// name, tracks per-field values across sources (so we can surface conflicts),
// and joins DOOD scheduling data per person.

import * as sync from './sync';
import type {
  UnifiedContact, ContactSource, ContactCategory, CastBibleEntry,
  ContactFieldValue, ContactConflict, DoodAppearance,
} from './types';

// ── Source readers ────────────────────────────────────────────────────────
// Each yields Partial<UnifiedContact>[] tagged with which source it came from.
// The merger combines them, tracking per-field provenance.

function readCallSheetCast(): Partial<UnifiedContact>[] {
  const raw = sync.getJSON<{ people?: unknown[]; rows?: unknown[] }>('settools_cast');
  if (!raw) return [];
  const list = (Array.isArray(raw.people) ? raw.people : Array.isArray(raw.rows) ? raw.rows : []) as Array<Record<string, unknown>>;
  return list.flatMap((p) => {
    const name = strOrEmpty(p.name ?? p.actor ?? p.talent ?? p.fullName);
    if (!name) return [];
    return [{
      name,
      category: 'cast' as ContactCategory,
      character: strOrUndef(p.character ?? p.role),
      phone: strOrUndef(p.phone ?? p.number),
      email: strOrUndef(p.email),
      sources: ['call_sheet'],
    }];
  });
}

function readCallSheetCrew(): Partial<UnifiedContact>[] {
  const raw = sync.getJSON<{ people?: unknown[]; rows?: unknown[] }>('settools_crew');
  if (!raw) return [];
  const list = (Array.isArray(raw.people) ? raw.people : Array.isArray(raw.rows) ? raw.rows : []) as Array<Record<string, unknown>>;
  return list.flatMap((p) => {
    const name = strOrEmpty(p.name);
    if (!name) return [];
    return [{
      name,
      category: 'crew' as ContactCategory,
      role: strOrUndef(p.role ?? p.position ?? p.title),
      department: strOrUndef(p.dept ?? p.department),
      phone: strOrUndef(p.phone ?? p.number),
      email: strOrUndef(p.email),
      sources: ['call_sheet'],
    }];
  });
}

function readCastBible(): Partial<UnifiedContact>[] {
  const raw = sync.getJSON<{ entries?: CastBibleEntry[] }>('settools_cast_bible');
  if (!raw?.entries) return [];
  return raw.entries.map((e) => ({
    name: e.actor,
    category: 'cast' as ContactCategory,
    role: e.role,
    character: e.character,
    phone: e.phone,
    email: e.email,
    actor_legal: e.actor_legal,
    status: e.status,
    agency_name: e.agency_name,
    agent_name: e.agent_name,
    agent_phone: e.agent_phone,
    agent_email: e.agent_email,
    manager_name: e.manager_name,
    manager_phone: e.manager_phone,
    manager_email: e.manager_email,
    guardian_name: e.guardian_name,
    guardian_phone: e.guardian_phone,
    diet: e.diet,
    notes: e.notes,
    sources: ['cast_bible' as ContactSource],
  }));
}

function readNextDay(): Partial<UnifiedContact>[] {
  const raw = sync.getJSON<{ contacts?: unknown[] }>('ST_nextday');
  if (!raw?.contacts) return [];
  const list = raw.contacts as Array<Record<string, unknown>>;
  return list.flatMap((c) => {
    const name = strOrEmpty(c.name);
    if (!name) return [];
    const isCast = c.isCast === true || c.role === 'cast';
    return [{
      name,
      category: (isCast ? 'cast' : 'crew') as ContactCategory,
      role: strOrUndef(c.role),
      phone: strOrUndef(c.phone),
      email: strOrUndef(c.email),
      sources: ['next_day' as ContactSource],
    }];
  });
}

// ── DOOD reader ───────────────────────────────────────────────────────────
// settools_dood shape varies; we tolerate three flavors:
//   1) { departments: { 'Cast': { 'Person Name': { days: [...] } } } }
//   2) { departments: { 'Cast': { people: [{ name, days }] } } }
//   3) { departments: { 'Cast': { rows: [{ name, days }] } } }
//
// Returns a map: normalized name → array of DOOD appearances.
function readDoodCoverage(): Map<string, DoodAppearance[]> {
  const map = new Map<string, DoodAppearance[]>();
  const raw = sync.getJSON<{ departments?: Record<string, unknown> }>('settools_dood');
  if (!raw?.departments) return map;

  for (const [deptName, deptData] of Object.entries(raw.departments)) {
    if (!deptData || typeof deptData !== 'object') continue;
    const dd = deptData as Record<string, unknown>;

    let people: Array<{ name: string; days?: unknown; notes?: string }> = [];
    if (Array.isArray(dd.people)) {
      people = dd.people as typeof people;
    } else if (Array.isArray(dd.rows)) {
      people = dd.rows as typeof people;
    } else {
      // Treat as map { name: details }
      people = Object.entries(dd)
        .filter(([k]) => k !== 'name' && k !== 'department')
        .map(([name, details]) => {
          const d = typeof details === 'object' && details !== null
            ? (details as Record<string, unknown>)
            : {};
          return { name, days: d.days ?? d.daysWorked ?? d.workingDays, notes: typeof d.notes === 'string' ? d.notes : undefined };
        });
    }

    for (const p of people) {
      const personName = strOrEmpty(p.name);
      if (!personName) continue;
      const days = parseDays(p.days);
      const appearance: DoodAppearance = {
        department: deptName,
        days,
        days_label: formatDays(days),
        notes: typeof p.notes === 'string' ? p.notes : undefined,
      };
      const key = nameKey(personName);
      const arr = map.get(key) ?? [];
      arr.push(appearance);
      map.set(key, arr);
    }
  }
  return map;
}

/** Parse a "days worked" representation into a sorted, deduped number[]. */
function parseDays(input: unknown): number[] {
  let nums: number[] = [];
  if (Array.isArray(input)) {
    nums = input
      .map((d) => parseInt(String(d).replace(/[^\d]/g, ''), 10))
      .filter((n) => Number.isFinite(n));
  } else if (typeof input === 'object' && input !== null) {
    nums = Object.entries(input as Record<string, unknown>)
      .filter(([, v]) => v === true || v === 1 || (typeof v === 'string' && v.toLowerCase() !== 'off' && v !== ''))
      .map(([k]) => parseInt(k.replace(/[^\d]/g, ''), 10))
      .filter((n) => Number.isFinite(n));
  } else if (typeof input === 'string') {
    nums = input.split(/[,\s;]+/)
      .map((s) => parseInt(s.replace(/[^\d]/g, ''), 10))
      .filter((n) => Number.isFinite(n));
  }
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

/** Format days as "D1, D3-5, D7". */
export function formatDays(days: number[]): string {
  if (!days.length) return '';
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]!;
    if (curr === prev + 1) { prev = curr; continue; }
    ranges.push(start === prev ? `D${start}` : `D${start}-${prev}`);
    start = curr; prev = curr;
  }
  ranges.push(start === prev ? `D${start}` : `D${start}-${prev}`);
  return ranges.join(', ');
}

// ── Helpers ───────────────────────────────────────────────────────────────
function strOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function strOrUndef(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.toLowerCase() !== 'n/a' && t !== '-' ? t : undefined;
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

const SOURCE_PRIORITY: Record<ContactSource, number> = {
  cast_bible: 3,
  next_day: 2,
  call_sheet: 1,
  sign_in: 0,
};

function preferred<T>(a: T | undefined, b: T | undefined, aSources: ContactSource[], bSources: ContactSource[]): T | undefined {
  if (a == null) return b;
  if (b == null) return a;
  const aMax = Math.max(...aSources.map((s) => SOURCE_PRIORITY[s] ?? 0), 0);
  const bMax = Math.max(...bSources.map((s) => SOURCE_PRIORITY[s] ?? 0), 0);
  return bMax > aMax ? b : a;
}

/** Normalize a phone string for conflict-comparison purposes (digits only). */
function normForCompare(field: string, value: string): string {
  if (field === 'phone' || field.endsWith('_phone')) {
    return value.replace(/\D/g, '');
  }
  if (field === 'email' || field.endsWith('_email')) {
    return value.trim().toLowerCase();
  }
  return value.trim().toLowerCase();
}

/** Fields we track per-source for conflict surfacing.
 *  (Things that often differ between bible / call sheet / next-day.) */
const TRACKED_FIELDS: readonly string[] = [
  'phone', 'email', 'character', 'role', 'status',
  'agent_phone', 'agent_email',
];

function recordField(c: UnifiedContact, field: string, value: string | undefined, source: ContactSource) {
  if (!value || !TRACKED_FIELDS.includes(field)) return;
  c.field_values = c.field_values ?? {};
  const arr = c.field_values[field] ?? [];
  const cmp = normForCompare(field, value);
  // Avoid recording the same logical value twice (e.g. "(555) 123" vs "555-123")
  if (!arr.some((existing) => normForCompare(field, existing.value) === cmp)) {
    arr.push({ source, value });
  }
  c.field_values[field] = arr;
}

function recordAllFields(c: UnifiedContact, entry: Partial<UnifiedContact>) {
  const incSources = entry.sources ?? [];
  if (!incSources.length) return;
  const primary = incSources[0]!;
  for (const f of TRACKED_FIELDS) {
    const v = entry[f as keyof UnifiedContact] as string | undefined;
    recordField(c, f, v, primary);
  }
}

function mergeInto(target: UnifiedContact, incoming: Partial<UnifiedContact>): void {
  const incSources = incoming.sources ?? [];
  const fields: Array<keyof UnifiedContact> = [
    'role', 'department', 'character',
    'phone', 'email',
    'actor_legal', 'status',
    'agency_name', 'agent_name', 'agent_phone', 'agent_email',
    'manager_name', 'manager_phone', 'manager_email',
    'guardian_name', 'guardian_phone',
    'diet', 'notes',
  ];
  for (const f of fields) {
    const existing = target[f] as string | undefined;
    const next = incoming[f] as string | undefined;
    const v = preferred(existing, next, target.sources, incSources);
    if (v) (target as Record<string, unknown>)[f] = v;
  }
  const CAT_PRIORITY: ContactCategory[] = ['cast', 'crew', 'agent', 'manager', 'guardian', 'vendor', 'other'];
  if (incoming.category && CAT_PRIORITY.indexOf(incoming.category) < CAT_PRIORITY.indexOf(target.category)) {
    target.category = incoming.category;
  }
  for (const s of incSources) if (!target.sources.includes(s)) target.sources.push(s);
  recordAllFields(target, incoming);
}

/** Compute conflicts from tracked field_values. */
export function getConflicts(c: UnifiedContact): ContactConflict[] {
  if (!c.field_values) return [];
  const conflicts: ContactConflict[] = [];
  for (const [field, values] of Object.entries(c.field_values)) {
    if (values.length < 2) continue;
    const distinct = new Set(values.map((v) => normForCompare(field, v.value)));
    if (distinct.size > 1) {
      conflicts.push({ field, values });
    }
  }
  return conflicts;
}

// ── Public API ────────────────────────────────────────────────────────────

export function loadAllContacts(): UnifiedContact[] {
  // Order matters for source-priority field selection AND for the order
  // values appear in conflict lists. Highest-priority first so its value
  // appears first in conflict displays.
  const all: Partial<UnifiedContact>[] = [
    ...readCastBible(),
    ...readNextDay(),
    ...readCallSheetCast(),
    ...readCallSheetCrew(),
  ];
  const byKey = new Map<string, UnifiedContact>();
  for (const entry of all) {
    const key = nameKey(entry.name ?? '');
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      mergeInto(existing, entry);
    } else {
      const seeded: UnifiedContact = {
        name: entry.name!,
        category: entry.category ?? 'other',
        sources: entry.sources ?? [],
        ...entry,
      } as UnifiedContact;
      // Seed field_values from the first source too
      recordAllFields(seeded, entry);
      byKey.set(key, seeded);
    }
  }

  // Attach DOOD coverage + compute final conflicts.
  const doodMap = readDoodCoverage();
  for (const contact of byKey.values()) {
    const key = nameKey(contact.name);
    const dood = doodMap.get(key);
    if (dood && dood.length) contact.dood = dood;
    const conflicts = getConflicts(contact);
    if (conflicts.length) contact.conflicts = conflicts;
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ── URL builders for one-tap actions ──────────────────────────────────────
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}
export function telUrl(phone: string): string { return `tel:${normalizePhone(phone)}`; }
export function smsUrl(phone: string, body?: string): string {
  const base = `sms:${normalizePhone(phone)}`;
  return body ? `${base}?body=${encodeURIComponent(body)}` : base;
}
export function mailtoUrl(email: string, subject?: string, body?: string): string {
  const params: string[] = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${email}${params.length ? '?' + params.join('&') : ''}`;
}

// ── Stats / display helpers ───────────────────────────────────────────────
export interface ContactStats {
  total: number;
  cast: number;
  crew: number;
  withPhone: number;
  withEmail: number;
  withAgent: number;
  withConflicts: number;
  inDood: number;
}

export function stats(list: UnifiedContact[]): ContactStats {
  let cast = 0, crew = 0, withPhone = 0, withEmail = 0, withAgent = 0, withConflicts = 0, inDood = 0;
  for (const c of list) {
    if (c.category === 'cast') cast++;
    else if (c.category === 'crew') crew++;
    if (c.phone) withPhone++;
    if (c.email) withEmail++;
    if (c.agent_name || c.agent_phone || c.agent_email) withAgent++;
    if (c.conflicts && c.conflicts.length) withConflicts++;
    if (c.dood && c.dood.length) inDood++;
  }
  return { total: list.length, cast, crew, withPhone, withEmail, withAgent, withConflicts, inDood };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

export function sourceLabel(s: ContactSource): string {
  switch (s) {
    case 'cast_bible': return 'Cast Bible';
    case 'call_sheet': return 'Call Sheet';
    case 'next_day':   return 'Next Day Prep';
    case 'sign_in':    return 'Sign-In Records';
  }
}

/** Human-readable name for a field key (used in conflict displays). */
export function fieldLabel(field: string): string {
  return ({
    phone: 'Phone',
    email: 'Email',
    character: 'Character',
    role: 'Role',
    status: 'Status',
    agent_phone: 'Agent Phone',
    agent_email: 'Agent Email',
  } as Record<string, string>)[field] ?? field;
}
