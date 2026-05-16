# Set Tools — Project Context for Claude

> This file is auto-loaded at the start of every Claude Code session.
> Keep it current. When something important is discovered, add it here.
> Last updated: 2026-05-15 (Session 8 — 23-tab build, Sides ported, scene reorder added)

---

## What This Project Is

**Set Tools** is a 23-tab 2nd AD / 2nd 2nd AD workstation for film and television production.
Built as a single-page application with Svelte 5 + Vite + TypeScript, synced across devices via Supabase.

It lives at `C:\Users\edmun\OneDrive\Desktop\Set Tools\`.
Owner: **Edmund Petty** — freelance UPM / 2nd AD / PA (Fresh Water Productions LLC).

Productions are typically 10-30 day shoots, indie / low-budget. Operator works **primarily non-union**
but union (SAG-AFTRA) components are available since they're often used on non-union sets.

The app runs on a **production laptop (DP machine)** and a **kiosk tablet** via `?mode=kiosk`.

---

## How to Run

```bash
# Development (from the app/ directory in the main project root OR any worktree)
cd app && npm run dev

# Production build (outputs to ../tomorrow/)
npm run build

# Type check (should pass with 0 errors, 0 warnings)
npm run check

# Format all files
npm run format

# Run unit tests
npm run test
```

The built app is served as static files from the `tomorrow/` directory.
The Python server at `:8282` (or `start-server.bat` at `:8765`) serves the old static HTML tools.
For Svelte development, always use `npm run dev`.

---

## Tech Stack

| Layer | What |
|-------|------|
| Frontend | **Svelte 5** with runes (`$state`, `$derived`, `$effect`, `$props`) + TypeScript |
| Build | **Vite** + vite-plugin-pwa (offline service worker) |
| Backend | **Supabase** (Postgres + Edge Functions for Anthropic API proxy) |
| Data sync | `sync.ts` — localStorage + Supabase `kv_store` mirror, 10-second polling |
| PDF reading | **pdf.js** loaded from CDN at runtime |
| PDF writing | **pdf-lib** loaded from CDN at runtime |
| AI | **Anthropic Claude API** via Supabase Edge Function proxy (`claude-proxy`) |
| Testing | **Vitest** for unit tests |
| Formatting | **Prettier** + prettier-plugin-svelte |

Supabase project: `qywzcaghcyueegxnkhjj.supabase.co`

---

## App Layout

**L-shaped layout**: Left sidebar (56px collapsed, 150px on hover) + top bar with Universal Header.
CSS Grid: `grid-template-columns: 56px 1fr; grid-template-rows: auto 1fr;`

---

## All 22 Tabs

### Set Day (8 tabs)
| Tab | Component | Storage Key | Description |
|-----|-----------|-------------|-------------|
| Tomorrow | `DailyBriefing.svelte` | `settools_uh`, `ST_nextday` | Weather, call times, scene schedule, alerts |
| Cast | `TrackerTab.svelte` | `settools_cast` | Cast timer — call times, countdowns, arrivals |
| Crew | `TrackerTab.svelte` | `settools_crew` | Crew timer — same as cast for crew |
| Sign-In | `SignIn.svelte` | `ST_signin` | Touchscreen tap cards. Kiosk mode: `?mode=kiosk` |
| Scenes | `SceneTracker.svelte` | `settools_scenes` | Status progression, page counts in eighths, setups |
| BG | `BGTracker.svelte` | `settools_bg` | Background/extras — check-in, vouchers, bumps, wardrobe, batch ops |
| Timers | `TimerDashboard.svelte` | `settools_prod_timers` | Meal penalty countdown, OT tracking, arrival board |
| Next Day | `NextDayCall.svelte` | `settools_nextcall` | Call sheet builder — scenes, cast calls, crew calls |
| Sides | `Sides.svelte` | `settools_sides` (IndexedDB: `set-tools-sides`) | Script PDF annotation — target scenes circled, non-target crossed out; 3 output PDFs; cast cross-check |

### Coordination (5 tabs)
| Tab | Component | Storage Key | Description |
|-----|-----------|-------------|-------------|
| Depts | `DeptStatus.svelte` | `settools_dept_status` | Department status board |
| Contacts | `Contacts.svelte` | `settools_contacts` | Unified contact directory |
| Distro | `Distribution.svelte` | `settools_distro` | Email distribution — compose, recipients, mailto |
| Walkie | `WalkieChart.svelte` | `settools_walkie` | Walkie channel chart — editable grid + quick-reference |
| Conflicts | `ConflictReview.svelte` | `settools_conflict_status` | Cross-source data discrepancy triage |

### Records (8 tabs)
| Tab | Component | Storage Key | Description |
|-----|-----------|-------------|-------------|
| Notes | `Notes.svelte` | `settools_notes` | Categorized notes, pinnable |
| Issues | `Issues.svelte` | `settools_issues` | Typed issue tracker with status workflow |
| DOOD | `DOODViewer.svelte` | `settools_dood` | Day Out Of Days — cast x shoot day grid |
| Wrap | `WrapReport.svelte` | `settools_wrap_report` | Auto-generated wrap report from all tabs |
| Times | `TimeSheet.svelte` | `settools_time_sheets` | Exhibit G (union) / Time Sheet (non-union) |
| Comms | `CommLog.svelte` | `settools_comm_log` | Communication log — email/call/text/radio tracking |
| Bible | `CastBible.svelte` | `settools_cast_bible` | Talent contact info, agency, rates |
| Resources | `GlobalResources.svelte` | Various | Global data viewer/editor for all storage keys |

### Settings
| Tab | Component | Storage Key | Description |
|-----|-----------|-------------|-------------|
| Settings | `ProjectSettings.svelte` | `settools_project_settings` | Union/non-union toggle, meal penalties, OT, turnaround, BG bumps |

---

## Union / Non-Union System

`projectSettings.ts` is the single source of truth. Other modules read via `PS.load()`.

- **Union defaults**: 6h meal, 6min grace, OT thresholds [8,10,12,14], 10h turnaround enforced, SAG vouchers, "Exhibit G"
- **Non-union defaults**: 6h meal, 0 grace, OT thresholds [8,10,12], 10h turnaround not enforced, simple check-in, "Time Sheet"
- Toggling union/non-union resets timing defaults but allows custom overrides
- Affects: BG Tracker (voucher vs badge), Time Sheets (Exhibit G vs Time Sheet), meal penalties, OT thresholds, wrap reports

---

## Svelte 5 Runes — Rules

- State: `let x = $state(value)` — NOT `let x = writable(value)` or `export let`
- Derived: `let y = $derived(expr)` or `$derived.by(() => expr)` — NOT `$: y = expr`
- Effects: `$effect(() => { ... })` — NOT `$: { ... }` blocks
- Props: `let { foo } = $props()` — NOT `export let foo`
- Do NOT import from `svelte/store` — use runes only
- a11y strict: every `<label>` needs `for`+`id`, interactive elements need ARIA roles + keyboard handlers
- Save pattern: `onblur={onBlur}` triggers async save; subscribe to sync changes for cross-tab updates
- Height pattern: child components use `height: 100%`, parent `.main` handles overflow via CSS Grid

---

## Supabase Sync Pattern

```typescript
// Read shared state
sync.getJSON<MyType>('my_key')

// Write shared state
await sync.set('my_key', JSON.stringify(value))

// Subscribe to remote changes
sync.subscribe((keys) => { if (keys.includes('my_key')) reload(); })
```

Workspace code is a 6-char alphanumeric. Devices join with this code to share state.

---

## AI Extraction Pattern

```typescript
import { extractFromPdf } from '../lib/extract';

const raw = await extractFromPdf(pdfBase64, promptString, {
  system: 'Return ONLY raw JSON, no markdown.',
  maxTokens: 4000,
});
// raw is a string — parse it (see parseJsonResponse() in extract.ts)
```

> Large PDFs (90+ pages as base64) can be slow or hit Supabase body size limits.

---

## Folder Structure

```
Set Tools/
├── app/                          # Svelte 5 SPA source
│   ├── src/
│   │   ├── App.svelte            # Root — L-shaped layout, routing, kiosk mode
│   │   ├── components/           # 22 tab components + UniversalHeader
│   │   │   ├── BGTracker.svelte
│   │   │   ├── CastBible.svelte
│   │   │   ├── CommLog.svelte
│   │   │   ├── ConflictReview.svelte
│   │   │   ├── Contacts.svelte
│   │   │   ├── DailyBriefing.svelte
│   │   │   ├── DeptStatus.svelte
│   │   │   ├── Distribution.svelte
│   │   │   ├── DOODViewer.svelte
│   │   │   ├── GlobalResources.svelte
│   │   │   ├── Issues.svelte
│   │   │   ├── NextDayCall.svelte
│   │   │   ├── Notes.svelte
│   │   │   ├── ProjectSettings.svelte
│   │   │   ├── SceneTracker.svelte
│   │   │   ├── SignIn.svelte
│   │   │   ├── TimerDashboard.svelte
│   │   │   ├── TimeSheet.svelte
│   │   │   ├── TrackerTab.svelte
│   │   │   ├── UniversalHeader.svelte
│   │   │   ├── WalkieChart.svelte
│   │   │   └── WrapReport.svelte
│   │   └── lib/                  # Data layer — one .ts per feature
│   │       ├── sync.ts           # localStorage + Supabase sync engine
│   │       ├── nav.ts            # Tab type union + navigation bus
│   │       ├── projectSettings.ts # Union/non-union + timing defaults
│   │       ├── tracker.ts        # Cast/crew timer data layer
│   │       ├── scenes.ts         # Scene tracker + page count math
│   │       ├── prodTimers.ts     # Meal penalty + OT calculations
│   │       ├── bgTracker.ts      # Background performer tracking
│   │       ├── timeSheet.ts      # Exhibit G / time sheet generator
│   │       ├── wrapReport.ts     # Day wrap report generator
│   │       ├── distro.ts         # Email distribution
│   │       ├── commLog.ts        # Communication log
│   │       ├── nextCall.ts       # Next Day Call builder
│   │       ├── dood.ts           # Day Out Of Days
│   │       ├── walkieChannels.ts # Walkie channel directory
│   │       ├── contacts.ts       # Unified contacts
│   │       ├── issues.ts         # Issue tracker
│   │       ├── notes.ts          # Quick notes
│   │       └── types.ts          # Shared types
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── tomorrow/                     # Built SPA (served statically)
├── backend/                      # Supabase config + Edge Functions
├── *.html                        # Legacy vanilla tools (being phased out)
├── CLAUDE.md                     # This file
├── README.md                     # Project documentation
└── DEVLOG.md                     # Skills, issues, lessons log
```

---

## Key Memory Files

| File | Contents |
|------|----------|
| `CLAUDE.md` | This file (auto-loaded every session) |
| `README.md` | Full project documentation |
| `DEVLOG.md` | Skills, issues encountered, lessons, phase completion log |
| `.claude/projects/.../memory/MEMORY.md` | Cross-project memory index |
| `.claude/projects/.../memory/sides_v2.md` | Sides v2 architecture deep-dive |
| `.claude/projects/.../memory/settools_lessons.md` | Historical session lessons |
