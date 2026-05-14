// Unified contact directory.
// Reads every source the existing tools have ever written to and merges them
// by normalized name. Read-only for now — edits happen in the source tool.
// Future: write-through so editing here updates the source store.

import * as sync from './sync';
import type { UnifiedContact, ContactSource, ContactCategory, CastBibleEntry } from './types';

// ── Source readers ────────────────────────────────────────────────────────
// Each returns Partial<UnifiedContact>[] — the merger handles dedup/combine.

/** settools_cast — populated by call-sheet upload in crew-tracker.
 *  Shape varies; we try multiple known field names. */
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

/** settools_crew — populated by call-sheet upload. */
function readCallSheetCrew(): Partial<UnifiedContact>[] {
  const raw = sync.getJSON<{ people?: unknown[]; rows?: unknown[] }>('settools_crew');
  if (!raw) return [];
  const list = (Array.isArray(raw.people) ? raw.people : Array.isArray(raw.rows) ? raw.rows : []) as Array<Record<string, unknown>>;
  return list.flatMap((p) => {
    const name = strOrEmpty(p.name);
    if (!name) return [];
    const role = strOrUndef(p.role ?? p.position ?? p.title);
    return [{
      name,
      category: 'crew' as ContactCategory,
      role,
      department: strOrUndef(p.dept ?? p.department),
      phone: strOrUndef(p.phone ?? p.number),
      email: strOrUndef(p.email),
      sources: ['call_sheet'],
    }];
  });
}

/** settools_cast_bible — richest source for cast data. */
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

/** ST_nextday.contacts — populated by Next Day Prep tool. */
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
  // Normalize for dedup: lowercase, collapse whitespace, strip punctuation.
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Source priority: bible > nextday > call_sheet > sign_in. When merging,
// later sources DON'T overwrite earlier filled fields (the richer source wins).
const SOURCE_PRIORITY: Record<ContactSource, number> = {
  cast_bible: 3,
  next_day: 2,
  call_sheet: 1,
  sign_in: 0,
};

function preferred<T>(a: T | undefined, b: T | undefined, aSources: ContactSource[], bSources: ContactSource[]): T | undefined {
  if (a == null) return b;
  if (b == null) return a;
  // Both set: keep whichever came from the higher-priority source.
  const aMax = Math.max(...aSources.map((s) => SOURCE_PRIORITY[s] ?? 0), 0);
  const bMax = Math.max(...bSources.map((s) => SOURCE_PRIORITY[s] ?? 0), 0);
  return bMax > aMax ? b : a;
}

function mergeInto(target: UnifiedContact, incoming: Partial<UnifiedContact>): void {
  const incSources = incoming.sources ?? [];
  // Field-by-field: prefer the value from the higher-priority source.
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
  // Category: cast wins over crew wins over other (basically, more-specific wins)
  const CAT_PRIORITY: ContactCategory[] = ['cast', 'crew', 'agent', 'manager', 'guardian', 'vendor', 'other'];
  if (incoming.category && CAT_PRIORITY.indexOf(incoming.category) < CAT_PRIORITY.indexOf(target.category)) {
    target.category = incoming.category;
  }
  // Sources: union
  for (const s of incSources) if (!target.sources.includes(s)) target.sources.push(s);
}

// ── Public API ────────────────────────────────────────────────────────────

export function loadAllContacts(): UnifiedContact[] {
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
      // Seed a new contact. Required fields default sensibly.
      byKey.set(key, {
        name: entry.name!,
        category: entry.category ?? 'other',
        sources: entry.sources ?? [],
        ...entry,
      } as UnifiedContact);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ── URL builders for one-tap actions ──────────────────────────────────────
/** Strip everything except digits and leading + for clean tel: / sms: URLs. */
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

// ── Stats / filters ───────────────────────────────────────────────────────
export interface ContactStats {
  total: number;
  cast: number;
  crew: number;
  withPhone: number;
  withEmail: number;
  withAgent: number;
}

export function stats(list: UnifiedContact[]): ContactStats {
  let cast = 0, crew = 0, withPhone = 0, withEmail = 0, withAgent = 0;
  for (const c of list) {
    if (c.category === 'cast') cast++;
    else if (c.category === 'crew') crew++;
    if (c.phone) withPhone++;
    if (c.email) withEmail++;
    if (c.agent_name || c.agent_phone || c.agent_email) withAgent++;
  }
  return { total: list.length, cast, crew, withPhone, withEmail, withAgent };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}
