<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as sync from '../lib/sync';
  import * as T from '../lib/tracker';
  import * as extract from '../lib/extract';

  // ─── Props ──────────────────────────────────────────────────────────
  let { mode }: { mode: T.TrackerMode } = $props();

  const cfg = $derived(T.configFor(mode));
  const colLabels = $derived(mode === 'cast' ? T.COL_LABELS : T.COL_CREW_LABELS);

  // ─── Reactive state ─────────────────────────────────────────────────
  let rows = $state<T.TrackerRow[]>([]);
  let nextId = $state(1);
  let warnMinutes = $state(15);
  let now = $state(new Date());
  let replaceOnUpload = $state(true);

  // Grid editing
  let sel = $state({ r0: 0, c0: 0, r1: 0, c1: 0 });
  let editing = $state<{ ri: number; ci: number } | null>(null);
  let editVal = $state('');
  let editInput = $state<HTMLInputElement | null>(null);

  // PDF upload
  let pdfStatus = $state<{ type: 'loading' | 'ok' | 'err'; msg: string } | null>(null);

  // Context menu
  let ctxMenu = $state<{ x: number; y: number; rowId: number } | null>(null);

  // ─── Derived ────────────────────────────────────────────────────────
  let timerGroups = $derived.by(() => T.buildGroups(rows, warnMinutes * 60000, now));
  let arrivedRows = $derived.by(() =>
    rows.filter(r => r.arrived && r.name)
      .sort((a, b) => (a.arrivedAt || '99:99').localeCompare(b.arrivedAt || '99:99'))
  );
  let arrivedCount = $derived(arrivedRows.length);

  // ─── Lifecycle ──────────────────────────────────────────────────────
  let tickTimer: number | undefined;
  let tableEl: HTMLTableElement | undefined;

  onMount(() => {
    load();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(cfg.storageKey)) load();
    });
    // Tick every second for live countdowns
    tickTimer = window.setInterval(() => { now = new Date(); }, 1000);
    return () => {
      unsub();
      if (tickTimer !== undefined) clearInterval(tickTimer);
    };
  });

  function load() {
    const data = T.loadTracker(cfg.storageKey);
    rows = data.rows;
    nextId = data.nid;
    if (!rows.length) {
      for (let i = 0; i < 5; i++) rows.push(T.mkRow(nextId++));
    }
  }

  async function save() {
    await T.saveTracker(cfg.storageKey, { rows, nid: nextId });
  }

  // ─── Grid: selection helpers ────────────────────────────────────────
  function selMin() {
    return {
      r: Math.min(sel.r0, sel.r1), c: Math.min(sel.c0, sel.c1),
      r2: Math.max(sel.r0, sel.r1), c2: Math.max(sel.c0, sel.c1),
    };
  }
  function inSel(ri: number, ci: number) {
    const s = selMin();
    return ri >= s.r && ri <= s.r2 && ci >= s.c && ci <= s.c2;
  }
  function isAnchor(ri: number, ci: number) { return ri === sel.r0 && ci === sel.c0; }

  // ─── Grid: cell editing ─────────────────────────────────────────────
  let dragging = false;

  async function startEdit(ri: number, ci: number, initialChar?: string) {
    if (editing) commitEdit();
    editing = { ri, ci };
    const col = T.COLS[ci];
    const row = rows[ri];
    if (!col || !row) { editing = null; return; }
    editVal = initialChar !== undefined ? initialChar : row[col];
    await tick();
    editInput?.focus();
    if (initialChar === undefined) editInput?.select();
  }

  function commitEdit() {
    if (!editing) return;
    const { ri, ci } = editing;
    const col = T.COLS[ci];
    const row = rows[ri];
    if (col && row) {
      let v = editVal.trim();
      if (col === 'callTime' || col === 'onSetTime') v = T.normTime(v);
      row[col] = v;
    }
    editing = null;
    editVal = '';
    void save();
  }

  function cancelEdit() {
    editing = null;
    editVal = '';
  }

  function onEditorKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      if (e.key === 'Enter') commitEdit(); else cancelEdit();
      tableEl?.focus();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      let { r0: ri, c0: ci } = sel;
      if (e.shiftKey) { ci--; if (ci < 0) { ci = T.COLS.length - 1; ri--; } }
      else { ci++; if (ci >= T.COLS.length) { ci = 0; ri++; } }
      ri = Math.max(0, Math.min(rows.length - 1, ri));
      ci = Math.max(0, Math.min(T.COLS.length - 1, ci));
      sel = { r0: ri, c0: ci, r1: ri, c1: ci };
      void startEdit(ri, ci);
    }
  }

  function onTableKeydown(e: KeyboardEvent) {
    if (editing) return;
    let { r0: ri, c0: ci } = sel;
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'ArrowDown') ri = Math.min(rows.length - 1, ri + 1);
      if (e.key === 'ArrowUp') ri = Math.max(0, ri - 1);
      if (e.key === 'ArrowRight') ci = Math.min(T.COLS.length - 1, ci + 1);
      if (e.key === 'ArrowLeft') ci = Math.max(0, ci - 1);
      sel = { r0: ri, c0: ci, r1: ri, c1: ci };
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const s = selMin();
      for (let r = s.r; r <= s.r2; r++)
        for (let c = s.c; c <= s.c2; c++) {
          const col = T.COLS[c]; const row = rows[r];
          if (col && row) row[col] = '';
        }
      void save();
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); void startEdit(sel.r0, sel.c0); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) { ci--; if (ci < 0) { ci = T.COLS.length - 1; ri--; } }
      else { ci++; if (ci >= T.COLS.length) { ci = 0; ri++; } }
      ri = Math.max(0, Math.min(rows.length - 1, ri));
      ci = Math.max(0, Math.min(T.COLS.length - 1, ci));
      sel = { r0: ri, c0: ci, r1: ri, c1: ci };
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      void startEdit(sel.r0, sel.c0, e.key);
    }
  }

  function onTablePaste(e: ClipboardEvent) {
    e.preventDefault();
    if (editing) commitEdit();
    const raw = e.clipboardData?.getData('text/plain');
    if (!raw) return;
    const result = T.applyPaste(raw, sel.r0, sel.c0, rows, nextId);
    rows = result.rows;
    nextId = result.nid;
    sel = { r0: sel.r0, c0: sel.c0, r1: result.selEnd.r, c1: result.selEnd.c };
    void save();
  }

  // ─── Grid: row operations ───────────────────────────────────────────
  function addRow() {
    if (editing) commitEdit();
    rows.push(T.mkRow(nextId++));
    rows = rows; // trigger reactivity
    sel = { r0: rows.length - 1, c0: 1, r1: rows.length - 1, c1: 1 };
    void save();
    void tick().then(() => startEdit(rows.length - 1, 1));
  }

  function deleteRow(ri: number) {
    if (editing) commitEdit();
    rows.splice(ri, 1);
    rows = rows;
    void save();
  }

  function toggleIsolate(ri: number) {
    const row = rows[ri];
    if (row) row.isolate = !row.isolate;
  }

  // ─── Timer: chip clicks → arrival toggle ────────────────────────────
  function toggleArrival(personId: number) {
    const row = rows.find(r => r.id === personId);
    if (!row) return;
    row.arrived = !row.arrived;
    if (row.arrived) row.arrivedAt = T.nowHHMM();
    else { row.arrivedAt = ''; row.adjMins = 0; row.adjNote = ''; }
    void save();
  }

  // ─── Arrival Log: context menu actions ──────────────────────────────
  function openCtx(e: MouseEvent, rowId: number) {
    e.preventDefault();
    ctxMenu = { x: e.clientX, y: e.clientY, rowId };
  }

  function closeCtx() { ctxMenu = null; }

  function ctxAdjust() {
    if (!ctxMenu) return;
    const row = rows.find(r => r.id === ctxMenu!.rowId);
    if (!row) { closeCtx(); return; }
    const mins = prompt(`Adjust arrival for ${row.name} by how many minutes? (positive=later, negative=earlier)`);
    if (mins === null) { closeCtx(); return; }
    const m = parseInt(mins);
    if (isNaN(m)) { closeCtx(); return; }
    const note = prompt('Reason (optional):') || '';
    row.adjMins = m;
    row.adjNote = note;
    void save();
    closeCtx();
  }

  function ctxWrap() {
    if (!ctxMenu) return;
    const row = rows.find(r => r.id === ctxMenu!.rowId);
    if (!row) { closeCtx(); return; }
    const wt = prompt('Wrap time (HH:MM):', T.nowHHMM());
    if (wt === null) { closeCtx(); return; }
    row.wrapTime = T.normTime(wt) || wt;
    void save();
    closeCtx();
  }

  function ctxUnarrive() {
    if (!ctxMenu) return;
    const row = rows.find(r => r.id === ctxMenu!.rowId);
    if (row) { row.arrived = false; row.arrivedAt = ''; row.adjMins = 0; row.adjNote = ''; }
    void save();
    closeCtx();
  }

  function ctxRemove() {
    if (!ctxMenu) return;
    const row = rows.find(r => r.id === ctxMenu!.rowId);
    if (row && confirm(`Remove ${row.name} from the tracker?`)) {
      const idx = rows.indexOf(row);
      if (idx !== -1) { rows.splice(idx, 1); rows = rows; }
      void save();
    }
    closeCtx();
  }

  // ─── PDF upload ─────────────────────────────────────────────────────
  let fileInput: HTMLInputElement | undefined;

  async function handlePdf(file: File) {
    pdfStatus = { type: 'loading', msg: 'Reading PDF...' };
    try {
      const b64 = await extract.fileToBase64(file);
      pdfStatus = { type: 'loading', msg: `Extracting ${mode === 'cast' ? 'cast & BG' : 'crew'}...` };
      const rawResp = await extract.extractFromPdf(b64, cfg.extractPrompt, { system: cfg.extractSystem });
      const result = extract.parseJsonResponse<T.ExtractResult>(rawResp);
      const people = result.people ?? [];
      if (!people.length) { pdfStatus = { type: 'err', msg: 'No people found in PDF.' }; return; }

      if (replaceOnUpload) { rows = []; }
      for (const p of people) {
        rows.push(T.mkRow(nextId++, {
          empId: String(p.id ?? ''),
          name: String(p.name ?? ''),
          role: String(p.role ?? ''),
          callTime: T.normTime(String(p.callTime ?? '')),
          onSetTime: T.normTime(String(p.onSetTime ?? '')),
        }));
      }
      rows = rows;
      void save();

      // Merge header into UH
      if (result.header) void T.mergeExtractedHeader(result.header);

      pdfStatus = { type: 'ok', msg: `Imported ${people.length} ${mode === 'cast' ? 'cast' : 'crew'} member${people.length === 1 ? '' : 's'}.` };
    } catch (e) {
      pdfStatus = { type: 'err', msg: `Error: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}` };
    }
  }

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void handlePdf(file);
    input.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file?.type === 'application/pdf') void handlePdf(file);
    else pdfStatus = { type: 'err', msg: 'PDF files only.' };
  }

  // ─── Kiosk sync ─────────────────────────────────────────────────────
  function doKioskSync() {
    const result = T.syncFromKiosk(rows);
    if (result.error) { alert(result.error); return; }
    void save();
    alert(`Kiosk sync: ${result.matched} arrival${result.matched !== 1 ? 's' : ''} imported.`);
  }

  // ─── Clear all ──────────────────────────────────────────────────────
  function clearAll() {
    if (!confirm(`Clear all ${mode === 'cast' ? 'cast' : 'crew'} data?`)) return;
    rows = [];
    nextId = 1;
    for (let i = 0; i < 5; i++) rows.push(T.mkRow(nextId++));
    editing = null;
    sel = { r0: 0, c0: 0, r1: 0, c1: 0 };
    void save();
  }

  // ─── Helpers for arrival status ─────────────────────────────────────
  function isOnTime(r: T.TrackerRow): boolean {
    const callT = T.parseTimeToday(r.callTime);
    const arrT = r.arrivedAt ? T.parseTimeToday(r.arrivedAt) : null;
    if (!callT || !arrT) return true; // no data = assume on time
    let effArr = arrT;
    if (r.adjMins) effArr = new Date(arrT.getTime() + r.adjMins * 60000);
    return effArr.getTime() <= callT.getTime();
  }
</script>

<!-- Global event handlers -->
<svelte:window
  onclick={closeCtx}
  onkeydown={(e) => { if (e.key === 'Escape') closeCtx(); }}
  onmouseup={() => dragging = false}
/>

<div class="tracker-tab">
  <!-- HEADER BAR -->
  <div class="tool-hdr">
    <h2>{mode === 'cast' ? 'Cast Call Timer' : 'Crew Call Timer'}</h2>
    <div class="thr">
      <span class="li">Warn</span>
      <input type="number" class="warn-input" bind:value={warnMinutes} min={0} max={120}>
      <span class="li">min before call</span>
      <button class="btn btn-a btn-sm" onclick={() => now = new Date()}>Refresh</button>
      {#if mode === 'cast'}
        <button class="btn btn-sm" onclick={doKioskSync} title="Pull times from Sign-In Station">Kiosk</button>
      {/if}
      <button class="btn btn-sm" onclick={clearAll}>Clear All</button>
    </div>
  </div>

  <!-- SPLIT: GRID | TIMERS -->
  <div class="split">
    <!-- LEFT: SPREADSHEET -->
    <div class="panel">
      <div class="ph2">
        <span class="pt">{mode === 'cast' ? 'Cast & Background' : 'Department Crew'}</span>
        <span class="hint-txt">dbl-click=edit · paste=fill · click chip=arrival</span>
      </div>
      <div class="pb">
        <div class="grid-wrap">
          <table
            class="sg"
            bind:this={tableEl}
            tabindex="0"
            role="grid"
            aria-label="{mode === 'cast' ? 'Cast' : 'Crew'} roster"
            onkeydown={onTableKeydown}
            onpaste={onTablePaste}
          >
            <thead><tr>
              <th class="th-rn"></th>
              {#each colLabels as label, ci}
                <th class={['th-id','th-name','th-role','th-call','th-onset'][ci]}>{label}</th>
              {/each}
              <th class="th-iso">ISO</th>
              <th class="th-del"></th>
            </tr></thead>
            <tbody>
              {#each rows as row, ri (row.id)}
                <tr>
                  <td class="rn">{ri + 1}</td>
                  {#each T.COLS as col, ci}
                    {@const isEditing = editing?.ri === ri && editing?.ci === ci}
                    {@const isMono = col === 'callTime' || col === 'onSetTime'}
                    <!-- svelte-ignore a11y_mouse_events_have_key_events -->
                    <td
                      class="data {['w-id','w-name','w-role','w-call','w-onset'][ci]}"
                      class:mono={isMono}
                      class:in-sel={inSel(ri, ci) && !isAnchor(ri, ci)}
                      class:anchor-cell={isAnchor(ri, ci)}
                      onmousedown={(e) => {
                        if (editing) commitEdit();
                        e.preventDefault();
                        sel = { r0: ri, c0: ci, r1: ri, c1: ci };
                        dragging = true;
                        tableEl?.focus();
                      }}
                      onmouseover={() => { if (dragging) sel = { ...sel, r1: ri, c1: ci }; }}
                      ondblclick={(e) => { e.preventDefault(); void startEdit(ri, ci); }}
                    >
                      {#if isEditing}
                        <input
                          bind:this={editInput}
                          bind:value={editVal}
                          class="cell-editor"
                          class:mono={isMono}
                          onkeydown={onEditorKey}
                          onblur={() => setTimeout(commitEdit, 80)}
                          placeholder={colLabels[ci]}
                        />
                      {:else}
                        <div class="cv" class:empty={!row[col]}>
                          {row[col] || colLabels[ci] || ''}
                        </div>
                      {/if}
                    </td>
                  {/each}
                  <td class="ic">
                    <input
                      type="checkbox"
                      class="iso-check"
                      checked={row.isolate}
                      onchange={() => toggleIsolate(ri)}
                    />
                  </td>
                  <td class="dc">
                    <button class="del-btn" onclick={() => deleteRow(ri)} title="Remove row">&times;</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>

          <!-- Below grid: add row + upload mode + PDF zone -->
          <div class="arw">
            <button class="btn btn-sm" onclick={addRow}>+ Add Row</button>
            <div class="um-toggle">
              <button
                class="um-btn"
                class:active={replaceOnUpload}
                onclick={() => replaceOnUpload = true}
              >Replace</button>
              <button
                class="um-btn"
                class:active={!replaceOnUpload}
                onclick={() => replaceOnUpload = false}
              >Append</button>
            </div>
            <span class="um-label">on upload</span>
          </div>

          <!-- PDF drop zone -->
          <div
            class="pdf-zone"
            role="button"
            tabindex="0"
            ondragover={(e) => e.preventDefault()}
            ondrop={onDrop}
            onclick={() => fileInput?.click()}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click(); } }}
          >
            <input
              bind:this={fileInput}
              type="file"
              accept=".pdf"
              onchange={onFileChange}
              style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"
            />
            <div class="pdf-icon">&#128196;</div>
            <div class="pdf-zone-text">
              <strong>Upload Call Sheet PDF</strong>
              Extracts {mode === 'cast' ? 'cast & BG' : 'department crew'} only
            </div>
          </div>
          {#if pdfStatus}
            <div class="pdf-status {pdfStatus.type}">
              {#if pdfStatus.type === 'loading'}<span class="spinner"></span>{/if}
              {pdfStatus.msg}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- RIGHT: TIMER CARDS -->
    <div class="panel">
      <div class="ph2">
        <span class="pt">Timers</span>
        <span class="hint-txt">click chip = mark arrival</span>
      </div>
      <div class="pb">
        <div class="tw">
          {#if timerGroups.length === 0}
            <div class="nt">Enter call times to see countdowns</div>
          {:else}
            {#each timerGroups as group (group.effectiveTime + (group.isIsolated ? '-iso-' + group.members[0]?.id : ''))}
              {@const displayMs = group.status === 'upcoming' ? group.warnCountdownMs : group.countdownMs}
              {@const callH = group.time.getHours()}
              {@const callM = group.time.getMinutes()}
              <div class="tc-card {group.status}">
                <div class="tc-head">
                  <span class="tc-ct12">{T.fmt12h(callH, callM)}</span>
                  <span class="tc-ct24">{String(callH).padStart(2,'0')}:{String(callM).padStart(2,'0')}</span>
                  <div class="tc-badge {group.status}">
                    {group.status === 'past' ? 'CALLED' : group.status === 'warning' ? 'WARN' : 'UPCOMING'}
                  </div>
                  {#if group.isIsolated}<span class="tc-iso">ISO</span>{/if}
                </div>
                <div class="tc-chips">
                  {#each group.members as m (m.id)}
                    {@const chipState = m.arrived ? 'arrived' : group.status === 'past' ? 'missing' : group.status === 'warning' ? 'warn' : ''}
                    <button
                      class="tc-chip {chipState}"
                      onclick={() => toggleArrival(m.id)}
                      title={m.arrived ? 'Click to unarrive' : 'Click to mark arrived'}
                    >
                      {m.arrived ? '&#10003; ' : ''}{m.name}{#if m.arrived && m.arrivedAt}{' '}&#183; {m.arrivedAt}{/if}
                      {#if m.role}<span class="tc-chip-role">{m.role}</span>{/if}
                    </button>
                  {/each}
                </div>
                <div class="tc-foot">
                  <span class="tc-cd-lbl">{group.status === 'past' ? 'after call' : 'until call'}</span>
                  <span class="tc-cd {group.status}">{T.fmtMs(displayMs)}</span>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- ARRIVAL LOG -->
  <div class="arr-section">
    <div class="arr-hdr">
      <span class="pt">Arrival Log</span>
      <span class="arr-count">{arrivedCount} arrived</span>
    </div>
    <div class="arr-scroll">
      {#if arrivedRows.length === 0}
        <div class="arr-empty">No arrivals logged yet — click a name chip above to mark arrival</div>
      {:else}
        <table class="arr-table">
          <thead><tr>
            <th>Name</th><th>Role</th><th>Call</th><th>Arrived</th><th>Adj</th><th>Status</th>
          </tr></thead>
          <tbody>
            {#each arrivedRows as r (r.id)}
              <tr class="arr-row" oncontextmenu={(e) => openCtx(e, r.id)}>
                <td class="name-cell">{r.name}</td>
                <td>{r.role || ''}</td>
                <td class="mono">{T.fmt12(r.callTime)}</td>
                <td class="mono">{T.fmt12(r.arrivedAt)}</td>
                <td>
                  {#if r.adjMins}
                    <span class="arr-adj" title={r.adjNote || 'adjustment'}>
                      {r.adjMins > 0 ? '+' : ''}{r.adjMins}m
                    </span>
                  {/if}
                </td>
                <td>
                  {#if isOnTime(r)}
                    <span class="arr-badge on-time">ON TIME</span>
                  {:else}
                    <span class="arr-badge late">LATE</span>
                  {/if}
                  {#if r.wrapTime}
                    <span class="arr-wrap">W:{r.wrapTime}</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
</div>

<!-- CONTEXT MENU (arrival log right-click) -->
{#if ctxMenu}
  <div
    class="ctx-menu"
    role="menu"
    tabindex="-1"
    style="left:{ctxMenu.x}px;top:{ctxMenu.y}px"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === 'Escape') closeCtx(); }}
  >
    <button class="ctx-item" type="button" onclick={ctxAdjust}>Adjust arrival time...</button>
    <button class="ctx-item" type="button" onclick={ctxWrap}>Mark as wrapped</button>
    <button class="ctx-item" type="button" onclick={ctxUnarrive}>Unarrive (clear arrival)</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item ctx-danger" type="button" onclick={ctxRemove}>Remove from tracker</button>
  </div>
{/if}


<style>
  /* ── Layout ── */
  .tracker-tab {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 52px - 34px); /* minus topnav and UH bar */
    overflow: hidden;
  }

  .tool-hdr {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 9px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    flex-shrink: 0;
    flex-wrap: wrap;
    row-gap: 6px;
  }
  .tool-hdr h2 {
    font-family: var(--cond);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text2);
  }
  .thr { display: flex; align-items: center; gap: 9px; margin-left: auto; }
  .li { font-family: var(--mono); font-size: 11px; color: var(--text2); white-space: nowrap; }

  .warn-input {
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--accent);
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 500;
    padding: 4px 10px;
    width: 60px;
    text-align: center;
    outline: none;
    user-select: text;
  }
  .warn-input:focus { border-color: var(--accent); }

  /* Buttons */
  .btn {
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    padding: 5px 12px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .btn:hover { background: var(--bg4); border-color: var(--text3); }
  .btn-a { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
  .btn-a:hover { background: var(--accent2); border-color: var(--accent2); }
  .btn-sm { padding: 3px 9px; font-size: 11px; }

  /* ── Split panes ── */
  .split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }
  .panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel:first-child { border-right: 1px solid var(--border); }
  .ph2 {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 6px 13px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .pt {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text3);
  }
  .hint-txt {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    margin-left: auto;
  }
  .pb { flex: 1; overflow: auto; position: relative; }

  /* ── Spreadsheet grid ── */
  .grid-wrap { padding: 10px; min-width: max-content; }

  table.sg { border-collapse: collapse; table-layout: fixed; font-size: 12px; }
  table.sg th {
    background: var(--bg3);
    border: 1px solid var(--border);
    padding: 4px 7px;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text3);
    font-weight: 500;
    white-space: nowrap;
    text-align: left;
  }
  .th-rn { width: 28px; }
  .th-iso { width: 42px; text-align: center; }
  .th-del { width: 28px; }

  table.sg td {
    border: 1px solid var(--border);
    padding: 0;
    height: 26px;
    vertical-align: middle;
    position: relative;
    cursor: default;
  }
  td.rn {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--text3);
    padding: 0 6px;
    text-align: center;
    width: 28px;
    background: var(--bg2);
  }
  td.data .cv {
    display: block;
    padding: 0 7px;
    line-height: 26px;
    white-space: nowrap;
    overflow: hidden;
    color: var(--text);
    font-size: 12px;
    min-height: 26px;
  }
  td.data.mono .cv { font-family: var(--mono); }
  td.data .cv.empty { color: var(--text3); opacity: 0.4; }
  td.data.in-sel { background: rgba(167, 139, 250, 0.12); }
  td.data.anchor-cell { background: rgba(167, 139, 250, 0.18); box-shadow: inset 0 0 0 2px var(--accent); }
  .w-id { width: 56px; min-width: 56px; }
  .w-name { width: 155px; min-width: 100px; }
  .w-role { width: 120px; min-width: 80px; }
  .w-call { width: 68px; min-width: 60px; }
  .w-onset { width: 68px; min-width: 60px; }

  td.ic { width: 42px; text-align: center; padding: 4px; border: 1px solid var(--border); }
  td.dc { width: 28px; text-align: center; border: 1px solid var(--border); }

  .cell-editor {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: var(--bg3);
    border: 2px solid var(--accent);
    color: var(--text);
    font-family: var(--font);
    font-size: 12px;
    padding: 0 6px;
    outline: none;
    z-index: 10;
    user-select: text;
  }
  .cell-editor.mono { font-family: var(--mono); }

  .del-btn {
    background: none;
    border: none;
    color: var(--text3);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 1px 4px;
    transition: color 0.12s;
  }
  .del-btn:hover { color: var(--danger); }
  .iso-check { width: 13px; height: 13px; cursor: pointer; accent-color: var(--accent); }

  /* Below grid controls */
  .arw { padding: 6px 10px; display: flex; align-items: center; gap: 10px; }
  .um-toggle {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .um-btn {
    background: none;
    border: none;
    color: var(--text3);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    padding: 4px 9px;
    cursor: pointer;
    letter-spacing: 0.04em;
    transition: background 0.12s, color 0.12s;
    white-space: nowrap;
    text-transform: uppercase;
  }
  .um-btn + .um-btn { border-left: 1px solid var(--border); }
  .um-btn.active { background: var(--bg4); color: var(--accent); }
  .um-btn:hover:not(.active) { color: var(--text2); background: var(--bg3); }
  .um-label { font-family: var(--mono); font-size: 10px; color: var(--text3); }

  /* PDF zone */
  .pdf-zone {
    margin: 8px 10px 0;
    border: 1px dashed var(--border2);
    border-radius: 5px;
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
    position: relative;
  }
  .pdf-zone:hover { border-color: var(--accent); background: rgba(167, 139, 250, 0.04); }
  .pdf-icon { font-size: 18px; flex-shrink: 0; }
  .pdf-zone-text { font-family: var(--mono); font-size: 10px; color: var(--text3); line-height: 1.5; }
  .pdf-zone-text strong { color: var(--text2); display: block; margin-bottom: 1px; font-size: 10px; }

  .pdf-status {
    margin: 5px 10px 0;
    font-family: var(--mono);
    font-size: 10px;
    padding: 6px 10px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .pdf-status.loading { background: var(--bg3); color: var(--text2); }
  .pdf-status.ok { background: rgba(52, 211, 153, 0.1); color: var(--success); border: 1px solid rgba(52, 211, 153, 0.2); }
  .pdf-status.err { background: rgba(224, 90, 90, 0.1); color: var(--danger); border: 1px solid rgba(224, 90, 90, 0.2); }

  .spinner {
    width: 11px;
    height: 11px;
    border: 2px solid var(--border2);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Timer cards ── */
  .tw { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .nt {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
    text-align: center;
    padding: 40px 20px;
    letter-spacing: 0.04em;
  }

  .tc-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px 14px;
    position: relative;
    overflow: hidden;
  }
  .tc-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--border2);
  }
  .tc-card.warning { border-color: rgba(167, 139, 250, 0.35); }
  .tc-card.warning::before { background: var(--accent); }
  .tc-card.past { border-color: rgba(224, 90, 90, 0.3); opacity: 0.85; }
  .tc-card.past::before { background: var(--danger); }

  .tc-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 9px; }
  .tc-ct12 { font-family: var(--mono); font-size: 18px; font-weight: 500; color: var(--text); line-height: 1; }
  .tc-ct24 { font-family: var(--mono); font-size: 11px; color: var(--text3); line-height: 1; }
  .tc-badge {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    border-radius: 2px;
    margin-left: auto;
  }
  .tc-badge.upcoming { background: var(--bg3); color: var(--text3); }
  .tc-badge.warning { background: rgba(167, 139, 250, 0.15); color: var(--accent); }
  .tc-badge.past { background: rgba(224, 90, 90, 0.15); color: var(--danger); }
  .tc-iso {
    font-family: var(--mono);
    font-size: 9px;
    padding: 2px 5px;
    background: var(--bg4);
    color: var(--text3);
    border-radius: 2px;
    margin-left: 4px;
    align-self: center;
  }

  .tc-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 9px; }
  .tc-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
    background: var(--bg4);
    color: var(--text2);
    border: 1px solid var(--border2);
    user-select: none;
    white-space: nowrap;
  }
  .tc-chip:hover { border-color: var(--text3); color: var(--text); }
  .tc-chip.warn { background: rgba(167, 139, 250, 0.1); color: var(--accent); border-color: rgba(167, 139, 250, 0.28); }
  .tc-chip.warn:hover { background: rgba(167, 139, 250, 0.18); }
  .tc-chip.missing { background: rgba(224, 90, 90, 0.13); color: var(--danger); border-color: rgba(224, 90, 90, 0.3); }
  .tc-chip.missing:hover { background: rgba(224, 90, 90, 0.2); }
  .tc-chip.arrived { background: rgba(52, 211, 153, 0.13); color: var(--success); border-color: rgba(52, 211, 153, 0.3); }
  .tc-chip.arrived:hover { background: rgba(52, 211, 153, 0.2); }
  .tc-chip-role { font-size: 10px; opacity: 0.7; font-family: var(--mono); }

  .tc-foot { display: flex; align-items: baseline; justify-content: flex-end; gap: 8px; }
  .tc-cd-lbl { font-family: var(--mono); font-size: 11px; color: var(--text3); letter-spacing: 0.04em; }
  .tc-cd { font-family: var(--mono); font-size: 30px; font-weight: 500; letter-spacing: 0.02em; color: var(--text); line-height: 1; }
  .tc-cd.warning { color: var(--accent); }
  .tc-cd.past { color: var(--danger); }

  /* ── Arrival log ── */
  .arr-section {
    flex-shrink: 0;
    border-top: 1px solid var(--border);
    height: 180px;
    display: flex;
    flex-direction: column;
  }
  .arr-hdr {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 6px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .arr-count { font-family: var(--mono); font-size: 11px; color: var(--text3); margin-left: auto; }
  .arr-scroll { flex: 1; overflow-y: auto; }
  .arr-empty {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
    padding: 18px 16px;
    text-align: center;
  }

  table.arr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.arr-table th {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text3);
    padding: 5px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg2);
    white-space: nowrap;
  }
  table.arr-table td {
    padding: 5px 12px;
    border-bottom: 1px solid var(--border);
    color: var(--text2);
    cursor: context-menu;
  }
  table.arr-table td.mono { font-family: var(--mono); }
  table.arr-table td.name-cell { color: var(--text); font-weight: 500; }

  .arr-adj {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--accent);
    cursor: help;
  }
  .arr-badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 2px;
    letter-spacing: 0.04em;
  }
  .arr-badge.on-time { background: rgba(52, 211, 153, 0.12); color: var(--success); }
  .arr-badge.late { background: rgba(224, 90, 90, 0.12); color: var(--danger); }
  .arr-wrap {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    margin-left: 6px;
  }

  /* ── Context menu ── */
  .ctx-menu {
    position: fixed;
    z-index: 2000;
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 5px;
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .ctx-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 7px 14px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text2);
    background: none;
    border: none;
    font-family: inherit;
    transition: background 0.1s, color 0.1s;
  }
  .ctx-item:hover { background: var(--bg4); color: var(--text); }
  .ctx-item.ctx-danger { color: var(--danger); }
  .ctx-sep { height: 1px; background: var(--border); margin: 3px 0; }

  /* ── Responsive ── */
  @media (max-width: 768px) {
    .split { grid-template-columns: 1fr; }
    .panel:first-child { border-right: none; border-bottom: 1px solid var(--border); max-height: 50%; }
    .tracker-tab { height: auto; min-height: calc(100vh - 86px); }
  }
</style>
