# Lessons Learned

## Architecture & Design Decisions

### 1. Offline-First with Supabase as Sync Layer (NOT Source of Truth)

**Decision**
- localStorage is the primary data store
- Supabase `kv_store` is a mirror synced every 10 seconds
- App works fully offline; Supabase is optional sync channel

**Why This Worked**
- ✅ Eliminates dependency on network for core functionality
- ✅ Fast reads/writes from localStorage
- ✅ Single source of truth reduces merge complexity
- ✅ 10-second polling is resilient to transient network hiccups
- ✅ User can shoot all day with zero internet

**Trade-offs**
- ❌ No real-time collaboration (10-second delay)
- ❌ Manual merge strategy needed if offline for >30 days
- ❌ localStorage has 10MB limit (sufficient for current scope)

**Lesson**: For production tools, offline-first + eventual consistency is better than online-only + complex sync protocols. The 10-second polling sweet spot balances responsiveness vs. simplicity.

---

### 2. Svelte 5 Runes (Exclusive Pattern)

**Decision**
- Use ONLY Svelte 5 runes: `$state()`, `$derived()`, `$effect()`, `$props()`
- No `$:` reactive statements
- No `export let` for props

**Why This Worked**
- ✅ Explicit state model (easier to trace)
- ✅ Zero boilerplate for derived/computed values
- ✅ `$effect()` replaces lifecycle hooks (simpler mental model)
- ✅ TypeScript inference works perfectly with `$props()`
- ✅ Smaller compiled output than Svelte 4

**Trade-offs**
- ❌ Svelte 5 still in release candidate (some edge cases not documented)
- ❌ Less Stack Overflow / community examples than Svelte 4
- ❌ Requires explicit understanding of runes reactivity

**Lesson**: Modern framework paradigms (runes, hooks, signals) are worth the learning curve. The explicit state model catches bugs earlier and makes refactoring safer.

---

### 3. L-Shaped Layout (Sidebar + Top Bar)

**Decision**
- Persistent left sidebar (56px collapsed, 150px on hover)
- Top bar (UniversalHeader) with project + workspace context
- Main content area grows to fill remaining space
- CSS Grid for height constraint propagation

**Why This Worked**
- ✅ Efficient use of widescreen real estate (22 tabs fit in narrow sidebar)
- ✅ Sidebar hover expansion doesn't require click
- ✅ UniversalHeader always visible for context switching
- ✅ Touch-friendly sidebar (wide hover target)
- ✅ Easy to toggle full-screen or print individual tabs

**Trade-offs**
- ❌ Mobile experience suboptimal (narrow sidebar awkward on small screens)
- ❌ CSS Grid height calc complex (requires careful parent overflow handling)
- ❌ Hover expansion not touch-friendly (need separate mobile pattern)

**Lesson**: L-shaped layout is ideal for production workstations with large displays. Would reconsider for mobile or consumer apps.

---

### 4. Workspace Scoping Instead of Multi-User

**Decision**
- Each workspace is a separate Supabase project instance (scoped by `workspace_code`)
- No per-user permissioning within a workspace
- Anyone with the workspace code can read/write all data

**Why This Worked**
- ✅ Simplified RLS (just check workspace_code)
- ✅ No need for user identity (anonymous auth sufficient)
- ✅ No permission UI complexity
- ✅ Natural boundary for data isolation (one workspace = one shoot)
- ✅ Easy to add users (just give them workspace code)

**Trade-offs**
- ❌ No field-level permissions (crew can't hide sensitive data)
- ❌ No audit trail (who changed what)
- ❌ No role-based features (director vs. PA different views)

**Lesson**: For on-set production tools, shared workspace model is sufficient. Multi-user permissioning adds complexity that doesn't match the reality of production teams (small, high-trust, same goals).

---

### 5. Hash-Based Deep Linking for Cross-Origin Navigation

**Decision**
- Resources page emits links with hash fragments (#dood-upload, #upload-call-sheet)
- Target tool (crew-tracker.html) reads `location.hash` on load
- If recognized hash, auto-trigger the corresponding file picker

**Why This Worked**
- ✅ Avoids postMessage() complexity (no cross-origin communication)
- ✅ Works with vanilla HTML tools (no framework dependency)
- ✅ One-click upload from Resources page (solved friction)
- ✅ Extensible (add new hashes as needed)
- ✅ Bookmarkable (hash persists in URL)

**Trade-offs**
- ❌ Limited to one-way navigation (target can't reply to origin)
- ❌ Requires manual hash handler in each tool
- ❌ Not SEO-friendly (but not relevant for this app)

**Lesson**: Hash-based routing is underutilized. For simple cross-origin integration, it's more robust than iframe postMessage() or redirect parameters.

---

### 6. Nominatim + Open-Meteo Geocoder Fallback

**Decision**
- Primary: Nominatim (OpenStreetMap) — handles street addresses
- Fallback: Open-Meteo — place/city names only
- User override: Manual address field stored to kv_store

**Why This Worked**
- ✅ Handles real production addresses (not just city names)
- ✅ Free (no API keys, no rate limits for single-user)
- ✅ User override prevents dead ends (geocoder fails → manual entry)
- ✅ Multiple fallbacks = production-grade resilience
- ✅ Decoupled from weather provider (Nominatim doesn't require Open-Meteo)

**Trade-offs**
- ❌ Nominatim slower than Google Maps (but acceptable for production)
- ❌ Open-Meteo place geocoding less accurate than Google (but good enough)
- ❌ Two API calls per address lookup (cache would help)

**Lesson**: Multi-fallback strategy is worth the extra complexity. For critical paths (weather, call times), graceful degradation beats perfect accuracy.

---

## User Feedback Insights

### 1. Production Reality != Expected Workflow

**Feedback**: "DOODs are per-department (Cast, Stunt, Wardrobe, Makeup, Vehicle, etc.), not a single grid"

**Impact**
- Original design missed core production terminology
- Had to revise DOOD description and consolidation logic
- Planned multi-DOOD upload support for future

**Lesson**: Domain experts (ADs in this case) have implicit mental models that aren't obvious to outsiders. Early user testing on core concepts saves rework.

---

### 2. Cross-Origin Navigation is High-Friction

**Feedback**: "I have to navigate to the tool first, then find the upload button"

**Impact**
- Implemented hash-based deep linking for one-click upload
- Reduced 2-step process to 1-step

**Lesson**: Even small friction points add up on set (time-pressed, distracted environment). Invest in streamlining the happy path.

---

### 3. Precision Over Simplicity for Geolocating

**Feedback**: Weather for "CA" showed Central Java, Indonesia instead of California

**Impact**
- Added Nominatim for street-address support
- Added address extraction safeguards (6-char minimum, whole-string-first)
- Added user override field

**Lesson**: For location-critical features, multiple fallbacks and manual override are not optional. A wrong location breaks trust faster than slow geocoding.

---

### 4. Offline Work is Non-Negotiable

**Implicit Feedback**: No mention of network in any request; expectation was complete offline operation

**Impact**
- Validated offline-first architecture choice
- localStorage as primary store was correct call

**Lesson**: Production tools must work without internet. Design for offline first, add sync later.

---

## Code Organization Patterns

### 1. Feature-Specific Data Layers

**Pattern**
- One `.ts` file per feature (tracker.ts, scenes.ts, bgTracker.ts, etc.)
- Each exports functions for read/write/compute
- All consume sync.ts as data source
- Types live in types.ts (centralized)

**Why This Worked**
- ✅ Easy to locate logic for a feature
- ✅ Low coupling (each layer independent)
- ✅ sync.ts stays simple (just localStorage mirroring)
- ✅ Easy to add new features (copy existing layer pattern)
- ✅ Components call feature layers, not sync directly

**Lesson**: Separation of concerns (components ← feature layers ← sync) scales better than monolithic data layer.

---

### 2. Component Naming (CamelCase, Descriptive)

**Pattern**
- CastTimer.svelte, CrewTimer.svelte, DailyBriefing.svelte
- Component name = feature name (not generic Button.svelte)
- One file per component (no splitting)

**Why This Worked**
- ✅ File names match IDE search (find CastTimer = find file)
- ✅ Clear ownership (one component = one feature tab)
- ✅ Easy to navigate App.svelte (22 explicit imports, no surprises)
- ✅ Component-to-feature mapping obvious

**Lesson**: Be explicit. A descriptive name saves more time than a clever generic one.

---

### 3. Types.ts as Source of Truth

**Pattern**
- All interfaces/enums live in types.ts
- Components, data layers, all import from types.ts
- One version of truth for every data structure

**Why This Worked**
- ✅ No duplicate type definitions across files
- ✅ Easy to add fields (update type once, IDEs catch everywhere)
- ✅ Easier to understand data model (read types.ts like a schema)
- ✅ TypeScript inference works perfectly

**Trade-offs**
- ❌ types.ts grows large (500+ lines now)
- ❌ May want to split by domain later (types-cast.ts, types-scenes.ts, etc.)

**Lesson**: Centralized types are fine up to 500 lines. After that, split by domain.

---

## Production Readiness

### 1. What Works Well On Set
- ✅ Offline operation (no internet dependency)
- ✅ Fast UI updates (localStorage instant)
- ✅ Cross-tab sync (open cast + crew timers side-by-side, both update)
- ✅ Backup/restore (users can save snapshots)
- ✅ Manual override fields (for when automation fails)

### 2. What Needs Testing
- ❌ Large projects (100+ scenes, 500+ crew) — untested
- ❌ Extended offline (>7 days) — merge strategy undefined
- ❌ High-traffic Supabase (many devices syncing) — no load test
- ❌ PWA offline mode — Service Worker not implemented
- ❌ Mobile use cases — UI optimized for large screens

### 3. What's Missing for Full Production Use
- ❌ Formal reports (wrap report UI exists but untested)
- ❌ Email distribution integration (UI exists but no SMTP)
- ❌ PDF call sheet extraction (manual upload only, no auto-parsing)
- ❌ Multi-project support (single project per workspace)
- ❌ Permission model (no director/PA/crew role distinction)

---

## Future Architecture Considerations

### 1. Supabase Edge Functions for Smart Sync

**Current**: 10-second polling from client
**Future**: Server-side triggers for immediate sync

**Pros**: Real-time updates, reduced client complexity
**Cons**: Added complexity, requires careful RLS design
**Recommendation**: Wait until production testing reveals polling bottlenecks

---

### 2. Service Worker for Offline-First PWA

**Current**: Works offline but no cached assets
**Future**: Cache-first strategy for `/tomorrow/` + sync on reconnect

**Pros**: True offline capability, instant page load
**Cons**: Cache invalidation complexity, Service Worker debugging
**Recommendation**: Add after first production shoot (gather feedback)

---

### 3. Component Library Extraction

**Current**: All components in app/src/components/
**Future**: Dedicated component library with Storybook

**Pros**: Reusable form controls, modal patterns
**Cons**: Overhead for single-app codebase
**Recommendation**: Only extract if multiple apps share components

---

### 4. Multi-Project Support

**Current**: One project per workspace
**Future**: Multiple projects in one workspace with switching UI

**Pros**: Users can run multiple shows in one account
**Cons**: Data model complexity, merge strategies, storage limits
**Recommendation**: Post-v1 feature (gather user demand first)

---

## Development Velocity Observations

### What Slowed Us Down
- ❌ Timezone bugs (3 sessions to fully debug)
- ❌ Cross-origin navigation confusion (2 sessions)
- ❌ Missing domain knowledge (DOOD terminology, production workflow)
- ❌ No automated tests (manual verification every session)

### What Sped Us Up
- ✅ TypeScript strict mode (caught many bugs early)
- ✅ Svelte 5 runes (less boilerplate, faster iteration)
- ✅ Feature-layer pattern (clear place to add logic)
- ✅ Good documentation (README, types, inline comments)
- ✅ User feedback early (validated core ideas before large refactors)

### Estimated Feature Delivery Timeline
- Core layout + weather: 2 sessions
- Timer + tracking features: 3 sessions
- Export/reports: 2 sessions
- Testing + polish: 3 sessions
- **Total for MVP**: ~10 sessions

---

## Recommendations for Next Session

1. **Test on real shoot data**: Have user run on actual call sheet and DOOD to gather real-world feedback
2. **Address DOOD consolidation UX**: Current spreadsheet view is not intuitive for "who works today" decision
3. **Build cast bible upload pipeline**: Design robust PDF/sheet parsing for talent data
4. **Document deployment process**: Create step-by-step for moving from `npm run dev` to production
5. **Add automated tests**: Even basic unit tests would catch regressions early
6. **Profile with large project**: Load test with 100+ scenes to find bottlenecks
