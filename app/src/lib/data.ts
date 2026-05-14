// Read derived state from the synced kv_store / localStorage.
// These functions look for data wherever the vanilla tools happen to write it
// today — they're defensive because shape varies between tools.

import * as sync from './sync';
import type { UHState, PTState, PersonCounts, PTProject, PTDay } from './types';

/** Universal Header state (call time, location, production, etc.). */
export function readUH(): UHState {
  return sync.getJSON<UHState>('settools_uh') ?? {};
}

/** Project Tracker state. */
export function readPT(): PTState {
  return sync.getJSON<PTState>('settools_pt') ?? {};
}

/** The currently active project, if any. */
export function activeProject(): PTProject | null {
  const pt = readPT();
  if (!pt.activeProject || !pt.projects) return null;
  return pt.projects[pt.activeProject] ?? null;
}

/** The most recent shooting day on the active project, if any. */
export function lastDay(): PTDay | null {
  const proj = activeProject();
  if (!proj?.days?.length) return null;
  return proj.days[proj.days.length - 1] ?? null;
}

/** Cast + crew counts, derived from whatever loaded data we can find.
 *  Defensive — different tools write counts in different shapes.
 */
export function counts(): PersonCounts {
  let cast = 0;
  let crew = 0;

  // Cast tracker keeps a list in settools_cast
  const castState = sync.getJSON<{ people?: unknown[]; rows?: unknown[] }>('settools_cast');
  if (castState) cast += (castState.people?.length ?? castState.rows?.length ?? 0);

  // Crew tracker keeps a list in settools_crew
  const crewState = sync.getJSON<{ people?: unknown[]; rows?: unknown[] }>('settools_crew');
  if (crewState) crew += (crewState.people?.length ?? crewState.rows?.length ?? 0);

  // Next-day contacts have an isCast/role flag — count there too if other sources are missing
  if (cast === 0 || crew === 0) {
    const nd = sync.getJSON<{ contacts?: Array<{ isCast?: boolean; role?: string }> }>('ST_nextday');
    if (nd?.contacts?.length) {
      for (const c of nd.contacts) {
        if (c.isCast) { if (cast === 0) cast = (cast || 0); cast++; }
        else          { if (crew === 0) crew = (crew || 0); crew++; }
      }
    }
  }

  return { cast, crew, total: cast + crew };
}

/** Lunch time = call time + 6 hours. Returns "HH:MM" or null. */
export function computeLunch(callTime: string | undefined): string | null {
  if (!callTime) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(callTime.trim());
  if (!m) return null;
  const hStr = m[1];
  const mStr = m[2];
  if (hStr == null || mStr == null) return null;
  const h = Number(hStr);
  const mins = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(mins)) return null;
  const total = h * 60 + mins + 6 * 60;
  const newH = Math.floor((total / 60) % 24);
  const newM = total % 60;
  return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
}

/** Tomorrow's date in YYYY-MM-DD (browser's local zone). */
export function tomorrowISODate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Tomorrow as a human label like "Tuesday, May 12". */
export function tomorrowLabel(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
