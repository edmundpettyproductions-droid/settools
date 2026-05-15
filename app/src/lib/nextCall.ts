// nextCall.ts — Next Day Call sheet builder data layer
// Build tomorrow's schedule, cast calls, and generate a preview.

import * as sync from './sync';
import * as T from './tracker';
import type { UHState } from './types';

// ─── Types ───────────────────────────────────────────────────────────
export interface NextCallScene {
  id: number;
  sceneNum: string;
  description: string;
  setLocation: string;
  pages: string;
  cast: string;
  estTime: string;  // estimated start time HH:MM
}

export interface NextCallPerson {
  name: string;
  role: string;
  callTime: string;
  muTime: string;     // makeup/wardrobe report
  onSetTime: string;
  notes: string;
  source: 'cast' | 'crew';
}

export interface NextCallData {
  date: string;             // tomorrow's date display
  generalCall: string;      // general crew call HH:MM
  firstShot: string;        // estimated first shot HH:MM
  location: string;
  scenes: NextCallScene[];
  castCalls: NextCallPerson[];
  crewCalls: NextCallPerson[];
  specialInstructions: string;
  advance: string;          // advance schedule notes
  notes: string;
  nid: number;
}

export const STORAGE_KEY = 'settools_nextcall';

// ─── Load / Save ─────────────────────────────────────────────────────
export function loadNextCall(): NextCallData {
  const raw = sync.getJSON<NextCallData>(STORAGE_KEY);
  if (raw?.scenes) return raw;
  return defaultNextCall();
}

function defaultNextCall(): NextCallData {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}/${tomorrow.getFullYear()}`;

  // Pull from UH
  const uh = sync.getJSON<UHState>('settools_uh');

  return {
    date: dateStr,
    generalCall: uh?.callTime ?? '',
    firstShot: uh?.firstShot ?? '',
    location: uh?.location ?? '',
    scenes: [],
    castCalls: [],
    crewCalls: [],
    specialInstructions: '',
    advance: '',
    notes: '',
    nid: 1,
  };
}

export async function saveNextCall(data: NextCallData): Promise<void> {
  await sync.set(STORAGE_KEY, JSON.stringify(data));
}

// ─── Scene helpers ───────────────────────────────────────────────────
export function mkScene(id: number, partial?: Partial<NextCallScene>): NextCallScene {
  return {
    id,
    sceneNum: '',
    description: '',
    setLocation: '',
    pages: '',
    cast: '',
    estTime: '',
    ...partial,
  };
}

// ─── Import from trackers ────────────────────────────────────────────
/** Import current cast/crew tracker data as next-day calls */
export function importFromTrackers(): { cast: NextCallPerson[]; crew: NextCallPerson[] } {
  const castData = T.loadTracker('settools_cast');
  const crewData = T.loadTracker('settools_crew');

  const cast: NextCallPerson[] = castData.rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name,
      role: r.role,
      callTime: r.callTime,
      muTime: r.onSetTime,
      onSetTime: '',
      notes: '',
      source: 'cast' as const,
    }));

  const crew: NextCallPerson[] = crewData.rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name,
      role: r.role,
      callTime: r.callTime,
      muTime: '',
      onSetTime: r.onSetTime,
      notes: '',
      source: 'crew' as const,
    }));

  return { cast, crew };
}

// ─── Preview generation ──────────────────────────────────────────────
export function fmt12(hhmm: string): string {
  if (!hhmm) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m?.[1] || !m[2]) return hhmm;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${min} ${ap}`;
}

export function generatePreview(data: NextCallData): string {
  const lines: string[] = [];
  const uh = sync.getJSON<UHState>('settools_uh');

  lines.push(`${'='.repeat(50)}`);
  lines.push(`  ${uh?.production ?? 'PRODUCTION'} — CALL SHEET`);
  lines.push(`${'='.repeat(50)}`);
  lines.push('');
  lines.push(`Date: ${data.date}`);
  if (uh?.episode) lines.push(`Episode: ${uh.episode}`);
  if (uh?.director) lines.push(`Director: ${uh.director}`);
  lines.push(`General Call: ${fmt12(data.generalCall) || 'TBD'}`);
  lines.push(`First Shot: ${fmt12(data.firstShot) || 'TBD'}`);
  lines.push(`Location: ${data.location || 'TBD'}`);
  lines.push('');

  if (data.scenes.length) {
    lines.push(`${'─'.repeat(50)}`);
    lines.push('  SHOOTING SCHEDULE');
    lines.push(`${'─'.repeat(50)}`);
    for (const s of data.scenes) {
      const time = s.estTime ? `  [${fmt12(s.estTime)}]` : '';
      lines.push(`  Sc ${s.sceneNum || '?'}  ${s.setLocation}${time}`);
      if (s.description) lines.push(`    ${s.description}`);
      if (s.cast) lines.push(`    Cast: ${s.cast}`);
      if (s.pages) lines.push(`    Pages: ${s.pages}`);
    }
    lines.push('');
  }

  if (data.castCalls.length) {
    lines.push(`${'─'.repeat(50)}`);
    lines.push('  CAST CALLS');
    lines.push(`${'─'.repeat(50)}`);
    for (const p of data.castCalls) {
      const call = fmt12(p.callTime) || 'TBD';
      const mu = p.muTime ? ` / MU: ${fmt12(p.muTime)}` : '';
      lines.push(`  ${p.name.padEnd(20)} Call: ${call}${mu}`);
      if (p.role) lines.push(`    (${p.role})`);
      if (p.notes) lines.push(`    Note: ${p.notes}`);
    }
    lines.push('');
  }

  if (data.crewCalls.length) {
    lines.push(`${'─'.repeat(50)}`);
    lines.push('  CREW CALLS');
    lines.push(`${'─'.repeat(50)}`);
    const grouped = new Map<string, NextCallPerson[]>();
    for (const p of data.crewCalls) {
      const ct = p.callTime || 'TBD';
      if (!grouped.has(ct)) grouped.set(ct, []);
      grouped.get(ct)!.push(p);
    }
    for (const [ct, people] of grouped) {
      lines.push(`  ${fmt12(ct) || ct}:`);
      for (const p of people) {
        lines.push(`    ${p.name} — ${p.role}`);
      }
    }
    lines.push('');
  }

  if (data.specialInstructions) {
    lines.push(`${'─'.repeat(50)}`);
    lines.push('  SPECIAL INSTRUCTIONS');
    lines.push(`${'─'.repeat(50)}`);
    lines.push(`  ${data.specialInstructions}`);
    lines.push('');
  }

  if (data.advance) {
    lines.push(`${'─'.repeat(50)}`);
    lines.push('  ADVANCE SCHEDULE');
    lines.push(`${'─'.repeat(50)}`);
    lines.push(`  ${data.advance}`);
    lines.push('');
  }

  return lines.join('\n');
}
