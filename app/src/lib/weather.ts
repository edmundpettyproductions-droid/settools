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

/** Geocode using Open-Meteo's place-name API. Good for city/landmark
 *  names like "Chatsworth" or "Times Square" but does NOT handle full
 *  street addresses — those go to Nominatim (below). Kept as a fallback.
 */
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

/** Geocode using OpenStreetMap's Nominatim. Handles full street addresses,
 *  which Open-Meteo can't. Free, no API key required.
 *
 *  Usage policy: max ~1 req/sec; identify via Referer (auto-sent by browser)
 *  or User-Agent. Don't hammer it. For our case — one fetch per address
 *  change — this is well within limits.
 */
export async function nominatimGeocode(query: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const params = new URLSearchParams({
    q: trimmed,
    format: 'json',
    limit: '1',
    addressdetails: '1',
  });
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const arr = (await r.json()) as Array<{
      lat: string;
      lon: string;
      display_name?: string;
      name?: string;
      address?: {
        house_number?: string; road?: string;
        city?: string; town?: string; village?: string; suburb?: string;
        county?: string; state?: string; country?: string; postcode?: string;
      };
    }>;
    if (!arr.length || !arr[0]) return null;
    const hit = arr[0];
    const a = hit.address ?? {};
    const cityish = a.city ?? a.town ?? a.village ?? a.suburb ?? a.county ?? '';
    const fallbackName = hit.display_name ? hit.display_name.split(',')[0]?.trim() : trimmed;
    return {
      name: cityish || hit.name || fallbackName || trimmed,
      latitude: Number(hit.lat),
      longitude: Number(hit.lon),
      country: a.country,
      admin1: a.state,
    };
  } catch {
    return null;
  }
}

/** Generate candidate query strings for a location, best-bet first.
 *  Call sheets typically read "LOCATION NAME, 123 STREET, CITY, ST 90210".
 *  The location name often doesn't geocode (made-up venue names), but the
 *  address tail does. Candidates with fewer than 6 chars are dropped to
 *  avoid producing useless queries like "CA" that fuzzy-match places in
 *  random countries.
 */
export function extractAddressCandidates(loc: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    const clean = s.trim().replace(/^[,\s\-—()]+|[,\s\-—()]+$/g, '').trim();
    // Min length 6: avoids "CA", "NY 11", and other ambiguous shrapnel
    // that geocoders happily match to wrong places (e.g. "CA" → Central Java).
    if (clean && clean.length >= 6 && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  };

  // 1. Whole string FIRST — Nominatim handles messy inputs well, and a
  //    pristine address like "9419 Mason Ave, Chatsworth, CA 91311" needs
  //    no extraction. Only fall back to extractions if this misses.
  add(loc);

  // 2. Inside parentheses with digits — cleanest extraction when present.
  //    "GRAYSTONE MANSION (905 Loma Vista Dr, Beverly Hills, CA 90210)"
  //    → "905 Loma Vista Dr, Beverly Hills, CA 90210"
  const parens = /\(([^)]+)\)/.exec(loc);
  if (parens && parens[1] && /\d/.test(parens[1])) add(parens[1]);

  // 3. After the FIRST comma — drops the friendly location name.
  //    "STAGE 14, 123 Main St, Burbank, CA 91505"
  //    → "123 Main St, Burbank, CA 91505"
  const firstComma = loc.indexOf(',');
  if (firstComma >= 0 && firstComma < loc.length - 1) {
    add(loc.substring(firstComma + 1));
  }

  // 4. After the first dash-with-spaces — same idea for "STAGE 14 - 123 Main…".
  const dashMatch = / [-—] (.+)/.exec(loc);
  if (dashMatch && dashMatch[1]) add(dashMatch[1]);

  // 5. ZIP-anchored substring — last resort. Goes back at least TWO commas
  //    so we always include city + state + ZIP, not just " CA 91505".
  const zip = /\b(\d{5}(?:-\d{4})?)\b/.exec(loc);
  if (zip) {
    const before = loc.substring(0, zip.index);
    const commas: number[] = [];
    for (let i = 0; i < before.length; i++) {
      if (before[i] === ',') commas.push(i);
    }
    // Need at least 2 commas to produce "Street, City, State ZIP"
    if (commas.length >= 2) {
      const startIdx = commas[commas.length - 2];
      if (startIdx !== undefined) {
        add(loc.substring(startIdx + 1, zip.index + zip[0].length));
      }
    }
  }

  return out;
}

/** Try multiple address extractions, geocoders in fallback order, and
 *  return the first hit. Per-candidate we try Nominatim first (handles
 *  street addresses) then Open-Meteo (handles place names) before moving
 *  to the next candidate string.
 */
export async function smartGeocode(loc: string): Promise<{ result: GeocodeResult; usedQuery: string } | null> {
  const candidates = extractAddressCandidates(loc);
  for (const q of candidates) {
    // Address-grade geocoder first (Nominatim / OpenStreetMap)
    const r1 = await nominatimGeocode(q);
    if (r1) return { result: r1, usedQuery: q };
    // Place-name fallback (Open-Meteo) — useful for inputs like "Times Square"
    const r2 = await geocode(q);
    if (r2) return { result: r2, usedQuery: q };
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

/** Parse "YYYY-MM-DDTHH:MM" into { h, m }, ignoring date and timezone.
 *  Open-Meteo returns times in the *location's* local timezone but without
 *  a TZ suffix; using `new Date()` would (mis)interpret them in the
 *  browser's timezone. Pure string math sidesteps the bug entirely.
 */
function parseLocalHHMM(iso: string): { h: number; m: number } | null {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

/** Approximate civil dawn/dusk as sunrise/sunset ± 30 min.
 *  Returns an ISO string with the HH:MM replaced — keeps the same shape
 *  so callers can fmtTime12() it just like the real value.
 *  Open-Meteo's free tier doesn't include true civil twilight; real
 *  value varies 20–40 min by latitude/season.
 */
function solarTimeOffset(iso: string, offsetMin: number): string {
  const t = parseLocalHHMM(iso);
  if (!t) return iso;
  const total = t.h * 60 + t.m + offsetMin;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return iso.replace(/T\d{2}:\d{2}/, `T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
}

/** Format Open-Meteo's local-time-no-TZ ISO string as "5:58 AM".
 *  Uses string parsing — does NOT pass through Date() to avoid
 *  browser-timezone interpretation of the timezone-less value.
 */
export function fmtTime12(iso: string): string {
  const t = parseLocalHHMM(iso);
  if (!t) return '—';
  const ap = t.h >= 12 ? 'PM' : 'AM';
  const h12 = t.h % 12 || 12;
  return `${h12}:${t.m.toString().padStart(2, '0')} ${ap}`;
}
