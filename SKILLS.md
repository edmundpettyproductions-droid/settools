# Skills & Technologies Used

## Core Stack

### Frontend
- **Svelte 5** (runes syntax: `$state`, `$derived`, `$effect`, `$props`)
  - Reactive components with zero-boilerplate state management
  - Type-safe prop forwarding via `$props()`
  - Automatic derived state and effects without subscription boilerplate
- **Vite** (modern bundler & dev server)
  - Fast HMR (hot module replacement) on port :5173
  - Custom base path configuration (`/tomorrow/`) for production
  - Automatic TypeScript support
- **TypeScript** (strict mode)
  - Comprehensive type definitions for UI state, data models, sync protocols
  - Generic types for flexible data layers
  - Type narrowing for union types (e.g., tab routes, issue statuses)

### Data & Backend
- **Supabase** (PostgreSQL + Edge Functions)
  - Anonymous auth (device-based, no login required)
  - RLS (Row Level Security) for workspace isolation
  - `kv_store` table as schema-less JSON key-value mirror
  - Realtime subscriptions (Edge Functions for sync notifications)
- **localStorage** (browser-based persistence)
  - Primary data store; Supabase is sync layer only
  - Offline-first architecture
  - 10-second polling pattern for resilience

### External APIs
- **Nominatim** (OpenStreetMap geocoder)
  - Street address lookup (primary strategy)
  - Returns bounding box + display name for weather queries
  - More flexible than Open-Meteo's place-only geocoder
- **Open-Meteo** (weather forecast API)
  - Falls back when Nominatim returns no coordinates
  - Timezone-aware forecast data (but returns times without TZ suffix)
  - Solar times (civil dawn/dusk) calculation
- **Google Maps / Apple Maps** (URL builders for map links)
  - Dynamic link generation based on address or coordinates

## Patterns & Techniques

### Reactive State Management
- **Svelte $state() runes** for mutable reactive state
- **$derived() computed values** (no subscription needed)
- **$effect() side effects** (replaces lifecycle hooks)
- Cross-tab coordination via localStorage `storage` event listener

### Data Layer Architecture
- **sync.ts** — Single source of truth
  - `get()` / `set()` for localStorage + Supabase
  - 10-second polling for background sync
  - Automatic type coercion (JSON parse/stringify)
  - Workspace scoping via `workspace_code`
- **Feature-specific layers** (one `.ts` per feature)
  - `tracker.ts`, `scenes.ts`, `bgTracker.ts`, etc.
  - Encapsulate business logic (meal penalty math, page count eighths, etc.)
  - Consume sync.ts as data source

### Form Handling
- **onblur pattern** — save to sync.ts when field loses focus
- **Debounced saves** for multi-field updates
- **Cross-tab updates** via `window.addEventListener('storage', ...)`

### Geocoding Strategy (Defensive)
1. Try Nominatim first (street addresses)
2. Fall back to Open-Meteo (place/city names only)
3. Allow manual override in UI (stored to `address_override` in kv_store)
4. String-based time parsing (no `new Date()` for locations)
   - Avoids browser timezone misinterpretation
   - Extracts HH:MM directly from ISO strings
   - Displays in location's timezone (via Open-Meteo offset or hardcoded)

### Deep Linking & Navigation
- **Hash-based routing** (#tomorrow, #contacts, etc.)
- **Vanilla HTML integration** (crew-tracker.html links to #dood-upload)
- **Cross-origin navigation** with runtime env detection
  - Vite dev (:5173) → absolute localhost:8282 URLs
  - Production → relative paths

### Conflict Detection & Contact Merging
- **UnifiedContact type** — consolidates across call sheet, cast bible, sign-in
- **ConflictStatus enum** — tracks which sources disagree on phone/email/character
- **Conflict badge** — shows count of unresolved discrepancies
- **Conflict Review tab** — triage UI for field-level mismatches

### Union Awareness
- **Global toggle** in Settings affects:
  - Meal penalty grace period (union: 5 min, non-union: 0 min)
  - Voucher requirements for background performers
  - OT threshold (8 hrs union, no standard non-union)
  - Time sheet format (Exhibit G vs. plain time sheet)

### Responsive Design
- **L-shaped layout** (left sidebar + top bar)
- **Collapsed sidebar** (56px) → expand on hover (150px)
- **CSS Grid** for component height constraints
- **Mobile-friendly** (but optimized for production on set with large screens)

## Known Technical Debt & Edge Cases

### Timezone Handling
- **Problem**: Open-Meteo returns times without timezone suffix (e.g., "08:30" not "08:30+00:00")
- **Solution**: Parse HH:MM as strings, display relative to Open-Meteo's offset or hardcoded location TZ
- **Risk**: Daylight Saving transitions not fully tested

### Address Extraction
- **Problem**: Naive ZIP-anchor strategy produced 2-char queries ("CA") matching wrong locations
- **Solution**: 
  - Require ≥6 characters minimum
  - Try whole string first before ZIP anchor
  - Require ≥2 commas before ZIP strategy
- **Limitation**: Complex addresses (PO boxes, stage names) may still fail

### Cross-Origin Communication
- **Dev environment**: Vite SPA on :5173, vanilla tools on :8282
- **Solution**: Runtime detection of port, emit absolute or relative URLs accordingly
- **Risk**: Hardcoded port assumptions (:5173, :8282) brittle if ports change

### localStorage vs. Supabase
- **Design**: Supabase is sync layer only, not source of truth
- **Risk**: If offline for >30 days without Supabase sync, no merge strategy defined
- **Mitigation**: Backup/restore UI to download/upload JSON snapshots

## Testing & Validation Gaps

- No automated unit tests (hand-tested only)
- No integration tests for cross-tab updates
- Limited testing of union vs. non-union mode edge cases
- No performance testing with large projects (100+ scenes, 500+ cast/crew)
- No stress test for 10-second polling with high data volume

## Future Skills to Develop

- Svelte component library patterns (reusable form controls, modals, etc.)
- Supabase Edge Function routing and rate limiting
- PWA offline mode (Service Worker caching strategy)
- WASM-based PDF extraction (currently Claude API only)
- Real-time sync patterns (WebSocket vs. polling trade-offs)
