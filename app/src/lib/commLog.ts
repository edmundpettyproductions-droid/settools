// commLog.ts — Communication Log
// Tracks emails, calls, texts, and radio communications during shoot days.

import * as sync from './sync';

// ─── Types ───────────────────────────────────────────────────────────
export type CommType = 'email' | 'call' | 'text' | 'radio' | 'other';
export type CommDirection = 'outbound' | 'inbound';

export interface CommEntry {
  id: string;
  type: CommType;
  direction: CommDirection;
  timestamp: string;       // ISO datetime
  contact: string;         // who — name, dept, or phone #
  subject: string;         // brief subject or topic
  notes: string;           // details / content summary
  flagged: boolean;        // important / follow-up needed
  resolved: boolean;       // follow-up completed
}

export interface CommLogState {
  entries: CommEntry[];
  lastUpdated: string | null;
}

export const STORAGE_KEY = 'settools_comm_log';

export const TYPE_LABELS: Record<CommType, { label: string; icon: string }> = {
  email: { label: 'Email', icon: '✉' },
  call:  { label: 'Call',  icon: '📞' },
  text:  { label: 'Text',  icon: '💬' },
  radio: { label: 'Radio', icon: '📻' },
  other: { label: 'Other', icon: '📋' },
};

export const DIRECTION_LABELS: Record<CommDirection, string> = {
  outbound: 'Out',
  inbound: 'In',
};

export const ALL_TYPES: readonly CommType[] = ['email', 'call', 'text', 'radio', 'other'];

// ─── Load / Save ─────────────────────────────────────────────────────
export function loadLog(): CommLogState {
  const raw = sync.getJSON<CommLogState>(STORAGE_KEY);
  if (raw?.entries) return raw;
  return { entries: [], lastUpdated: null };
}

export async function saveLog(state: CommLogState): Promise<void> {
  state.lastUpdated = new Date().toISOString();
  await sync.set(STORAGE_KEY, JSON.stringify(state));
}

// ─── CRUD ────────────────────────────────────────────────────────────
function makeId(): string {
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function addEntry(
  partial: Omit<CommEntry, 'id' | 'timestamp' | 'flagged' | 'resolved'>,
): Promise<CommEntry> {
  const state = loadLog();
  const entry: CommEntry = {
    id: makeId(),
    timestamp: new Date().toISOString(),
    flagged: false,
    resolved: false,
    ...partial,
  };
  state.entries.unshift(entry);
  await saveLog(state);
  return entry;
}

export async function updateEntry(id: string, patch: Partial<CommEntry>): Promise<void> {
  const state = loadLog();
  const idx = state.entries.findIndex((e) => e.id === id);
  if (idx === -1) return;
  state.entries[idx] = { ...state.entries[idx]!, ...patch };
  await saveLog(state);
}

export async function deleteEntry(id: string): Promise<void> {
  const state = loadLog();
  state.entries = state.entries.filter((e) => e.id !== id);
  await saveLog(state);
}

export async function toggleFlag(id: string): Promise<void> {
  const state = loadLog();
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  entry.flagged = !entry.flagged;
  await saveLog(state);
}

export async function toggleResolved(id: string): Promise<void> {
  const state = loadLog();
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  entry.resolved = !entry.resolved;
  await saveLog(state);
}

// ─── Queries ─────────────────────────────────────────────────────────
export function flaggedEntries(): CommEntry[] {
  return loadLog().entries.filter((e) => e.flagged && !e.resolved);
}

export function todayEntries(): CommEntry[] {
  const today = new Date().toISOString().slice(0, 10);
  return loadLog().entries.filter((e) => e.timestamp.startsWith(today));
}

export function counts(): { total: number; flagged: number; resolved: number } {
  const entries = loadLog().entries;
  return {
    total: entries.length,
    flagged: entries.filter((e) => e.flagged && !e.resolved).length,
    resolved: entries.filter((e) => e.resolved).length,
  };
}

// ─── Export ──────────────────────────────────────────────────────────
export function formatLogText(entries: CommEntry[]): string {
  if (!entries.length) return 'No communications logged.';
  const lines: string[] = ['COMMUNICATION LOG', '═'.repeat(50), ''];
  for (const e of entries) {
    const dt = new Date(e.timestamp);
    const time = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const flag = e.flagged ? ' ★' : '';
    const resolved = e.resolved ? ' ✓' : '';
    const dir = e.direction === 'inbound' ? '←' : '→';
    lines.push(`${time}  ${dir} ${TYPE_LABELS[e.type].icon} ${TYPE_LABELS[e.type].label}${flag}${resolved}`);
    lines.push(`  To/From: ${e.contact}`);
    if (e.subject) lines.push(`  Subject: ${e.subject}`);
    if (e.notes) lines.push(`  Notes:   ${e.notes}`);
    lines.push('');
  }
  return lines.join('\n');
}
