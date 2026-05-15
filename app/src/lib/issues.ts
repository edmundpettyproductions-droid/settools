// Issue Tracker — talent late, equipment problem, wardrobe delay, etc.
// Persists to settools_issues via sync.ts. Designed for one-tap quick-create.

import * as sync from './sync';
import type { IssueEntry, IssuesState, IssueStatus, IssueType } from './types';

const KEY = 'settools_issues';

export const TYPE_LABELS: Record<IssueType, { label: string; icon: string }> = {
  talent_late:    { label: 'Talent Late',   icon: '⏰' },
  equipment:      { label: 'Equipment',     icon: '🎥' },
  wardrobe:       { label: 'Wardrobe',      icon: '👕' },
  makeup_hair:    { label: 'MU / Hair',     icon: '💄' },
  location:       { label: 'Location',      icon: '📍' },
  script:         { label: 'Script',        icon: '📜' },
  safety:         { label: 'Safety',        icon: '⚠️' },
  transportation: { label: 'Transport',     icon: '🚐' },
  catering:       { label: 'Catering',      icon: '🥗' },
  other:          { label: 'Other',         icon: '❔' },
};

export const STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
};

export function loadIssues(): IssuesState {
  const s = sync.getJSON<IssuesState>(KEY);
  if (!s) return { issues: [] };
  return {
    issues: Array.isArray(s.issues) ? s.issues : [],
    last_updated: typeof s.last_updated === 'string' ? s.last_updated : undefined,
  };
}

export async function addIssue(partial: Omit<IssueEntry, 'id' | 'created_at' | 'status'> & { status?: IssueStatus }): Promise<IssueEntry> {
  const state = loadIssues();
  const issue: IssueEntry = {
    id: makeId(),
    status: 'open',
    created_at: new Date().toISOString(),
    ...partial,
  };
  state.issues.unshift(issue);
  state.last_updated = issue.created_at;
  await sync.set(KEY, JSON.stringify(state));
  return issue;
}

export async function updateIssue(id: string, patch: Partial<IssueEntry>): Promise<void> {
  const state = loadIssues();
  const idx = state.issues.findIndex((i) => i.id === id);
  if (idx === -1) return;
  state.issues[idx] = { ...state.issues[idx]!, ...patch };
  state.last_updated = new Date().toISOString();
  await sync.set(KEY, JSON.stringify(state));
}

export async function resolveIssue(id: string, note?: string): Promise<void> {
  await updateIssue(id, {
    status: 'resolved',
    resolved_at: new Date().toISOString(),
    resolution_note: note,
  });
}

export async function reopenIssue(id: string): Promise<void> {
  await updateIssue(id, { status: 'open', resolved_at: undefined, resolution_note: undefined });
}

export async function deleteIssue(id: string): Promise<void> {
  const state = loadIssues();
  state.issues = state.issues.filter((i) => i.id !== id);
  state.last_updated = new Date().toISOString();
  await sync.set(KEY, JSON.stringify(state));
}

function makeId(): string {
  return `i_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function openIssues(): IssueEntry[] {
  return loadIssues().issues.filter((i) => i.status !== 'resolved');
}

/** Issues affecting a specific person — for cross-linking from Contacts. */
export function issuesForPerson(name: string): IssueEntry[] {
  const norm = name.toLowerCase().trim();
  if (!norm) return [];
  return loadIssues().issues.filter(
    (i) => (i.person && i.person.toLowerCase().trim() === norm) || i.description.toLowerCase().includes(norm),
  );
}

/** Counts open vs resolved for stats display. */
export function counts(): { open: number; in_progress: number; resolved: number; total: number } {
  const list = loadIssues().issues;
  let open = 0, in_progress = 0, resolved = 0;
  for (const i of list) {
    if (i.status === 'open') open++;
    else if (i.status === 'in_progress') in_progress++;
    else if (i.status === 'resolved') resolved++;
  }
  return { open, in_progress, resolved, total: list.length };
}

/** Format a relative time like "5m ago", "1h ago", "yesterday". */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
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
