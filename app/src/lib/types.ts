// Shared types across the Set Tools Svelte app.
// Mirrors the shapes the vanilla tools write to localStorage / kv_store today.

/** Universal Header state, stored under key `settools_uh`. */
export interface UHState {
  callTime?: string;     // "07:00"
  firstShot?: string;    // "09:00"
  shootDay?: string;     // "12" of N
  production?: string;
  episode?: string;
  director?: string;
  location?: string;     // free-text address
}

/** Project Tracker state, stored under key `settools_pt`. */
export interface PTState {
  activeProject?: string;
  projects?: Record<string, PTProject>;
}

export interface PTProject {
  name: string;
  days?: PTDay[];
  scriptVersion?: string;
  scheduleVersion?: string;
}

export interface PTDay {
  dayNum: number;
  date?: string;
}

/** Cast or crew person — derived from various sources. */
export interface Person {
  empId?: string;
  name: string;
  role?: string;
  callTime?: string;
  email?: string;
  phone?: string;
}

/** Counts derived across all loaded data. */
export interface PersonCounts {
  cast: number;
  crew: number;
  total: number;
}

/** Open-Meteo daily forecast slice for one day. */
export interface DailyForecast {
  date: string;             // "2026-05-12"
  weatherCode: number;      // WMO code → label via wmoLabel()
  tempHi: number;           // °F
  tempLo: number;           // °F
  sunrise: string;          // ISO time
  sunset: string;           // ISO time
  civilDawn?: string;
  civilDusk?: string;
  precipitationProb?: number; // 0-100
}

/** Open-Meteo geocoding result. */
export interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

/** A single cast/talent entry extracted from a Cast Bible document. */
export interface CastBibleEntry {
  actor: string;             // actor's primary/working name (required)
  actor_legal?: string;      // legal name if different from theatrical
  character?: string;        // character/role name
  role?: CastRole;           // Lead, Supporting, etc.
  status?: CastStatus;       // Locked, Cancelled, Wrapped, Shooting, etc.
  phone?: string;
  email?: string;
  agency_name?: string;      // agency/management company name
  agent_name?: string;       // person at the agency
  agent_phone?: string;
  agent_email?: string;
  manager_name?: string;
  manager_phone?: string;
  manager_email?: string;
  guardian_name?: string;    // for minors: parent/guardian contact name
  guardian_phone?: string;
  hours?: number;            // contracted hours/day if specified
  rate?: string;             // talent rate if specified (kept as string — varied formats)
  diet?: string;             // dietary requirements / allergies
  notes?: string;
}

export type CastStatus = 'Locked' | 'Tentative' | 'Cancelled' | 'Wrapped' | 'Shooting' | 'Pending';

export type CastRole =
  | 'Lead' | 'Co-Lead' | 'Supporting' | 'Recurring' | 'Guest Star'
  | 'Day Player' | 'Background' | 'Stunt' | 'Stand-In' | 'Voice' | 'Other';

/** A single Cast Bible upload event — kept for audit + history. */
export interface CastBibleUpload {
  filename: string;
  filesize: number;          // bytes
  uploaded_at: string;       // ISO datetime
  extracted_count: number;
  format_summary?: string;   // Claude's brief description of source format
}

/** Full Cast Bible state stored under key `settools_cast_bible`. */
export interface CastBibleState {
  entries: CastBibleEntry[];
  uploads: CastBibleUpload[];
  last_updated?: string;     // ISO datetime
}
