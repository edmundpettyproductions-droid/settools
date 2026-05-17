# Set Tools — Development Log

Running log of skills learned, issues encountered, and lessons for future sessions.

---

## Skills & Patterns

### Svelte 5 Runes
- **`$state()`** for all reactive variables — replaces `let` reactive declarations
- **`$derived()`** / **`$derived.by()`** for computed values — replaces `$:` statements
- **`$effect()`** for side effects (subscriptions, DOM sync) — replaces `$:` blocks with side effects
- **`$props()`** for component inputs — replaces `export let`
- Never mix Svelte 4 (`$:`, `export let`) and Svelte 5 runes in the same component

### Data Layer (sync.ts)
- localStorage-first, Supabase `kv_store` mirror with 10-second polling
- `sync.getJSON<T>(key)` to read, `sync.set(key, JSON.stringify(data))` to write
- Subscribe to key changes for cross-tab/cross-device updates
- Each feature module owns one storage key (e.g., `settools_cast`, `settools_bg`)

### Save Pattern
- `onblur={onBlur}` triggers async save to sync.ts
- Subscribe to sync changes for cross-tab updates
- Flash message feedback on save ("Saved!" badge fades after 1.5s)

### Layout Pattern
- Child components: `height: 100%` — parent `.main` handles overflow via CSS Grid
- CSS Grid: `grid-template-columns: 56px 1fr; grid-template-rows: auto 1fr;`
- Sidebar: 56px collapsed, 150px on hover (CSS transition)

### Union / Non-Union Architecture
- `projectSettings.ts` is the single source of truth for union status
- Other modules read settings via `PS.load()` — never store union status locally
- `applyUnionDefaults()` resets timing/threshold values when toggling
- Each feature checks settings: BG tracker (voucher vs badge), time sheets (Exhibit G vs Time Sheet), meal penalties (grace period), OT thresholds

---

## Issues Encountered

### a11y Enforcement (svelte-check)
- **Problem**: Svelte 5 enforces strict a11y rules. Labels must have `for` + `id` pairs. Interactive elements need ARIA roles + keyboard handlers.
- **Fix**: Every `<label>` gets a matching `for="id"` to its control. For non-form elements that look like labels, use `<span>` instead.
- **Lesson**: Plan label/id pairs from the start. Converting after the fact is tedious.

### Form vs Div for Keyboard Handlers
- **Problem**: `<div onkeydown={...}>` triggers a11y warning — non-interactive element with keyboard handler.
- **Fix**: Wrap in `<form onsubmit={handler}>` for Enter-to-submit patterns. Remove standalone `onkeydown` if a cancel button already exists.
- **Lesson**: Use `<form>` with `onsubmit` for any "Enter to add" quick-input patterns.

### Type Narrowing for Optional Values
- **Problem**: `WrapReport | undefined` passed to function expecting `WrapReport` — TypeScript strict mode catches it.
- **Fix**: Extract to a variable, null-check before passing: `const item = arr[idx]; if (item) fn(item);`
- **Lesson**: Always guard optional array access results before passing to typed functions.

### Worktree Merge Conflicts
- **Problem**: Main worktree had stale staged changes from partial merges, causing conflicts when pulling from feature branches.
- **Fix**: `git reset HEAD -- <paths>` to unstage, `git checkout -- <paths>` to restore clean state, then `git checkout <branch> -- <paths>` to pull fresh.
- **Lesson**: Always verify `git status` is clean on the target branch before merging via `checkout --`.

### Build Size at 22 Tabs
- **Problem**: JS bundle exceeded 500KB warning at ~Phase 12.
- **Reality**: 537KB raw / 156KB gzipped — acceptable for a production tool SPA that loads once.
- **Lesson**: Not a blocking issue for an internal tool. Consider code-splitting if it crosses 1MB gzipped.

### Stale Build Artifacts
- **Problem**: Old `tomorrow/assets/index-*.js` files lingering after rebuilds.
- **Fix**: `git rm` old hashed filenames when committing new builds.
- **Lesson**: Vite hashes output filenames — always clean old assets when committing builds.

---

## Lessons for Future Sessions

1. **Read the a11y rules before writing any new component.** Every `<label>` needs `for`/`id`. Every interactive non-button needs a role.
2. **Use `<form onsubmit>` not `<div onkeydown>`.** It's more accessible and Svelte won't warn.
3. **Guard every array index access.** `arr[i]` can be `undefined` even if `i` looks valid — TypeScript strict mode requires the check.
4. **One storage key per feature module.** Don't share keys between features. Makes debugging data issues trivial.
5. **Test union/non-union toggle early.** It affects BG, time sheets, meal penalties, wrap reports — toggling should update all dependent views.
6. **Keep the sidebar icon → label mapping consistent.** Use single Unicode character or emoji per tab. Test that collapsed state (56px) doesn't clip.
7. **Verify build output before committing.** Run `npm run build` and check that `tomorrow/index.html` references the new asset hashes.
8. **Clean feature branches after merge.** Worktrees and branches pile up fast — prune regularly.

---

---

## Session 9 Log — 2026-05-15 (Gap Closure Sprint)

Full historical audit of all 23-tab app features against session 1–8 requests found 10 gaps. All resolved in this session:

### TrackerTab.svelte changes
- `markAllArrived()` — marks all named rows arrived at `T.nowHHMM()`; green "Mark All" button in toolbar
- `allArrived` / `timersCollapsed` — `$derived` auto-collapse: timer panel collapses to "ALL ARRIVED" banner when every named row has arrived; Expand/Collapse toggle
- Inline arrival time edit — `editingArrivalId` / `arrivalEditVal` state + `startArrivalEdit()` / `commitArrivalEdit()` — clicking arrival time opens inline input with `use:focus` action; `T.normTime()` on save

### SignIn.svelte changes
- **Signature canvas**: `sigCanvas`, `sigDrawing`, `sigHasData` state; `sigPointerDown/Move/Up()` with `setPointerCapture`; `sigToDataURL()` returns PNG base64; stored in `SignInRecord.sig`; Clear button disables when canvas empty
- **`confirmSignInWithSig()`** replaces `confirmSignIn()` — captures signature before pushing record
- **Print export**: `printSignInSheet()` → `window.print()`; hidden `.si-print-only` div with full `<table>` of all records + unsigned people; `@media print` shows table, hides everything else; `<img src={r.sig}>` for captured signatures

### Distribution.svelte changes
- **AI email updater**: collapsible panel `aiPanelOpen`; `aiUpdateEmail()` builds Next Day Call context string via `D.generateEmailBody()`, then calls `extract.extractFromText()` with rewrite prompt; result updates `emailBody`; loading/error status display

### NextDayCall.svelte changes
- **PDF import**: `pdfImportOpen` panel with drop zone; `handlePdfImport()` calls `extract.extractFromPdf()` with structured JSON prompt; `parseJsonResponse<ExtractedCallSheet>()` parses result
- **Cross-check**: builds `crossCheck` array comparing extracted `castCalls` vs `data.castCalls` by name; table with ✓/⚠ status; `applyExtracted()` pushes all fields into builder on confirm

### scenes.ts changes
- `estMins: number` added to `SceneRow` (default 0); `normalizeRow()` and `mkScene()` updated
- `ScheduleEntry` interface + `computeRunningSchedule(rows, generalCallHHMM)` — parses HH:MM start, accumulates cursor per scene, returns `{rowId, sceneNum, estStart, estEnd, estMins}[]`

### SceneTracker.svelte changes
- **estMins column**: "Est" header (60px), inline number input on click, `startEstEdit/commitEstEdit` functions
- **Running schedule panel**: "Schedule" button toggles `showSchedule`; `generalCallInput` field auto-populated from NC data; `scheduleEntries = $derived(...)` from `S.computeRunningSchedule()`; chip-style entry display
- **Compare panel**: "Compare" button toggles `showCompare`, loads `ncScenes` from NextCall; `compareRows = $derived.by(...)` matches by sceneNum, computes position in both lists, flags `reordered`, `onlyInNC`, `onlyInTracker`

### Patterns learned / confirmed
- `use:focus` Svelte action (one-liner `function focus(node) { node.focus(); }`) for auto-focus on conditionally rendered inputs
- `HTMLCanvasElement` pointer events + `setPointerCapture()` + `toDataURL()` for signature capture — no library needed
- `@media print` CSS approach for print export is far simpler than pdf-lib for basic sign-in sheets
- `$state<HTMLInputElement | undefined>(undefined)` required for element bindings that trigger svelte-check warnings when declared as plain `let`

---

## Session 10 Log — 2026-05-16 (Forced Call + Turnaround + Meal Times)

Three final gaps from the deep audit were implemented in this session:

### tracker.ts changes
- `mealOut: string` and `mealIn: string` added to `TrackerRow` interface (default `''`)
- `mkRow()` updated: `mealOut: data?.mealOut ?? ''`, `mealIn: data?.mealIn ?? ''`
- `loadTracker()` updated: `mealOut: String(o.mealOut ?? '')`, `mealIn: String(o.mealIn ?? '')`

### prodTimers.ts changes
- `prevDayLastOut: string | null` added to `ProdTimerState` interface (default `null`)
- `DEFAULT_STATE` updated with `prevDayLastOut: null`
- Purpose: tracks previous day's last out time for turnaround violation detection

### timeSheet.ts changes
- Replaced `const forcedCall = false; // TODO` with real turnaround detection:
  ```typescript
  const prevDayLastOutMins = parseHHMM(prodState.prevDayLastOut);
  // Per-entry:
  let forcedCall = false;
  if (settings.turnaroundEnforced && prevDayLastOutMins != null && callMins != null) {
    let gap = callMins - prevDayLastOutMins;
    if (gap < 0) gap += 1440; // crosses midnight
    forcedCall = gap < turnaroundMins;
  }
  ```
- `mealOut: r.mealOut ? fmt12(r.mealOut) : ''` — now uses real per-person meal data
- `mealIn: r.mealIn ? fmt12(r.mealIn) : ''` — now uses real per-person meal data

### TimerDashboard.svelte changes
- Added `import * as PS from '../lib/projectSettings'`
- Added `settings`, `prevDayEditOpen`, `prevDayInput` state
- `openPrevDayEdit()` / `commitPrevDay()` / `cancelPrevDay()` — editable prev day last out
- `computeEarliestCall(lastOut, turnaroundH)` — pure fn computes earliest call tomorrow
- `earliestCallTomorrow = $derived(...)` — reactive result
- `focus(node)` action for auto-focus on the input
- **Turnaround card** added to top strip: shows prev last out (editable on click), "→ X:XX earliest" when set, "{N}h turnaround" hint otherwise
- CSS: `.turnaround-card`, `.prev-day-val`, `.prev-day-input`, `.turnaround-earliest`, `.turnaround-hint`

### TrackerTab.svelte changes
- `editingMealId`, `editingMealField`, `mealEditVal` state for inline meal time editing
- `startMealEdit(rowId, field, currentVal)` / `commitMealEdit()` / `cancelMealEdit()` functions
- `ctxMealOut()` / `ctxMealIn()` — context menu actions using `prompt()`
- Arrival log table now has **M-Out** and **M-In** columns (after Arrived column)
- Each meal cell: clickable inline input (same pattern as arrival time edit), `—` when empty
- Context menu updated: "Set meal out time…" and "Set meal in time…" items added
- CSS: `.arr-time-val.meal-val` — dotted border, text3 color, dim until hovered

### Patterns confirmed
- Single `editingMealId + editingMealField` approach handles two distinct inline edits cleanly (vs. separate state pairs for each field)
- `gap < 0 → gap += 1440` is the correct cross-midnight turnaround gap formula
- Derived `computeEarliestCall` as a pure function + `$derived(fn(...))` is cleaner than `$derived.by` for simple computations with function calls

### next-day.html — renderSchedOut() fixes (also Session 10)
- **Cast grid — Step 2 not loaded**: now derives working cast from `castNums` in scenes; does DOOD lookup (`ND.dood.items` by `item.num`); shows "Call TBD — upload Step 2" instead of empty
- **Cast grid — Step 2 loaded**: unchanged — shows `t.cast[].callTime` from prelim call sheet (correct)
- **`sched-seq-grid`**: added to HTML (below the 2-col grid, before prod-details); populated in JS by filtering scenes-only, sorting by `parseFloat(nums.replace(/[^0-9.]/g,''))`, rendering same `.sched-row` template without `startTime` column (since scene-number order has no est. time)
- Pattern: `parseFloat(String(a.nums||'').replace(/[^0-9.]/g,'')||'0')` handles "23A" (→23), "pt 23" (→23), "41-42" (→41)

---

## Phase Completion Log

| Phase | Feature | Status | Notes |
|-------|---------|--------|-------|
| 1 | Core Layout + Universal Header | Done | L-shaped grid, UH inline in top bar |
| 2 | Cast & Crew Timer tabs | Done | Spreadsheet with call times, countdowns |
| 3 | Sign-In Station | Done | Tap cards, kiosk mode (`?mode=kiosk`) |
| 4 | Scene Tracker | Done | Status progression, page counts in eighths |
| 5 | Production Timers (Dashboard) | Done | Meal penalty countdown, OT tracking |
| 6 | Notes + Issues | Done | Categorized notes, typed issue tracker |
| 7 | Contacts + Next Day Call | Done | Unified directory, call sheet builder |
| 8 | DOOD + Cast Bible | Done | Day Out Of Days grid, talent contact bible |
| 9 | Distribution | Done | Compose email, recipients from contacts |
| 10 | Wrap Report | Done | Auto-generated from all tabs, full export |
| 11 | Communication Log | Done | Email/call/text/radio with flag/resolve |
| 12 | Project Settings | Done | Union/non-union toggle, meal/OT/turnaround config |
| 13 | Walkie Channel Chart | Done | Editable grid + quick-reference cards |
| 14 | Background Tracker | Done | Check-in, vouchers/badges, bumps, wardrobe, batch ops |
| 15 | Time Sheet / Exhibit G | Done | Union/non-union formats, FC/NDB/NDD flags |
| — | Department Status Board | Wired | Tab exists, component placeholder |
| — | Conflict Review | Wired | Tab exists, component placeholder |
| — | Resources (Global Data Viewer) | Wired | Tab exists, component placeholder |

---

## Session 11 Log — 2026-05-16 (Full Audit Bug Fix Sprint)

Full codebase audit identified 20+ bugs across all 22 Svelte components, lib files, and static HTML tools. All fixed in this session.

### timeSheet.ts fixes
- Sort by raw 24h call time (sort source `rows` before loop instead of adding `_sortKey` temp property — cleaner approach)
- Overnight wrap detection: `effectiveWrapMins = wrapMins < inMins ? wrapMins + 1440 : wrapMins`
- `cameraWrap` = last raw `wrapMins` (actual camera down); `lastOut` = last `effectiveWrapMins` (handles overnight)
- `minsToHHMM(m)` helper with `% 1440` to handle overnight modulo
- Removed `uh.date` reference (field doesn't exist on `UHState`) — always use today's date
- `mealOut`/`mealIn` now use real per-person tracker data (from Session 10)

### distro.ts fix
- `buildMailto`: replaced `URLSearchParams` with `encodeURIComponent` directly — `URLSearchParams` encodes spaces as `+` but RFC 6068 mailto: requires `%20`
- Added `bodyCache: string` field to `DistroState` — email body now persists across navigation via `$effect` sync

### wrapReport.ts fix
- Overnight hours: `effectiveWrap = wrapMins < arrMins ? wrapMins + 1440 : wrapMins` before computing `worked`

### scenes.ts fixes
- `normalizeRow()` status validation: `STATUSES.includes(r.status) ? r.status : 'scheduled'` instead of bare cast
- `computeRunningSchedule()` skips `complete` scenes in addition to `omitted` — shows remaining day schedule

### CSS variable fix (`var(--warning)` → `var(--warn)`)
- Fixed in `WrapReport.svelte` (6 occurrences), `CommLog.svelte` (4), `BGTracker.svelte` (3)
- `--warn: #f0a040` is defined in `app.css`; `--warning` was undefined (rendered as no color)

### contacts.ts DOOD reader rewrite
- Old reader expected `{departments: {...}}` format — completely wrong shape
- Actual `settools_dood` format: `{cast: [{id, name, role}], days: [...], grid: {castId: {dayNum: StatusCode}}}`
- New reader: for each cast member, collect day numbers where status is in `DOOD_WORKING_CODES = {W, SW, WF, SWF, T}`
- Department always "Cast" for principal cast DOOD entries

### UniversalHeader.svelte — upload confirmation
- Before processing uploaded call sheet, check existing cast/crew row count
- `window.confirm()` warns: "will replace N cast + M crew, arrival times will be lost"

### TrackerTab.svelte fixes
- Double file picker: removed `position:absolute;inset:0` overlay input; changed to `display:none` + programmatic click only
- `fileInput` type: `$state<HTMLInputElement | undefined>(undefined)` (was plain `let`)

### SignIn.svelte fixes
- Removed dead `confirmSignIn()` function (was replaced by `confirmSignInWithSig()` in Session 9)
- After `confirmSignInWithSig()`, call `sigClear()` to clear canvas for next person's signature

### SceneTracker.svelte fixes
- **Paste confirmation**: shows `confirm()` when `applyPaste()` would replace existing scenes
- **Manual time edit for `firstUp`/`wrapped`**: inline input on click, same pattern as `estMins` edit; normalizes HH:MM 24h input

### TimerDashboard.svelte fix
- Settings reactivity: added `PS.STORAGE_KEY` to sync subscriber — reloads `settings = PS.load()` when project settings change from another tab

### next-day.html fixes
- Model: `claude-sonnet-4-5` → `claude-sonnet-4-6`
- `f.dept` undefined: added `dept: 'Cast'` to all `doodFlags.push()` calls

### crew-tracker.html fixes
- Model: `claude-haiku-4-5-20251001` → `claude-haiku-4-5`
- Port: `localhost:8282` → `localhost:8765`
- `loadDay` append bug: `loadFromExtract(people, forceReplace?)` — `loadDay()` passes `true` to always replace
- Kiosk sync: handles both old array format and new Svelte `{records:[...]}` object format; maps `signedAt`/`signedOutAt` from Svelte SignIn

### sign-in.html fixes
- Storage key: `st-s` → `settools_cast` (Svelte app's actual key)
- `pullFromTracker`: `ct.cast` → `ct.rows` (Svelte TrackerData shape)
- Colspan: `colspan="4"` → `colspan="5"` (table has 5 columns)

### index.html DOOD panel fix
- `dood.rows` → `dood.cast` (actual Svelte DOOD shape)
- "crew members" → "cast members"
- Link: `crew-tracker.html` → `tomorrow/index.html` (DOOD is in Svelte SPA now)

### bgTracker.ts — clarified inverted naming
- `mealIn` (first tap = went out to meal) and `mealOut` (second tap = returned) have misleading names
- Added detailed comments explaining the inversion; behavior is correct/self-consistent, rename avoided to prevent data migration issues

### Patterns learned
- Sorting source data before the loop is cleaner than appending temp sort keys to output objects
- `URLSearchParams.toString()` is wrong for mailto: URIs — always use `encodeURIComponent` for mailto body/subject
- TypeScript `STATUSES.includes(x as SceneStatus)` is the safe narrowing pattern for union string arrays
- `window.confirm()` is fine for data-loss warnings — it blocks, which is exactly what you want before destructive actions
- The `--warning` vs `--warn` CSS variable name divergence was a global bug that silently degraded warning UI across 3 components
