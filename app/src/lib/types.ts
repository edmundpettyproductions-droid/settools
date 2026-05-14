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
