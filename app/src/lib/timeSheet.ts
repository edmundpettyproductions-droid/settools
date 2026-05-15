// timeSheet.ts — Cast Time Sheet / Exhibit G generator
// Pulls from cast tracker + production timers to build formal time reports.
// Union-aware: Exhibit G format for union, simpler layout for non-union.

import * as sync from './sync';
import * as T from './tracker';
import * as PT from './prodTimers';
import * as PS from './projectSettings';
import type { UHState } from './types';

// ─── Types ───────────────────────────────────────────────────────────
export interface TimeSheetEntry {
  name: string;
  role: string;
  empId: string;
  callTime: string;        // scheduled call
  actualIn: string;        // actual arrival
  mealOut: string;         // sent to meal
  mealIn: string;          // back from meal
  wrapTime: string;        // wrapped
  hoursWorked: number;     // decimal hours
  otHours: number;         // hours past 8h (or configured threshold)
  forcedCall: boolean;     // violated turnaround
  ndb: boolean;            // non-deductible breakfast
  ndd: boolean;            // non-deductible dinner (union)
  adjustments: string;     // notes about adjustments
}

export interface TimeSheetData {
  // Header
  production: string;
  episode: string;
  date: string;
  shootDay: string;
  director: string;

  // Times
  generalCall: string;
  firstShot: string;
  mealBreak: string;       // meal penalty reference
  cameraWrap: string;      // last shot
  lastOut: string;         // last person wrapped

  // Entries
  entries: TimeSheetEntry[];

  // Meta
  label: string;           // "Exhibit G" or "Time Sheet"
  isUnion: boolean;
  generated: string;       // ISO datetime
}

export interface TimeSheetState {
  sheets: TimeSheetData[];
  lastUpdated: string | null;
}

export const STORAGE_KEY = 'settools_time_sheets';

// ─── Load / Save ─────────────────────────────────────────────────────
export function loadSheets(): TimeSheetState {
  const raw = sync.getJSON<TimeSheetState>(STORAGE_KEY);
  if (raw?.sheets) return raw;
  return { sheets: [], lastUpdated: null };
}

export async function saveSheets(state: TimeSheetState): Promise<void> {
  state.lastUpdated = new Date().toISOString();
  await sync.set(STORAGE_KEY, JSON.stringify(state));
}

// ─── Time helpers ────────────────────────────────────────────────────
function parseHHMM(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m?.[1] || !m[2]) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function fmt12(hhmm: string | null | undefined): string {
  if (!hhmm) return '—';
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m?.[1] || !m[2]) return hhmm;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? 'p' : 'a';
  return `${h % 12 || 12}:${min}${ap}`;
}

function decimalHours(mins: number): number {
  return Math.round((mins / 60) * 100) / 100;
}

// ─── Generate ────────────────────────────────────────────────────────
export function generate(): TimeSheetData {
  const settings = PS.load();
  const uh = sync.getJSON<UHState>('settools_uh') ?? {};
  const prodState = PT.loadState();
  const castData = T.loadTracker('settools_cast');

  const otThreshold = settings.otThresholds[0] ?? 8; // first threshold in hours
  const turnaroundMins = settings.turnaroundHours * 60;

  // Build entries from cast tracker
  const entries: TimeSheetEntry[] = [];
  let lastWrapMins = 0;

  for (const r of castData.rows) {
    if (!r.name.trim()) continue;

    const inMins = parseHHMM(r.arrivedAt);
    const wrapMins = parseHHMM(r.wrapTime);
    const callMins = parseHHMM(r.callTime);

    let hoursWorked = 0;
    let otHours = 0;
    if (inMins != null && wrapMins != null && wrapMins > inMins) {
      hoursWorked = decimalHours(wrapMins - inMins);
      const otThresholdMins = otThreshold * 60;
      const workedMins = wrapMins - inMins;
      if (workedMins > otThresholdMins) {
        otHours = decimalHours(workedMins - otThresholdMins);
      }
    }

    // Track latest wrap
    if (wrapMins != null && wrapMins > lastWrapMins) lastWrapMins = wrapMins;

    // Forced call detection: would need previous day's wrap time
    // For now, check if call time is unreasonably early (placeholder logic)
    const forcedCall = false; // TODO: cross-day turnaround check

    entries.push({
      name: r.name,
      role: r.role,
      empId: r.empId,
      callTime: fmt12(r.callTime),
      actualIn: fmt12(r.arrivedAt),
      mealOut: '',   // not tracked per-person in current timer system
      mealIn: '',
      wrapTime: fmt12(r.wrapTime),
      hoursWorked,
      otHours,
      forcedCall,
      ndb: false,
      ndd: false,
      adjustments: r.adjNote || '',
    });
  }

  // Sort by call time then name
  entries.sort((a, b) => {
    const cmp = a.callTime.localeCompare(b.callTime);
    return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
  });

  return {
    production: uh.production ?? '',
    episode: uh.episode ?? '',
    date: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
    shootDay: uh.shootDay ?? '',
    director: uh.director ?? '',

    generalCall: fmt12(uh.callTime),
    firstShot: fmt12(prodState.firstShot ?? uh.firstShot),
    mealBreak: prodState.lastMeal ? fmt12(prodState.lastMeal) : '—',
    cameraWrap: lastWrapMins > 0 ? fmt12(`${Math.floor(lastWrapMins / 60).toString().padStart(2, '0')}:${(lastWrapMins % 60).toString().padStart(2, '0')}`) : '—',
    lastOut: lastWrapMins > 0 ? fmt12(`${Math.floor(lastWrapMins / 60).toString().padStart(2, '0')}:${(lastWrapMins % 60).toString().padStart(2, '0')}`) : '—',

    entries,
    label: settings.timeSheetLabel,
    isUnion: settings.union === 'union',
    generated: new Date().toISOString(),
  };
}

// ─── Format as text ──────────────────────────────────────────────────
export function formatText(d: TimeSheetData): string {
  const lines: string[] = [];
  const hr = '═'.repeat(70);
  const hr2 = '─'.repeat(70);

  lines.push(hr);
  lines.push(`  ${d.label.toUpperCase()}`);
  lines.push(hr);
  lines.push('');

  if (d.production) lines.push(`Production:    ${d.production}${d.episode ? ` — Ep ${d.episode}` : ''}`);
  if (d.shootDay) lines.push(`Shoot Day:     ${d.shootDay}`);
  lines.push(`Date:          ${d.date}`);
  if (d.director) lines.push(`Director:      ${d.director}`);
  lines.push('');
  lines.push(`General Call:  ${d.generalCall}`);
  lines.push(`First Shot:    ${d.firstShot}`);
  lines.push(`Meal Break:    ${d.mealBreak}`);
  lines.push(`Camera Wrap:   ${d.cameraWrap}`);
  lines.push(`Last Out:      ${d.lastOut}`);
  lines.push('');

  lines.push(hr2);

  // Header
  const cols = d.isUnion
    ? ['Name', 'Character', 'ID', 'Call', 'In', 'M-Out', 'M-In', 'Wrap', 'Hrs', 'OT', 'FC', 'NDB']
    : ['Name', 'Character', 'Call', 'In', 'Wrap', 'Hours', 'OT', 'Notes'];

  if (d.isUnion) {
    lines.push(`  ${'Name'.padEnd(18)}${'Character'.padEnd(14)}${'ID'.padEnd(8)}${'Call'.padEnd(8)}${'In'.padEnd(8)}${'M-Out'.padEnd(8)}${'M-In'.padEnd(8)}${'Wrap'.padEnd(8)}${'Hrs'.padEnd(6)}${'OT'.padEnd(6)}FC  NDB`);
  } else {
    lines.push(`  ${'Name'.padEnd(18)}${'Character'.padEnd(14)}${'Call'.padEnd(8)}${'In'.padEnd(8)}${'Wrap'.padEnd(8)}${'Hours'.padEnd(8)}${'OT'.padEnd(8)}Notes`);
  }
  lines.push(hr2);

  for (const e of d.entries) {
    if (d.isUnion) {
      const fc = e.forcedCall ? 'FC' : '  ';
      const ndb = e.ndb ? 'NDB' : '   ';
      lines.push(`  ${e.name.padEnd(18)}${e.role.padEnd(14)}${e.empId.padEnd(8)}${e.callTime.padEnd(8)}${e.actualIn.padEnd(8)}${e.mealOut.padEnd(8)}${e.mealIn.padEnd(8)}${e.wrapTime.padEnd(8)}${e.hoursWorked.toFixed(1).padEnd(6)}${e.otHours.toFixed(1).padEnd(6)}${fc}  ${ndb}`);
    } else {
      lines.push(`  ${e.name.padEnd(18)}${e.role.padEnd(14)}${e.callTime.padEnd(8)}${e.actualIn.padEnd(8)}${e.wrapTime.padEnd(8)}${e.hoursWorked.toFixed(1).padEnd(8)}${e.otHours.toFixed(1).padEnd(8)}${e.adjustments}`);
    }
  }

  lines.push('');
  const totalHours = d.entries.reduce((s, e) => s + e.hoursWorked, 0);
  const totalOT = d.entries.reduce((s, e) => s + e.otHours, 0);
  lines.push(`  Total Cast: ${d.entries.length}    Total Hours: ${totalHours.toFixed(1)}    Total OT: ${totalOT.toFixed(1)}`);

  lines.push('');
  lines.push(hr);
  lines.push(`  Generated ${new Date(d.generated).toLocaleTimeString()} — Set Tools DA Workstation`);
  lines.push(hr);

  return lines.join('\n');
}
