// tracker.ts — Pure data layer for Cast + Crew Timer tabs.
// No Svelte, no DOM. Just types, load/save, formatting, grouping, paste, kiosk sync.

import * as sync from './sync';
import type { UHState } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface TrackerRow {
  id: number;
  empId: string;
  name: string;
  role: string;
  callTime: string;     // HH:MM 24h
  onSetTime: string;    // HH:MM 24h (makeup/wardrobe/on-set time)
  isolate: boolean;     // separate timer card for this person
  arrived: boolean;
  arrivedAt: string;    // HH:MM
  adjMins: number;      // adjustment minutes (positive = later, negative = earlier)
  adjNote: string;
  kioskIn: string | null;
  kioskOut: string | null;
  wrapTime: string | null;
}

export interface TrackerData {
  rows: TrackerRow[];
  nid: number;
}

export type TrackerMode = 'cast' | 'crew';

export interface TrackerConfig {
  mode: TrackerMode;
  storageKey: string;
  rolePlaceholder: string;
  extractSystem: string;
  extractPrompt: string;
}

export interface TimerGroup {
  effectiveTime: string;  // HH:MM after adj applied to first member
  time: Date;             // parsed to today's Date
  warnTime: Date;         // time - warnMs
  members: TrackerRow[];
  isIsolated: boolean;    // true = single-person isolated card
  status: 'upcoming' | 'warning' | 'past';
  countdownMs: number;    // ms until call (negative = past)
  warnCountdownMs: number; // ms until warn threshold
}

export interface ExtractedPerson {
  id?: string;
  name?: string;
  role?: string;
  callTime?: string;
  onSetTime?: string;
}

export interface ExtractResult {
  people: ExtractedPerson[];
  header?: {
    production?: string;
    episode?: string;
    director?: string;
    callTime?: string;
    location?: string;
    shootDay?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Column keys in display order. */
export const COLS: (keyof Pick<TrackerRow, 'empId' | 'name' | 'role' | 'callTime' | 'onSetTime'>)[] =
  ['empId', 'name', 'role', 'callTime', 'onSetTime'];

export const COL_LABELS = ['ID', 'Name', 'Character', 'Call', 'On Set'];
export const COL_CREW_LABELS = ['ID', 'Name', 'Role / Dept', 'Call', 'On Set'];

/** Header detection for smart paste. */
export const COL_ALIASES: Record<string, string[]> = {
  empId: ['id', '#', 'no.', 'no', 'num', 'number', 'badge', 'emp id', 'badge no', 'badge #', 'crew id', 'employee id', 'talent id', 'cast id'],
  name: ['name', 'full name', 'crew name', 'actor', 'talent', 'performer', 'cast', 'crew member', 'talent name'],
  role: ['role', 'position', 'dept', 'department', 'title', 'character', 'job', 'job title', 'description', 'function', 'role/dept'],
  callTime: ['call', 'call time', 'calltime', 'call t', 'c/t', 'ct', 'call out', 'call in', 'call-time', 'in time'],
  onSetTime: ['on set', 'onset', 'on set time', 'on-set', 'set time', 'set', 'm/u', 'mu', 'makeup', 'h/mu', 'hmua', 'hair', 'wardrobe', 'hw', 'report', 'report time'],
};

const CAST_EXTRACT_SYSTEM = 'You extract cast and background data from film/TV call sheets. Extract ONLY cast members, actors, and background performers. Do NOT include crew. Return ONLY raw JSON, no markdown.';
const CREW_EXTRACT_SYSTEM = 'You extract crew data from film/TV call sheets. Extract ONLY crew members and department staff. Do NOT include cast or actors. Return ONLY raw JSON, no markdown.';

const EXTRACT_PROMPT_TEMPLATE = `Extract from this call sheet and return exactly this JSON structure (no markdown):
{"people":[{"id":"","name":"","role":"","callTime":"","onSetTime":""}],"header":{"production":"","episode":"","director":"","date":"","callTime":"","location":"","shootDay":""}}
people: id=badge/ID or empty, name=full name, role=ROLE_DESC, callTime=HH:MM 24h, onSetTime=HH:MM 24h.
header: production=show name, episode=ep number, director=director name, callTime=general call HH:MM 24h, location=filming location, shootDay=shoot day number. Empty string for missing.`;

export const CAST_CONFIG: TrackerConfig = {
  mode: 'cast',
  storageKey: 'settools_cast',
  rolePlaceholder: 'Character',
  extractSystem: CAST_EXTRACT_SYSTEM,
  extractPrompt: EXTRACT_PROMPT_TEMPLATE.replace('ROLE_DESC', 'character name'),
};

export const CREW_CONFIG: TrackerConfig = {
  mode: 'crew',
  storageKey: 'settools_crew',
  rolePlaceholder: 'Role / Dept',
  extractSystem: CREW_EXTRACT_SYSTEM,
  extractPrompt: EXTRACT_PROMPT_TEMPLATE.replace('ROLE_DESC', 'job title/dept'),
};

export function configFor(mode: TrackerMode): TrackerConfig {
  return mode === 'cast' ? CAST_CONFIG : CREW_CONFIG;
}

// ═══════════════════════════════════════════════════════════════════════════
// Row factory
// ═══════════════════════════════════════════════════════════════════════════

export function mkRow(id: number, data?: Partial<TrackerRow>): TrackerRow {
  return {
    id,
    empId: data?.empId ?? '',
    name: data?.name ?? '',
    role: data?.role ?? '',
    callTime: data?.callTime ?? '',
    onSetTime: data?.onSetTime ?? '',
    isolate: data?.isolate ?? false,
    arrived: data?.arrived ?? false,
    arrivedAt: data?.arrivedAt ?? '',
    adjMins: data?.adjMins ?? 0,
    adjNote: data?.adjNote ?? '',
    kioskIn: data?.kioskIn ?? null,
    kioskOut: data?.kioskOut ?? null,
    wrapTime: data?.wrapTime ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════

export function loadTracker(key: string): TrackerData {
  const raw = sync.getJSON<{ rows?: unknown[]; nid?: number }>(key);
  if (!raw?.rows?.length) return { rows: [], nid: 1 };
  let nid = raw.nid ?? 1;
  const rows: TrackerRow[] = [];
  for (const r of raw.rows) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    rows.push(mkRow(typeof o.id === 'number' ? o.id : nid++, {
      empId: String(o.empId ?? ''),
      name: String(o.name ?? ''),
      role: String(o.role ?? ''),
      callTime: String(o.callTime ?? ''),
      onSetTime: String(o.onSetTime ?? ''),
      isolate: !!o.isolate,
      arrived: !!o.arrived,
      arrivedAt: String(o.arrivedAt ?? ''),
      adjMins: typeof o.adjMins === 'number' ? o.adjMins : 0,
      adjNote: String(o.adjNote ?? ''),
      kioskIn: typeof o.kioskIn === 'string' ? o.kioskIn : null,
      kioskOut: typeof o.kioskOut === 'string' ? o.kioskOut : null,
      wrapTime: typeof o.wrapTime === 'string' ? o.wrapTime : null,
    }));
  }
  return { rows, nid: Math.max(nid, rows.length + 1) };
}

export async function saveTracker(key: string, data: TrackerData): Promise<void> {
  await sync.set(key, JSON.stringify({ rows: data.rows, nid: data.nid }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Time formatting & parsing
// ═══════════════════════════════════════════════════════════════════════════

function pad(n: number): string { return n.toString().padStart(2, '0'); }

/** Normalize loose time input: "7" → "07:00", "730" → "07:30", "7pm" → "19:00", etc. */
export function normTime(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const fmt = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

  // AM/PM
  const ampm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(s);
  if (ampm?.[1] != null && ampm[3] != null) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] != null ? parseInt(ampm[2], 10) : 0;
    if (ampm[3].toLowerCase() === 'pm' && h < 12) h += 12;
    if (ampm[3].toLowerCase() === 'am' && h === 12) h = 0;
    if (h <= 23 && m <= 59) return fmt(h, m);
  }
  // HH:MM
  const colon = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (colon?.[1] != null && colon[2] != null) {
    const h = parseInt(colon[1], 10), m = parseInt(colon[2], 10);
    if (h <= 23 && m <= 59) return fmt(h, m);
  }
  // H:M (single minute)
  const shortColon = /^(\d{1,2}):(\d)$/.exec(s);
  if (shortColon?.[1] != null && shortColon[2] != null) {
    const h = parseInt(shortColon[1], 10), m = parseInt(shortColon[2], 10) * 10;
    if (h <= 23 && m <= 59) return fmt(h, m);
  }
  // 3-4 digit: "730"→"07:30", "1430"→"14:30"
  if (/^\d{3,4}$/.test(s)) {
    const n = parseInt(s, 10), h = Math.floor(n / 100), m = n % 100;
    if (h <= 23 && m <= 59) return fmt(h, m);
  }
  // 1-2 digit hour: "7"→"07:00"
  if (/^\d{1,2}$/.test(s)) {
    const h = parseInt(s, 10);
    if (h <= 23) return fmt(h, 0);
  }
  return raw; // unrecognized — keep as typed
}

/** Parse "HH:MM" into today's Date. Returns null on failure. */
export function parseTimeToday(s: string): Date | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m?.[1] || !m[2]) return null;
  const h = parseInt(m[1], 10), mn = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(mn)) return null;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mn, 0, 0);
}

/** Format hours and minutes as 12h time: "7:00 AM". */
export function fmt12h(h: number, m: number): string {
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${pad(m)} ${ap}`;
}

/** Format a time string "HH:MM" as 12-hour display. */
export function fmt12(t: string): string {
  if (!t) return '--';
  const p = t.split(':');
  if (p.length < 2) return t;
  const h = parseInt(p[0] ?? '0', 10);
  const m = parseInt(p[1] ?? '0', 10);
  if (isNaN(h) || isNaN(m)) return t;
  return fmt12h(h, m);
}

/** Format milliseconds as countdown: "mm:ss" or "h:mm:ss". Negative = past. */
export function fmtMs(ms: number): string {
  const abs = Math.abs(ms);
  const s = Math.floor(abs / 1000);
  const h = Math.floor(s / 3600);
  const mn = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  const sign = ms < 0 ? '-' : '';
  return h > 0 ? `${sign}${h}:${pad(mn)}:${pad(sc)}` : `${sign}${pad(mn)}:${pad(sc)}`;
}

/** Human-readable countdown: "in 2h 15m" or "45m ago". */
export function fmtCountdown(ms: number): string {
  if (isNaN(ms)) return '--';
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  if (neg) return h > 0 ? `${h}h ${m}m ago` : `${m}m ago`;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

/** Compute effective call time after adjMins. */
export function effectiveCallTime(row: TrackerRow): string {
  if (!row.callTime || !row.adjMins) return row.callTime;
  const t = parseTimeToday(row.callTime);
  if (!t) return row.callTime;
  const adj = new Date(t.getTime() + row.adjMins * 60000);
  return `${pad(adj.getHours())}:${pad(adj.getMinutes())}`;
}

/** Current 24h time as HH:MM. */
export function nowHHMM(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Timer group computation
// ═══════════════════════════════════════════════════════════════════════════

export function buildGroups(rows: TrackerRow[], warnMs: number, now: Date): TimerGroup[] {
  const groups: Record<string, TrackerRow[]> = {};
  const isoRows: TrackerRow[] = [];

  for (const r of rows) {
    if (!r.callTime || !r.name) continue;
    const ect = effectiveCallTime(r);
    if (r.isolate) {
      isoRows.push(r);
    } else {
      if (!groups[ect]) groups[ect] = [];
      groups[ect]!.push(r);
    }
  }

  const entries: TimerGroup[] = [];

  // Regular groups
  for (const [ect, members] of Object.entries(groups)) {
    const time = parseTimeToday(ect);
    if (!time) continue;
    const warnTime = new Date(time.getTime() - warnMs);
    const callMs = time.getTime() - now.getTime();
    const warnCountdownMs = warnTime.getTime() - now.getTime();
    const status: TimerGroup['status'] = callMs < 0 ? 'past' : warnCountdownMs <= 0 ? 'warning' : 'upcoming';
    entries.push({ effectiveTime: ect, time, warnTime, members, isIsolated: false, status, countdownMs: callMs, warnCountdownMs });
  }

  // Isolated (each person = own card)
  for (const r of isoRows) {
    const time = parseTimeToday(r.callTime);
    if (!time) continue;
    const warnTime = new Date(time.getTime() - warnMs);
    const callMs = time.getTime() - now.getTime();
    const warnCountdownMs = warnTime.getTime() - now.getTime();
    const status: TimerGroup['status'] = callMs < 0 ? 'past' : warnCountdownMs <= 0 ? 'warning' : 'upcoming';
    entries.push({ effectiveTime: r.callTime, time, warnTime, members: [r], isIsolated: true, status, countdownMs: callMs, warnCountdownMs });
  }

  entries.sort((a, b) => a.time.getTime() - b.time.getTime());
  return entries;
}

// ═══════════════════════════════════════════════════════════════════════════
// Paste parsing (smart column detection from spreadsheet paste)
// ═══════════════════════════════════════════════════════════════════════════

function splitLine(line: string, sep: string): string[] {
  if (sep !== ',') return line.split('\t').map(c => c.trim());
  // CSV with quoted strings
  const result: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

export function applyPaste(
  raw: string,
  startRow: number,
  startCol: number,
  currentRows: TrackerRow[],
  nid: number,
): { rows: TrackerRow[]; nid: number; selEnd: { r: number; c: number } } {
  const rows = [...currentRows];
  let nextId = nid;
  if (!raw) return { rows, nid: nextId, selEnd: { r: startRow, c: startCol } };

  const lines = raw.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1]?.trim() === '') lines.pop();
  if (!lines.length) return { rows, nid: nextId, selEnd: { r: startRow, c: startCol } };

  const sep = lines[0]?.indexOf('\t') === -1 && (lines[0]?.indexOf(',') ?? -1) !== -1 ? ',' : '\t';

  // Try smart column detection from headers
  const firstCols = splitLine(lines[0] ?? '', sep);
  let colMap: Record<number, number> | null = null;
  let matched = 0;
  const tempMap: Record<number, number> = {};
  firstCols.forEach((hdr, pi) => {
    const h = hdr.toLowerCase().replace(/[^a-z0-9 /#]/g, '').trim();
    for (const [col, aliases] of Object.entries(COL_ALIASES)) {
      if (aliases.includes(h)) {
        tempMap[pi] = COLS.indexOf(col as typeof COLS[number]);
        matched++;
      }
    }
  });
  if (matched >= 2) colMap = tempMap;

  const data = colMap !== null ? lines.slice(1) : lines;
  if (!data.length) return { rows, nid: nextId, selEnd: { r: startRow, c: startCol } };

  // Ensure enough rows
  while (rows.length < startRow + data.length) rows.push(mkRow(nextId++));

  data.forEach((line, li) => {
    if (!line?.trim()) return;
    const cols = splitLine(line, sep);
    if (colMap !== null) {
      // Smart mapping
      for (const [piStr, ci] of Object.entries(colMap)) {
        const pi = Number(piStr);
        if (ci === undefined || ci === -1) continue;
        const col = COLS[ci];
        if (!col) continue;
        let v = (cols[pi] ?? '').trim();
        if (col === 'callTime' || col === 'onSetTime') v = normTime(v);
        const row = rows[startRow + li];
        if (row) row[col] = v;
      }
    } else {
      // Positional mapping
      cols.forEach((val, ci) => {
        const fi = startCol + ci;
        if (fi >= COLS.length) return;
        const col = COLS[fi];
        if (!col) return;
        let v = val.trim();
        if (col === 'callTime' || col === 'onSetTime') v = normTime(v);
        const row = rows[startRow + li];
        if (row) row[col] = v;
      });
    }
  });

  const endR = Math.min(startRow + data.length - 1, rows.length - 1);
  const endC = colMap ? COLS.length - 1 : Math.min(startCol + firstCols.length - 1, COLS.length - 1);

  return { rows, nid: nextId, selEnd: { r: endR, c: endC } };
}

// ═══════════════════════════════════════════════════════════════════════════
// Kiosk sync — pull sign-in records from ST_signin into tracker rows
// ═══════════════════════════════════════════════════════════════════════════

interface KioskRecord {
  name: string;
  signedAt?: string;
  signInTime?: string;
  signedOutAt?: string;
  signOutTime?: string;
}

export function syncFromKiosk(rows: TrackerRow[]): { matched: number; error: string | null } {
  const raw = sync.get('ST_signin');
  if (!raw) return { matched: 0, error: 'No Sign-In Station data found. Make sure the kiosk is running and synced.' };

  let data: { records?: KioskRecord[] } | KioskRecord[];
  try { data = JSON.parse(raw) as typeof data; } catch {
    return { matched: 0, error: 'Invalid kiosk data format.' };
  }

  const records: KioskRecord[] = Array.isArray(data) ? data : (data as { records?: KioskRecord[] }).records ?? [];
  if (!records.length) return { matched: 0, error: 'No sign-in records found.' };

  let matched = 0;
  for (const rec of records) {
    if (!rec.name) continue;
    const signIn = rec.signedAt ?? rec.signInTime;
    if (!signIn) continue;
    const rname = rec.name.toLowerCase().trim();

    for (const row of rows) {
      const rowname = (row.name || '').toLowerCase().trim();
      if (!rowname) continue;
      if (rowname === rname || rowname.includes(rname) || rname.includes(rowname)) {
        if (!row.arrived) {
          row.arrived = true;
          row.arrivedAt = normTime(signIn) || signIn;
          row.kioskIn = signIn;
          const signOut = rec.signedOutAt ?? rec.signOutTime;
          if (signOut) row.kioskOut = signOut;
          matched++;
        }
      }
    }
  }

  return { matched, error: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// UH merge — when call sheet extraction includes header data, merge into UH
// ═══════════════════════════════════════════════════════════════════════════

export async function mergeExtractedHeader(header: ExtractResult['header']): Promise<void> {
  if (!header) return;
  const uh = sync.getJSON<UHState>('settools_uh') ?? {};
  let changed = false;
  const trySet = (uhKey: keyof UHState, val: string | undefined) => {
    if (val && !uh[uhKey]) { (uh as Record<string, string>)[uhKey] = uhKey === 'callTime' ? normTime(val) : val; changed = true; }
  };
  trySet('production', header.production);
  trySet('episode', header.episode);
  trySet('director', header.director);
  trySet('location', header.location);
  trySet('callTime', header.callTime);
  trySet('shootDay', header.shootDay);
  if (changed) await sync.set('settools_uh', JSON.stringify(uh));
}
