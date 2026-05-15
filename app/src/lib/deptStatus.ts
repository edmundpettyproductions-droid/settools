// Department Status Board — fast "where is every dept right now" view.
// Persists to settools_dept_status. Derives the active dept list from
// existing data sources (issues, contacts, DOOD) and falls back to a
// curated default set so the board is useful on day one.

import * as sync from './sync';
import * as issuesLib from './issues';
import * as contactsLib from './contacts';
import type {
  DeptStatus,
  DeptStatusEntry,
  DeptStatusState,
  IssueEntry,
  UnifiedContact,
} from './types';

const KEY = 'settools_dept_status';

export const STATUS_META: Record<DeptStatus, { label: string; icon: string; color: string }> = {
  ready:   { label: 'Ready',   icon: '🟢', color: 'var(--success)' },
  working: { label: 'Rolling', icon: '🎬', color: 'var(--accent)'  },
  blocked: { label: 'Blocked', icon: '🛑', color: 'var(--danger)'  },
  wrapped: { label: 'Wrapped', icon: '✅', color: 'var(--text3)'   },
};

export const STATUS_ORDER: DeptStatus[] = ['blocked', 'working', 'ready', 'wrapped'];

/** Default department set — the common ones on a feature/episodic crew.
 *  These are always shown unless the user explicitly hides them. */
export const DEFAULT_DEPTS: readonly string[] = Object.freeze([
  'Camera',
  'Sound',
  'Lighting',
  'Grip',
  'Art',
  'Props',
  'Wardrobe',
  'Hair / Makeup',
  'Locations',
  'Stunts',
  'VFX',
  'Production',
  'Talent',
  'Catering',
  'Transportation',
]);

/** Canonical aliases — when we see these in source data, map to the standard
 *  display name. Keeps Camera/CAM/camera dept from showing as three cards. */
const ALIASES: Record<string, string> = {
  cam: 'Camera',
  camera: 'Camera',
  snd: 'Sound',
  sound: 'Sound',
  'g&e': 'Lighting',
  'g & e': 'Lighting',
  ge: 'Lighting',
  gae: 'Lighting',
  gaffer: 'Lighting',
  lighting: 'Lighting',
  electric: 'Lighting',
  electrics: 'Lighting',
  grip: 'Grip',
  grips: 'Grip',
  art: 'Art',
  'art dept': 'Art',
  props: 'Props',
  prop: 'Props',
  wardrobe: 'Wardrobe',
  costume: 'Wardrobe',
  costumes: 'Wardrobe',
  mu: 'Hair / Makeup',
  'mu/hair': 'Hair / Makeup',
  'mu / hair': 'Hair / Makeup',
  'hair/mu': 'Hair / Makeup',
  'h/mu': 'Hair / Makeup',
  hair: 'Hair / Makeup',
  makeup: 'Hair / Makeup',
  'hair & makeup': 'Hair / Makeup',
  'hair and makeup': 'Hair / Makeup',
  locations: 'Locations',
  location: 'Locations',
  stunts: 'Stunts',
  stunt: 'Stunts',
  vfx: 'VFX',
  production: 'Production',
  producer: 'Production',
  producers: 'Production',
  prod: 'Production',
  talent: 'Talent',
  cast: 'Talent',
  catering: 'Catering',
  craft: 'Catering',
  'craft service': 'Catering',
  'craft services': 'Catering',
  transpo: 'Transportation',
  transport: 'Transportation',
  transportation: 'Transportation',
  drivers: 'Transportation',
};

export function canonicalize(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  return ALIASES[lower] ?? trimmed.replace(/\s+/g, ' ');
}

export function loadStatus(): DeptStatusState {
  const s = sync.getJSON<DeptStatusState>(KEY);
  if (!s) return { entries: {} };
  return {
    entries: typeof s.entries === 'object' && s.entries ? s.entries : {},
    custom_depts: Array.isArray(s.custom_depts) ? s.custom_depts : undefined,
    hidden_depts: Array.isArray(s.hidden_depts) ? s.hidden_depts : undefined,
    last_updated: typeof s.last_updated === 'string' ? s.last_updated : undefined,
  };
}

export async function setStatus(dept: string, status: DeptStatus, note?: string): Promise<void> {
  const state = loadStatus();
  const canon = canonicalize(dept);
  const entry: DeptStatusEntry = {
    dept: canon,
    status,
    note: note?.trim() || undefined,
    updated_at: new Date().toISOString(),
  };
  state.entries[canon] = entry;
  state.last_updated = entry.updated_at;
  await sync.set(KEY, JSON.stringify(state));
}

export async function clearStatus(dept: string): Promise<void> {
  const state = loadStatus();
  const canon = canonicalize(dept);
  delete state.entries[canon];
  state.last_updated = new Date().toISOString();
  await sync.set(KEY, JSON.stringify(state));
}

export async function addCustomDept(name: string): Promise<void> {
  const canon = canonicalize(name);
  if (!canon) return;
  const state = loadStatus();
  const custom = state.custom_depts ?? [];
  if (!custom.includes(canon)) custom.push(canon);
  state.custom_depts = custom;
  // If it was hidden, un-hide it.
  state.hidden_depts = (state.hidden_depts ?? []).filter((d) => d !== canon);
  state.last_updated = new Date().toISOString();
  await sync.set(KEY, JSON.stringify(state));
}

export async function hideDept(name: string): Promise<void> {
  const canon = canonicalize(name);
  const state = loadStatus();
  const hidden = state.hidden_depts ?? [];
  if (!hidden.includes(canon)) hidden.push(canon);
  state.hidden_depts = hidden;
  // Also drop any current status for this dept.
  delete state.entries[canon];
  state.last_updated = new Date().toISOString();
  await sync.set(KEY, JSON.stringify(state));
}

export async function resetAllStatuses(): Promise<void> {
  const state = loadStatus();
  state.entries = {};
  state.last_updated = new Date().toISOString();
  await sync.set(KEY, JSON.stringify(state));
}

/** Build the full list of departments to show, in this priority order:
 *   1. Departments derived from existing data (issues, contacts, DOOD)
 *   2. The DEFAULT_DEPTS set
 *   3. User-added custom depts
 *  Minus anything in hidden_depts. */
export function listDepts(state?: DeptStatusState): string[] {
  const s = state ?? loadStatus();
  const hidden = new Set((s.hidden_depts ?? []).map(canonicalize));
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const canon = canonicalize(raw);
    if (!canon) return;
    if (hidden.has(canon)) return;
    if (seen.has(canon)) return;
    seen.add(canon);
    out.push(canon);
  };

  // From issues
  for (const i of issuesLib.loadIssues().issues) {
    if (i.department) push(i.department);
  }
  // From contacts (crew department + DOOD appearances)
  for (const c of contactsLib.loadAllContacts()) {
    if (c.department) push(c.department);
    for (const d of c.dood ?? []) push(d.department);
  }
  // Defaults
  for (const d of DEFAULT_DEPTS) push(d);
  // User custom
  for (const d of s.custom_depts ?? []) push(d);

  return out;
}

export interface DeptSummary {
  dept: string;
  status?: DeptStatusEntry;
  openIssues: IssueEntry[];
  contacts: UnifiedContact[];   // crew / talent whose dept matches
  doodToday: UnifiedContact[];  // people with DOOD appearances tagged to this dept
}

/** Build summary cards for every visible dept. Single pass over issues/contacts. */
export function buildSummaries(): DeptSummary[] {
  const state = loadStatus();
  const depts = listDepts(state);

  // Pre-index issues and contacts by canonical dept for O(n+m).
  const issuesByDept = new Map<string, IssueEntry[]>();
  for (const i of issuesLib.loadIssues().issues) {
    if (i.status === 'resolved') continue;
    if (!i.department) continue;
    const canon = canonicalize(i.department);
    const arr = issuesByDept.get(canon) ?? [];
    arr.push(i);
    issuesByDept.set(canon, arr);
  }

  const contactsByDept = new Map<string, UnifiedContact[]>();
  const doodByDept = new Map<string, UnifiedContact[]>();
  for (const c of contactsLib.loadAllContacts()) {
    if (c.department) {
      const canon = canonicalize(c.department);
      const arr = contactsByDept.get(canon) ?? [];
      arr.push(c);
      contactsByDept.set(canon, arr);
    }
    for (const d of c.dood ?? []) {
      const canon = canonicalize(d.department);
      const arr = doodByDept.get(canon) ?? [];
      arr.push(c);
      doodByDept.set(canon, arr);
    }
  }

  return depts.map((dept) => ({
    dept,
    status: state.entries[dept],
    openIssues: issuesByDept.get(dept) ?? [],
    contacts: contactsByDept.get(dept) ?? [],
    doodToday: doodByDept.get(dept) ?? [],
  }));
}

/** For the top-nav badge: count departments currently flagged blocked. */
export function blockedCount(): number {
  const state = loadStatus();
  return Object.values(state.entries).filter((e) => e.status === 'blocked').length;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
