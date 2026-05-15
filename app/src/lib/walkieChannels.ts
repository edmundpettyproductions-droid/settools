// walkieChannels.ts — Walkie-talkie channel directory
// Quick-reference mapping of department → channel number.

import * as sync from './sync';

// ─── Types ───────────────────────────────────────────────────────────
export interface WalkieChannel {
  id: number;
  channel: string;       // "1", "2", "A1", etc.
  department: string;    // "Production", "Camera", etc.
  notes: string;         // "AD team", "Private", etc.
}

export interface WalkieState {
  channels: WalkieChannel[];
  nid: number;
  lastUpdated: string | null;
}

export const STORAGE_KEY = 'settools_walkie';

// ─── Default channels (common film set layout) ──────────────────────
const DEFAULT_CHANNELS: Omit<WalkieChannel, 'id'>[] = [
  { channel: '1', department: 'Production / Open', notes: 'General production channel' },
  { channel: '2', department: 'ADs / Background', notes: 'AD team + BG wrangling' },
  { channel: '3', department: 'Electric / Grip', notes: '' },
  { channel: '4', department: 'Camera', notes: '' },
  { channel: '5', department: 'Sound', notes: '' },
  { channel: '6', department: 'Art / Props', notes: '' },
  { channel: '7', department: 'Wardrobe / MU / Hair', notes: '' },
  { channel: '8', department: 'Locations / Transpo', notes: '' },
];

// ─── Load / Save ─────────────────────────────────────────────────────
export function load(): WalkieState {
  const raw = sync.getJSON<WalkieState>(STORAGE_KEY);
  if (raw?.channels?.length) return { channels: raw.channels, nid: raw.nid ?? raw.channels.length + 1, lastUpdated: raw.lastUpdated ?? null };
  // First load: populate defaults
  const channels: WalkieChannel[] = DEFAULT_CHANNELS.map((c, i) => ({ id: i + 1, ...c }));
  return { channels, nid: channels.length + 1, lastUpdated: null };
}

export async function save(state: WalkieState): Promise<void> {
  state.lastUpdated = new Date().toISOString();
  await sync.set(STORAGE_KEY, JSON.stringify(state));
}

// ─── CRUD ────────────────────────────────────────────────────────────
export function addChannel(state: WalkieState): WalkieChannel {
  const ch: WalkieChannel = { id: state.nid++, channel: '', department: '', notes: '' };
  state.channels.push(ch);
  return ch;
}

export function removeChannel(state: WalkieState, id: number): void {
  state.channels = state.channels.filter((c) => c.id !== id);
}

export function moveUp(state: WalkieState, idx: number): void {
  if (idx <= 0) return;
  const tmp = state.channels[idx - 1]!;
  state.channels[idx - 1] = state.channels[idx]!;
  state.channels[idx] = tmp;
}

export function moveDown(state: WalkieState, idx: number): void {
  if (idx >= state.channels.length - 1) return;
  const tmp = state.channels[idx + 1]!;
  state.channels[idx + 1] = state.channels[idx]!;
  state.channels[idx] = tmp;
}

/** Reset to defaults */
export function resetDefaults(state: WalkieState): void {
  state.channels = DEFAULT_CHANNELS.map((c, i) => ({ id: state.nid++, ...c }));
}

/** Format for clipboard */
export function formatText(channels: WalkieChannel[]): string {
  const lines = ['WALKIE CHANNEL CHART', '═'.repeat(40), ''];
  for (const c of channels) {
    const ch = `Ch ${c.channel}`.padEnd(8);
    lines.push(`  ${ch}  ${c.department}${c.notes ? `  (${c.notes})` : ''}`);
  }
  return lines.join('\n');
}
