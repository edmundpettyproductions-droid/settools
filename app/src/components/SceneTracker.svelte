<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as sync from '../lib/sync';
  import * as S from '../lib/scenes';
  import * as NC from '../lib/nextCall';

  // ─── State ──────────────────────────────────────────────────────────
  let rows = $state<S.SceneRow[]>([]);
  let nid = $state(1);

  // Grid selection
  let selRow = $state<number | null>(null);
  let selCol = $state<S.ColKey | null>(null);
  let editVal = $state('');
  let editEl = $state<HTMLInputElement | null>(null);

  // Paste zone
  let pasteText = $state('');
  let showPaste = $state(false);

  // ─── Derived ────────────────────────────────────────────────────────
  let summary = $derived(S.summarize(rows));
  let progressPct = $derived(
    summary.totalEighths > 0
      ? Math.round((summary.completeEighths / summary.totalEighths) * 100)
      : 0,
  );

  // ─── Load / Save ───────────────────────────────────────────────────
  function load() {
    const d = S.loadScenes();
    rows = d.rows;
    nid = d.nid;
  }

  async function save() {
    await S.saveScenes({ rows, nid });
  }

  onMount(() => {
    load();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(S.STORAGE_KEY)) load();
    });
    return () => unsub();
  });

  // ─── Cell editing ──────────────────────────────────────────────────
  async function startEdit(rowId: number, col: S.ColKey) {
    if (selRow === rowId && selCol === col) return;
    if (selRow != null && selCol != null) await commitEdit();
    selRow = rowId;
    selCol = col;
    const row = rows.find((r) => r.id === rowId);
    editVal = row ? (row[col] ?? '') : '';
    await tick();
    editEl?.focus();
    editEl?.select();
  }

  function cancelEdit() {
    selRow = null;
    selCol = null;
    editVal = '';
  }

  async function commitEdit() {
    if (selRow == null || selCol == null) return;
    const row = rows.find((r) => r.id === selRow);
    if (row) {
      (row as unknown as Record<string, string>)[selCol] = editVal.trim();
      rows = rows; // trigger reactivity
    }
    selRow = null;
    selCol = null;
    editVal = '';
    await save();
  }

  function onCellKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); void commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      void commitEditThenAdvance(e.shiftKey);
    }
  }

  async function commitEditThenAdvance(reverse: boolean) {
    const currentRow = selRow;
    const currentCol = selCol;
    if (currentRow == null || currentCol == null) return;
    await commitEdit();
    const colIdx = S.COLS.indexOf(currentCol);
    const nextColIdx = reverse ? colIdx - 1 : colIdx + 1;
    if (nextColIdx >= 0 && nextColIdx < S.COLS.length) {
      const nextCol = S.COLS[nextColIdx];
      if (nextCol) await startEdit(currentRow, nextCol);
    } else if (!reverse && nextColIdx >= S.COLS.length) {
      // Tab past last column → move to next row, first column
      const rowIdx = rows.findIndex((r) => r.id === currentRow);
      const nextRow = rows[rowIdx + 1];
      if (nextRow) await startEdit(nextRow.id, S.COLS[0]!);
    }
  }

  // ─── Row management ────────────────────────────────────────────────
  async function addRow() {
    rows.push(S.mkScene(nid++));
    rows = rows;
    await save();
    // Focus the new row's first column
    const last = rows[rows.length - 1];
    if (last) await startEdit(last.id, 'sceneNum');
  }

  async function removeRow(id: number) {
    rows = rows.filter((r) => r.id !== id);
    await save();
  }

  // ─── Status cycling ────────────────────────────────────────────────
  async function advanceScene(row: S.SceneRow) {
    S.advanceStatus(row);
    rows = rows;
    await save();
  }

  async function toggleOmit(row: S.SceneRow) {
    if (row.status === 'omitted') {
      S.resetStatus(row);
    } else {
      row.status = 'omitted';
    }
    rows = rows;
    await save();
  }

  async function resetScene(row: S.SceneRow) {
    S.resetStatus(row);
    rows = rows;
    await save();
  }

  // ─── Setup counter ─────────────────────────────────────────────────
  async function bumpSetups(row: S.SceneRow, delta: number) {
    row.setups = Math.max(0, row.setups + delta);
    rows = rows;
    await save();
  }

  // ─── Reorder ───────────────────────────────────────────────────────
  async function moveSceneUp(row: S.SceneRow) {
    const idx = rows.findIndex((r) => r.id === row.id);
    S.moveUp(rows, idx);
    rows = rows;
    await save();
  }

  async function moveSceneDown(row: S.SceneRow) {
    const idx = rows.findIndex((r) => r.id === row.id);
    S.moveDown(rows, idx);
    rows = rows;
    await save();
  }

  // ─── Context menu ──────────────────────────────────────────────────
  let ctxRow = $state<S.SceneRow | null>(null);
  let ctxX = $state(0);
  let ctxY = $state(0);

  function openCtx(e: MouseEvent, row: S.SceneRow) {
    e.preventDefault();
    ctxRow = row;
    ctxX = e.clientX;
    ctxY = e.clientY;
  }
  function closeCtx() { ctxRow = null; }

  // ─── Paste ─────────────────────────────────────────────────────────
  async function applyPaste() {
    if (!pasteText.trim()) return;
    const result = S.applyPaste(rows, pasteText, nid);
    // Warn before replacing existing scenes
    if (result.result.replaced) {
      const ok = confirm(
        `This will replace your ${rows.length} existing scene${rows.length !== 1 ? 's' : ''} with ${result.result.added} pasted scene${result.result.added !== 1 ? 's' : ''}.\n\nTimings and status will be lost. Continue?`
      );
      if (!ok) return;
    }
    rows = result.rows;
    nid = result.nid;
    showPaste = false;
    pasteText = '';
    await save();
  }

  async function clearAll() {
    if (!confirm('Clear all scenes? This cannot be undone.')) return;
    rows = [];
    nid = 1;
    await save();
  }

  // ─── estMins inline edit ───────────────────────────────────────────
  let estEditId = $state<number | null>(null);
  let estEditVal = $state('');
  let estEditEl = $state<HTMLInputElement | null>(null);

  async function startEstEdit(rowId: number) {
    const row = rows.find(r => r.id === rowId);
    estEditId = rowId;
    estEditVal = row?.estMins ? String(row.estMins) : '';
    await tick();
    estEditEl?.focus();
    estEditEl?.select();
  }

  async function commitEstEdit() {
    if (estEditId == null) return;
    const row = rows.find(r => r.id === estEditId);
    if (row) {
      row.estMins = parseInt(estEditVal, 10) || 0;
      rows = rows;
      await save();
    }
    estEditId = null;
    estEditVal = '';
  }

  // ─── Timing inline edit (firstUp / wrapped) ───────────────────────
  let timeEditId = $state<number | null>(null);
  let timeEditField = $state<'firstUp' | 'wrapped'>('firstUp');
  let timeEditVal = $state('');
  let timeEditEl = $state<HTMLInputElement | null>(null);

  async function startTimeEdit(rowId: number, field: 'firstUp' | 'wrapped') {
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    timeEditId = rowId;
    timeEditField = field;
    timeEditVal = row[field] ?? '';
    await tick();
    timeEditEl?.focus();
    timeEditEl?.select();
  }

  async function commitTimeEdit() {
    if (timeEditId == null) return;
    const row = rows.find(r => r.id === timeEditId);
    if (row) {
      // Normalize HH:MM or h:mm AM/PM → HH:MM 24h; empty clears the field
      const m24 = /^(\d{1,2}):(\d{2})$/.exec(timeEditVal.trim());
      const normalized = m24 ? `${m24[1]!.padStart(2,'0')}:${m24[2]}` : '';
      row[timeEditField] = normalized || null;
      rows = rows;
      await save();
    }
    timeEditId = null;
    timeEditVal = '';
  }

  function cancelTimeEdit() {
    timeEditId = null;
    timeEditVal = '';
  }

  // ─── Running schedule ──────────────────────────────────────────────
  let showSchedule = $state(false);
  let generalCallInput = $state('');

  function loadGeneralCall() {
    const nc = NC.loadNextCall();
    if (nc.generalCall && !generalCallInput) generalCallInput = nc.generalCall;
  }

  let scheduleEntries = $derived.by(() => {
    if (!showSchedule || !generalCallInput) return [];
    return S.computeRunningSchedule(rows, generalCallInput);
  });

  // ─── Compare view ──────────────────────────────────────────────────
  let showCompare = $state(false);
  let ncScenes = $state<NC.NextCallScene[]>([]);

  function loadNCScenes() {
    ncScenes = NC.loadNextCall().scenes;
  }

  interface CompareRow {
    ncIdx: number | null;   // position in Next Day Call (1-based)
    ncNum: string;
    ncDesc: string;
    trackerIdx: number | null; // position in SceneTracker (1-based)
    status: S.SceneStatus | null;
    reordered: boolean; // position differs
    onlyInNC: boolean;
    onlyInTracker: boolean;
  }

  let compareRows = $derived.by<CompareRow[]>(() => {
    if (!showCompare) return [];
    const ncMap = new Map(ncScenes.map((s, i) => [s.sceneNum.trim(), i + 1]));
    const trackerMap = new Map(rows.map((r, i) => [r.sceneNum.trim(), { idx: i + 1, status: r.status }]));
    const allNums = new Set([...ncMap.keys(), ...trackerMap.keys()].filter(Boolean));
    const result: CompareRow[] = [];
    for (const num of allNums) {
      const ncIdx = ncMap.get(num) ?? null;
      const trackerEntry = trackerMap.get(num);
      const trackerIdx = trackerEntry?.idx ?? null;
      const ncScene = ncScenes.find(s => s.sceneNum.trim() === num);
      result.push({
        ncIdx,
        ncNum: num,
        ncDesc: ncScene?.description ?? '',
        trackerIdx,
        status: trackerEntry?.status ?? null,
        reordered: ncIdx != null && trackerIdx != null && ncIdx !== trackerIdx,
        onlyInNC: ncIdx != null && trackerIdx == null,
        onlyInTracker: ncIdx == null && trackerIdx != null,
      });
    }
    return result.sort((a, b) => (a.ncIdx ?? 999) - (b.ncIdx ?? 999) || (a.trackerIdx ?? 999) - (b.trackerIdx ?? 999));
  });

  // ─── Grid template ─────────────────────────────────────────────────
  const gridTemplate = S.COLS.map((c) => S.COL_WIDTHS[c]).join(' ');

  // Helper: is a row first or last?
  function isFirst(row: S.SceneRow): boolean { return rows[0]?.id === row.id; }
  function isLast(row: S.SceneRow): boolean { return rows[rows.length - 1]?.id === row.id; }
</script>

<svelte:window onclick={closeCtx} />

<div class="scene-tab">
  <!-- TOOLBAR -->
  <div class="toolbar">
    <h2>Scene Tracker</h2>

    <!-- Progress bar -->
    <div class="progress-group">
      <div class="progress-bar">
        <div class="progress-fill" style:width="{progressPct}%"></div>
      </div>
      <span class="progress-text">
        {S.fmtEighths(summary.completeEighths)}/{S.fmtEighths(summary.totalEighths)} pgs
        · {summary.complete}/{summary.total - summary.omitted} scenes
        · {progressPct}%
      </span>
    </div>

    <!-- Status chips -->
    <div class="status-chips">
      {#if summary.shooting > 0}
        <span class="chip shooting">Shooting {summary.shooting}</span>
      {/if}
      {#if summary.rehearsing > 0}
        <span class="chip rehearsing">Rehearsing {summary.rehearsing}</span>
      {/if}
      {#if summary.scheduled > 0}
        <span class="chip scheduled">Remaining {summary.scheduled}</span>
      {/if}
    </div>

    <div class="toolbar-actions">
      <button class="tb-btn" onclick={addRow} title="Add scene row">+ Row</button>
      <button class="tb-btn" onclick={() => showPaste = !showPaste} title="Paste from spreadsheet">Paste</button>
      <button
        class="tb-btn"
        class:active={showSchedule}
        onclick={() => { showSchedule = !showSchedule; if (showSchedule) loadGeneralCall(); }}
        title="Show estimated running schedule"
      >Schedule</button>
      <button
        class="tb-btn"
        class:active={showCompare}
        onclick={() => { showCompare = !showCompare; if (showCompare) loadNCScenes(); }}
        title="Compare with Next Day Call sheet"
      >Compare</button>
      <button class="tb-btn danger" onclick={clearAll} title="Clear all scenes">Clear</button>
    </div>
  </div>

  <!-- PASTE ZONE -->
  {#if showPaste}
    <div class="paste-zone">
      <textarea
        bind:value={pasteText}
        placeholder="Paste scene data from Excel/Sheets here (Scene, Description, Set/Location, Cast, Pages, Notes)"
        rows="4"
      ></textarea>
      <div class="paste-actions">
        <button class="tb-btn" onclick={applyPaste}>Apply</button>
        <button class="tb-btn ghost" onclick={() => { showPaste = false; pasteText = ''; }}>Cancel</button>
      </div>
    </div>
  {/if}

  <!-- RUNNING SCHEDULE PANEL -->
  {#if showSchedule}
    <div class="sched-panel">
      <div class="sched-hdr">
        <span class="sched-label">Running Schedule</span>
        <label class="sched-input-wrap">
          <span>General Call:</span>
          <input
            class="sched-call-input"
            type="text"
            bind:value={generalCallInput}
            placeholder="07:00"
          />
        </label>
        <span class="sched-hint">Click "Est" column per row to set minutes per scene</span>
      </div>
      {#if scheduleEntries.length === 0}
        <div class="sched-empty">Set a general call time and add "Est" minutes to scenes to see running schedule</div>
      {:else}
        <div class="sched-list">
          {#each scheduleEntries as e}
            <div class="sched-entry">
              <span class="sched-sc">Sc {e.sceneNum}</span>
              <span class="sched-time">{e.estStart}</span>
              <span class="sched-arrow">→</span>
              <span class="sched-time">{e.estEnd}</span>
              <span class="sched-dur">({S.fmtMins(e.estMins)})</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- COMPARE PANEL -->
  {#if showCompare}
    <div class="compare-panel">
      <div class="compare-hdr">
        <span class="compare-label">Schedule Comparison: Next Day Call vs Scene Tracker</span>
        <button class="tb-btn ghost" onclick={() => { loadNCScenes(); }}>↺ Refresh</button>
      </div>
      {#if ncScenes.length === 0}
        <div class="compare-empty">No scenes in Next Day Call tab. Build tomorrow's schedule there first.</div>
      {:else if compareRows.length === 0}
        <div class="compare-empty">No matching scene numbers found.</div>
      {:else}
        <div class="compare-grid">
          <div class="cg-hdr">
            <span>Scene #</span>
            <span>Next Day # (Call)</span>
            <span>Tracker # (Today)</span>
            <span>Today's Status</span>
            <span>Note</span>
          </div>
          {#each compareRows as cr}
            <div class="cg-row"
              class:only-nc={cr.onlyInNC}
              class:only-tracker={cr.onlyInTracker}
              class:reordered={cr.reordered}
            >
              <span class="cg-num">{cr.ncNum}</span>
              <span>{cr.ncIdx != null ? `#${cr.ncIdx}` : '—'}</span>
              <span>{cr.trackerIdx != null ? `#${cr.trackerIdx}` : '—'}</span>
              <span>{cr.status ? S.STATUS_LABELS[cr.status] : '—'}</span>
              <span class="cg-note">
                {#if cr.onlyInNC}⚠ Not in tracker{:else if cr.onlyInTracker}⚠ Not on call sheet{:else if cr.reordered}⇅ Reordered{:else}✓{/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- GRID -->
  {#if rows.length === 0 && !showPaste}
    <div class="empty">
      <h3>No Scenes</h3>
      <p>Click <strong>+ Row</strong> to add scenes manually, or <strong>Paste</strong> from a shooting schedule spreadsheet.</p>
    </div>
  {:else if rows.length > 0}
    <div class="grid-scroll">
      <div class="grid" role="grid" style="grid-template-columns: 40px {gridTemplate} 120px 80px 50px 60px 36px 50px;">
        <!-- Header -->
        <div class="grid-header" role="row">
          <span class="gh">#</span>
          {#each S.COLS as col}
            <span class="gh">{S.COL_LABELS[col]}</span>
          {/each}
          <span class="gh">Status</span>
          <span class="gh">Time</span>
          <span class="gh">Setups</span>
          <span class="gh" title="Estimated minutes for running schedule">Est</span>
          <span class="gh" title="Reorder">⇅</span>
          <span class="gh"></span>
        </div>

        <!-- Rows -->
        {#each rows as row, i (row.id)}
          <div
            class="grid-row"
            class:complete={row.status === 'complete'}
            class:shooting={row.status === 'shooting'}
            class:rehearsing={row.status === 'rehearsing'}
            class:omitted={row.status === 'omitted'}
            role="row"
            tabindex="-1"
            oncontextmenu={(e) => openCtx(e, row)}
          >
            <!-- Row number -->
            <span class="cell row-num">{i + 1}</span>

            <!-- Data cells -->
            {#each S.COLS as col}
              {#if selRow === row.id && selCol === col}
                <input
                  bind:this={editEl}
                  bind:value={editVal}
                  class="cell-edit"
                  onkeydown={onCellKeydown}
                  onblur={() => void commitEdit()}
                  spellcheck={false}
                />
              {:else}
                <span
                  class="cell"
                  class:empty={!row[col]}
                  role="gridcell"
                  tabindex="0"
                  onclick={() => void startEdit(row.id, col)}
                  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void startEdit(row.id, col); } }}
                >{row[col] || ' '}</span>
              {/if}
            {/each}

            <!-- Status button -->
            <button
              class="status-btn {row.status}"
              onclick={() => void advanceScene(row)}
              title={row.status === 'complete' ? 'Complete' : `Click to advance`}
            >
              {S.STATUS_LABELS[row.status]}
            </button>

            <!-- Timing: click to edit firstUp or wrapped manually -->
            <span class="cell time-cell">
              {#if timeEditId === row.id && timeEditField === 'firstUp'}
                <input
                  bind:this={timeEditEl}
                  bind:value={timeEditVal}
                  class="time-edit-input"
                  placeholder="HH:MM"
                  onblur={commitTimeEdit}
                  onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitTimeEdit(); } if (e.key === 'Escape') cancelTimeEdit(); }}
                />
              {:else}
                <button
                  class="time-val-btn"
                  title="Click to set first-up time"
                  onclick={() => void startTimeEdit(row.id, 'firstUp')}
                >
                  {row.firstUp ? S.fmt12(row.firstUp) : '—'}
                </button>
              {/if}
              {#if row.firstUp || row.wrapped}
                <span class="time-sep">–</span>
                {#if timeEditId === row.id && timeEditField === 'wrapped'}
                  <input
                    bind:this={timeEditEl}
                    bind:value={timeEditVal}
                    class="time-edit-input"
                    placeholder="HH:MM"
                    onblur={commitTimeEdit}
                    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitTimeEdit(); } if (e.key === 'Escape') cancelTimeEdit(); }}
                  />
                {:else}
                  <button
                    class="time-val-btn"
                    title="Click to set wrapped time"
                    onclick={() => void startTimeEdit(row.id, 'wrapped')}
                  >
                    {row.wrapped ? S.fmt12(row.wrapped) : '—'}
                  </button>
                {/if}
              {/if}
            </span>

            <!-- Setups -->
            <span class="cell setups-cell">
              <button class="setup-btn" onclick={() => void bumpSetups(row, -1)} title="Decrease setups">-</button>
              <span class="setup-count">{row.setups}</span>
              <button class="setup-btn" onclick={() => void bumpSetups(row, 1)} title="Increase setups">+</button>
            </span>

            <!-- estMins -->
            {#if estEditId === row.id}
              <input
                bind:this={estEditEl}
                bind:value={estEditVal}
                class="cell-edit est-edit"
                type="number"
                min="0"
                max="999"
                placeholder="min"
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); void commitEstEdit(); } if (e.key === 'Escape') { estEditId = null; } }}
                onblur={() => setTimeout(() => void commitEstEdit(), 80)}
              />
            {:else}
              <span
                class="cell est-cell"
                class:empty={!row.estMins}
                role="gridcell"
                tabindex="0"
                title="Click to set estimated shoot time in minutes"
                onclick={() => void startEstEdit(row.id)}
                onkeydown={(e) => { if (e.key === 'Enter') void startEstEdit(row.id); }}
              >{row.estMins ? `${row.estMins}m` : ''}</span>
            {/if}

            <!-- Reorder -->
            <span class="reorder-cell">
              <button
                class="reorder-btn"
                onclick={() => void moveSceneUp(row)}
                disabled={isFirst(row)}
                title="Move scene up"
                aria-label="Move scene {row.sceneNum} up"
              >▲</button>
              <button
                class="reorder-btn"
                onclick={() => void moveSceneDown(row)}
                disabled={isLast(row)}
                title="Move scene down"
                aria-label="Move scene {row.sceneNum} down"
              >▼</button>
            </span>

            <!-- Actions (delete) -->
            <button class="del-btn" onclick={() => void removeRow(row.id)} title="Remove scene">x</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- CONTEXT MENU -->
{#if ctxRow}
  <div class="ctx-menu" role="menu" tabindex="-1" style="left:{ctxX}px;top:{ctxY}px">
    {#if ctxRow.status !== 'complete'}
      <button role="menuitem" onclick={() => { if (ctxRow) void advanceScene(ctxRow); closeCtx(); }}>
        Advance Status
      </button>
    {/if}
    <button role="menuitem" onclick={() => { if (ctxRow) void toggleOmit(ctxRow); closeCtx(); }}>
      {ctxRow.status === 'omitted' ? 'Un-omit' : 'Omit Scene'}
    </button>
    <button role="menuitem" onclick={() => { if (ctxRow) void resetScene(ctxRow); closeCtx(); }}>
      Reset to Scheduled
    </button>
    <hr class="ctx-divider" />
    {#if !isFirst(ctxRow)}
      <button role="menuitem" onclick={() => { if (ctxRow) void moveSceneUp(ctxRow); closeCtx(); }}>
        ▲ Move Up
      </button>
    {/if}
    {#if !isLast(ctxRow)}
      <button role="menuitem" onclick={() => { if (ctxRow) void moveSceneDown(ctxRow); closeCtx(); }}>
        ▼ Move Down
      </button>
    {/if}
    <hr class="ctx-divider" />
    <button role="menuitem" class="danger" onclick={() => { if (ctxRow) void removeRow(ctxRow.id); closeCtx(); }}>
      Delete Row
    </button>
  </div>
{/if}

<style>
  .scene-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ─── Toolbar ─── */
  .toolbar {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .toolbar h2 {
    font-family: var(--cond);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent);
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .progress-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 200px;
  }
  .progress-bar {
    height: 8px;
    background: var(--bg3);
    border-radius: 4px;
    flex: 1;
    max-width: 180px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--success);
    border-radius: 4px;
    transition: width 0.3s ease;
  }
  .progress-text {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
    white-space: nowrap;
  }

  .status-chips {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .chip {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .chip.shooting { background: rgba(251, 191, 36, 0.15); color: var(--warn); }
  .chip.rehearsing { background: rgba(167, 139, 250, 0.12); color: var(--accent); }
  .chip.scheduled { background: var(--bg3); color: var(--text3); }

  .toolbar-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
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
  .tb-btn.danger:hover { border-color: var(--danger); color: var(--danger); }
  .tb-btn.ghost { border-color: transparent; }
  .tb-btn.ghost:hover { border-color: var(--border); }

  /* ─── Paste zone ─── */
  .paste-zone {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 10px 20px;
  }
  .paste-zone textarea {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 6px;
    padding: 8px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text);
    resize: vertical;
  }
  .paste-zone textarea::placeholder { color: var(--text3); }
  .paste-actions { display: flex; gap: 6px; margin-top: 6px; }

  /* ─── Empty state ─── */
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px;
  }
  .empty h3 {
    font-family: var(--cond);
    font-size: 24px;
    font-weight: 700;
    color: var(--accent);
  }
  .empty p {
    font-size: 14px;
    color: var(--text2);
    text-align: center;
    max-width: 400px;
    line-height: 1.6;
  }

  /* ─── Grid ─── */
  .grid-scroll {
    flex: 1;
    overflow: auto;
  }
  .grid {
    display: grid;
    min-width: 900px;
  }

  .grid-header {
    display: contents;
  }
  .gh {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--bg2);
    border-bottom: 2px solid var(--border);
    padding: 6px 8px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
    white-space: nowrap;
  }

  .grid-row {
    display: contents;
  }
  .grid-row:hover .cell,
  .grid-row:hover .status-btn,
  .grid-row:hover .del-btn {
    background: var(--bg2);
  }

  .cell {
    padding: 6px 8px;
    font-size: 12px;
    font-family: var(--mono);
    color: var(--text);
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background 0.08s;
    background: none;
    border-right: none;
    border-left: none;
    border-top: none;
    text-align: left;
  }
  .cell.empty { color: var(--text3); }
  .cell.row-num {
    color: var(--text3);
    font-size: 10px;
    text-align: center;
    cursor: default;
  }

  .cell-edit {
    padding: 4px 6px;
    font-size: 12px;
    font-family: var(--mono);
    color: var(--text);
    background: var(--bg2);
    border: 1px solid var(--accent);
    border-radius: 3px;
    outline: none;
    box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.18);
    width: 100%;
    min-width: 0;
  }

  .grid-row.complete .cell { color: var(--text3); text-decoration: line-through; }
  .grid-row.omitted .cell { color: var(--text3); text-decoration: line-through; opacity: 0.5; }
  .grid-row.shooting .cell { color: var(--warn); }
  .grid-row.rehearsing .cell { color: var(--accent); }

  /* ─── Status button ─── */
  .status-btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: all 0.12s;
    background: none;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    justify-self: center;
    align-self: center;
  }
  .status-btn.scheduled { color: var(--text3); border-color: var(--border); }
  .status-btn.scheduled:hover { color: var(--accent); border-color: var(--accent); }
  .status-btn.rehearsing { color: var(--accent); border-color: var(--accent); background: rgba(167, 139, 250, 0.08); }
  .status-btn.shooting { color: var(--warn); border-color: var(--warn); background: rgba(251, 191, 36, 0.08); animation: pulse-shoot 2s ease infinite; }
  @keyframes pulse-shoot { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
  .status-btn.complete { color: var(--success); border-color: var(--success); background: rgba(52, 211, 153, 0.08); cursor: default; }
  .status-btn.omitted { color: var(--text3); border-color: var(--border); text-decoration: line-through; }

  /* ─── Time cell ─── */
  .time-cell {
    font-size: 10px;
    color: var(--text2);
    white-space: nowrap;
    cursor: default;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .time-val-btn {
    background: none;
    border: none;
    font-size: 10px;
    color: var(--text2);
    cursor: pointer;
    padding: 0 2px;
    border-radius: 2px;
    font-family: var(--mono);
  }
  .time-val-btn:hover { background: var(--bg3); color: var(--accent); }
  .time-sep { color: var(--text3); }
  .time-edit-input {
    width: 52px;
    font-size: 10px;
    font-family: var(--mono);
    background: var(--bg3);
    border: 1px solid var(--accent);
    border-radius: 2px;
    padding: 1px 3px;
    color: var(--text);
    outline: none;
  }

  /* ─── Setups ─── */
  .setups-cell {
    display: flex;
    align-items: center;
    gap: 2px;
    justify-content: center;
    cursor: default;
  }
  .setup-btn {
    width: 18px;
    height: 18px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text3);
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.1s;
    font-family: var(--mono);
    line-height: 1;
  }
  .setup-btn:hover { border-color: var(--accent); color: var(--accent); }
  .setup-count {
    font-family: var(--mono);
    font-size: 12px;
    min-width: 14px;
    text-align: center;
    color: var(--text);
  }

  /* ─── Reorder buttons ─── */
  .reorder-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    border-bottom: 1px solid var(--border);
    opacity: 0;
    transition: opacity 0.1s;
  }
  .grid-row:hover .reorder-cell { opacity: 1; }
  .reorder-btn {
    background: none;
    border: none;
    color: var(--text3);
    font-size: 9px;
    cursor: pointer;
    padding: 1px 4px;
    line-height: 1;
    transition: color 0.1s;
    font-family: var(--mono);
  }
  .reorder-btn:hover:not(:disabled) { color: var(--accent); }
  .reorder-btn:disabled { opacity: 0.2; cursor: default; }

  /* ─── Delete button ─── */
  .del-btn {
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text3);
    font-size: 12px;
    cursor: pointer;
    opacity: 0;
    transition: all 0.1s;
    font-family: var(--mono);
    padding: 0;
  }
  .grid-row:hover .del-btn { opacity: 0.6; }
  .del-btn:hover { color: var(--danger); opacity: 1; }

  /* ─── Context menu ─── */
  .ctx-menu {
    position: fixed;
    z-index: 200;
    background: var(--bg2);
    border: 1px solid var(--border2);
    border-radius: 8px;
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .ctx-menu button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 7px 14px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font);
    transition: background 0.08s;
  }
  .ctx-menu button:hover { background: var(--bg3); }
  .ctx-menu button.danger { color: var(--danger); }
  .ctx-divider { border: none; border-top: 1px solid var(--border); margin: 3px 0; }

  /* ─── estMins cell ─── */
  .est-cell { font-family: var(--mono); font-size: 10px; color: var(--accent); text-align: center; }
  .est-cell.empty { color: var(--text3); opacity: 0.4; }
  .est-edit { font-family: var(--mono); font-size: 11px; text-align: center; width: 100%; min-width: 0; }

  /* ─── Running schedule panel ─── */
  .sched-panel {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    flex-shrink: 0;
  }
  .sched-hdr {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .sched-label {
    font-family: var(--mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    font-weight: 600;
  }
  .sched-input-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
  }
  .sched-call-input {
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 11px;
    padding: 3px 7px;
    width: 65px;
    text-align: center;
  }
  .sched-call-input:focus { border-color: var(--accent); outline: none; }
  .sched-hint { font-family: var(--mono); font-size: 10px; color: var(--text3); margin-left: auto; }
  .sched-empty {
    font-family: var(--mono); font-size: 11px; color: var(--text3);
    padding: 6px 0; letter-spacing: 0.03em;
  }
  .sched-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .sched-entry {
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 8px;
    font-family: var(--mono);
    font-size: 11px;
  }
  .sched-sc { color: var(--accent); font-weight: 600; }
  .sched-time { color: var(--text); }
  .sched-arrow { color: var(--text3); }
  .sched-dur { color: var(--text3); font-size: 10px; }

  /* ─── Compare panel ─── */
  .compare-panel {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    max-height: 220px;
    overflow-y: auto;
    flex-shrink: 0;
  }
  .compare-hdr {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    position: sticky;
    top: 0;
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
  }
  .compare-label {
    font-family: var(--mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    font-weight: 600;
  }
  .compare-empty { font-family: var(--mono); font-size: 11px; color: var(--text3); padding: 10px 14px; }
  .compare-grid { font-size: 12px; }
  .cg-hdr, .cg-row {
    display: grid;
    grid-template-columns: 80px 110px 110px 110px 1fr;
    padding: 4px 14px;
    gap: 8px;
    align-items: center;
  }
  .cg-hdr {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text3);
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
    position: sticky;
    top: 37px;
  }
  .cg-row { border-bottom: 1px solid var(--border); }
  .cg-row:hover { background: var(--bg3); }
  .cg-row.reordered { background: rgba(251, 191, 36, 0.05); }
  .cg-row.only-nc { background: rgba(167, 139, 250, 0.05); }
  .cg-row.only-tracker { background: rgba(224, 90, 90, 0.05); }
  .cg-num { font-family: var(--mono); font-weight: 600; color: var(--text); }
  .cg-note { font-family: var(--mono); font-size: 10px; }
  .cg-row.reordered .cg-note { color: var(--warn); }
  .cg-row.only-nc .cg-note, .cg-row.only-tracker .cg-note { color: var(--danger); }

  @media (max-width: 640px) {
    .toolbar { padding: 8px 12px; gap: 8px; }
    .progress-group { min-width: 0; }
  }
</style>
