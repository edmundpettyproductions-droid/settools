<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as sync from '../lib/sync';
  import * as D from '../lib/dood';
  import * as extract from '../lib/extract';

  // ─── State ──────────────────────────────────────────────────────────
  let data = $state<D.DOODData>(D.loadDOOD());
  let editingTitle = $state(false);
  let titleVal = $state('');
  let titleEl = $state<HTMLInputElement | null>(null);

  // Setup wizard
  let showSetup = $state(false);
  let setupCast = $state('');
  let setupDays = $state('20');
  let setupTitle = $state('');
  let setupStart = $state('1');

  // PDF extract
  let fileInput = $state<HTMLInputElement | null>(null);
  let extracting = $state(false);
  let extractErr = $state<string | null>(null);

  // Cell picker
  let pickerCell = $state<{ castId: string; dayNum: number } | null>(null);

  // ─── Derived ────────────────────────────────────────────────────────
  let isEmpty = $derived(data.cast.length === 0);

  // ─── Load / Save ───────────────────────────────────────────────────
  function load() { data = D.loadDOOD(); }

  async function save() { await D.saveDOOD(data); }

  onMount(() => {
    load();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(D.STORAGE_KEY)) load();
    });
    return () => unsub();
  });

  // ─── Title edit ─────────────────────────────────────────────────────
  async function startTitleEdit() {
    titleVal = data.title;
    editingTitle = true;
    await tick();
    titleEl?.focus();
    titleEl?.select();
  }
  async function commitTitle() {
    data.title = titleVal.trim() || 'DOOD';
    editingTitle = false;
    await save();
  }

  // ─── Today marker ──────────────────────────────────────────────────
  async function setToday(dayNum: number) {
    data.todayDayNum = data.todayDayNum === dayNum ? null : dayNum;
    data = data;
    await save();
  }

  // ─── Cell status cycling ───────────────────────────────────────────
  function cycleStatus(castId: string, dayNum: number) {
    const current = D.getStatus(data, castId, dayNum);
    const order: D.StatusCode[] = ['', 'W', 'H', 'SW', 'WF', 'SWF', 'T', 'R', 'WD', 'PU'];
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length];
    if (next !== undefined) {
      D.setStatus(data, castId, dayNum, next);
      data = data; // trigger reactivity
      void save();
    }
  }

  function openPicker(castId: string, dayNum: number) {
    pickerCell = { castId, dayNum };
  }
  function closePicker() { pickerCell = null; }

  async function pickStatus(code: D.StatusCode) {
    if (!pickerCell) return;
    D.setStatus(data, pickerCell.castId, pickerCell.dayNum, code);
    data = data;
    pickerCell = null;
    await save();
  }

  // ─── Setup wizard ──────────────────────────────────────────────────
  async function applySetup() {
    const names = setupCast.split('\n').map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    const numDays = parseInt(setupDays, 10) || 20;
    const startDay = parseInt(setupStart, 10) || 1;
    data = D.buildEmptyDOOD(setupTitle || 'DOOD', names, numDays, startDay);
    showSetup = false;
    await save();
  }

  // ─── PDF extraction ────────────────────────────────────────────────
  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void extractDOOD(file);
    input.value = '';
  }

  async function extractDOOD(file: File) {
    extracting = true;
    extractErr = null;
    try {
      const b64 = await extract.fileToBase64(file);
      const system = 'You extract Day Out Of Days (DOOD) charts from film/TV production documents. Return ONLY raw JSON, no markdown.';
      const prompt = `Extract the DOOD chart from this document. Return exactly this JSON (no markdown):
{"title":"","cast":[{"name":"","role":""}],"days":[{"dayNum":1,"date":""}],"grid":[{"name":"ACTOR NAME","statuses":[{"day":1,"code":"W"}]}]}
Status codes: W=Work, H=Hold, SW=Start/Work, WF=Work/Finish, SWF=Start-Work-Finish, T=Travel, R=Rehearsal, WD=Work/Drop, PU=Pickup, empty string=Off.
days: list all shoot days as dayNum (1-based). grid: for each cast member, list every day they have a status.`;

      const rawResp = await extract.extractFromPdf(b64, prompt, { system });
      const result = extract.parseJsonResponse<D.ExtractedDOOD>(rawResp);
      data = D.parseExtracted(result);
      await save();
    } catch (e) {
      extractErr = e instanceof Error ? e.message.slice(0, 80) : String(e);
    } finally {
      extracting = false;
    }
  }

  // ─── Row management ────────────────────────────────────────────────
  async function addCastRow() {
    const name = prompt('Cast member name:');
    if (!name) return;
    const id = `c${Date.now()}`;
    data.cast.push({ id, name, role: '' });
    data = data;
    await save();
  }

  async function removeCast(id: string) {
    data.cast = data.cast.filter((c) => c.id !== id);
    delete data.grid[id];
    data = data;
    await save();
  }

  async function addDay() {
    const maxDay = data.days.reduce((m, d) => Math.max(m, d.dayNum), 0);
    const next = maxDay + 1;
    data.days.push({ dayNum: next, date: '', label: `D${next}` });
    data = data;
    await save();
  }

  async function clearAll() {
    if (!confirm('Clear entire DOOD? This cannot be undone.')) return;
    data = { title: '', cast: [], days: [], grid: {}, todayDayNum: null };
    await save();
  }
</script>

<svelte:window onclick={closePicker} />

<div class="dood-tab">
  <!-- TOOLBAR -->
  <div class="toolbar">
    {#if editingTitle}
      <input
        bind:this={titleEl}
        bind:value={titleVal}
        class="title-edit"
        onblur={() => void commitTitle()}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitTitle(); } if (e.key === 'Escape') editingTitle = false; }}
        spellcheck={false}
      />
    {:else}
      <button class="title-btn" onclick={startTitleEdit}>
        {data.title || 'Day Out of Days'}
      </button>
    {/if}

    <div class="toolbar-actions">
      {#if !isEmpty}
        <button class="tb-btn" onclick={addCastRow}>+ Cast</button>
        <button class="tb-btn" onclick={addDay}>+ Day</button>
      {/if}
      <button class="tb-btn" onclick={() => showSetup = !showSetup}>Setup</button>
      <button
        class="tb-btn"
        class:extracting
        disabled={extracting}
        onclick={() => fileInput?.click()}
      >{extracting ? 'Extracting...' : 'Upload PDF'}</button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        onchange={onFileChange}
        style="position:fixed;left:-9999px;width:0;height:0;opacity:0"
      />
      {#if !isEmpty}
        <button class="tb-btn danger" onclick={clearAll}>Clear</button>
      {/if}
    </div>
    {#if extractErr}
      <span class="extract-err">{extractErr}</span>
    {/if}
  </div>

  <!-- SETUP WIZARD -->
  {#if showSetup}
    <div class="setup-panel">
      <div class="setup-row">
        <label>
          Title
          <input bind:value={setupTitle} placeholder="Production DOOD" />
        </label>
        <label>
          Shoot Days
          <input bind:value={setupDays} type="number" min="1" max="100" style="width:60px" />
        </label>
        <label>
          Start Day #
          <input bind:value={setupStart} type="number" min="1" style="width:60px" />
        </label>
      </div>
      <label class="setup-cast-label">
        Cast (one per line)
        <textarea bind:value={setupCast} rows="4" placeholder="Actor Name&#10;Another Actor&#10;..."></textarea>
      </label>
      <div class="setup-actions">
        <button class="tb-btn" onclick={applySetup}>Create DOOD</button>
        <button class="tb-btn ghost" onclick={() => showSetup = false}>Cancel</button>
      </div>
    </div>
  {/if}

  <!-- LEGEND -->
  {#if !isEmpty}
    <div class="legend">
      {#each D.ALL_CODES.filter((c) => c !== '') as code}
        <span class="legend-item">
          <span class="legend-swatch" style:background={D.CODE_COLORS[code]}></span>
          <span class="legend-code">{code}</span>
          <span class="legend-label">{D.CODE_LABELS[code]}</span>
        </span>
      {/each}
    </div>
  {/if}

  <!-- GRID -->
  {#if isEmpty && !showSetup}
    <div class="empty">
      <h3>No DOOD Loaded</h3>
      <p>Click <strong>Setup</strong> to create a blank DOOD, or <strong>Upload PDF</strong> to extract one from a document.</p>
    </div>
  {:else if !isEmpty}
    <div class="grid-scroll">
      <table class="dood-grid" role="grid">
        <thead>
          <tr>
            <th class="corner">Cast</th>
            <th class="role-col">Role</th>
            <th class="stat-col">W</th>
            <th class="stat-col">H</th>
            {#each data.days as day (day.dayNum)}
              <th
                class="day-col"
                class:today={data.todayDayNum === day.dayNum}
              >
                <button
                  class="day-btn"
                  onclick={() => void setToday(day.dayNum)}
                  title={data.todayDayNum === day.dayNum ? 'Unmark today' : 'Mark as today'}
                >{day.label}</button>
                {#if day.date}<span class="day-date">{day.date}</span>{/if}
              </th>
            {/each}
            <th class="del-col"></th>
          </tr>
        </thead>
        <tbody>
          {#each data.cast as member (member.id)}
            <tr>
              <td class="name-cell">{member.name}</td>
              <td class="role-cell">{member.role}</td>
              <td class="stat-cell">{D.workDays(data, member.id)}</td>
              <td class="stat-cell">{D.holdDays(data, member.id)}</td>
              {#each data.days as day (day.dayNum)}
                {@const code = D.getStatus(data, member.id, day.dayNum)}
                <td
                  class="grid-cell"
                  class:today={data.todayDayNum === day.dayNum}
                  class:has-status={code !== ''}
                  style:background={code ? `${D.CODE_COLORS[code]}22` : undefined}
                >
                  <button
                    class="cell-btn"
                    style:color={D.CODE_COLORS[code] || 'var(--text3)'}
                    onclick={() => cycleStatus(member.id, day.dayNum)}
                    oncontextmenu={(e) => { e.preventDefault(); openPicker(member.id, day.dayNum); }}
                    title="{code ? D.CODE_LABELS[code] : 'Off'} — click to cycle, right-click to pick"
                  >{code || '·'}</button>
                </td>
              {/each}
              <td class="del-cell">
                <button class="row-del" onclick={() => void removeCast(member.id)} title="Remove">x</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- STATUS PICKER -->
{#if pickerCell}
  <div class="picker" role="menu" tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === 'Escape') closePicker(); }}>
    {#each D.ALL_CODES as code}
      <button
        role="menuitem"
        class="picker-item"
        onclick={() => void pickStatus(code)}
      >
        <span class="picker-swatch" style:background={D.CODE_COLORS[code] || 'var(--bg3)'}></span>
        <span class="picker-code">{code || '—'}</span>
        <span class="picker-label">{D.CODE_LABELS[code]}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .dood-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ─── Toolbar ─── */
  .toolbar {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .title-btn {
    background: none;
    border: none;
    border-bottom: 1px dashed transparent;
    font-family: var(--cond);
    font-size: 16px;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
    padding: 2px 4px;
    transition: border-color 0.1s;
  }
  .title-btn:hover { border-bottom-color: var(--accent); }
  .title-edit {
    font-family: var(--cond);
    font-size: 16px;
    font-weight: 700;
    color: var(--accent);
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 2px 8px;
    outline: none;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    width: 200px;
  }

  .toolbar-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
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
  .tb-btn.extracting { color: var(--accent); border-color: var(--accent); animation: pulse-ex 1.5s ease infinite; }
  @keyframes pulse-ex { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }

  .extract-err {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--danger);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ─── Setup ─── */
  .setup-panel {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .setup-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .setup-panel label {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .setup-panel input, .setup-panel textarea {
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 6px 8px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text);
  }
  .setup-panel textarea { resize: vertical; width: 100%; }
  .setup-cast-label { width: 100%; }
  .setup-actions { display: flex; gap: 6px; }

  /* ─── Legend ─── */
  .legend {
    display: flex;
    gap: 10px;
    padding: 6px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .legend::-webkit-scrollbar { display: none; }
  .legend-item { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .legend-swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .legend-code {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--text);
  }
  .legend-label {
    font-size: 10px;
    color: var(--text3);
  }

  /* ─── Empty ─── */
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

  .dood-grid {
    border-collapse: collapse;
    min-width: max-content;
  }
  .dood-grid th, .dood-grid td {
    border: 1px solid var(--border);
    padding: 0;
    text-align: center;
    vertical-align: middle;
  }

  .corner {
    position: sticky;
    left: 0;
    z-index: 12;
    background: var(--bg2);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text3);
    padding: 6px 12px;
    min-width: 120px;
    text-align: left;
  }
  .role-col {
    position: sticky;
    left: 120px;
    z-index: 12;
    background: var(--bg2);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text3);
    padding: 6px 8px;
    min-width: 100px;
    text-align: left;
  }
  .stat-col {
    background: var(--bg2);
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 700;
    color: var(--text3);
    padding: 4px 6px;
    min-width: 32px;
  }

  .day-col {
    background: var(--bg2);
    padding: 4px 2px;
    min-width: 38px;
    position: relative;
  }
  .day-col.today {
    background: rgba(167, 139, 250, 0.15);
  }
  .day-btn {
    background: none;
    border: none;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--text2);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    transition: all 0.1s;
  }
  .day-col.today .day-btn { color: var(--accent); }
  .day-btn:hover { background: var(--bg3); color: var(--accent); }
  .day-date {
    display: block;
    font-family: var(--mono);
    font-size: 8px;
    color: var(--text3);
    line-height: 1;
  }

  .name-cell {
    position: sticky;
    left: 0;
    z-index: 10;
    background: var(--bg);
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    padding: 6px 10px;
    text-align: left;
    white-space: nowrap;
  }
  .role-cell {
    position: sticky;
    left: 120px;
    z-index: 10;
    background: var(--bg);
    font-size: 11px;
    color: var(--text2);
    padding: 4px 8px;
    text-align: left;
    white-space: nowrap;
  }
  .stat-cell {
    background: var(--bg);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
    padding: 4px 6px;
    font-weight: 600;
  }

  .grid-cell {
    padding: 0;
    min-width: 38px;
    height: 32px;
    transition: background 0.1s;
  }
  .grid-cell.today {
    background: rgba(167, 139, 250, 0.06) !important;
  }

  .cell-btn {
    width: 100%;
    height: 100%;
    min-height: 32px;
    background: none;
    border: none;
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.08s;
    padding: 4px;
  }
  .cell-btn:hover {
    background: var(--bg3);
    transform: scale(1.05);
  }

  .del-col { background: var(--bg2); width: 30px; }
  .del-cell { background: var(--bg); }
  .row-del {
    background: none;
    border: none;
    color: var(--text3);
    font-size: 11px;
    cursor: pointer;
    opacity: 0;
    transition: all 0.1s;
    padding: 4px 8px;
    font-family: var(--mono);
  }
  tr:hover .row-del { opacity: 0.6; }
  .row-del:hover { color: var(--danger); opacity: 1; }

  /* ─── Status picker ─── */
  .picker {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 300;
    background: var(--bg2);
    border: 1px solid var(--border2);
    border-radius: 10px;
    padding: 6px 0;
    min-width: 180px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  }
  .picker-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    padding: 7px 14px;
    cursor: pointer;
    transition: background 0.08s;
    font-family: var(--font);
    font-size: 12px;
    color: var(--text);
    text-align: left;
  }
  .picker-item:hover { background: var(--bg3); }
  .picker-swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex-shrink: 0;
    border: 1px solid var(--border);
  }
  .picker-code {
    font-family: var(--mono);
    font-weight: 700;
    font-size: 11px;
    min-width: 28px;
  }
  .picker-label { color: var(--text2); font-size: 11px; }

  @media (max-width: 640px) {
    .toolbar { padding: 6px 10px; }
    .corner { min-width: 90px; }
    .role-col { left: 90px; min-width: 70px; }
    .name-cell { min-width: 90px; }
    .role-cell { left: 90px; }
  }
</style>
