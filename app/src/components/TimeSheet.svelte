<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as TS from '../lib/timeSheet';

  // ─── State ──────────────────────────────────────────────────────────
  let sheet = $state<TS.TimeSheetData | null>(null);
  let sheetText = $state('');
  let history = $state<TS.TimeSheetData[]>([]);
  let view = $state<'current' | 'history'>('current');
  let copyMsg = $state('');

  // ─── Derived ────────────────────────────────────────────────────────
  let totalHours = $derived(sheet ? sheet.entries.reduce((s, e) => s + e.hoursWorked, 0) : 0);
  let totalOT = $derived(sheet ? sheet.entries.reduce((s, e) => s + e.otHours, 0) : 0);
  let forcedCalls = $derived(sheet ? sheet.entries.filter((e) => e.forcedCall).length : 0);

  // ─── Load ──────────────────────────────────────────────────────────
  function loadHistory() {
    history = TS.loadSheets().sheets;
  }

  onMount(() => {
    loadHistory();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(TS.STORAGE_KEY)) loadHistory();
    });
    return () => unsub();
  });

  // ─── Actions ──────────────────────────────────────────────────────
  function generateSheet() {
    sheet = TS.generate();
    sheetText = TS.formatText(sheet);
    view = 'current';
  }

  async function saveSheet() {
    if (!sheet) return;
    const state = TS.loadSheets();
    const exists = state.sheets.some((s) => s.generated === sheet!.generated);
    if (!exists) {
      state.sheets.unshift(sheet);
      if (state.sheets.length > 30) state.sheets = state.sheets.slice(0, 30);
      await TS.saveSheets(state);
      loadHistory();
    }
    flash('Saved!');
  }

  async function copySheet() {
    if (!sheetText) return;
    try {
      await navigator.clipboard.writeText(sheetText);
      flash('Copied!');
    } catch { flash('Failed'); }
  }

  function viewHistory(idx: number) {
    const s = history[idx];
    if (s) {
      sheet = s;
      sheetText = TS.formatText(s);
      view = 'current';
    }
  }

  async function deleteHistory(idx: number) {
    const state = TS.loadSheets();
    state.sheets.splice(idx, 1);
    await TS.saveSheets(state);
    loadHistory();
  }

  function toggleNDB(entry: TS.TimeSheetEntry) {
    entry.ndb = !entry.ndb;
    if (sheet) sheetText = TS.formatText(sheet);
  }

  function toggleNDD(entry: TS.TimeSheetEntry) {
    entry.ndd = !entry.ndd;
    if (sheet) sheetText = TS.formatText(sheet);
  }

  function toggleFC(entry: TS.TimeSheetEntry) {
    entry.forcedCall = !entry.forcedCall;
    if (sheet) sheetText = TS.formatText(sheet);
  }

  function flash(msg: string) {
    copyMsg = msg;
    setTimeout(() => copyMsg = '', 2000);
  }
</script>

<div class="ts-tab">
  <div class="toolbar">
    <h2>{sheet?.label ?? 'Time Sheet'}</h2>
    {#if sheet}
      <span class="mode-badge" class:union={sheet.isUnion}>{sheet.isUnion ? 'Union' : 'Non-Union'}</span>
    {/if}
    <div class="toolbar-actions">
      <button class="tb-btn" class:active={view === 'current'} onclick={() => view = 'current'}>Sheet</button>
      <button class="tb-btn" class:active={view === 'history'} onclick={() => view = 'history'}>
        History
        {#if history.length > 0}<span class="badge">{history.length}</span>{/if}
      </button>
      <button class="tb-btn accent" onclick={generateSheet}>Generate</button>
    </div>
  </div>

  {#if view === 'current'}
    <div class="ts-scroll">
      {#if !sheet}
        <div class="empty">
          <p>No time sheet generated yet.</p>
          <p>Click <strong>Generate</strong> to build from today's Cast Timer data.</p>
          <button class="action-btn" onclick={generateSheet}>Generate Time Sheet</button>
        </div>
      {:else}
        <!-- Production header -->
        <div class="ts-header">
          <div class="th-row">
            <span class="th-label">Production</span>
            <span class="th-value">{sheet.production}{sheet.episode ? ` — Ep ${sheet.episode}` : ''}</span>
          </div>
          <div class="th-row">
            <span class="th-label">Date</span>
            <span class="th-value">{sheet.date}</span>
          </div>
          {#if sheet.shootDay}
            <div class="th-row">
              <span class="th-label">Day</span>
              <span class="th-value">{sheet.shootDay}</span>
            </div>
          {/if}
          {#if sheet.director}
            <div class="th-row">
              <span class="th-label">Director</span>
              <span class="th-value">{sheet.director}</span>
            </div>
          {/if}
        </div>

        <!-- Time summary -->
        <div class="time-strip">
          <div class="ts-card"><span class="tc-label">Call</span><span class="tc-value">{sheet.generalCall}</span></div>
          <div class="ts-card"><span class="tc-label">1st Shot</span><span class="tc-value">{sheet.firstShot}</span></div>
          <div class="ts-card"><span class="tc-label">Meal</span><span class="tc-value">{sheet.mealBreak}</span></div>
          <div class="ts-card"><span class="tc-label">Cam Wrap</span><span class="tc-value">{sheet.cameraWrap}</span></div>
          <div class="ts-card"><span class="tc-label">Last Out</span><span class="tc-value">{sheet.lastOut}</span></div>
          <div class="ts-card highlight"><span class="tc-label">Total Hrs</span><span class="tc-value">{totalHours.toFixed(1)}</span></div>
          {#if totalOT > 0}
            <div class="ts-card danger"><span class="tc-label">OT Hrs</span><span class="tc-value">{totalOT.toFixed(1)}</span></div>
          {/if}
          {#if forcedCalls > 0}
            <div class="ts-card danger"><span class="tc-label">Forced</span><span class="tc-value">{forcedCalls}</span></div>
          {/if}
        </div>

        <!-- Cast grid -->
        <div class="cast-section">
          <div class="cast-grid" class:union={sheet.isUnion}>
            <div class="cg-header">
              <span>Name</span>
              <span>Character</span>
              {#if sheet.isUnion}<span>ID</span>{/if}
              <span>Call</span>
              <span>In</span>
              {#if sheet.isUnion}
                <span>M-Out</span>
                <span>M-In</span>
              {/if}
              <span>Wrap</span>
              <span>Hours</span>
              <span>OT</span>
              {#if sheet.isUnion}
                <span>Flags</span>
              {:else}
                <span>Notes</span>
              {/if}
            </div>
            {#each sheet.entries as e (e.name)}
              <div class="cg-row" class:has-ot={e.otHours > 0} class:forced={e.forcedCall}>
                <span class="cg-name">{e.name}</span>
                <span class="cg-role">{e.role}</span>
                {#if sheet.isUnion}<span class="cg-id">{e.empId || '—'}</span>{/if}
                <span>{e.callTime}</span>
                <span>{e.actualIn}</span>
                {#if sheet.isUnion}
                  <span>{e.mealOut || '—'}</span>
                  <span>{e.mealIn || '—'}</span>
                {/if}
                <span>{e.wrapTime}</span>
                <span class="cg-hours">{e.hoursWorked > 0 ? e.hoursWorked.toFixed(1) : '—'}</span>
                <span class="cg-ot">{e.otHours > 0 ? e.otHours.toFixed(1) : '—'}</span>
                {#if sheet.isUnion}
                  <span class="cg-flags">
                    <button class="flag-btn" class:active={e.forcedCall} title="Forced Call" onclick={() => toggleFC(e)}>FC</button>
                    <button class="flag-btn" class:active={e.ndb} title="Non-Deductible Breakfast" onclick={() => toggleNDB(e)}>NDB</button>
                    <button class="flag-btn" class:active={e.ndd} title="Non-Deductible Dinner" onclick={() => toggleNDD(e)}>NDD</button>
                  </span>
                {:else}
                  <span class="cg-notes">{e.adjustments || '—'}</span>
                {/if}
              </div>
            {/each}
          </div>

          <!-- Totals row -->
          <div class="totals-row">
            <span>Cast: {sheet.entries.length}</span>
            <span>Total Hours: {totalHours.toFixed(1)}</span>
            <span>Total OT: {totalOT.toFixed(1)}</span>
          </div>
        </div>

        <!-- Text preview -->
        <details class="text-section">
          <summary class="section-title">Plain Text Preview</summary>
          <pre class="text-preview">{sheetText}</pre>
        </details>

        <!-- Actions -->
        <div class="ts-actions">
          <button class="action-btn" onclick={saveSheet}>Save</button>
          <button class="action-btn ghost" onclick={copySheet}>Copy Text</button>
          <button class="action-btn ghost" onclick={generateSheet}>Regenerate</button>
          {#if copyMsg}<span class="copy-msg">{copyMsg}</span>{/if}
        </div>
      {/if}
    </div>

  {:else}
    <!-- HISTORY -->
    <div class="ts-scroll">
      {#if history.length === 0}
        <div class="empty"><p>No saved time sheets yet.</p></div>
      {:else}
        <div class="history-list">
          {#each history as s, idx (s.generated)}
            <div class="history-card">
              <div class="hc-top">
                <span class="hc-date">{s.date}</span>
                <span class="hc-label">{s.label}</span>
                {#if s.shootDay}<span class="hc-day">Day {s.shootDay}</span>{/if}
                <span class="hc-time">{new Date(s.generated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              <div class="hc-stats">
                <span>Cast: {s.entries.length}</span>
                <span>Hours: {s.entries.reduce((t, e) => t + e.hoursWorked, 0).toFixed(1)}</span>
                <span>OT: {s.entries.reduce((t, e) => t + e.otHours, 0).toFixed(1)}</span>
              </div>
              <div class="hc-actions">
                <button class="tb-btn" onclick={() => viewHistory(idx)}>View</button>
                <button class="tb-btn" onclick={() => { sheetText = TS.formatText(s); void copySheet(); }}>Copy</button>
                <button class="tb-btn danger" onclick={() => void deleteHistory(idx)}>Delete</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ts-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .toolbar {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }
  .toolbar h2 {
    font-family: var(--cond);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent);
    text-transform: uppercase;
  }
  .mode-badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(52, 211, 153, 0.1);
    color: var(--success);
    border: 1px solid rgba(52, 211, 153, 0.2);
  }
  .mode-badge.union { background: rgba(167, 139, 250, 0.1); color: var(--accent); border-color: rgba(167, 139, 250, 0.2); }
  .toolbar-actions { display: flex; gap: 6px; margin-left: auto; }
  .tb-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 10px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
    cursor: pointer;
    transition: all 0.12s;
  }
  .tb-btn:hover { border-color: var(--accent); color: var(--accent); }
  .tb-btn.active { background: rgba(167, 139, 250, 0.13); color: var(--accent); border-color: var(--accent); }
  .tb-btn.accent { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; }
  .tb-btn.accent:hover { background: var(--accent2); border-color: var(--accent2); }
  .tb-btn.danger { color: var(--danger); }
  .badge { font-size: 9px; background: rgba(167, 139, 250, 0.2); color: var(--accent); padding: 1px 5px; border-radius: 8px; margin-left: 4px; }

  .ts-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }
  .empty { padding: 40px; text-align: center; }
  .empty p { font-size: 14px; color: var(--text2); line-height: 1.6; margin-bottom: 12px; }

  /* ─── Header ─── */
  .ts-header {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 12px;
  }
  .th-row { display: flex; gap: 6px; align-items: baseline; }
  .th-label { font-family: var(--mono); font-size: 9px; text-transform: uppercase; color: var(--text3); }
  .th-value { font-size: 13px; color: var(--text); font-weight: 600; }

  /* ─── Time strip ─── */
  .time-strip {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .ts-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ts-card.highlight { border-color: var(--accent); }
  .ts-card.danger { border-color: var(--danger); background: rgba(224, 90, 90, 0.06); }
  .tc-label { font-family: var(--mono); font-size: 8px; text-transform: uppercase; color: var(--text3); }
  .tc-value { font-size: 14px; font-weight: 700; color: var(--text); font-family: var(--cond); }
  .ts-card.highlight .tc-value { color: var(--accent); }
  .ts-card.danger .tc-value { color: var(--danger); }

  /* ─── Cast grid ─── */
  .cast-section {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .cast-grid { overflow-x: auto; }
  .cast-grid .cg-header, .cast-grid .cg-row {
    display: grid;
    grid-template-columns: 1fr 100px 60px 60px 60px 60px 50px 60px;
    gap: 0;
    min-width: 540px;
  }
  .cast-grid.union .cg-header, .cast-grid.union .cg-row {
    grid-template-columns: 1fr 100px 50px 60px 60px 60px 60px 60px 50px 50px 90px;
    min-width: 740px;
  }
  .cg-header span {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text3);
    padding: 6px 6px;
    border-bottom: 2px solid var(--border);
    background: var(--bg2);
  }
  .cg-row > span {
    padding: 6px 6px;
    font-size: 12px;
    color: var(--text2);
    border-bottom: 1px solid var(--border);
  }
  .cg-row.has-ot > span { background: rgba(224, 90, 90, 0.03); }
  .cg-row.forced > span { background: rgba(251, 191, 36, 0.05); }
  .cg-name { font-weight: 600; color: var(--text) !important; }
  .cg-role { font-size: 11px !important; }
  .cg-id { font-family: var(--mono); font-size: 10px !important; }
  .cg-hours { font-family: var(--mono); }
  .cg-ot { font-family: var(--mono); color: var(--danger) !important; }
  .cg-notes { font-size: 10px !important; color: var(--text3) !important; }

  .cg-flags { display: flex; gap: 2px; }
  .flag-btn {
    font-family: var(--mono);
    font-size: 8px;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text3);
    cursor: pointer;
    transition: all 0.1s;
  }
  .flag-btn:hover { border-color: var(--accent); }
  .flag-btn.active { background: rgba(224, 90, 90, 0.15); color: var(--danger); border-color: var(--danger); }

  .totals-row {
    display: flex;
    gap: 16px;
    padding: 8px 10px;
    background: var(--bg2);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
    font-weight: 600;
  }

  /* ─── Text preview ─── */
  .text-section {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .section-title {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text2);
    padding: 8px 14px;
    background: var(--bg2);
    cursor: pointer;
  }
  .text-preview {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
    line-height: 1.5;
    padding: 14px;
    white-space: pre-wrap;
    overflow-x: auto;
    max-height: 300px;
    overflow-y: auto;
  }

  /* ─── Actions ─── */
  .ts-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .action-btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--bg);
    font-family: var(--font);
  }
  .action-btn:hover { background: var(--accent2); border-color: var(--accent2); }
  .action-btn.ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .action-btn.ghost:hover { border-color: var(--accent); color: var(--accent); }
  .copy-msg { font-family: var(--mono); font-size: 11px; color: var(--success); }

  /* ─── History ─── */
  .history-list { display: flex; flex-direction: column; gap: 8px; }
  .history-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
  }
  .history-card:hover { border-color: var(--accent); }
  .hc-top { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .hc-date { font-weight: 600; font-size: 14px; color: var(--text); }
  .hc-label { font-family: var(--mono); font-size: 10px; color: var(--accent); }
  .hc-day { font-family: var(--mono); font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(167, 139, 250, 0.1); color: var(--accent); }
  .hc-time { font-family: var(--mono); font-size: 10px; color: var(--text3); margin-left: auto; }
  .hc-stats { display: flex; gap: 14px; font-family: var(--mono); font-size: 11px; color: var(--text2); margin-bottom: 8px; }
  .hc-actions { display: flex; gap: 6px; }

  @media (max-width: 640px) {
    .ts-scroll { padding: 10px 12px; }
    .ts-header { flex-direction: column; gap: 4px; }
    .time-strip { gap: 4px; }
    .ts-card { padding: 4px 8px; }
  }
</style>
