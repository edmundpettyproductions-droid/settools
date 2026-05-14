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

/** Where a unified contact entry was pulled from. A single person may
 *  appear in multiple sources (e.g., a lead actor is in the call sheet,
 *  the cast bible, and the sign-in records simultaneously). */
export type ContactSource =
  | 'call_sheet'   // settools_cast / settools_crew (call-sheet derived)
  | 'cast_bible'   // settools_cast_bible (richest contact data)
  | 'sign_in'      // ST_signin (touchscreen records)
  | 'next_day';    // ST_nextday.contacts

/** Categories for unified contact display + filtering. */
export type ContactCategory = 'cast' | 'crew' | 'agent' | 'manager' | 'guardian' | 'vendor' | 'other';

/** One observation of a field's value from a specific source.
 *  Multiple of these for the same field across sources = potential conflict. */
export interface ContactFieldValue {
  source: ContactSource;
  value: string;
}

/** A DOOD appearance — this person is scheduled in a department's DOOD on these days. */
export interface DoodAppearance {
  department: string;        // "Cast", "Wardrobe", "Stunts", "MU/Hair", "Vehicle", etc.
  days: number[];            // shoot day numbers, sorted ascending, deduped
  days_label?: string;       // pretty label like "D1, D3-5"
  notes?: string;
}

/** A detected conflict: same field, multiple distinct values across sources. */
export interface ContactConflict {
  field: string;             // 'phone', 'email', 'character', etc.
  values: ContactFieldValue[];
}

/** A merged contact, deduplicated across sources by normalized name.
 *  Fields are populated from the richest available source. */
export interface UnifiedContact {
  name: string;
  category: ContactCategory;
  role?: string;             // crew role/department or cast role classification
  department?: string;       // crew dept (e.g., "Camera", "Wardrobe")
  character?: string;        // cast character name
  phone?: string;
  email?: string;
  // Cast-bible-specific extras (only set when source includes cast_bible)
  actor_legal?: string;
  status?: string;           // Locked / Cancelled / etc.
  agency_name?: string;
  agent_name?: string;
  agent_phone?: string;
  agent_email?: string;
  manager_name?: string;
  manager_phone?: string;
  manager_email?: string;
  guardian_name?: string;
  guardian_phone?: string;
  diet?: string;
  notes?: string;
  // Provenance
  sources: ContactSource[];
  /** Per-field observations across sources. Used to detect conflicts.
   *  Only populated for fields where conflicts are meaningful
   *  (phone, email, character, role, status). */
  field_values?: Record<string, ContactFieldValue[]>;
  /** Detected conflicts: fields where multiple distinct values exist. */
  conflicts?: ContactConflict[];
  /** DOOD appearances (per department this person is scheduled in). */
  dood?: DoodAppearance[];
}
