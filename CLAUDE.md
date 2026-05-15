# Set Tools — Project Context for Claude Sessions

> **This file exists so any new Claude session can resume without losing context.**
> Read this first, then read `docs/LESSONS.md` for known gotchas before touching code.

---

## What this project is

**Set Tools** is a browser-based dashboard for a film production Director's Assistant (DA).
It runs as static HTML served locally via `python -m http.server 8282` or `start-server.bat`.
All data lives in `localStorage` (key prefix `settools_` or `ST_`), optionally synced to Supabase.

### The tools

| File / URL | Purpose |
|---|---|
| `index.html` | Hub — links to all tools, Backup/Restore, Cross-Device Sync panel |
| `crew-tracker.html` | Call sheet upload (Claude extraction), timers, schedule, DOOD table |
| `sign-in.html` | Cast sign-in kiosk — touchscreen, signature capture |
| `next-day.html` | Next-day planning, weather, email blast (isolated from today's data) |
| `tomorrow/index.html` | Svelte 5 app (built output) — 7-tab planning suite |

### Tomorrow app tabs (Svelte, served at `/tomorrow/`)

1. **Tomorrow's Briefing** — weather, solar, call time logistics
2. **Contacts** — unified view merging cast bible + call sheet + DOOD + nextday
3. **Conflict Review** — flag/resolve/export cross-source data conflicts
4. **Notes** — quick notes, person-linked
5. **Issues** — issue tracker with badge count, priority, status
6. **Cast Bible** — XLSX/PDF upload → Claude extracts cast data
7. **Resources** — in-page upload + deep-link shortcuts to vanilla tools

---

## Repository

- **Location**: `C:\dev\set-tools`  (NOT OneDrive — was moved to avoid sync corruption)
- **Remote**: `https://github.com/edmundpettyproductions-droid/settools.git`
- **Branch**: `main`
- **Last meaningful commit**: `49db1ce` — Cast Sign-In fix (call sheet primary)

```
set-tools/
├── index.html
├── crew-tracker.html
├── sign-in.html
├── next-day.html
├── manifest.webmanifest      # PWA manifest
├── icon.svg                  # clapperboard + "ST" monogram, amber
├── start-server.bat          # Windows launcher → port 8282
├── start-server.command      # macOS launcher → port 8282
├── js/
│   └── sync.js               # Vanilla cross-device sync (localStorage monkeypatch)
├── app/                      # Svelte 5 source (Vite, TypeScript)
│   └── src/
│       ├── lib/
│       │   ├── sync.ts           # Typed Supabase client, workspace create/join/leave
│       │   ├── extract.ts        # Claude proxy wrapper + SheetJS XLSX→text
│       │   ├── castBible.ts      # Bible extraction prompt + parser
│       │   ├── contacts.ts       # 4-source merger, conflict detection, DOOD reader
│       │   ├── conflictStatus.ts # Conflict review state, PDF export
│       │   ├── weather.ts        # Open-Meteo + Nominatim geocoder
│       │   ├── notes.ts          # Notes CRUD + sync
│       │   └── issues.ts         # Issues CRUD + sync
│       └── components/
│           ├── App.svelte
│           ├── DailyBriefing.svelte
│           ├── Contacts.svelte
│           ├── ConflictReview.svelte
│           ├── Notes.svelte
│           ├── Issues.svelte
│           ├── CastBible.svelte
│           └── GlobalResources.svelte
├── tomorrow/                 # Built Svelte output (committed, served statically)
├── backend/
│   ├── README.md             # Supabase setup instructions
│   └── supabase/
│       ├── migrations/
│       │   ├── 0001_initial_schema.sql   # workspaces, projects, contacts, sign_ins, RLS
│       │   └── 0002_kv_store_and_workspace_rpcs.sql  # kv_store, create_workspace(), join_workspace()
│       └── functions/
│           └── claude-proxy/index.ts    # Deno Edge Function, ANTHROPIC_API_KEY server-side
├── docs/
│   └── LESSONS.md            # Technical gotchas learned the hard way
└── CLAUDE.md                 ← you are here
```

---

## Architecture decisions

### Port 8282 everywhere
All tools must run on the same origin. `localStorage` is origin-scoped — different ports = different storage = data isolation. `8282` is the single canonical port.

### localStorage key prefixes
- `settools_*` — Crew Tracker data (projects, DOOD, call sheets)
- `ST_*` — Next Day / Svelte app data
- `st-key` — API key (excluded from backups)
- All keys matching `/^(settools[_-]|ST[_-]|st[_-])/i` are considered Set Tools data

### Supabase backend
- **Project**: live on supabase.com (user has credentials)
- **Anonymous auth** must be enabled in dashboard → Auth → Providers
- **kv_store table**: `(workspace_id, key, value jsonb, updated_at)` — each localStorage key maps to one row
- **Cross-device sync**: devices share a workspace via 6-char join code
- **Claude proxy**: Edge Function `claude-proxy` reads `ANTHROPIC_API_KEY` from server secret, forwards to Anthropic. Browser never sees the key.

### Svelte app build
```bash
cd app
# Build (node not in PATH in Bash — use direct path on Windows):
"/c/Program Files/nodejs/node.exe" ./node_modules/vite/bin/vite.js build
# Output goes to ../tomorrow/ (configured in vite.config.ts)
```
The `tomorrow/` folder is committed to git so Python's HTTP server can serve it without running `npm run dev`.

### API key flow (after proxy migration)
```
Browser → supabase.co/functions/v1/claude-proxy → api.anthropic.com
         (anon Bearer token)                       (ANTHROPIC_API_KEY secret)
```
All `apiCall()` functions in vanilla tools send to the proxy URL.
`next-day.html` returns `'proxy'` from `apiKey()` so existing UI gates see a truthy value.

---

## Data flows

### Call sheet upload (crew-tracker.html)
1. User clicks upload → `cs-input` hidden file input (positioned off-screen, NOT inside clickable div — prevents double-click)
2. `uhRunExtract()` calls `apiCall()` → claude-proxy → Claude extracts JSON
3. Extracted data saved to `settools_cast` and `settools_pt` (active project)
4. hash `#upload-call-sheet` deep-links here from Resources tab

### Sign-In population (sign-in.html)
`pullFromTracker()` — call sheet IS primary, bible is enrichment only:
1. Read `settools_cast` → today's working cast (additive)
2. Fallback: legacy `st-s` key
3. Fallback: cast bible (`ST_castBible`) — shows warning ("loaded from bible, not call sheet")
4. Enrich: fill missing phone/email from bible and nextday contacts (does NOT add new people)

### DOOD reading (contacts.ts)
Three known storage shapes — reader handles all:
- Shape A: name-keyed dict `{ "Jane Smith": { dept, role, ... } }`
- Shape B: `{ people: [{ name, dept, ... }] }`
- Shape C: `{ rows: [{ name, dept, ... }] }` (crew-tracker native)

### Contact merge (contacts.ts)
Sources (in priority order): cast bible → call sheet → DOOD → nextday contacts
Per-field conflict tracking: for each person+field, record which source provided which value.
Conflicts flagged when 2+ sources disagree after normalization (phones: digits only; emails: lowercase).

### Weather (DailyBriefing.svelte → weather.ts)
1. Extract location from shoot day address using smart extractor:
   - Try full address → Nominatim (handles street addresses)
   - Fall back to city/state portion → Open-Meteo geocoding
   - Minimum 6-char candidate filter
2. Open-Meteo for forecast — CRITICAL: sunrise/sunset are local time strings without TZ suffix. Parse as string (HH:MM), never `new Date()`.

---

## Known issues / pending work

### Cosmetic (non-blocking)
- ~37 svelte-check TypeScript warnings in `app/src` — all from Svelte 5 rune syntax that svelte-check misreads. App compiles and runs correctly. Do NOT add generic type args to runes (`$state<T>()` is INVALID syntax in Svelte 5 — causes runtime error). Use `let x: T = $state(val)` instead.

### Pending features (deferred)
- **Department Status Board** — DA workflow tool, not yet built
- **Realtime subscriptions** — replace 10s polling in sync.ts with Supabase Realtime websockets
- **Offline write queue + Service Worker** — true offline support
- **In-page upload for vanilla tools** — currently hash-deep-links; could be done in-Svelte

### Known workarounds in place
- `worldtimeapi.org` NTP removed from crew-tracker (service dead, caused ERR_CONNECTION_RESET) — now uses system clock only
- Cast bible sample files are gitignored (`*.xlsx`, `*.xls`, `_samples/*.csv`) — they had real PII and were accidentally committed; removed with `git rm --cached`

---

## How to resume a session

Say this to a new Claude session:

> "I'm working on Set Tools, a film production DA dashboard at `C:\dev\set-tools`. Read `CLAUDE.md` first, then `docs/LESSONS.md`. The Svelte app is in `app/`, builds to `tomorrow/`. Everything runs on port 8282. Ask me what we're working on today."

---

## Environment / credentials

All credentials are in environment / Supabase secrets — NOT in code.
- Supabase URL and anon key: hardcoded in `js/sync.js` and `app/src/lib/sync.ts` (anon key is public-safe)
- `ANTHROPIC_API_KEY`: Supabase secret only (`supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`)
- GitHub remote: `https://github.com/edmundpettyproductions-droid/settools.git`

---

## Session log (summary of major phases)

| Phase | What happened |
|---|---|
| 1 | Move out of OneDrive → `C:\dev\set-tools`. Remove leaked token from git remote. Port → 8282. PWA manifest. Backup/Restore panel. |
| 2 | Supabase backend: schema migrations, kv_store, workspace RPCs, claude-proxy Edge Function. `js/sync.js` monkeypatches localStorage for transparent sync. |
| 3 | Svelte 5 app in `app/` → built to `tomorrow/`. 7 tabs. Nominatim geocoder fix. Sunrise/sunset timezone fix. Cross-source conflict detection. Conflict review + PDF export. Notes + Issues with cross-linking. Cast Bible XLSX/PDF extraction. Resources tab with deep-links + in-page upload. |
| 4 | Cast Sign-In fix (call sheet primary, bible enrichment only). Double-click upload fix. Sign-In renamed "Cast Sign-In". DOOD 3-shape reader. |
