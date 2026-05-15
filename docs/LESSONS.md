# Set Tools — Lessons Learned

Technical gotchas discovered during development. Read before modifying anything.

---

## Svelte 5

### Generic type args on runes are INVALID
```typescript
// ❌ WRONG — causes compile error / runtime crash
let contacts = $state<Contact[]>([]);
let count = $derived<number>(contacts.length);

// ✅ CORRECT — annotate the variable, not the rune
let contacts: Contact[] = $state([]);
let count: number = $derived(contacts.length);
```

### Variable named `state` conflicts with rune detection
svelte-check sees `$state` as auto-subscribing to a Svelte store named `state` if any variable in scope is named `state`. Rename to `syncState`, `pageState`, etc.

### `$derived.by` for complex derivations
```typescript
// For simple expressions:
let full = $derived(first + ' ' + last);

// For multi-line logic:
let conflicts = $derived.by(() => {
  // ... multi-line computation
  return result;
});
```

### Svelte-check vs runtime
svelte-check is stricter than the runtime. ~37 warnings exist in this project (all cosmetic). App runs fine. Do NOT add generic args to fix them — that makes it worse.

---

## Geocoding / Weather

### Open-Meteo geocoding only handles city/place names
`https://geocoding-api.open-meteo.com/v1/search?name=...` does fuzzy text matching against place names. Feeding it a street address like `"9419 Mason Ave Unit G, Chatsworth, CA 91311"` will fail or match wrong country.

**Use Nominatim (OpenStreetMap) first:**
```
https://nominatim.openstreetmap.org/search?q=<address>&format=json&limit=1
```
Nominatim handles full street addresses. Fall back to Open-Meteo only for plain city names.

**Respect Nominatim rate limit**: 1 req/sec, User-Agent header required.

### Open-Meteo sunrise/sunset are local time strings WITHOUT timezone
```
"sunrise": "2026-05-13T05:58"   // local time at forecast location, NO "Z", NO "+07:00"
```
Using `new Date("2026-05-13T05:58")` will reinterpret in browser timezone → wrong by hours.

**Parse as string only:**
```typescript
function parseLocalHHMM(iso: string): { h: number; m: number } | null {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}
// Do all time math in minutes: h*60 + m. Never construct a Date object.
```

### Address extraction strategy (for geocoding from shoot day address)
Address field might be: `"9419 Mason Ave Unit G (Stage 4), Chatsworth, CA 91311"` or `"The Lot — 1040 N Las Palmas Ave, Hollywood, CA 90038"`.

Extraction order (try each, skip if < 6 chars):
1. Content in parentheses → probably a stage name, skip
2. Whole string → try Nominatim with full address
3. After first comma → `"Chatsworth, CA 91311"`
4. After first dash → `"1040 N Las Palmas Ave, Hollywood, CA 90038"`
5. ZIP-code-anchored → find 5-digit ZIP, take string ending there

The "CA, Central Java, Indonesia" bug was caused by extracting just `" CA 91505"` (state + ZIP). Nominatim fuzzy-matched "CA" to Indonesia's Central Java province. The fix: try the whole string before slicing.

---

## localStorage

### Origin isolation
`localStorage` is scoped to origin (scheme + hostname + port). Running on port 8282 vs 8765 = completely separate storage. ALL tools must run on port 8282.

### Key prefix convention
- `settools_*` — Crew Tracker (projects, call sheets, DOOD)
- `ST_*` — Next Day / Svelte app
- `st-key` — API key (exclude from backup/export/sync)

### Backup exclusion
`st-key` is always excluded from backup downloads and sync uploads. It's the user's Anthropic API key (now moved to server-side, but key kept for backward compat).

---

## API / Claude Proxy

### After proxy migration, all API calls go through Supabase
```javascript
// Pattern used in all vanilla tools:
async function apiCall(messages, system) {
  const session = await getSupabaseSession();
  return fetch('https://<ref>.supabase.co/functions/v1/claude-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token
    },
    body: JSON.stringify({ model: 'claude-opus-4-5', messages, system })
  });
}
```

### `apiKey()` returning `'proxy'` (truthy) is intentional
Several places in `next-day.html` and `crew-tracker.html` had `if (!apiKey()) return;` guards. After removing the real API key, `apiKey()` returns `'proxy'` (a truthy string) so those guards still pass.

### Never check `localStorage.getItem('st-key')` before calling `apiCall()`
`uhRunExtract()` in crew-tracker had this check — it silently blocked call sheet uploads after the proxy migration. The check was removed. The proxy handles auth; the local key is irrelevant.

---

## File Upload UX

### Double-click bug: hidden input inside clickable container
If a `<div onclick="input.click()">` contains a `<input type="file">`, the click event bubbles → the input gets clicked twice → OS file picker flashes or requires two selections.

**Fix**: position the input completely off-screen, outside the clickable container:
```html
<input type="file" id="cs-input" 
  style="position:fixed;left:-9999px;width:0;height:0;opacity:0">
<div onclick="document.getElementById('cs-input').click()">Upload</div>
```

---

## DOOD Storage Shapes

Three shapes exist in the wild — reader must handle all:

```javascript
// Shape A: name-keyed dict
{ "Jane Smith": { dept: "Camera", role: "DP", ... } }

// Shape B: people array
{ people: [{ name: "Jane Smith", dept: "Camera", ... }] }

// Shape C: rows array (crew-tracker native format)
{ rows: [{ name: "Jane Smith", dept: "Camera", ... }] }
```

Detection:
```typescript
function readDood(raw: unknown): DoodEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.rows)) return obj.rows as DoodEntry[];
  if (Array.isArray(obj.people)) return obj.people as DoodEntry[];
  // name-keyed dict: keys are names, values are objects
  return Object.entries(obj)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([name, v]) => ({ name, ...(v as object) } as DoodEntry));
}
```

---

## Sign-In Population Order

`pullFromTracker()` in `sign-in.html` — order matters:

1. **`settools_cast`** (call sheet extract) — today's working cast, additive
2. **`st-s`** — legacy key, fallback
3. **`ST_castBible`** — full bible roster, fallback ONLY, shows warning
4. Enrich from bible + nextday contacts — fills missing phone/email, does NOT add new people

**Do not let the bible add new people** — it has the full roster (30+), not just today's 8.

---

## Git

### Token was leaked in remote URL — already fixed
The old remote had a GitHub PAT embedded: `https://ghp_...@github.com/...`. Token was revoked. Remote fixed to `https://github.com/edmundpettyproductions-droid/settools.git`.

### Sample files with PII were committed — already fixed
7 XLSX/CSV cast bible samples with real actor data were committed. Removed with `git rm --cached`. Now gitignored: `*.xlsx`, `*.xls`, `*.xlsm`, `_samples/*.csv`, `_samples/*.txt`.

### Stale worktrees cause red terminal warnings
After moving the repo from OneDrive to `C:\dev\set-tools`, old worktree paths showed as invalid. Fixed with `git worktree prune`.

### `npm run build` fails in Git Bash (node not in PATH)
Node installed after the shell session started. Fix:
```bash
"/c/Program Files/nodejs/node.exe" ./node_modules/vite/bin/vite.js build
```

---

## Supabase

### Anonymous auth must be explicitly enabled
Dashboard → Auth → Providers → Anonymous sign-ins → Enable. Without it, `supabase.auth.signInAnonymously()` throws `AuthApiError: Anonymous sign-ins are disabled`.

### Secret name must match exactly
Edge Function reads `Deno.env.get('ANTHROPIC_API_KEY')`. Secret must be named `ANTHROPIC_API_KEY`, not `KEY` or anything else.

### Supabase CLI: use npx, not global install
`npm install -g supabase` may fail (blocked in some environments). Use:
```bash
npm install --save-dev supabase
npx supabase <command>
```

### `supabase functions deploy` requires Docker on local machine
For deploy-only (no local dev), this is fine. But `supabase functions serve` (local testing) requires Docker.

---

## Worldtimeapi.org — REMOVED
`crew-tracker.html` used to fetch from `https://worldtimeapi.org/api/ip` for NTP sync. The service is dead and caused `ERR_CONNECTION_RESET` on every page load. Removed — system clock is sufficient.

---

## SheetJS (xlsx) — lazy CDN load

Don't bundle SheetJS — it's large (~1MB). Lazy-load from CDN when needed:
```typescript
let _xlsx: typeof import('xlsx') | null = null;
async function loadSheetJs() {
  if (_xlsx) return _xlsx;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
  _xlsx = (window as unknown as { XLSX: typeof import('xlsx') }).XLSX;
  return _xlsx!;
}
```
