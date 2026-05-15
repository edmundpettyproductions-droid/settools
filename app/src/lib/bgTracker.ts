// bgTracker.ts — Background / Extras performer tracking
// Check-in, vouchers (union), wardrobe changes, bumps, meal tracking.
// Union/non-union aware via projectSettings.

import * as sync from './sync';
import * as PS from './projectSettings';

// ─── Types ───────────────────────────────────────────────────────────
export interface BGPerformer {
  id: number;
  name: string;
  voucherNum: string;        // SAG voucher # (union) or badge # (non-union)
  rate: string;              // pay rate (free text)
  callTime: string;          // HH:MM
  checkedIn: boolean;
  checkInTime: string;       // HH:MM
  checkOutTime: string;      // HH:MM (wrap)
  wardrobeChanges: number;   // count of wardrobe changes
  bumps: string[];           // list of bump category names
  mealIn: string;            // HH:MM - sent to meal
  mealOut: string;           // HH:MM - back from meal
  scenes: string;            // which scenes they appear in
  notes: string;
}

export interface BGState {
  performers: BGPerformer[];
  nid: number;
  date: string;              // shoot date
  generalCall: string;       // BG general call time
  holdingLocation: string;   // where BG holds
  lastUpdated: string | null;
}

export const STORAGE_KEY = 'settools_bg';

// ─── Load / Save ─────────────────────────────────────────────────────
export function load(): BGState {
  const raw = sync.getJSON<BGState>(STORAGE_KEY);
  if (raw?.performers) return raw;
  return {
    performers: [],
    nid: 1,
    date: new Date().toISOString().slice(0, 10),
    generalCall: '',
    holdingLocation: '',
    lastUpdated: null,
  };
}

export async function save(state: BGState): Promise<void> {
  state.lastUpdated = new Date().toISOString();
  await sync.set(STORAGE_KEY, JSON.stringify(state));
}

// ─── CRUD ────────────────────────────────────────────────────────────
export function addPerformer(state: BGState): BGPerformer {
  const p: BGPerformer = {
    id: state.nid++,
    name: '',
    voucherNum: '',
    rate: '',
    callTime: state.generalCall || '',
    checkedIn: false,
    checkInTime: '',
    checkOutTime: '',
    wardrobeChanges: 0,
    bumps: [],
    mealIn: '',
    mealOut: '',
    scenes: '',
    notes: '',
  };
  state.performers.push(p);
  return p;
}

export function removePerformer(state: BGState, id: number): void {
  state.performers = state.performers.filter((p) => p.id !== id);
}

export function checkIn(performer: BGPerformer): void {
  performer.checkedIn = true;
  const now = new Date();
  performer.checkInTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

export function checkOut(performer: BGPerformer): void {
  const now = new Date();
  performer.checkOutTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

export function addBump(performer: BGPerformer, category: string): void {
  if (!performer.bumps.includes(category)) {
    performer.bumps.push(category);
  }
}

export function removeBump(performer: BGPerformer, category: string): void {
  performer.bumps = performer.bumps.filter((b) => b !== category);
}

// ─── Queries ─────────────────────────────────────────────────────────
export interface BGSummary {
  total: number;
  checkedIn: number;
  wrapped: number;
  atMeal: number;
  withBumps: number;
  totalBumps: number;
  totalWardrobeChanges: number;
}

export function summarize(performers: BGPerformer[]): BGSummary {
  let checkedIn = 0, wrapped = 0, atMeal = 0, withBumps = 0, totalBumps = 0, totalWC = 0;
  for (const p of performers) {
    if (p.checkedIn) checkedIn++;
    if (p.checkOutTime) wrapped++;
    if (p.mealIn && !p.mealOut) atMeal++;
    if (p.bumps.length > 0) { withBumps++; totalBumps += p.bumps.length; }
    totalWC += p.wardrobeChanges;
  }
  return { total: performers.length, checkedIn, wrapped, atMeal, withBumps, totalBumps, totalWardrobeChanges: totalWC };
}

/** Get bump categories from project settings */
export function getBumpCategories(): string[] {
  return PS.load().bgBumpCategories;
}

/** Is voucher mode (union) */
export function isVoucherMode(): boolean {
  return PS.load().bgVoucherRequired;
}

// ─── Time helpers ────────────────────────────────────────────────────
function parseHHMM(hhmm: string): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m?.[1] || !m[2]) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function hoursWorked(p: BGPerformer): string {
  const inMins = parseHHMM(p.checkInTime);
  const outMins = parseHHMM(p.checkOutTime);
  if (inMins == null || outMins == null) return '—';
  const diff = outMins - inMins;
  if (diff <= 0) return '—';
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function fmt12(hhmm: string): string {
  if (!hhmm) return '—';
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m?.[1] || !m[2]) return hhmm;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? 'p' : 'a';
  return `${h % 12 || 12}:${min}${ap}`;
}

// ─── Export ──────────────────────────────────────────────────────────
export function formatText(state: BGState): string {
  const lines: string[] = [];
  const settings = PS.load();
  const label = settings.bgVoucherRequired ? 'BACKGROUND VOUCHER LOG' : 'BACKGROUND CHECK-IN LOG';
  lines.push(label);
  lines.push('═'.repeat(50));
  lines.push('');
  if (state.date) lines.push(`Date: ${state.date}`);
  if (state.generalCall) lines.push(`BG Call: ${fmt12(state.generalCall)}`);
  if (state.holdingLocation) lines.push(`Holding: ${state.holdingLocation}`);
  lines.push(`Total BG: ${state.performers.length}`);
  lines.push('');

  for (const p of state.performers) {
    const vLabel = settings.bgVoucherRequired ? `V#${p.voucherNum}` : (p.voucherNum ? `#${p.voucherNum}` : '');
    lines.push(`${p.name}${vLabel ? `  ${vLabel}` : ''}`);
    lines.push(`  Call: ${fmt12(p.callTime)}  In: ${fmt12(p.checkInTime)}  Out: ${fmt12(p.checkOutTime)}  Hours: ${hoursWorked(p)}`);
    if (p.wardrobeChanges > 0) lines.push(`  Wardrobe Changes: ${p.wardrobeChanges}`);
    if (p.bumps.length > 0) lines.push(`  Bumps: ${p.bumps.join(', ')}`);
    if (p.scenes) lines.push(`  Scenes: ${p.scenes}`);
    if (p.notes) lines.push(`  Notes: ${p.notes}`);
    lines.push('');
  }
  return lines.join('\n');
}
