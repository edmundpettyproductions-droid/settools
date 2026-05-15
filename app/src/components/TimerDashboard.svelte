<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as PT from '../lib/prodTimers';
  import * as T from '../lib/tracker';

  // ─── State ──────────────────────────────────────────────────────────
  let timerState = $state<PT.ProdTimerState>({ ...PT.DEFAULT_STATE });
  let mealInfo = $state<PT.MealTimerInfo>(PT.computeMeal(PT.DEFAULT_STATE));
  let elapsed = $state('—');
  let otList = $state<PT.PersonOT[]>([]);
  let arrivalGroups = $state<PT.ArrivalGroup[]>([]);
  let tickInterval: number | undefined;

  // Derived
  let totalPeople = $derived(arrivalGroups.reduce((s, g) => s + g.totalCount, 0));
  let totalArrived = $derived(arrivalGroups.reduce((s, g) => s + g.arrivedCount, 0));
  let otWarnings = $derived(otList.filter((p) => !p.isWrapped && p.currentThreshold));

  // ─── Load / Tick ───────────────────────────────────────────────────
  function load() {
    timerState = PT.loadState();
    // Auto-pull first shot from UH if not set
    if (!timerState.firstShot) {
      timerState.firstShot = PT.firstShotFromUH();
    }
    refresh();
  }

  function refresh() {
    const now = new Date();
    mealInfo = PT.computeMeal(timerState, now);
    elapsed = PT.productionElapsed(timerState, now);
    otList = PT.computeOT(now);
    arrivalGroups = PT.buildArrivalBoard();
  }

  onMount(() => {
    load();
    tickInterval = window.setInterval(refresh, 1000);
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(PT.STORAGE_KEY) ||
          keys.includes('settools_cast') ||
          keys.includes('settools_crew') ||
          keys.includes('settools_uh')) {
        load();
      }
    });
    return () => {
      if (tickInterval) clearInterval(tickInterval);
      unsub();
    };
  });

  // ─── Actions ───────────────────────────────────────────────────────
  async function setFirstShot() {
    timerState.firstShot = PT.stampNow();
    timerState.mealCalled = false;
    timerState.lastMeal = null;
    await PT.saveState(timerState);
    refresh();
  }

  async function callMeal() {
    timerState.lastMeal = PT.stampNow();
    timerState.mealCalled = true;
    await PT.saveState(timerState);
    refresh();
  }

  async function resetMeal() {
    // Start new meal period from now (e.g. after lunch, tracking second meal)
    timerState.lastMeal = PT.stampNow();
    timerState.mealCalled = false;
    await PT.saveState(timerState);
    refresh();
  }

  async function resetAll() {
    timerState = { ...PT.DEFAULT_STATE };
    await PT.saveState(timerState);
    refresh();
  }

  // ─── View toggle ───────────────────────────────────────────────────
  let view = $state<'timers' | 'board'>('timers');

  // ─── OT formatting ────────────────────────────────────────────────
  function fmtHours(h: number): string {
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  }

  function fmtCountdown(ms: number): string {
    if (ms <= 0) return 'now';
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  }
</script>

<div class="dash">
  <!-- TOP STRIP: Production Clock + Meal Timer -->
  <div class="top-strip">
    <div class="clock-card">
      <div class="clock-label">Production Elapsed</div>
      <div class="clock-value">{elapsed}</div>
      {#if timerState.firstShot}
        <div class="clock-sub">First shot {T.fmt12(timerState.firstShot)}</div>
      {:else}
        <button class="stamp-btn" onclick={setFirstShot}>Stamp First Shot</button>
      {/if}
    </div>

    <div class="meal-card" class:counting={mealInfo.status === 'counting'} class:grace={mealInfo.status === 'grace'} class:penalty={mealInfo.status === 'penalty'} class:called={mealInfo.status === 'called'}>
      <div class="meal-label">Meal Timer</div>
      <div class="meal-value">{mealInfo.display}</div>
      {#if mealInfo.status === 'counting' || mealInfo.status === 'grace' || mealInfo.status === 'penalty'}
        <button class="meal-btn" onclick={callMeal}>Call Meal</button>
      {:else if mealInfo.status === 'called'}
        <button class="meal-btn" onclick={resetMeal}>Start Next Period</button>
      {:else}
        <div class="meal-sub">Set first shot to start</div>
      {/if}
    </div>

    <div class="stat-card">
      <div class="stat-label">Arrivals</div>
      <div class="stat-value">{totalArrived}<span class="stat-of">/{totalPeople}</span></div>
      <div class="stat-bar">
        <div class="stat-fill" style:width="{totalPeople > 0 ? Math.round((totalArrived / totalPeople) * 100) : 0}%"></div>
      </div>
    </div>

    {#if otWarnings.length > 0}
      <div class="stat-card warn">
        <div class="stat-label">OT Alerts</div>
        <div class="stat-value">{otWarnings.length}</div>
        <div class="stat-sub">
          {#if otWarnings[0]}
            {otWarnings[0].name} — {fmtHours(otWarnings[0].hoursWorked)}
          {/if}
        </div>
      </div>
    {/if}

    <div class="strip-actions">
      <button class="view-btn" class:active={view === 'timers'} onclick={() => view = 'timers'}>OT List</button>
      <button class="view-btn" class:active={view === 'board'} onclick={() => view = 'board'}>Arrival Board</button>
      {#if timerState.firstShot}
        <button class="reset-btn" onclick={resetAll} title="Reset all production timers">Reset</button>
      {/if}
    </div>
  </div>

  <!-- MAIN CONTENT -->
  {#if view === 'timers'}
    <!-- OT LIST -->
    <div class="ot-list">
      {#if otList.length === 0}
        <div class="empty">
          <p>No arrivals recorded yet. Mark people as arrived in the Cast/Crew tabs to track overtime.</p>
        </div>
      {:else}
        <div class="ot-grid">
          <div class="ot-header">
            <span class="ot-h">Name</span>
            <span class="ot-h">Role</span>
            <span class="ot-h">In</span>
            <span class="ot-h">Hours</span>
            <span class="ot-h">Status</span>
            <span class="ot-h">Next</span>
          </div>
          {#each otList as p (p.name + p.source)}
            <div class="ot-row" class:wrapped={p.isWrapped}>
              <span class="ot-cell name">
                <span class="source-dot" class:cast={p.source === 'cast'} class:crew={p.source === 'crew'}></span>
                {p.name}
              </span>
              <span class="ot-cell role">{p.role}</span>
              <span class="ot-cell mono">{T.fmt12(p.arrivedAt)}</span>
              <span class="ot-cell mono hours">{fmtHours(p.hoursWorked)}</span>
              <span class="ot-cell">
                {#if p.isWrapped}
                  <span class="ot-badge wrapped">Wrapped</span>
                {:else if p.currentThreshold}
                  <span class="ot-badge {p.currentThreshold.severity}">{p.currentThreshold.label}+</span>
                {:else}
                  <span class="ot-badge ok">OK</span>
                {/if}
              </span>
              <span class="ot-cell mono next">
                {#if !p.isWrapped && p.nextThreshold}
                  {p.nextThreshold.label} in {fmtCountdown(p.nextThresholdMs)}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <!-- ARRIVAL BOARD -->
    <div class="board">
      {#if arrivalGroups.length === 0}
        <div class="empty">
          <p>No cast or crew loaded. Add people via the Cast/Crew tabs or upload a call sheet.</p>
        </div>
      {:else}
        {#each arrivalGroups as group (group.callTime)}
          <div class="board-group">
            <div class="board-group-header">
              <span class="board-time">{group.callTime12 || '—'}</span>
              <span class="board-count">{group.arrivedCount}/{group.totalCount}</span>
            </div>
            <div class="board-people">
              {#each group.people as p (p.name + p.source)}
                <div
                  class="board-chip"
                  class:arrived={p.arrived}
                  class:wrapped={p.isWrapped}
                  class:cast={p.source === 'cast'}
                  class:crew={p.source === 'crew'}
                >
                  <span class="chip-name">{p.name}</span>
                  {#if p.arrived}
                    <span class="chip-time">{T.fmt12(p.arrivedAt)}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .dash {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ─── Top strip ─── */
  .top-strip {
    display: flex;
    align-items: stretch;
    gap: 12px;
    padding: 12px 20px;
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .top-strip::-webkit-scrollbar { display: none; }

  .clock-card, .meal-card, .stat-card {
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 10px;
    padding: 12px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 140px;
    flex-shrink: 0;
  }
  .clock-label, .meal-label, .stat-label {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text3);
  }
  .clock-value {
    font-family: var(--mono);
    font-size: 28px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: 0.02em;
  }
  .clock-sub {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
  }

  .stamp-btn, .meal-btn {
    background: none;
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 3px 10px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--accent);
    cursor: pointer;
    transition: all 0.12s;
    margin-top: 2px;
  }
  .stamp-btn:hover, .meal-btn:hover {
    background: var(--accent);
    color: var(--bg);
  }

  /* Meal card states */
  .meal-value {
    font-family: var(--mono);
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
    white-space: nowrap;
  }
  .meal-sub { font-size: 10px; color: var(--text3); }
  .meal-card.counting .meal-value { color: var(--text); }
  .meal-card.grace { border-color: var(--warn); }
  .meal-card.grace .meal-value { color: var(--warn); animation: pulse-warn 1s ease infinite; }
  .meal-card.penalty { border-color: var(--danger); background: rgba(224, 90, 90, 0.06); }
  .meal-card.penalty .meal-value { color: var(--danger); animation: pulse-warn 0.6s ease infinite; }
  .meal-card.called { border-color: var(--success); }
  .meal-card.called .meal-value { color: var(--success); }
  @keyframes pulse-warn { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }

  .stat-card {
    min-width: 100px;
  }
  .stat-value {
    font-family: var(--mono);
    font-size: 28px;
    font-weight: 700;
    color: var(--text);
  }
  .stat-of { font-size: 16px; color: var(--text3); }
  .stat-bar {
    width: 100%;
    height: 4px;
    background: var(--bg3);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 2px;
  }
  .stat-fill {
    height: 100%;
    background: var(--success);
    border-radius: 2px;
    transition: width 0.3s;
  }
  .stat-sub { font-size: 10px; color: var(--text2); white-space: nowrap; }
  .stat-card.warn { border-color: var(--warn); }
  .stat-card.warn .stat-value { color: var(--warn); }

  .strip-actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    justify-content: center;
    flex-shrink: 0;
  }
  .view-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 12px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text2);
    cursor: pointer;
    transition: all 0.12s;
    white-space: nowrap;
  }
  .view-btn:hover { border-color: var(--accent); color: var(--accent); }
  .view-btn.active { background: rgba(167, 139, 250, 0.13); color: var(--accent); border-color: var(--accent); }
  .reset-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 8px;
    font-family: var(--mono);
    font-size: 9px;
    color: var(--text3);
    cursor: pointer;
  }
  .reset-btn:hover { border-color: var(--danger); color: var(--danger); }

  /* ─── OT list ─── */
  .ot-list {
    flex: 1;
    overflow: auto;
    padding: 0;
  }
  .ot-grid {
    display: grid;
    grid-template-columns: 1fr 140px 70px 90px 80px 120px;
    min-width: 700px;
  }
  .ot-header {
    display: contents;
  }
  .ot-h {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--bg2);
    border-bottom: 2px solid var(--border);
    padding: 6px 10px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
  }
  .ot-row {
    display: contents;
  }
  .ot-row:hover .ot-cell { background: var(--bg2); }
  .ot-cell {
    padding: 8px 10px;
    font-size: 12px;
    color: var(--text);
    border-bottom: 1px solid var(--border);
    transition: background 0.08s;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ot-cell.name { font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .ot-cell.role { color: var(--text2); font-size: 11px; }
  .ot-cell.mono { font-family: var(--mono); font-size: 11px; }
  .ot-cell.hours { font-weight: 600; }
  .ot-cell.next { font-size: 10px; color: var(--text3); }
  .ot-row.wrapped .ot-cell { opacity: 0.5; }

  .source-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .source-dot.cast { background: var(--accent); }
  .source-dot.crew { background: var(--success); }

  .ot-badge {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .ot-badge.ok { background: rgba(52, 211, 153, 0.1); color: var(--success); }
  .ot-badge.info { background: rgba(96, 165, 250, 0.1); color: #60a5fa; }
  .ot-badge.warn { background: rgba(251, 191, 36, 0.15); color: var(--warn); }
  .ot-badge.danger { background: rgba(224, 90, 90, 0.12); color: var(--danger); }
  .ot-badge.wrapped { background: var(--bg3); color: var(--text3); }

  /* ─── Arrival board ─── */
  .board {
    flex: 1;
    overflow: auto;
    padding: 12px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .board-group {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .board-group-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--bg3);
    border-bottom: 1px solid var(--border);
  }
  .board-time {
    font-family: var(--mono);
    font-size: 16px;
    font-weight: 700;
    color: var(--accent);
  }
  .board-count {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
  }

  .board-people {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 14px;
  }

  .board-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    border: 1px solid var(--border2);
    background: var(--bg);
    transition: all 0.12s;
  }
  .board-chip.arrived {
    border-color: var(--success);
    background: rgba(52, 211, 153, 0.06);
  }
  .board-chip.wrapped {
    opacity: 0.5;
    border-color: var(--border);
  }
  .board-chip:not(.arrived) {
    border-style: dashed;
    opacity: 0.7;
  }

  .chip-name {
    font-weight: 600;
    color: var(--text);
  }
  .board-chip:not(.arrived) .chip-name { color: var(--text2); }

  .chip-time {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--success);
  }

  /* ─── Empty ─── */
  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
  }
  .empty p {
    font-size: 14px;
    color: var(--text2);
    text-align: center;
    max-width: 400px;
    line-height: 1.6;
  }

  @media (max-width: 640px) {
    .top-strip { padding: 8px 12px; gap: 8px; flex-wrap: wrap; }
    .clock-card, .meal-card, .stat-card { min-width: 120px; padding: 8px 12px; }
    .clock-value { font-size: 22px; }
    .meal-value { font-size: 18px; }
    .board { padding: 8px 12px; }
  }
</style>
