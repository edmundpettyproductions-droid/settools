<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as sync from '../lib/sync';
  import * as T from '../lib/tracker';
  import * as extract from '../lib/extract';
  import * as N from '../lib/notifications';
  import * as SMS from '../lib/sms';

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

  // Notifications
  let notifPrefs = $state<N.NotifPrefs>(N.DEFAULT_PREFS);
  let notifOpen = $state(false);
  let notifPerm = $state<NotificationPermission>('default');
  let toast = $state<{ title: string; body: string } | null>(null);
  let toastTimer: number | undefined;
  // Dedupe — keys are `${dateStr}:${event}:${id}` so they reset each day
  const firedKeys = new Set<string>();
  // Previous arrived state per row id (for arrival edge detection)
  const prevArrived = new Map<number, boolean>();
  // Previous "all arrived" state per group key
  const prevAllArrived = new Map<string, boolean>();

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
    notifPrefs = N.loadPrefs(mode);
    notifPerm = N.permission();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(cfg.storageKey)) load();
      if (keys.includes(N.prefsKey(mode))) notifPrefs = N.loadPrefs(mode);
      // Auto-sync arrivals when sign-in kiosk data changes
      if (keys.includes('ST_signin')) {
        const result = T.syncFromKiosk(rows);
        if (result.matched > 0) void save();
      }
    });
    // Tick every second for live countdowns
    tickTimer = window.setInterval(() => { now = new Date(); }, 1000);
    return () => {
      unsub();
      if (tickTimer !== undefined) clearInterval(tickTimer);
      if (toastTimer !== undefined) clearTimeout(toastTimer);
    };
  });

  // ─── Notification triggers ──────────────────────────────────────────
  function showToast(title: string, body: string) {
    toast = { title, body };
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast = null; }, 6000);
  }

  function todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function fireOnce(key: string, event: { title: string; body: string; vibrationId: string; sms: boolean; smsFrom: N.FromSlot }) {
    const k = `${todayKey()}:${key}`;
    if (firedKeys.has(k)) return;
    firedKeys.add(k);
    N.fire(notifPrefs, {
      title: event.title,
      body: event.body,
      vibrationId: event.vibrationId,
      tag: k,
      sms: event.sms,
      smsFrom: event.smsFrom,
    });
    showToast(event.title, event.body);
  }

  // Watch tick → evaluate triggers
  $effect(() => {
    // Read `now` so this re-runs every second
    void now;
    if (!notifPrefs.enabled) return;
    const label = mode === 'cast' ? 'Cast' : 'Crew';

    // Pre-call + all-arrived per group
    for (const g of timerGroups) {
      const gKey = g.effectiveTime + (g.isIsolated ? '-iso-' + (g.members[0]?.id ?? '') : '');

      // Pre-call warning
      if (notifPrefs.preCallEnabled) {
        const preMs = notifPrefs.preCallMinutes * 60000;
        const untilCall = g.countdownMs;
        if (untilCall > 0 && untilCall <= preMs) {
          const names = g.members.map(m => m.name).filter(Boolean).join(', ');
          fireOnce(`pre:${gKey}`, {
            title: `${label} call in ${notifPrefs.preCallMinutes}m`,
            body: `${g.effectiveTime} — ${names || g.members.length + ' people'}`,
            vibrationId: notifPrefs.preCallVibration,
            sms: notifPrefs.preCallSms,
            smsFrom: notifPrefs.preCallSmsFrom,
          });
        }
      }

      // All-arrived (only fire on the transition empty → all-in)
      if (notifPrefs.allArrivedEnabled && g.members.length > 0) {
        const allIn = g.members.every(m => m.arrived);
        const wasAllIn = prevAllArrived.get(gKey) ?? false;
        if (allIn && !wasAllIn) {
          fireOnce(`all:${gKey}`, {
            title: `All ${label.toLowerCase()} in @ ${g.effectiveTime}`,
            body: `${g.members.length} arrived`,
            vibrationId: notifPrefs.allArrivedVibration,
            sms: notifPrefs.allArrivedSms,
            smsFrom: notifPrefs.allArrivedSmsFrom,
          });
        }
        prevAllArrived.set(gKey, allIn);
      }
    }

    // Late + arrival (per row)
    for (const r of rows) {
      if (!r.name || !r.callTime) continue;
      const callT = T.parseTimeToday(r.callTime);
      if (!callT) continue;
      const sinceCall = now.getTime() - callT.getTime();

      // Late: past call, not arrived, threshold passed
      if (notifPrefs.lateEnabled && !r.arrived && sinceCall >= notifPrefs.lateMinutes * 60000) {
        fireOnce(`late:${r.id}`, {
          title: `LATE: ${r.name}`,
          body: `Call ${T.fmt12(r.callTime)} — ${notifPrefs.lateMinutes}m past`,
          vibrationId: notifPrefs.lateVibration,
          sms: notifPrefs.lateSms,
          smsFrom: notifPrefs.lateSmsFrom,
        });
      }

      // Arrival edge detection
      const was = prevArrived.get(r.id) ?? false;
      if (notifPrefs.arrivalEnabled && r.arrived && !was) {
        fireOnce(`arr:${r.id}`, {
          title: `Arrived: ${r.name}`,
          body: `${r.arrivedAt || ''}${r.role ? ' · ' + r.role : ''}`,
          vibrationId: notifPrefs.arrivalVibration,
          sms: notifPrefs.arrivalSms,
          smsFrom: notifPrefs.arrivalSmsFrom,
        });
      }
      prevArrived.set(r.id, r.arrived);
    }
  });

  async function savePrefs() {
    await N.savePrefs(mode, notifPrefs);
  }

  async function toggleMaster() {
    notifPrefs.enabled = !notifPrefs.enabled;
    if (notifPrefs.enabled && notifPrefs.browserEnabled && notifPerm === 'default') {
      notifPerm = await N.requestPermission();
    }
    await savePrefs();
  }

  async function toggleBrowser() {
    notifPrefs.browserEnabled = !notifPrefs.browserEnabled;
    if (notifPrefs.browserEnabled && notifPerm === 'default') {
      notifPerm = await N.requestPermission();
    }
    await savePrefs();
  }

  function testPattern(vibrationId: string, label: string) {
    N.test(notifPrefs, vibrationId, label);
    showToast('Test', label);
  }

  function normalizePhoneOnBlur() {
    if (notifPrefs.smsTo) {
      const cleaned = SMS.normalizeE164(notifPrefs.smsTo);
      if (cleaned !== notifPrefs.smsTo) notifPrefs.smsTo = cleaned;
    }
    void savePrefs();
  }

  let smsTestStatus = $state<string | null>(null);
  let smsTestTimer: number | undefined;
  async function testSmsBtn(fromSlot: N.FromSlot, label: string) {
    if (smsTestTimer !== undefined) clearTimeout(smsTestTimer);
    smsTestStatus = `Sending from slot ${fromSlot}...`;
    const res = await N.testSms(notifPrefs, fromSlot, label);
    smsTestStatus = res.ok ? `Sent from slot ${fromSlot} ✓` : `Failed: ${res.error}`;
    smsTestTimer = window.setTimeout(() => { smsTestStatus = null; }, 5000);
  }

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
  onclick={() => { closeCtx(); notifOpen = false; }}
  onkeydown={(e) => { if (e.key === 'Escape') { closeCtx(); notifOpen = false; } }}
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
      <button class="btn btn-sm" onclick={doKioskSync} title="Manual sync from Sign-In Station (auto-sync is on)">↓ Kiosk</button>
      <button
        class="btn btn-sm notif-btn"
        class:active={notifPrefs.enabled}
        onclick={(e) => { e.stopPropagation(); notifOpen = !notifOpen; }}
        title="Notification settings"
      >&#128276; Notifs{notifPrefs.enabled ? ' ON' : ''}</button>
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

<!-- NOTIFICATION SETTINGS POPOVER -->
{#if notifOpen}
  <div
    class="notif-panel"
    role="dialog"
    aria-label="Notification settings"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === 'Escape') notifOpen = false; }}
    tabindex="-1"
  >
    <div class="notif-hdr">
      <span class="notif-title">{mode === 'cast' ? 'Cast' : 'Crew'} Notifications</span>
      <button class="notif-x" type="button" onclick={() => notifOpen = false} aria-label="Close">&times;</button>
    </div>

    <div class="notif-body">
      <!-- Master row -->
      <label class="notif-row notif-master">
        <input type="checkbox" checked={notifPrefs.enabled} onchange={toggleMaster} />
        <span class="notif-row-label">Enable notifications</span>
      </label>

      <div class="notif-section">
        <div class="notif-section-hdr">Channels</div>

        <label class="notif-row">
          <input
            type="checkbox"
            checked={notifPrefs.browserEnabled}
            onchange={toggleBrowser}
            disabled={!notifPrefs.enabled}
          />
          <span class="notif-row-label">Browser pop-up (when tab unfocused)</span>
          {#if notifPerm === 'denied'}
            <span class="notif-warn">blocked in browser</span>
          {:else if notifPerm === 'default' && notifPrefs.browserEnabled}
            <span class="notif-warn">tap to grant permission</span>
          {/if}
        </label>

        <label class="notif-row">
          <input
            type="checkbox"
            bind:checked={notifPrefs.soundEnabled}
            onchange={savePrefs}
            disabled={!notifPrefs.enabled}
          />
          <span class="notif-row-label">Sound (ding)</span>
        </label>

        <label class="notif-row">
          <input
            type="checkbox"
            bind:checked={notifPrefs.vibrateEnabled}
            onchange={savePrefs}
            disabled={!notifPrefs.enabled}
          />
          <span class="notif-row-label">Vibration</span>
          {#if !N.canVibrate()}
            <span class="notif-warn">not supported on iOS Safari</span>
          {/if}
        </label>

        <label class="notif-row">
          <input
            type="checkbox"
            bind:checked={notifPrefs.onlyWhenHidden}
            onchange={savePrefs}
            disabled={!notifPrefs.enabled}
          />
          <span class="notif-row-label">Only fire when tab is hidden</span>
        </label>
      </div>

      <!-- SMS (Twilio) -->
      <div class="notif-section">
        <div class="notif-section-hdr">
          <label class="notif-event-toggle">
            <input
              type="checkbox"
              bind:checked={notifPrefs.smsEnabled}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled}
            />
            SMS via Twilio
          </label>
        </div>
        <div class="notif-event-controls">
          <label class="notif-inline notif-phone-row">
            <span class="notif-phone-lbl">Your phone</span>
            <input
              type="tel"
              class="notif-phone"
              placeholder="+13105551234"
              bind:value={notifPrefs.smsTo}
              onblur={normalizePhoneOnBlur}
              disabled={!notifPrefs.enabled || !notifPrefs.smsEnabled}
            />
          </label>
          {#if notifPrefs.smsEnabled && notifPrefs.smsTo && !SMS.isValidE164(notifPrefs.smsTo)}
            <div class="notif-warn-inline">Not valid E.164 — expecting +13105551234</div>
          {/if}
          <div class="notif-foot-inline">
            Each event below can pick a Twilio sender slot (A–D). Save each as a contact in iOS with a unique custom vibration to get per-event patterns.
          </div>
          {#if smsTestStatus}
            <div class="notif-sms-status">{smsTestStatus}</div>
          {/if}
        </div>
      </div>

      <!-- Pre-call -->
      <div class="notif-section">
        <div class="notif-section-hdr">
          <label class="notif-event-toggle">
            <input
              type="checkbox"
              bind:checked={notifPrefs.preCallEnabled}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled}
            />
            Pre-call warning
          </label>
        </div>
        <div class="notif-event-controls">
          <label class="notif-inline">
            <input
              type="number"
              min={1}
              max={120}
              class="notif-num"
              bind:value={notifPrefs.preCallMinutes}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.preCallEnabled}
            />
            <span>min before call</span>
          </label>
          <div class="notif-vib-row">
            <select
              bind:value={notifPrefs.preCallVibration}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.preCallEnabled}
            >
              {#each N.VIBRATION_PATTERNS as p}
                <option value={p.id}>{p.label}</option>
              {/each}
            </select>
            <button
              class="btn btn-sm"
              type="button"
              onclick={() => testPattern(notifPrefs.preCallVibration, 'Pre-call')}
              disabled={!notifPrefs.enabled}
            >Test</button>
          </div>
          <div class="notif-sms-row">
            <label class="notif-sms-toggle">
              <input
                type="checkbox"
                bind:checked={notifPrefs.preCallSms}
                onchange={savePrefs}
                disabled={!notifPrefs.enabled || !notifPrefs.preCallEnabled || !notifPrefs.smsEnabled}
              />
              SMS
            </label>
            <select
              bind:value={notifPrefs.preCallSmsFrom}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.preCallEnabled || !notifPrefs.smsEnabled || !notifPrefs.preCallSms}
            >
              {#each N.FROM_SLOTS as s}<option value={s}>From {s}</option>{/each}
            </select>
            <button
              class="btn btn-sm"
              type="button"
              onclick={() => testSmsBtn(notifPrefs.preCallSmsFrom, 'Pre-call')}
              disabled={!notifPrefs.enabled || !notifPrefs.smsEnabled || !notifPrefs.smsTo}
            >Send test</button>
          </div>
        </div>
      </div>

      <!-- Late -->
      <div class="notif-section">
        <div class="notif-section-hdr">
          <label class="notif-event-toggle">
            <input
              type="checkbox"
              bind:checked={notifPrefs.lateEnabled}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled}
            />
            Late warning
          </label>
        </div>
        <div class="notif-event-controls">
          <label class="notif-inline">
            <input
              type="number"
              min={1}
              max={120}
              class="notif-num"
              bind:value={notifPrefs.lateMinutes}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.lateEnabled}
            />
            <span>min past call &amp; not arrived</span>
          </label>
          <div class="notif-vib-row">
            <select
              bind:value={notifPrefs.lateVibration}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.lateEnabled}
            >
              {#each N.VIBRATION_PATTERNS as p}
                <option value={p.id}>{p.label}</option>
              {/each}
            </select>
            <button
              class="btn btn-sm"
              type="button"
              onclick={() => testPattern(notifPrefs.lateVibration, 'Late warning')}
              disabled={!notifPrefs.enabled}
            >Test</button>
          </div>
          <div class="notif-sms-row">
            <label class="notif-sms-toggle">
              <input
                type="checkbox"
                bind:checked={notifPrefs.lateSms}
                onchange={savePrefs}
                disabled={!notifPrefs.enabled || !notifPrefs.lateEnabled || !notifPrefs.smsEnabled}
              />
              SMS
            </label>
            <select
              bind:value={notifPrefs.lateSmsFrom}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.lateEnabled || !notifPrefs.smsEnabled || !notifPrefs.lateSms}
            >
              {#each N.FROM_SLOTS as s}<option value={s}>From {s}</option>{/each}
            </select>
            <button
              class="btn btn-sm"
              type="button"
              onclick={() => testSmsBtn(notifPrefs.lateSmsFrom, 'Late')}
              disabled={!notifPrefs.enabled || !notifPrefs.smsEnabled || !notifPrefs.smsTo}
            >Send test</button>
          </div>
        </div>
      </div>

      <!-- Arrival -->
      <div class="notif-section">
        <div class="notif-section-hdr">
          <label class="notif-event-toggle">
            <input
              type="checkbox"
              bind:checked={notifPrefs.arrivalEnabled}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled}
            />
            On arrival (each person)
          </label>
        </div>
        <div class="notif-event-controls">
          <div class="notif-vib-row">
            <select
              bind:value={notifPrefs.arrivalVibration}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.arrivalEnabled}
            >
              {#each N.VIBRATION_PATTERNS as p}
                <option value={p.id}>{p.label}</option>
              {/each}
            </select>
            <button
              class="btn btn-sm"
              type="button"
              onclick={() => testPattern(notifPrefs.arrivalVibration, 'Arrival')}
              disabled={!notifPrefs.enabled}
            >Test</button>
          </div>
          <div class="notif-sms-row">
            <label class="notif-sms-toggle">
              <input
                type="checkbox"
                bind:checked={notifPrefs.arrivalSms}
                onchange={savePrefs}
                disabled={!notifPrefs.enabled || !notifPrefs.arrivalEnabled || !notifPrefs.smsEnabled}
              />
              SMS
            </label>
            <select
              bind:value={notifPrefs.arrivalSmsFrom}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.arrivalEnabled || !notifPrefs.smsEnabled || !notifPrefs.arrivalSms}
            >
              {#each N.FROM_SLOTS as s}<option value={s}>From {s}</option>{/each}
            </select>
            <button
              class="btn btn-sm"
              type="button"
              onclick={() => testSmsBtn(notifPrefs.arrivalSmsFrom, 'Arrival')}
              disabled={!notifPrefs.enabled || !notifPrefs.smsEnabled || !notifPrefs.smsTo}
            >Send test</button>
          </div>
        </div>
      </div>

      <!-- All arrived -->
      <div class="notif-section">
        <div class="notif-section-hdr">
          <label class="notif-event-toggle">
            <input
              type="checkbox"
              bind:checked={notifPrefs.allArrivedEnabled}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled}
            />
            All arrived (whole group in)
          </label>
        </div>
        <div class="notif-event-controls">
          <div class="notif-vib-row">
            <select
              bind:value={notifPrefs.allArrivedVibration}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.allArrivedEnabled}
            >
              {#each N.VIBRATION_PATTERNS as p}
                <option value={p.id}>{p.label}</option>
              {/each}
            </select>
            <button
              class="btn btn-sm"
              type="button"
              onclick={() => testPattern(notifPrefs.allArrivedVibration, 'All arrived')}
              disabled={!notifPrefs.enabled}
            >Test</button>
          </div>
          <div class="notif-sms-row">
            <label class="notif-sms-toggle">
              <input
                type="checkbox"
                bind:checked={notifPrefs.allArrivedSms}
                onchange={savePrefs}
                disabled={!notifPrefs.enabled || !notifPrefs.allArrivedEnabled || !notifPrefs.smsEnabled}
              />
              SMS
            </label>
            <select
              bind:value={notifPrefs.allArrivedSmsFrom}
              onchange={savePrefs}
              disabled={!notifPrefs.enabled || !notifPrefs.allArrivedEnabled || !notifPrefs.smsEnabled || !notifPrefs.allArrivedSms}
            >
              {#each N.FROM_SLOTS as s}<option value={s}>From {s}</option>{/each}
            </select>
            <button
              class="btn btn-sm"
              type="button"
              onclick={() => testSmsBtn(notifPrefs.allArrivedSmsFrom, 'All arrived')}
              disabled={!notifPrefs.enabled || !notifPrefs.smsEnabled || !notifPrefs.smsTo}
            >Send test</button>
          </div>
        </div>
      </div>

      <div class="notif-foot">
        iOS note: in-tab vibration is not supported on Safari. Use SMS with per-slot iOS contact vibrations for off-tab delivery to your phone.
      </div>
    </div>
  </div>
{/if}

<!-- TOAST -->
{#if toast}
  <div class="st-toast" role="status">
    <div class="st-toast-title">{toast.title}</div>
    {#if toast.body}<div class="st-toast-body">{toast.body}</div>{/if}
  </div>
{/if}

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
    height: 100%;
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

  /* ── Notifications: header button ── */
  .notif-btn.active {
    background: rgba(167, 139, 250, 0.18);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ── Notifications: popover ── */
  .notif-panel {
    position: fixed;
    top: 56px;
    right: 16px;
    z-index: 3000;
    width: 360px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    background: var(--bg2);
    border: 1px solid var(--border2);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
    outline: none;
  }
  .notif-hdr {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg3);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .notif-title {
    font-family: var(--cond);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text);
  }
  .notif-x {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text3);
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }
  .notif-x:hover { color: var(--text); }

  .notif-body { padding: 8px 14px 14px; }

  .notif-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    cursor: pointer;
    font-size: 12px;
    color: var(--text2);
  }
  .notif-row input[type="checkbox"] {
    width: 14px; height: 14px;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .notif-row input[disabled] { cursor: not-allowed; opacity: 0.5; }
  .notif-row-label { flex: 1; }
  .notif-master { font-weight: 600; color: var(--text); padding: 8px 0; }

  .notif-warn {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--accent);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .notif-section {
    border-top: 1px solid var(--border);
    margin-top: 8px;
    padding-top: 8px;
  }
  .notif-section-hdr {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text3);
    margin-bottom: 4px;
  }
  .notif-event-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-family: var(--cond);
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.04em;
    text-transform: none;
  }
  .notif-event-toggle input[type="checkbox"] {
    width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer;
  }
  .notif-event-controls {
    padding: 6px 0 4px 22px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .notif-inline {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text2);
  }
  .notif-num {
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--accent);
    font-family: var(--mono);
    font-size: 12px;
    padding: 3px 8px;
    width: 56px;
    text-align: center;
    outline: none;
  }
  .notif-num:focus { border-color: var(--accent); }
  .notif-num:disabled { opacity: 0.5; cursor: not-allowed; }

  .notif-vib-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .notif-vib-row select {
    flex: 1;
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    padding: 4px 6px;
    outline: none;
    cursor: pointer;
  }
  .notif-vib-row select:focus { border-color: var(--accent); }
  .notif-vib-row select:disabled { opacity: 0.5; cursor: not-allowed; }

  .notif-foot {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    line-height: 1.5;
  }

  /* ── SMS sub-controls ── */
  .notif-phone-row { width: 100%; }
  .notif-phone-lbl {
    font-size: 11px;
    color: var(--text2);
    width: 76px;
    flex-shrink: 0;
  }
  .notif-phone {
    flex: 1;
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 12px;
    padding: 4px 8px;
    outline: none;
  }
  .notif-phone:focus { border-color: var(--accent); }
  .notif-phone:disabled { opacity: 0.5; cursor: not-allowed; }

  .notif-warn-inline {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--danger);
  }
  .notif-foot-inline {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    line-height: 1.45;
  }
  .notif-sms-status {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent);
    padding: 4px 0;
  }

  .notif-sms-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 4px;
  }
  .notif-sms-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text2);
    cursor: pointer;
  }
  .notif-sms-toggle input[type="checkbox"] {
    width: 13px; height: 13px; accent-color: var(--accent); cursor: pointer;
  }
  .notif-sms-row select {
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    padding: 3px 6px;
    outline: none;
    cursor: pointer;
    min-width: 72px;
  }
  .notif-sms-row select:focus { border-color: var(--accent); }
  .notif-sms-row select:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── In-app toast ── */
  .st-toast {
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 4000;
    background: var(--bg3);
    border: 1px solid var(--accent);
    border-left: 3px solid var(--accent);
    border-radius: 5px;
    padding: 10px 16px;
    min-width: 220px;
    max-width: 360px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    animation: toast-in 0.18s ease-out;
  }
  .st-toast-title {
    font-family: var(--cond);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 3px;
  }
  .st-toast-body {
    font-size: 12px;
    color: var(--text);
  }
  @keyframes toast-in {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  /* ── Responsive ── */
  @media (max-width: 768px) {
    .split { grid-template-columns: 1fr; }
    .panel:first-child { border-right: none; border-bottom: 1px solid var(--border); max-height: 50%; }
    .tracker-tab { height: auto; min-height: 100%; }
  }
</style>
