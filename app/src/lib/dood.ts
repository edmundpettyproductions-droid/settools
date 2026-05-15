// dood.ts — Day Out Of Days data layer
// Stores a cast × shoot-day grid with standard DOOD status codes.

import * as sync from './sync';

// ─── Types ───────────────────────────────────────────────────────────
export type StatusCode =
  | ''     // off / not scheduled
  | 'W'   // work
  | 'SW'  // start / work (first day on show or after gap)
  | 'WF'  // work / finish (last day of run)
  | 'SWF' // start-work-finish (single day only)
  | 'H'   // hold (on standby, not called)
  | 'T'   // travel
  | 'R'   // rehearsal
  | 'WD'  // work-drop (work then released, next day off)
  | 'PU'  // pickup (returning after a gap);

export const ALL_CODES: StatusCode[] = ['W', 'SW', 'WF', 'SWF', 'H', 'T', 'R', 'WD', 'PU', ''];

export const CODE_LABELS: Record<StatusCode, string> = {
  '': 'Off',
  W: 'Work',
  SW: 'Start/Work',
  WF: 'Work/Finish',
  SWF: 'Start-Work-Finish',
  H: 'Hold',
  T: 'Travel',
  R: 'Rehearsal',
  WD: 'Work/Drop',
  PU: 'Pickup',
};

export const CODE_COLORS: Record<StatusCode, string> = {
  '': 'transparent',
  W: 'var(--success)',
  SW: '#60a5fa',      // blue
  WF: '#f472b6',      // pink
  SWF: '#c084fc',     // purple
  H: 'var(--warn)',
  T: '#94a3b8',       // gray
  R: '#a78bfa',       // light purple
  WD: '#fb923c',      // orange
  PU: '#2dd4bf',      // teal
};

export interface DOODDay {
  dayNum: number;       // shoot day number (1, 2, 3, ...)
  date: string;         // YYYY-MM-DD or display date
  label: string;        // short label for column header
}

export interface DOODCast {
  id: string;           // unique identifier
  name: string;
  role: string;
}

export interface DOODData {
  title: string;
  cast: DOODCast[];
  days: DOODDay[];
  // grid[castId][dayNum] = StatusCode
  grid: Record<string, Record<number, StatusCode>>;
  todayDayNum: number | null;  // which shoot day is today
}

export const STORAGE_KEY = 'settools_dood';

// ─── Load / Save ─────────────────────────────────────────────────────
export function loadDOOD(): DOODData {
  const raw = sync.getJSON<DOODData>(STORAGE_KEY);
  if (raw?.cast && raw?.days) return raw;
  return { title: '', cast: [], days: [], grid: {}, todayDayNum: null };
}

export async function saveDOOD(data: DOODData): Promise<void> {
  await sync.set(STORAGE_KEY, JSON.stringify(data));
}

// ─── Grid helpers ────────────────────────────────────────────────────
export function getStatus(data: DOODData, castId: string, dayNum: number): StatusCode {
  return data.grid[castId]?.[dayNum] ?? '';
}

export function setStatus(data: DOODData, castId: string, dayNum: number, code: StatusCode): void {
  if (!data.grid[castId]) data.grid[castId] = {};
  if (code === '') {
    delete data.grid[castId]![dayNum];
  } else {
    data.grid[castId]![dayNum] = code;
  }
}

/** Count work days for a cast member */
export function workDays(data: DOODData, castId: string): number {
  const row = data.grid[castId];
  if (!row) return 0;
  return Object.values(row).filter((c) =>
    c === 'W' || c === 'SW' || c === 'WF' || c === 'SWF' || c === 'WD' || c === 'PU',
  ).length;
}

/** Count hold days for a cast member */
export function holdDays(data: DOODData, castId: string): number {
  const row = data.grid[castId];
  if (!row) return 0;
  return Object.values(row).filter((c) => c === 'H').length;
}

/** Total scheduled days (work + hold + travel + rehearsal) */
export function totalDays(data: DOODData, castId: string): number {
  const row = data.grid[castId];
  if (!row) return 0;
  return Object.values(row).filter((c) => c !== '').length;
}

// ─── Quick-build from manual entry ───────────────────────────────────
export function buildEmptyDOOD(
  title: string,
  castNames: string[],
  numDays: number,
  startDayNum: number = 1,
): DOODData {
  const cast: DOODCast[] = castNames.map((name, i) => ({
    id: `c${i + 1}`,
    name,
    role: '',
  }));
  const days: DOODDay[] = [];
  for (let i = 0; i < numDays; i++) {
    const d = startDayNum + i;
    days.push({ dayNum: d, date: '', label: `D${d}` });
  }
  return { title, cast, days, grid: {}, todayDayNum: null };
}

// ─── Extract parsing ─────────────────────────────────────────────────
export interface ExtractedDOOD {
  title?: string;
  cast?: Array<{ name: string; role?: string }>;
  days?: Array<{ dayNum: number; date?: string }>;
  grid?: Array<{ name: string; statuses: Array<{ day: number; code: string }> }>;
}

export function parseExtracted(raw: ExtractedDOOD): DOODData {
  const cast: DOODCast[] = (raw.cast ?? []).map((c, i) => ({
    id: `c${i + 1}`,
    name: c.name,
    role: c.role ?? '',
  }));

  const days: DOODDay[] = (raw.days ?? []).map((d) => ({
    dayNum: d.dayNum,
    date: d.date ?? '',
    label: `D${d.dayNum}`,
  }));

  const grid: Record<string, Record<number, StatusCode>> = {};
  if (raw.grid) {
    for (const row of raw.grid) {
      // Match to cast by name
      const match = cast.find((c) => c.name.toLowerCase() === row.name.toLowerCase());
      if (!match) continue;
      grid[match.id] = {};
      for (const s of row.statuses) {
        const code = normalizeCode(s.code);
        if (code) grid[match.id]![s.day] = code;
      }
    }
  }

  return {
    title: raw.title ?? 'DOOD',
    cast,
    days,
    grid,
    todayDayNum: null,
  };
}

function normalizeCode(raw: string): StatusCode | null {
  const s = raw.toUpperCase().trim();
  if (ALL_CODES.includes(s as StatusCode)) return s as StatusCode;
  // Common aliases
  if (s === 'WORK') return 'W';
  if (s === 'HOLD') return 'H';
  if (s === 'TRAVEL') return 'T';
  if (s === 'REHEARS' || s === 'REHEARSE') return 'R';
  if (s === 'START' || s === 'START WORK') return 'SW';
  if (s === 'FINISH' || s === 'WORK FINISH') return 'WF';
  if (s === 'DROP' || s === 'WORK DROP') return 'WD';
  if (s === 'PICK UP' || s === 'PICKUP DAY') return 'PU';
  if (s === 'OFF' || s === '-' || s === '.') return '';
  return null;
}
