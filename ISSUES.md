# Issues & Bugs — Resolved & Known

## Resolved Issues

### 1. Timezone Misinterpretation in Solar Times (CRITICAL - FIXED)

**Problem**
- Open-Meteo API returns sunrise/sunset times without timezone suffix (e.g., "08:30" instead of "08:30+00:00")
- JavaScript `new Date("08:30")` interprets the time in browser's LOCAL timezone, not location's timezone
- Result: Off by 1-3 hours depending on user's location
- Example: Location weather for LA returns 08:30 sunset, but browser in EST interprets as 08:30 EST, then displays as 04:30 PT (wrong)

**Root Cause**
- Open-Meteo provides times as bare HH:MM strings without TZ information
- Date constructor defaults to browser timezone when no offset specified

**Solution**
- **Eliminated Date objects** for solar time parsing entirely
- String-based extraction: `.split(':')[0]` for hour, `.split(':')[1]` for minute
- Display timezone-aware using Open-Meteo's offset (e.g., "+02:00" for Berlin in summer)
- No Date arithmetic, no timezone inference

**Status**: ✅ FIXED (session 3+)
**Files Modified**: `app/src/lib/weather.ts` (deprecated all time parsing via Date constructor)
**Testing**: Manual verification on multiple timezones (CA, GMT, CET)

---

### 2. Address Extractor Matching Wrong Locations (CRITICAL - FIXED)

**Problem**
- Address string "9419 Mason Ave Unit G, Chatsworth, CA 91311" when fed to geocoder
- Initial strategy tried "CA" (ZIP-anchor fallback) as a standalone query
- "CA" matched Central Java, Indonesia instead of California
- Result: Weather, sunrise/sunset, maps all pointed to wrong location

**Root Cause**
- ZIP-anchor strategy designed to extract location from postal code
- Applied to 2-character state abbreviations without length check
- Open-Meteo and Nominatim both have place-name matching that will match a 2-letter abbreviation to a real place (Central Java = "CA")

**Solution**
1. **Length minimum**: Drop candidates < 6 characters
2. **Ordering**: Try whole-string first (full address), only after failure try ZIP-anchor
3. **Comma threshold**: Require ≥2 commas before ZIP-anchor applies (ensures address structure)
4. **API hierarchy**: Nominatim first (handles streets), Open-Meteo second (place-names only)

**Status**: ✅ FIXED (session 3+)
**Files Modified**: `app/src/lib/weather.ts` (address extraction logic)
**Testing**: Verified with "9419 Mason Ave Unit G, Chatsworth, CA 91311" → correct coordinates

---

### 3. Open-Meteo Geocoder Cannot Handle Street Addresses (MEDIUM - FIXED)

**Problem**
- Open-Meteo Geocoding API designed for place/city names, not street addresses
- Query "9419 Mason Ave Unit G, Chatsworth, CA 91311" returns empty results
- No fallback meant weather lookup failed silently

**Root Cause**
- Open-Meteo API documentation states it's for "administrative places" and "city/town names"
- Street-level geocoding requires different API (Nominatim, Google Maps, etc.)

**Solution**
- **Added Nominatim (OpenStreetMap) as primary geocoder**
- Nominatim handles street addresses natively
- If Nominatim returns empty, fall back to Open-Meteo for place-name queries
- Both return `{lat, lon, display_name}` compatible format

**Status**: ✅ FIXED (session 3+)
**Files Modified**: `app/src/lib/weather.ts` (added Nominatim lookup, restructured fallback chain)
**Testing**: Street, city, and place name queries all verified

---

### 4. Cross-Origin Navigation Failed from Svelte App to Vanilla Tools (HIGH - FIXED)

**Problem**
- Svelte app running on localhost:5173
- Links to vanilla tools (crew-tracker.html, next-day.html) on localhost:8282
- Relative links didn't work: `/crew-tracker.html` resolved to `http://localhost:5173/crew-tracker.html` (wrong origin)
- "Open in tool" buttons from Resources page were silent no-ops

**Root Cause**
- Vite dev server on :5173 intercepts all relative navigation
- Vanilla tools on :8282 are unreachable from same-origin context
- No detection of development vs. production environment

**Solution**
- **Runtime environment detection**:
  - Check if `window.location.port === '5173'` (Vite dev mode)
  - If dev: emit absolute URLs `http://localhost:8282/crew-tracker.html`
  - If production: emit relative paths `/tomorrow/...` (build output location)
- **Implemented in components**:
  - `GlobalResources.svelte` "Open in tool" links
  - `DailyBriefing.svelte` DOOD/scenes links

**Status**: ✅ FIXED (session 3+)
**Files Modified**: `app/src/components/GlobalResources.svelte`, `app/src/components/DailyBriefing.svelte`
**Testing**: Verified links work both in dev (:5173) and production (`/tomorrow/`)

---

### 5. Upload Buttons Didn't Trigger File Pickers (HIGH - FIXED)

**Problem**
- Resources page had "Upload DOOD" button that appeared to do nothing
- Clicking "Open in tool" and then manually finding upload button on crew-tracker was friction
- User expected one-click direct upload

**Root Cause**
- Navigation alone didn't trigger UI actions (file picker clicks)
- No two-way messaging between Svelte app (:5173) and vanilla tool (:8282)
- Cross-origin restriction prevented postMessage() communication

**Solution**
- **Hash-based deep linking**:
  - Resources page emits links like `http://localhost:8282/crew-tracker.html#dood-upload`
  - crew-tracker.html route handler checks `location.hash` on page load
  - If `#dood-upload`, simulates `document.getElementById('file-input-dood').click()`
- **Implemented hash routes**:
  - `#dood-upload` → opens DOOD file picker
  - `#upload-call-sheet` → opens call sheet file picker
  - Other tools can extend as needed

**Status**: ✅ FIXED (session 4)
**Files Modified**: `crew-tracker.html` (added hash route handler), `app/src/components/GlobalResources.svelte` (updated links to use hash)
**Testing**: Verified one-click upload from Resources page

---

### 6. DOOD Consolidation Logic & Description (MEDIUM - FIXED)

**Problem**
- Original description: "Day Out Of Days — cast member × shoot day grid with status codes"
- Implied single-department view
- User feedback: DOODs are **per-department** (Cast DOOD, Stunt DOOD, Wardrobe DOOD, Makeup DOOD, Vehicle DOOD, etc.)
- User expected tool to consolidate multiple department DOODs into unified daily view

**Root Cause**
- Misunderstanding of production terminology
- Original design treated DOOD as monolithic grid
- Didn't account for multi-department tracking reality

**Solution**
- **Updated DOOD description** in README and components:
  - "Day Out Of Days — per-department: consolidates Cast, Stunt, Wardrobe, Makeup, Vehicle, etc. DOODs into daily 'who works where' view"
- **GlobalResources.svelte DOOD summary** now shows example: "Cast DOOD (22 crew), Stunt DOOD (5 crew), Wardrobe DOOD (3 crew)"
- **Planned multi-upload support** for future sessions (allow importing multiple DOODs in single upload flow)

**Status**: ✅ PARTIALLY FIXED (description updated, multi-upload TBD)
**Files Modified**: `README.md`, `app/src/components/GlobalResources.svelte`
**Testing**: Description verified with user

---

## Known Issues (Unfixed)

### 1. DOOD Consolidation UI Not Intuitive (MEDIUM)

**Description**
- Current DOOD view in crew-tracker.html is a simple spreadsheet
- Doesn't clearly show which department each DOOD represents
- Doesn't streamline the "who works today across all departments" decision

**Severity**: MEDIUM (impacts production decision-making)
**Impact**: User must manually cross-reference DOODs instead of seeing one consolidated view
**Workaround**: Open each DOOD file separately and mentally consolidate

**Proposed Fix**: Redesign DOOD tab to show department-wise breakdown with color coding + "who's on set today" summary
**Effort**: Medium (2-3 sessions)

---

### 2. localStorage vs. Supabase Merge Strategy Undefined (LOW)

**Description**
- If user is offline for >30 days without Supabase sync, local changes and remote changes may diverge
- No merge strategy defined (last-write-wins vs. conflict detection)

**Severity**: LOW (unlikely in practice for single-user app)
**Impact**: Potential data loss in extended offline scenarios
**Workaround**: Download backup before each shoot day (UI exists)

**Proposed Fix**: Implement merge strategy (likely last-write-wins with conflict log) and document in sync.ts
**Effort**: Low (1 session)

---

### 3. No Automated Tests (MEDIUM)

**Description**
- Zero unit tests or integration tests
- All testing is manual
- No CI/CD pipeline

**Severity**: MEDIUM (risks regression on major refactors)
**Impact**: New features could break existing functionality without detection
**Workaround**: Manual testing on every session

**Proposed Fix**: Add Jest/Vitest unit tests for sync.ts, tracker.ts, and weather.ts; add Playwright e2e tests
**Effort**: High (4-5 sessions)

---

### 4. Performance Testing Not Done (LOW)

**Description**
- Unknown behavior with large projects (100+ scenes, 500+ cast/crew)
- 10-second polling may become a bottleneck at scale
- No load testing on Supabase

**Severity**: LOW (within scope of initial feature set)
**Impact**: Degraded UX at high data volume
**Workaround**: None; users should keep project data lean for now

**Proposed Fix**: Load test with 1000-scene project, profile polling lag, optimize if needed
**Effort**: Low-Medium (2-3 sessions)

---

### 5. Address Override Not Discoverable (LOW)

**Description**
- DailyBriefing.svelte has manual address override field (small text input)
- Users may not realize they can override the auto-geocoded address

**Severity**: LOW (power-user feature)
**Impact**: Confusion if auto-geocode picks wrong location
**Workaround**: Click gear icon in DailyBriefing to reveal override field

**Proposed Fix**: Better labeling, tooltip, or help text explaining address override
**Effort**: Low (1 session)

---

### 6. Cross-Tab Updates Rely on localStorage Events (LOW)

**Description**
- If user has two browser tabs open and edits same field in both simultaneously
- localStorage event fires but timing of saves may cause races
- Last write wins, but sequence is not guaranteed

**Severity**: LOW (user error if editing same field in two tabs)
**Impact**: Potential data loss if user manually creates race condition
**Workaround**: Don't edit same field in two tabs simultaneously

**Proposed Fix**: Add edit lock (temporary) or conflict detection on sync
**Effort**: Medium (2 sessions)

---

### 7. PWA Offline Mode Not Implemented (LOW)

**Description**
- App works with localStorage when offline, but Service Worker not registered
- No cache-first strategy for assets
- Page refresh while offline may fail to load JS/CSS

**Severity**: LOW (offline work still possible with page already loaded)
**Impact**: Poor experience if page is refreshed while offline
**Workaround**: Avoid refresh while offline

**Proposed Fix**: Register Service Worker, implement cache-first strategy for `/tomorrow/` assets
**Effort**: Medium (2 sessions)

---

## Session-by-Session Issue Log

### Session 1-2
- Initial architecture discussions, no blocking issues identified

### Session 3
- **CRITICAL**: Timezone misinterpretation in solar times (FIXED)
- **CRITICAL**: Address extractor matching Central Java instead of California (FIXED)
- **MEDIUM**: Open-Meteo can't handle street addresses (FIXED)
- **HIGH**: Cross-origin links not working from Svelte to vanilla tools (FIXED)

### Session 4
- **HIGH**: Upload buttons didn't trigger file pickers (FIXED via hash-based deep linking)
- **MEDIUM**: DOOD description incorrect / missing multi-department concept (FIXED)

### Session 5+ (Current)
- No new blocking issues identified
- Documentation pass to enable future session continuity
