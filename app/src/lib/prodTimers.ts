// prodTimers.ts — Production timer calculations (meal penalty, OT, arrival board)
// Pure data layer, no DOM.

import * as sync from './sync';
import * as T from './tracker';
import type { UHState } from './types';

// ─── Types ───────────────────────────────────────────────────────────
export interface ProdTimerState {
  firstShot: string | null;   // HH:MM — when cameras rolled
  lastMeal: string | null;    // HH:MM — when last meal was called
  mealDueMins: number;        // minutes until meal penalty (default 360 = 6h)
  graceMins: number;          // union grace period (default 6)
  mealCalled: boolean;        // has a meal been called for this period?
}

export const STORAGE_KEY = 'settools_prod_timers';

export const DEFAULT_STATE: ProdTimerState = {
  firstShot: null,
  lastMeal: null,
  mealDueMins: 360,
  graceMins: 6,
  mealCalled: false,
};

// ─── Load / Save ─────────────────────────────────────────────────────
export function loadState(): ProdTimerState {
  const raw = sync.getJSON<Partial<ProdTimerState>>(STORAGE_KEY);
  return { ...DEFAULT_STATE, ...raw };
}

export async function saveState(s: ProdTimerState): Promise<void> {
  await sync.set(STORAGE_KEY, JSON.stringify(s));
}

// ─── Time parsing ────────────────────────────────────────────────────
function parseHHMM(hhmm: string | null): Date | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m?.[1] || !m[2]) return null;
  const d = new Date();
  d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  return d;
}

function nowHHMM(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ─── Meal timer ──────────────────────────────────────────────────────
export type MealStatus = 'no-start' | 'counting' | 'grace' | 'penalty' | 'called';

export interface MealTimerInfo {
  status: MealStatus;
  /** Reference time the meal clock started from */
  startedFrom: string | null;
  /** When the meal becomes due (6h from start) */
  dueAt: Date | null;
  /** Milliseconds remaining until meal due (negative = past due) */
  remainingMs: number;
  /** Minutes into penalty (0 if not in penalty) */
  penaltyMins: number;
  /** Friendly display string */
  display: string;
}

export function computeMeal(state: ProdTimerState, now: Date = new Date()): MealTimerInfo {
  if (state.mealCalled) {
    return { status: 'called', startedFrom: null, dueAt: null, remainingMs: 0, penaltyMins: 0, display: 'Meal Called' };
  }

  // Reference point: lastMeal if exists, else firstShot
  const ref = state.lastMeal ?? state.firstShot;
  const refTime = parseHHMM(ref);
  if (!refTime) {
    return { status: 'no-start', startedFrom: null, dueAt: null, remainingMs: 0, penaltyMins: 0, display: 'No first shot set' };
  }

  const dueAt = new Date(refTime.getTime() + state.mealDueMins * 60_000);
  const graceEnd = new Date(dueAt.getTime() + state.graceMins * 60_000);
  const remainingMs = dueAt.getTime() - now.getTime();

  if (now < dueAt) {
    // Still counting down
    const mins = Math.floor(remainingMs / 60_000);
    const secs = Math.floor((remainingMs % 60_000) / 1000);
    return {
      status: 'counting',
      startedFrom: ref,
      dueAt,
      remainingMs,
      penaltyMins: 0,
      display: `${mins}:${secs.toString().padStart(2, '0')} to meal`,
    };
  }

  if (now < graceEnd) {
    // In grace period
    const graceSecs = Math.floor((graceEnd.getTime() - now.getTime()) / 1000);
    return {
      status: 'grace',
      startedFrom: ref,
      dueAt,
      remainingMs,
      penaltyMins: 0,
      display: `GRACE — ${Math.ceil(graceSecs / 60)}m left`,
    };
  }

  // In penalty
  const penaltyMs = now.getTime() - graceEnd.getTime();
  const penaltyMins = Math.ceil(penaltyMs / 60_000);
  return {
    status: 'penalty',
    startedFrom: ref,
    dueAt,
    remainingMs,
    penaltyMins,
    display: `PENALTY — ${penaltyMins}m`,
  };
}

// ─── OT thresholds ───────────────────────────────────────────────────
export interface OTThreshold {
  hours: number;
  label: string;
  severity: 'info' | 'warn' | 'danger';
}

export const OT_THRESHOLDS: OTThreshold[] = [
  { hours: 8, label: '8h', severity: 'info' },
  { hours: 10, label: '10h', severity: 'warn' },
  { hours: 12, label: '12h', severity: 'danger' },
  { hours: 14, label: '14h', severity: 'danger' },
];

export interface PersonOT {
  name: string;
  role: string;
  source: 'cast' | 'crew';
  arrivedAt: string;
  hoursWorked: number;
  currentThreshold: OTThreshold | null;
  nextThreshold: OTThreshold | null;
  nextThresholdMs: number; // ms until next threshold
  isWrapped: boolean;
}

export function computeOT(now: Date = new Date()): PersonOT[] {
  const castData = T.loadTracker('settools_cast');
  const crewData = T.loadTracker('settools_crew');
  const results: PersonOT[] = [];

  for (const source of ['cast', 'crew'] as const) {
    const rows = source === 'cast' ? castData.rows : crewData.rows;
    for (const r of rows) {
      if (!r.arrived || !r.arrivedAt) continue;
      const arrTime = parseHHMM(r.arrivedAt);
      if (!arrTime) continue;

      const isWrapped = !!r.wrapTime;
      const endTime = isWrapped ? (parseHHMM(r.wrapTime!) ?? now) : now;
      const elapsedMs = endTime.getTime() - arrTime.getTime();
      const hoursWorked = elapsedMs / (3600_000);

      // Find current and next OT threshold
      let currentThreshold: OTThreshold | null = null;
      let nextThreshold: OTThreshold | null = null;
      for (const t of OT_THRESHOLDS) {
        if (hoursWorked >= t.hours) {
          currentThreshold = t;
        } else if (!nextThreshold) {
          nextThreshold = t;
        }
      }

      const nextThresholdMs = nextThreshold
        ? arrTime.getTime() + nextThreshold.hours * 3600_000 - now.getTime()
        : 0;

      results.push({
        name: r.name,
        role: r.role,
        source,
        arrivedAt: r.arrivedAt,
        hoursWorked,
        currentThreshold,
        nextThreshold,
        nextThresholdMs,
        isWrapped,
      });
    }
  }

  // Sort by hours worked descending
  results.sort((a, b) => b.hoursWorked - a.hoursWorked);
  return results;
}

// ─── Arrival board ───────────────────────────────────────────────────
export interface ArrivalGroup {
  callTime: string;       // HH:MM
  callTime12: string;     // "7:00a"
  people: ArrivalPerson[];
  arrivedCount: number;
  totalCount: number;
}

export interface ArrivalPerson {
  name: string;
  role: string;
  source: 'cast' | 'crew';
  callTime: string;
  arrived: boolean;
  arrivedAt: string;
  isWrapped: boolean;
}

export function buildArrivalBoard(): ArrivalGroup[] {
  const castData = T.loadTracker('settools_cast');
  const crewData = T.loadTracker('settools_crew');
  const all: ArrivalPerson[] = [];

  for (const source of ['cast', 'crew'] as const) {
    const rows = source === 'cast' ? castData.rows : crewData.rows;
    for (const r of rows) {
      if (!r.name.trim()) continue;
      all.push({
        name: r.name,
        role: r.role,
        source,
        callTime: r.callTime || '—',
        arrived: r.arrived,
        arrivedAt: r.arrivedAt,
        isWrapped: !!r.wrapTime,
      });
    }
  }

  // Group by call time
  const groups = new Map<string, ArrivalPerson[]>();
  for (const p of all) {
    const key = p.callTime;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  // Sort groups by call time, then people by name
  const result: ArrivalGroup[] = [];
  const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [ct, people] of sorted) {
    people.sort((a, b) => a.name.localeCompare(b.name));
    result.push({
      callTime: ct,
      callTime12: T.fmt12(ct),
      people,
      arrivedCount: people.filter((p) => p.arrived).length,
      totalCount: people.length,
    });
  }
  return result;
}

// ─── Production elapsed ──────────────────────────────────────────────
export function productionElapsed(state: ProdTimerState, now: Date = new Date()): string {
  const firstShot = parseHHMM(state.firstShot);
  if (!firstShot) return '—';
  const ms = now.getTime() - firstShot.getTime();
  if (ms < 0) return '—';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

/** Get first shot time from UH if not set in state */
export function firstShotFromUH(): string | null {
  const uh = sync.getJSON<UHState>('settools_uh');
  return uh?.firstShot ?? null;
}

/** Record "now" as the first shot time */
export function stampNow(): string {
  return nowHHMM();
}
