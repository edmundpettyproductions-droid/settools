// Scene Tracker — data layer
// Tracks daily shooting progress: scene status, timing, setups, page counts.

import * as sync from './sync';

// ─── Types ───────────────────────────────────────────────────────────
export type SceneStatus = 'scheduled' | 'rehearsing' | 'shooting' | 'complete' | 'omitted';

export interface SceneRow {
  id: number;
  sceneNum: string;       // e.g. "23", "23A", "pt 23"
  description: string;    // brief description
  setLocation: string;    // INT. HOUSE - KITCHEN
  cast: string;           // cast involved (free text or numbers)
  pages: string;          // page count "2 3/8"
  status: SceneStatus;
  firstUp: string | null; // HH:MM — when scene started (auto or manual)
  wrapped: string | null; // HH:MM — when scene wrapped (auto or manual)
  setups: number;         // number of camera setups
  notes: string;
}

export interface SceneData {
  rows: SceneRow[];
  nid: number; // next id
}

export const STORAGE_KEY = 'settools_scenes';

export const STATUSES: readonly SceneStatus[] = [
  'scheduled', 'rehearsing', 'shooting', 'complete', 'omitted',
];

export const STATUS_LABELS: Record<SceneStatus, string> = {
  scheduled: 'Scheduled',
  rehearsing: 'Rehearsing',
  shooting: 'Shooting',
  complete: 'Complete',
  omitted: 'Omitted',
};

export const STATUS_ICONS: Record<SceneStatus, string> = {
  scheduled: '',
  rehearsing: 'R',
  shooting: 'S',
  complete: 'C',
  omitted: 'X',
};

// Columns for the spreadsheet grid
export type ColKey = 'sceneNum' | 'description' | 'setLocation' | 'cast' | 'pages' | 'notes';
export const COLS: readonly ColKey[] = ['sceneNum', 'description', 'setLocation', 'cast', 'pages', 'notes'];
export const COL_LABELS: Record<ColKey, string> = {
  sceneNum: 'Scene',
  description: 'Description',
  setLocation: 'Set / Location',
  cast: 'Cast',
  pages: 'Pages',
  notes: 'Notes',
};
export const COL_WIDTHS: Record<ColKey, string> = {
  sceneNum: '70px',
  description: '1fr',
  setLocation: '180px',
  cast: '120px',
  pages: '70px',
  notes: '1fr',
};

// ─── CRUD ────────────────────────────────────────────────────────────
/** Normalize a raw row object from storage, handling old field names from
 *  the static HTML version of Set Tools (scene→sceneNum, set→setLocation)
 *  and coercing types that may have been stored as strings.
 */
function normalizeRow(r: Record<string, unknown>, id: number): SceneRow {
  return {
    id,
    sceneNum:    String(r.sceneNum    ?? r.scene ?? r.sceneNumber ?? ''),
    description: String(r.description ?? r.desc  ?? ''),
    setLocation: String(r.setLocation ?? r.set   ?? r.location   ?? ''),
    cast:        String(r.cast        ?? r.actors ?? ''),
    pages:       String(r.pages       ?? r.pgs    ?? ''),
    status:      (r.status as SceneStatus) ?? 'scheduled',
    firstUp:     (r.firstUp as string) ?? null,
    wrapped:     (r.wrapped as string) ?? null,
    setups:      typeof r.setups === 'number' ? r.setups : parseInt(String(r.setups ?? 0), 10) || 0,
    notes:       String(r.notes ?? ''),
  };
}

export function loadScenes(): SceneData {
  const raw = sync.getJSON<{ rows: Record<string, unknown>[]; nid?: number }>(STORAGE_KEY);
  if (raw?.rows) {
    const rows = raw.rows.map((r, i) => {
      // Coerce id: may be stored as string, or use index+1 as fallback
      const id = typeof r.id === 'number' ? r.id
               : typeof r.id === 'string' ? (parseInt(r.id, 10) || i + 1)
               : i + 1;
      return normalizeRow(r, id);
    });
    return { rows, nid: raw.nid ?? rows.length + 1 };
  }
  return { rows: [], nid: 1 };
}

export async function saveScenes(data: SceneData): Promise<void> {
  await sync.set(STORAGE_KEY, JSON.stringify(data));
}

/** Move a scene up one position (toward index 0). No-op at index 0. */
export function moveUp(rows: SceneRow[], idx: number): void {
  if (idx <= 0 || idx >= rows.length) return;
  const tmp = rows[idx - 1]!;
  rows[idx - 1] = rows[idx]!;
  rows[idx] = tmp;
}

/** Move a scene down one position (toward last). No-op at last index. */
export function moveDown(rows: SceneRow[], idx: number): void {
  if (idx < 0 || idx >= rows.length - 1) return;
  const tmp = rows[idx + 1]!;
  rows[idx + 1] = rows[idx]!;
  rows[idx] = tmp;
}

export function mkScene(id: number, partial?: Partial<SceneRow>): SceneRow {
  return {
    id,
    sceneNum: '',
    description: '',
    setLocation: '',
    cast: '',
    pages: '',
    status: 'scheduled',
    firstUp: null,
    wrapped: null,
    setups: 0,
    notes: '',
    ...partial,
  };
}

// ─── Status advancement ──────────────────────────────────────────────
const STATUS_ORDER: SceneStatus[] = ['scheduled', 'rehearsing', 'shooting', 'complete'];

/** Advance scene to next status. Returns the new status. */
export function advanceStatus(row: SceneRow): SceneStatus {
  if (row.status === 'omitted') return 'omitted';
  const idx = STATUS_ORDER.indexOf(row.status);
  if (idx < 0 || idx >= STATUS_ORDER.length - 1) return row.status;
  const next = STATUS_ORDER[idx + 1];
  if (!next) return row.status;

  // Auto-set timing on transitions
  const now = nowHHMM();
  if (next === 'shooting' && !row.firstUp) row.firstUp = now;
  if (next === 'complete' && !row.wrapped) row.wrapped = now;

  row.status = next;
  return next;
}

/** Reset scene back to scheduled */
export function resetStatus(row: SceneRow): void {
  row.status = 'scheduled';
  row.firstUp = null;
  row.wrapped = null;
  row.setups = 0;
}

// ─── Time helpers ────────────────────────────────────────────────────
function nowHHMM(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function fmt12(hhmm: string | null): string {
  if (!hhmm) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m?.[1] || !m[2]) return hhmm;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? 'p' : 'a';
  return `${h % 12 || 12}:${min}${ap}`;
}

/** Compute elapsed minutes between two HH:MM strings */
export function elapsedMins(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const parse = (s: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m?.[1] || !m[2]) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };
  const a = parse(start), b = parse(end);
  if (a == null || b == null) return null;
  return b - a;
}

/** Format minutes as "Xh Ym" */
export function fmtMins(mins: number | null): string {
  if (mins == null) return '';
  if (mins < 0) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Page count math ─────────────────────────────────────────────────
/** Parse page count string like "2 3/8" or "1/8" into eighths */
export function parsePageEighths(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;

  // "2 3/8" format
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(trimmed);
  if (mixed?.[1] && mixed[2] && mixed[3]) {
    const whole = parseInt(mixed[1], 10);
    const num = parseInt(mixed[2], 10);
    const den = parseInt(mixed[3], 10);
    return whole * 8 + Math.round((num / den) * 8);
  }
  // "3/8" format
  const frac = /^(\d+)\/(\d+)$/.exec(trimmed);
  if (frac?.[1] && frac[2]) {
    return Math.round((parseInt(frac[1], 10) / parseInt(frac[2], 10)) * 8);
  }
  // Plain number
  const n = parseFloat(trimmed);
  if (!isNaN(n)) return Math.round(n * 8);
  return 0;
}

/** Format eighths back to page count string */
export function fmtEighths(e: number): string {
  if (e <= 0) return '';
  const whole = Math.floor(e / 8);
  const rem = e % 8;
  if (rem === 0) return `${whole}`;
  if (whole === 0) return `${rem}/8`;
  return `${whole} ${rem}/8`;
}

// ─── Progress summary ────────────────────────────────────────────────
export interface SceneSummary {
  total: number;
  complete: number;
  shooting: number;
  rehearsing: number;
  scheduled: number;
  omitted: number;
  totalEighths: number;
  completeEighths: number;
}

export function summarize(rows: SceneRow[]): SceneSummary {
  const s: SceneSummary = {
    total: rows.length,
    complete: 0,
    shooting: 0,
    rehearsing: 0,
    scheduled: 0,
    omitted: 0,
    totalEighths: 0,
    completeEighths: 0,
  };
  for (const r of rows) {
    s[r.status]++;
    const e = parsePageEighths(r.pages);
    if (r.status !== 'omitted') s.totalEighths += e;
    if (r.status === 'complete') s.completeEighths += e;
  }
  return s;
}

// ─── Paste support ───────────────────────────────────────────────────
const COL_ALIASES: Record<string, ColKey> = {
  scene: 'sceneNum', 'scene #': 'sceneNum', 'sc': 'sceneNum', 'scene no': 'sceneNum',
  'scene number': 'sceneNum', '#': 'sceneNum',
  description: 'description', desc: 'description', 'scene description': 'description',
  set: 'setLocation', location: 'setLocation', 'set/location': 'setLocation',
  'set / location': 'setLocation', loc: 'setLocation',
  cast: 'cast', actors: 'cast', talent: 'cast', characters: 'cast',
  pages: 'pages', 'page count': 'pages', pgs: 'pages', 'pg count': 'pages',
  notes: 'notes', note: 'notes', remarks: 'notes',
};

export interface PasteResult {
  added: number;
  replaced: boolean;
}

/** Parse pasted TSV/CSV into scene rows. Smart-detects headers. */
export function applyPaste(
  existing: SceneRow[],
  text: string,
  nid: number,
): { rows: SceneRow[]; nid: number; result: PasteResult } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: existing, nid, result: { added: 0, replaced: false } };

  const sep = lines[0]!.includes('\t') ? '\t' : ',';
  const parsed = lines.map((l) => l.split(sep).map((c) => c.trim()));

  // Detect header row
  let colMap: (ColKey | null)[] | null = null;
  const firstRow = parsed[0];
  if (firstRow) {
    const mapped = firstRow.map((h) => COL_ALIASES[h.toLowerCase().trim()] ?? null);
    if (mapped.filter(Boolean).length >= 2) {
      colMap = mapped;
      parsed.shift();
    }
  }

  // Default column order if no headers
  if (!colMap) {
    colMap = [...COLS];
  }

  const newRows: SceneRow[] = [];
  let nextId = nid;
  for (const cells of parsed) {
    if (!cells.some((c) => c)) continue; // skip empty rows
    const partial: Partial<SceneRow> = {};
    for (let i = 0; i < colMap.length; i++) {
      const key = colMap[i];
      const val = cells[i];
      if (key && val) {
        (partial as unknown as Record<string, string>)[key] = val;
      }
    }
    if (partial.sceneNum || partial.description) {
      newRows.push(mkScene(nextId++, partial));
    }
  }

  const replaced = existing.length > 0 && newRows.length > 0;
  return {
    rows: newRows.length > 0 ? newRows : existing,
    nid: nextId,
    result: { added: newRows.length, replaced },
  };
}
