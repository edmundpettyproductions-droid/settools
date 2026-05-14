<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as castBible from '../lib/castBible';
  import { fileToBase64, fileToText, xlsxToText } from '../lib/extract';
  import type { CastBibleEntry, CastBibleState } from '../lib/types';

  // ── State ─────────────────────────────────────────────────────────────────
  let state    = $state<CastBibleState>({ entries: [], uploads: [] });
  let dragOver = $state(false);
  let phase    = $state<'idle' | 'reading' | 'extracting' | 'preview' | 'saving' | 'done' | 'error'>('idle');
  let phaseMsg = $state('');
  let errorMsg = $state<string | null>(null);

  // Preview state — what we got back from Claude, awaiting user confirmation
  let previewEntries    = $state<CastBibleEntry[]>([]);
  let previewFilename   = $state('');
  let previewFilesize   = $state(0);
  let previewFormatSum  = $state<string | undefined>(undefined);
  let previewSkippedRows = $state<number | undefined>(undefined);

  // Roster filtering / sort
  let filterText = $state('');
  let sortBy     = $state<'actor' | 'character' | 'role'>('actor');

  function refresh() { state = castBible.loadCastBible(); }

  onMount(() => {
    refresh();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes('settools_cast_bible')) refresh();
    });
    return () => unsub();
  });

  // ── Upload pipeline ───────────────────────────────────────────────────────
  async function handleFile(file: File) {
    errorMsg = null;
    previewFilename = file.name;
    previewFilesize = file.size;

    const isPdf  = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isXlsx = /\.(xlsx|xlsm|xls)$/i.test(file.name)
      || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || file.type === 'application/vnd.ms-excel';
    const isText = /^text\//.test(file.type) || /\.(txt|csv|tsv)$/i.test(file.name);

    if (!isPdf && !isXlsx && !isText) {
      errorMsg = `Unsupported file type "${file.type || 'unknown'}". Use PDF, XLSX/XLSM/XLS, CSV, TSV, or TXT.`;
      phase = 'error';
      return;
    }

    try {
      phase = 'reading';
      phaseMsg = isXlsx
        ? `Loading XLSX parser and reading all sheets in ${file.name}…`
        : `Reading ${file.name}…`;

      let payload: { kind: 'pdf'; pdfBase64: string } | { kind: 'text'; text: string };
      if (isPdf) {
        payload = { kind: 'pdf', pdfBase64: await fileToBase64(file) };
      } else if (isXlsx) {
        const text = await xlsxToText(file);
        if (!text.trim()) {
          errorMsg = `XLSX file appears empty (no rows in any sheet).`;
          phase = 'error';
          return;
        }
        payload = { kind: 'text', text };
      } else {
        payload = { kind: 'text', text: await fileToText(file) };
      }

      phase = 'extracting';
      phaseMsg = `Sending to Claude for extraction… (this can take 10–30 seconds for big files)`;
      const result = await castBible.extractCastBible(payload);

      if (!result.entries.length) {
        errorMsg = `Claude extracted 0 cast entries.\n\n${result.formatSummary ?? 'No cast roster found in this file.'}\n\nIf the file does contain a cast list, try a different format (e.g. PDF export, or use a file that has the cast on its own clearly-labeled sheet/page).`;
        phase = 'error';
        return;
      }
      previewEntries     = result.entries;
      previewFormatSum   = result.formatSummary;
      previewSkippedRows = result.skippedRows;
      phase = 'preview';
      phaseMsg = `Found ${result.entries.length} cast entries. Review and confirm to save.`;
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      phase = 'error';
    }
  }

  async function confirmSave() {
    phase = 'saving';
    phaseMsg = 'Saving roster…';
    try {
      await castBible.saveCastBible(previewEntries, {
        filename: previewFilename,
        filesize: previewFilesize,
        uploaded_at: new Date().toISOString(),
        extracted_count: previewEntries.length,
        format_summary: previewFormatSum,
      });
      refresh();
      phase = 'done';
      phaseMsg = `Saved ${previewEntries.length} cast entries.`;
      setTimeout(() => { if (phase === 'done') phase = 'idle'; }, 3000);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      phase = 'error';
    }
  }

  function cancelPreview() { phase = 'idle'; previewEntries = []; }

  async function clearAll() {
    if (!confirm(`Clear the entire Cast Bible (${state.entries.length} entries)?\n\nThis can't be undone unless you re-upload the source file.`)) return;
    await castBible.clearCastBible();
    refresh();
  }

  // ── File picker / drag-drop wiring ────────────────────────────────────────
  let fileInput: HTMLInputElement | undefined = $state();

  function onPickClick() { fileInput?.click(); }
  function onFileChange(e: Event) {
    const t = e.target as HTMLInputElement;
    const f = t.files?.[0];
    if (f) handleFile(f);
    t.value = '';
  }
  function onDragOver(e: DragEvent) { e.preventDefault(); dragOver = true; }
  function onDragLeave() { dragOver = false; }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }

  // ── Roster derived state ──────────────────────────────────────────────────
  let visible = $derived.by(() => {
    const q = filterText.trim().toLowerCase();
    const filtered = q
      ? state.entries.filter((e) =>
          (e.actor + ' ' + (e.character ?? '') + ' ' + (e.role ?? '') + ' ' + (e.notes ?? '')).toLowerCase().includes(q),
        )
      : state.entries.slice();
    filtered.sort((a, b) => {
      const av = String(a[sortBy] ?? '').toLowerCase();
      const bv = String(b[sortBy] ?? '').toLowerCase();
      return av.localeCompare(bv);
    });
    return filtered;
  });
  let byRole = $derived(castBible.countByRole(state.entries));
  let lastUpload = $derived(state.uploads[state.uploads.length - 1]);

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
  function formatWhen(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

<section class="bible">
  <header class="hdr">
    <div class="hdr-l">
      <div class="hdr-eyebrow">CAST BIBLE</div>
      <h1>Cast Roster</h1>
      {#if lastUpload}
        <div class="hdr-meta">
          Last upload: <strong>{lastUpload.filename}</strong>
          · {state.entries.length} entries
          · {formatWhen(state.last_updated)}
        </div>
      {/if}
    </div>
  </header>

  <!-- ── Upload zone ─────────────────────────────────────────── -->
  {#if phase === 'idle' || phase === 'error' || phase === 'done'}
    <div
      class="dropzone {dragOver ? 'over' : ''}"
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
      onclick={onPickClick}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickClick(); } }}
      role="button"
      tabindex="0"
    >
      <div class="dz-icon">🎭</div>
      <div class="dz-text">
        <strong>{state.entries.length ? 'Upload a new Cast Bible' : 'Upload your first Cast Bible'}</strong>
        <span>Drag a file here or click to browse · XLSX, XLSM, XLS, PDF, CSV, TSV, TXT</span>
      </div>
      <input
        type="file"
        accept=".pdf,.csv,.tsv,.txt,.xlsx,.xlsm,.xls,application/pdf,text/csv,text/plain,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        bind:this={fileInput}
        onchange={onFileChange}
        style="position:fixed;left:-9999px;width:0;height:0;opacity:0"
      />
    </div>
    {#if phase === 'done'}<div class="banner ok">✓ {phaseMsg}</div>{/if}
    {#if errorMsg}<div class="banner err">{errorMsg}</div>{/if}
  {/if}

  <!-- ── Processing states ───────────────────────────────────── -->
  {#if phase === 'reading' || phase === 'extracting' || phase === 'saving'}
    <div class="processing">
      <div class="spinner"></div>
      <div class="proc-text">
        <strong>{phase === 'reading' ? 'Reading file…' : phase === 'extracting' ? 'Extracting cast roster…' : 'Saving…'}</strong>
        <span>{phaseMsg}</span>
      </div>
    </div>
  {/if}

  <!-- ── Preview modal (large) ───────────────────────────────── -->
  {#if phase === 'preview'}
    <div class="preview">
      <header class="preview-head">
        <div>
          <h2>Confirm Cast Roster</h2>
          <div class="preview-sub">
            From <strong>{previewFilename}</strong>
            · {previewEntries.length} entries
            {#if previewSkippedRows !== undefined && previewSkippedRows > 0}· <span class="dim">{previewSkippedRows} row{previewSkippedRows === 1 ? '' : 's'} skipped (dividers, blanks)</span>{/if}
          </div>
          {#if previewFormatSum}
            <div class="preview-format"><em>{previewFormatSum}</em></div>
          {/if}
        </div>
        <div class="preview-actions">
          <button class="btn ghost" onclick={cancelPreview}>Cancel</button>
          <button class="btn primary" onclick={confirmSave}>
            {state.entries.length ? `Replace existing ${state.entries.length} entries` : 'Save Roster'}
          </button>
        </div>
      </header>
      {#if state.entries.length > 0}
        <div class="warning">
          This will <strong>replace</strong> your current {state.entries.length} entries. Old uploads remain in history.
        </div>
      {/if}
      <div class="preview-table-wrap">
        <table class="roster">
          <thead>
            <tr>
              <th>Actor</th><th>Character</th><th>Role</th><th>Phone</th><th>Email</th><th>Agent</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {#each previewEntries as e (e.actor)}
              <tr>
                <td><strong>{e.actor}</strong></td>
                <td>{e.character ?? '—'}</td>
                <td><span class="role-tag">{e.role ?? '—'}</span></td>
                <td class="mono">{e.phone ?? '—'}</td>
                <td class="mono">{e.email ?? '—'}</td>
                <td>{e.agent_name ?? '—'}</td>
                <td class="notes-cell">{e.notes ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- ── Current roster ──────────────────────────────────────── -->
  {#if state.entries.length && phase !== 'preview'}
    <div class="roster-section">
      <div class="roster-toolbar">
        <input
          type="search"
          placeholder="Filter by name, character, role, notes…"
          bind:value={filterText}
        />
        <select bind:value={sortBy}>
          <option value="actor">Sort by Actor</option>
          <option value="character">Sort by Character</option>
          <option value="role">Sort by Role</option>
        </select>
        <button class="btn ghost danger" onclick={clearAll}>Clear roster</button>
      </div>

      {#if byRole.size > 0}
        <div class="stats">
          {#each Array.from(byRole.entries()).sort((a, b) => b[1] - a[1]) as [role, count] (role)}
            <span class="stat"><strong>{count}</strong> {role}</span>
          {/each}
        </div>
      {/if}

      <div class="table-wrap">
        <table class="roster">
          <thead>
            <tr>
              <th>Actor</th><th>Character</th><th>Role</th><th>Phone</th><th>Email</th><th>Agent</th><th>Manager</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {#each visible as e (e.actor)}
              <tr>
                <td><strong>{e.actor}</strong></td>
                <td>{e.character ?? '—'}</td>
                <td><span class="role-tag">{e.role ?? '—'}</span></td>
                <td class="mono">{e.phone ?? '—'}</td>
                <td class="mono">{e.email ?? '—'}</td>
                <td>
                  {#if e.agent_name}
                    {e.agent_name}{#if e.agent_phone} <span class="mono dim">· {e.agent_phone}</span>{/if}
                  {:else}—{/if}
                </td>
                <td>{e.manager_name ?? '—'}</td>
                <td class="notes-cell">{e.notes ?? ''}</td>
              </tr>
            {/each}
            {#if !visible.length}
              <tr><td colspan="8" class="empty-row">No entries match "{filterText}"</td></tr>
            {/if}
          </tbody>
        </table>
      </div>

      {#if state.uploads.length > 1}
        <details class="history">
          <summary>Upload history ({state.uploads.length})</summary>
          <ul>
            {#each state.uploads.slice().reverse() as u}
              <li>
                <span class="mono">{formatWhen(u.uploaded_at)}</span>
                · {u.filename} ({formatBytes(u.filesize)})
                · {u.extracted_count} entries
                {#if u.format_summary}· <em>{u.format_summary}</em>{/if}
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    </div>
  {/if}

  {#if !state.entries.length && phase !== 'preview' && phase !== 'reading' && phase !== 'extracting'}
    <div class="empty">
      <p>No cast roster yet. Upload your bible above to extract it.</p>
      <p class="dim">Works on PDFs (use "Save as PDF" from Google Sheets / Excel / your bible doc) or plain text (CSV / TSV / copy-paste).</p>
    </div>
  {/if}
</section>

<style>
  .bible { max-width: 1400px; margin: 0 auto; padding: 24px 20px 60px; }
  .hdr { margin-bottom: 16px; }
  .hdr-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
  .hdr-l h1 { font-family: var(--cond); font-size: 32px; font-weight: 700; letter-spacing: 0.04em; color: var(--text); line-height: 1.05; }
  .hdr-meta { font-family: var(--mono); font-size: 12px; color: var(--text2); margin-top: 6px; }
  .hdr-meta strong { color: var(--text); font-weight: 600; }

  /* Drop zone */
  .dropzone {
    border: 2px dashed var(--border2); border-radius: 12px;
    padding: 36px 28px; background: var(--bg2);
    display: flex; align-items: center; gap: 18px;
    cursor: pointer; transition: all .15s;
    margin-bottom: 14px;
  }
  .dropzone:hover, .dropzone.over { border-color: var(--accent); background: rgba(167,139,250,0.06); }
  .dropzone:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .dz-icon { font-size: 38px; }
  .dz-text { display: flex; flex-direction: column; gap: 4px; }
  .dz-text strong { font-size: 16px; color: var(--text); }
  .dz-text span { font-size: 12px; color: var(--text2); }

  /* Banners */
  .banner { padding: 12px 16px; border-radius: 8px; font-family: var(--mono); font-size: 12px; margin-bottom: 14px; }
  .banner.ok  { background: rgba(52,211,153,0.10); color: var(--success); border: 1px solid rgba(52,211,153,0.35); }
  .banner.err { background: rgba(224,90,90,0.10);  color: var(--danger);  border: 1px solid rgba(224,90,90,0.35); word-break: break-word; }

  /* Processing state */
  .processing { display: flex; gap: 14px; align-items: center; padding: 24px; background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 14px; }
  .spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .9s linear infinite; flex-shrink: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .proc-text { display: flex; flex-direction: column; gap: 4px; }
  .proc-text strong { font-size: 14px; color: var(--text); }
  .proc-text span  { font-size: 12px; color: var(--text2); }

  /* Preview */
  .preview { background: var(--bg2); border: 1px solid var(--accent); border-radius: 12px; padding: 18px 22px; margin-bottom: 14px; box-shadow: 0 4px 20px rgba(167,139,250,0.15); }
  .preview-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
  .preview-head h2 { font-family: var(--cond); font-size: 22px; color: var(--accent); margin-bottom: 4px; }
  .preview-sub { font-size: 12px; color: var(--text2); }
  .preview-sub .dim { color: var(--text3); }
  .preview-format { font-size: 11.5px; color: var(--text3); margin-top: 4px; max-width: 700px; }
  .preview-format em { font-style: italic; color: var(--text2); }
  .preview-actions { display: flex; gap: 8px; }
  .warning { background: rgba(240,160,64,0.10); color: var(--warn); border: 1px solid rgba(240,160,64,0.35); padding: 10px 14px; border-radius: 6px; font-size: 12px; margin-bottom: 14px; }
  .preview-table-wrap { max-height: 460px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; }

  /* Buttons */
  .btn { font-family: var(--font); font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 6px; cursor: pointer; transition: all .12s; border: 1px solid; }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .btn.primary:hover { background: var(--accent2); border-color: var(--accent2); }
  .btn.ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .btn.ghost:hover { color: var(--accent); border-color: var(--accent); }
  .btn.ghost.danger:hover { color: var(--danger); border-color: var(--danger); }

  /* Roster */
  .roster-section { margin-top: 8px; }
  .roster-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .roster-toolbar input[type="search"] { flex: 1; min-width: 220px; font-family: var(--font); font-size: 13px; padding: 8px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; }
  .roster-toolbar input[type="search"]:focus { outline: none; border-color: var(--accent); }
  .roster-toolbar select { font-family: var(--font); font-size: 13px; padding: 7px 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }

  .stats { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .stat { font-family: var(--mono); font-size: 11px; color: var(--text2); padding: 4px 10px; background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; }
  .stat strong { color: var(--accent); font-weight: 700; }

  .table-wrap { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; overflow: auto; max-height: 70vh; }
  table.roster { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.roster thead { background: var(--bg3); position: sticky; top: 0; z-index: 1; }
  table.roster th { text-align: left; padding: 10px 12px; font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text2); border-bottom: 1px solid var(--border); white-space: nowrap; }
  table.roster td { padding: 9px 12px; color: var(--text); vertical-align: top; border-bottom: 1px solid var(--border); }
  table.roster tr:last-child td { border-bottom: none; }
  table.roster tr:hover td { background: var(--bg3); }
  table.roster td.mono { font-family: var(--mono); font-size: 11px; color: var(--text2); white-space: nowrap; }
  table.roster .mono.dim { color: var(--text3); }
  table.roster td.notes-cell { color: var(--text2); font-style: italic; max-width: 300px; }
  .role-tag { display: inline-block; font-family: var(--mono); font-size: 10px; font-weight: 600; padding: 2px 8px; background: rgba(167,139,250,0.13); color: var(--accent); border: 1px solid rgba(167,139,250,0.3); border-radius: 3px; }
  .empty-row { text-align: center; color: var(--text3); padding: 24px !important; font-style: italic; }

  .history { margin-top: 18px; }
  .history summary { font-family: var(--mono); font-size: 11px; color: var(--text2); cursor: pointer; padding: 8px 0; }
  .history summary:hover { color: var(--accent); }
  .history ul { list-style: none; padding: 8px 0 0; }
  .history li { font-size: 11.5px; color: var(--text2); padding: 4px 0; border-top: 1px solid var(--border); }
  .history li .mono { font-family: var(--mono); color: var(--text3); }
  .history li em { color: var(--text); font-style: italic; }

  .empty { text-align: center; padding: 60px 20px; color: var(--text2); }
  .empty p { margin-bottom: 8px; }
  .empty p.dim { font-size: 12px; color: var(--text3); max-width: 520px; margin: 0 auto; }
</style>
