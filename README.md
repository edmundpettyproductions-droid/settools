# Set Tools — DA Workstation

A comprehensive 2nd AD / 2nd 2nd AD workstation for film and television production. Built as a single-page application with Svelte 5 + Vite + TypeScript, synced across devices via Supabase.

## Overview

22-tab production suite covering the full daily workflow of an Assistant Director, from pre-call through wrap. Designed for a solo operator running one primary workstation and optionally a second device as a sign-in kiosk (`?mode=kiosk`).

## Architecture

- **Frontend**: Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`) + Vite + TypeScript
- **Data Layer**: `sync.ts` — localStorage + Supabase `kv_store` mirror with 10-second polling
- **Backend**: Supabase (Postgres + Edge Functions for Anthropic API proxy)
- **Build Output**: `tomorrow/` directory (served as static files)
- **Layout**: L-shaped — left sidebar (56px collapsed, 150px on hover) + top bar with Universal Header

## Tabs

### Set Day (8 tabs)
| Tab | Description | Storage Key |
|-----|-------------|-------------|
| **Tomorrow** | Daily briefing — weather, call times, scene schedule, alerts | `settools_uh`, `ST_nextday` |
| **Cast** | Cast timer — spreadsheet with call times, countdowns, arrival tracking | `settools_cast` |
| **Crew** | Crew timer — same as cast but for crew/departments | `settools_crew` |
| **Sign-In** | Touchscreen sign-in station — tap cards to confirm arrival | `ST_signin` |
| **Scenes** | Scene tracker — status progression (scheduled → rehearsing → shooting → complete), page counts in eighths, setups | `settools_scenes` |
| **BG** | Background/extras tracker — check-in, vouchers (union) or badges, wardrobe changes, bump categories, batch meal/wrap | `settools_bg` |
| **Timers** | Timer dashboard — meal penalty countdown (grace/penalty states), OT threshold tracking per person, arrival board | `settools_prod_timers` |
| **Next Day** | Next Day Call sheet builder — scenes, cast calls, crew calls, preview + clipboard | `settools_nextcall` |

### Coordination (5 tabs)
| Tab | Description | Storage Key |
|-----|-------------|-------------|
| **Depts** | Department status board — at-a-glance where every dept stands | `settools_dept_status` |
| **Contacts** | Unified contact directory — merged from cast bible, call sheets, sign-in | `settools_contacts` |
| **Distro** | Distribution — compose email with recipients from contacts, copy/mailto | `settools_distro` |
| **Walkie** | Walkie channel chart — editable dept → channel grid + quick-reference cards | `settools_walkie` |
| **Conflicts** | Conflict review — cross-source data discrepancy triage | `settools_conflict_status` |

### Records (8 tabs)
| Tab | Description | Storage Key |
|-----|-------------|-------------|
| **Notes** | Quick notes — categorized (director, continuity, production, general), pinnable | `settools_notes` |
| **Issues** | Issue tracker — typed (talent late, equipment, safety, etc.), status workflow | `settools_issues` |
| **DOOD** | Day Out Of Days — cast member × shoot day grid with status codes (W, SW, H, etc.) | `settools_dood` |
| **Wrap** | Day Wrap Report — auto-generated from all tabs, scenes/cast/crew/OT/issues/comms | `settools_wrap_report` |
| **Times** | Time Sheet / Exhibit G — formal cast time report, union-aware (FC, NDB, NDD flags) | `settools_time_sheets` |
| **Comms** | Communication log — email/call/text/radio tracking with flag/resolve | `settools_comm_log` |
| **Bible** | Cast bible — talent contact info, agency/manager, dietary, rates | `settools_cast_bible` |
| **Resources** | Global resources — data viewer/editor for all storage keys | Various |

### Settings
| Tab | Description | Storage Key |
|-----|-------------|-------------|
| **Settings** | Project config — union/non-union toggle, meal penalty timing, OT thresholds, turnaround hours, BG bump categories, time sheet label | `settools_project_settings` |

## Key Features

- **Union / Non-Union aware**: Global toggle in Settings affects meal penalties, grace periods, OT thresholds, BG voucher requirements, time sheet format (Exhibit G vs. Time Sheet)
- **Kiosk mode**: Append `?mode=kiosk` to URL for a full-viewport sign-in station on a second device
- **Cross-device sync**: All data syncs via Supabase `kv_store` with 10-second polling
- **Offline-first**: Everything works from localStorage; Supabase is the sync layer, not a dependency
- **PDF/call sheet extraction**: Upload call sheets and use Claude API to extract cast/crew data
- **Clipboard export**: Every report (wrap, time sheet, comm log, call sheet) has copy-to-clipboard

## Quick Start

```bash
# Install dependencies
cd app && npm install

# Development
npm run dev

# Production build (outputs to ../tomorrow/)
npm run build

# Type check
npx svelte-check --tsconfig ./tsconfig.json
```

## File Structure

```
Set Tools/
├── app/                          # Svelte 5 SPA source
│   ├── src/
│   │   ├── App.svelte            # Root — L-shaped layout, routing, kiosk mode
│   │   ├── components/           # 22 tab components + UniversalHeader
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
│   │       └── types.ts          # Shared types
│   ├── vite.config.ts
│   └── tsconfig.json
├── tomorrow/                     # Built SPA (served statically)
├── backend/                      # Supabase config + Edge Functions
├── *.html                        # Legacy vanilla tools (being phased out)
└── README.md                     # This file
```

## Development Notes

- **Svelte 5 runes only** — no `$:` reactive statements, no `export let`. Use `$state()`, `$derived()`, `$effect()`, `$props()`
- **a11y strict** — svelte-check enforces all a11y rules. Labels need `for` + `id`, interactive elements need roles + keyboard handlers
- **Height pattern** — child components use `height: 100%`, parent `.main` handles overflow via CSS Grid
- **Save pattern** — `onblur={onBlur}` triggers async save to sync.ts; subscribe to sync changes for cross-tab updates
