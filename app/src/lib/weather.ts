// Open-Meteo client — geocoding + daily forecast for the shoot location.
// No API key required. Free tier covers our usage trivially.

import type { DailyForecast, GeocodeResult } from './types';

const WMO_LABELS: Record<number, string> = {
  0: 'Clear', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy Fog',
  51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  77: 'Snow Grains',
  80: 'Showers', 81: 'Showers', 82: 'Heavy Showers',
  85: 'Snow Showers', 86: 'Heavy Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm + Hail', 99: 'Thunderstorm + Hail',
};

export function wmoLabel(code: number): string {
  return WMO_LABELS[code] ?? `Code ${code}`;
}

/** Geocode an address string. Returns null if nothing found. */
export async function geocode(query: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json() as { results?: Array<GeocodeResult> };
    return data.results?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Generate candidate query strings for a location, best-bet first.
 *  Call sheets typically read "LOCATION NAME, 123 STREET, CITY, ST 90210".
 *  The location name often won't geocode, but the address tail will.
 */
export function extractAddressCandidates(loc: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    const clean = s.trim().replace(/^[,\s\-—()]+|[,\s\-—()]+$/g, '').trim();
    if (clean && !seen.has(clean)) { seen.add(clean); out.push(clean); }
  };

  // 1. ZIP code anchor — most reliable. Grab from last separator-before-ZIP
  //    through end of ZIP. Handles "STAGE 14, 123 Main, LA, CA 90001".
  const zip = /\b(\d{5}(?:-\d{4})?)\b/.exec(loc);
  if (zip) {
    const zipEnd = zip.index + zip[0].length;
    const before = loc.substring(0, zip.index);
    const sepIdx = Math.max(
      before.lastIndexOf(','),
      before.lastIndexOf(' - '),
      before.lastIndexOf('('),
      before.lastIndexOf('\n'),
    );
    add(loc.substring(sepIdx >= 0 ? sepIdx + 1 : 0, zipEnd));
  }

  // 2. State abbreviation — for addresses without an explicit ZIP.
  const STATES = '(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)';
  const stateRe = new RegExp(`\\b${STATES}\\b`);
  const stateMatch = stateRe.exec(loc);
  if (stateMatch) {
    const before = loc.substring(0, stateMatch.index);
    const sepIdx = Math.max(before.lastIndexOf(','), before.lastIndexOf(' - '), before.lastIndexOf('('));
    add(loc.substring(sepIdx >= 0 ? sepIdx + 1 : 0, stateMatch.index + stateMatch[0].length));
  }

  // 3. Text inside parentheses if it has digits — "STAGE 14 (123 Main St)".
  const parens = /\(([^)]+)\)/.exec(loc);
  if (parens && parens[1] && /\d/.test(parens[1])) add(parens[1]);

  // 4. Everything after the first comma or dash — broad heuristic.
  const sep = /[,\-—]\s*(.+)/.exec(loc);
  if (sep && sep[1]) add(sep[1]);

  // 5. Last resort: the original string.
  add(loc);

  return out;
}

/** Try multiple address extractions; return first one that geocodes successfully.
 *  Returns the result AND the query that worked, so callers can show what was used.
 */
export async function smartGeocode(loc: string): Promise<{ result: GeocodeResult; usedQuery: string } | null> {
  const candidates = extractAddressCandidates(loc);
  for (const q of candidates) {
    const r = await geocode(q);
    if (r) return { result: r, usedQuery: q };
  }
  return null;
}

/** Fetch daily forecast for `days` days starting today. Tomorrow is `[1]`. */
export async function getForecast(lat: number, lon: number, days = 3): Promise<DailyForecast[]> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'sunrise',
      'sunset',
      'precipitation_probability_max',
    ].join(','),
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    forecast_days: String(days),
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!r.ok) throw new Error(`Open-Meteo forecast HTTP ${r.status}`);
  const data = await r.json() as {
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      sunrise: string[];
      sunset: string[];
      precipitation_probability_max?: number[];
    };
  };

  const d = data.daily;
  const n = d.time.length;
  const out: DailyForecast[] = [];
  for (let i = 0; i < n; i++) {
    const date = d.time[i];
    const code = d.weather_code[i];
    const max = d.temperature_2m_max[i];
    const min = d.temperature_2m_min[i];
    const rise = d.sunrise[i];
    const set  = d.sunset[i];
    if (date == null || code == null || max == null || min == null || rise == null || set == null) continue;
    out.push({
      date,
      weatherCode: code,
      tempHi: Math.round(max),
      tempLo: Math.round(min),
      sunrise: rise,
      sunset: set,
      civilDawn: solarTimeOffset(rise, -30),
      civilDusk: solarTimeOffset(set, +30),
      precipitationProb: d.precipitation_probability_max?.[i],
    });
  }
  return out;
}

/** Approximate civil dawn/dusk as sunrise/sunset ± 30 min.
 *  Open-Meteo's free tier doesn't include civil twilight, so this is a
 *  reasonable fallback (true value depends on latitude/season but is
 *  usually 25–35 min in temperate zones).
 */
function solarTimeOffset(iso: string, offsetMin: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + offsetMin);
  return d.toISOString();
}

/** Format an ISO time string as "6:42 AM" in the local timezone of the time. */
export function fmtTime12(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ap}`;
}
