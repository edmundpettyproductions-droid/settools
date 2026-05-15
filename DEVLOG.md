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
