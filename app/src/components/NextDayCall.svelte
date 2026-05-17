<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as NC from '../lib/nextCall';
  import * as extract from '../lib/extract';

  // ─── State ──────────────────────────────────────────────────────────
  let data = $state<NC.NextCallData>(NC.loadNextCall());
  let view = $state<'edit' | 'preview'>('edit');
  let previewText = $state('');
  let copyMsg = $state('');

  // ─── Load / Save ───────────────────────────────────────────────────
  function load() { data = NC.loadNextCall(); }
  async function save() { await NC.saveNextCall(data); }

  onMount(() => {
    load();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(NC.STORAGE_KEY)) load();
    });
    return () => unsub();
  });

  // ─── Scene management ──────────────────────────────────────────────
  async function addScene() {
    data.scenes.push(NC.mkScene(data.nid++));
    data = data;
    await save();
  }

  async function removeScene(id: number) {
    data.scenes = data.scenes.filter((s) => s.id !== id);
    await save();
  }

  // ─── Import from trackers ──────────────────────────────────────────
  async function importCastCrew() {
    const imported = NC.importFromTrackers();
    if (imported.cast.length || imported.crew.length) {
      data.castCalls = imported.cast;
      data.crewCalls = imported.crew;
      data = data;
      await save();
    }
  }

  // ─── Person management ─────────────────────────────────────────────
  async function addPerson(type: 'cast' | 'crew') {
    const arr = type === 'cast' ? data.castCalls : data.crewCalls;
    arr.push({ name: '', role: '', callTime: data.generalCall, muTime: '', onSetTime: '', notes: '', source: type });
    data = data;
    await save();
  }

  async function removePerson(type: 'cast' | 'crew', idx: number) {
    if (type === 'cast') data.castCalls.splice(idx, 1);
    else data.crewCalls.splice(idx, 1);
    data = data;
    await save();
  }

  // ─── Preview + Copy ────────────────────────────────────────────────
  function showPreview() {
    previewText = NC.generatePreview(data);
    view = 'preview';
  }

  async function copyPreview() {
    try {
      await navigator.clipboard.writeText(previewText);
      copyMsg = 'Copied!';
      setTimeout(() => copyMsg = '', 2000);
    } catch {
      copyMsg = 'Failed';
    }
  }

  // ─── Auto-save on field blur ───────────────────────────────────────
  function onFieldBlur() { void save(); }

  // ─── PDF Import (extraction + cross-check) ─────────────────────────
  interface ExtractedCallSheet {
    date?: string;
    generalCall?: string;
    location?: string;
    scenes?: Array<{ sceneNum: string; setLocation: string; pages: string; description: string; cast: string; estTime: string }>;
    castCalls?: Array<{ name: string; role: string; callTime: string; muTime?: string }>;
    crewCalls?: Array<{ name: string; role: string; callTime: string }>;
  }

  interface CrossCheckEntry {
    name: string;
    role: string;
    extractedCall: string;
    existingCall: string;
    match: boolean;
  }

  let pdfImportOpen = $state(false);
  let pdfImporting = $state(false);
  let pdfImportStatus = $state<{ type: 'loading' | 'ok' | 'err'; msg: string } | null>(null);
  let extractedData = $state<ExtractedCallSheet | null>(null);
  let crossCheck = $state<CrossCheckEntry[]>([]);
  let pdfFileInput = $state<HTMLInputElement | undefined>(undefined);

  const PDF_EXTRACT_PROMPT = `You are extracting call sheet information from a film/TV production call sheet PDF.
Return ONLY a valid JSON object with this structure (use empty strings for missing fields):
{
  "date": "string (production date)",
  "generalCall": "string (general crew call time HH:MM or HH:MMam/pm)",
  "location": "string (main shooting location)",
  "scenes": [
    {"sceneNum": "string", "setLocation": "string (INT/EXT. SET NAME - DAY/NIGHT)", "pages": "string", "description": "string", "cast": "string (comma-separated cast names)", "estTime": "string (HH:MM estimated shoot time or blank)"}
  ],
  "castCalls": [
    {"name": "string", "role": "string (character name)", "callTime": "string (HH:MM)", "muTime": "string (makeup/hair time or blank)"}
  ],
  "crewCalls": [
    {"name": "string", "role": "string (department/position)", "callTime": "string (HH:MM)"}
  ]
}`;

  async function handlePdfImport(file: File) {
    pdfImportStatus = { type: 'loading', msg: 'Reading PDF...' };
    extractedData = null;
    crossCheck = [];
    try {
      const b64 = await extract.fileToBase64(file);
      pdfImportStatus = { type: 'loading', msg: 'Extracting call sheet data...' };
      const raw = await extract.extractFromPdf(b64, PDF_EXTRACT_PROMPT, {
        system: 'Return ONLY raw JSON. No markdown, no explanation.',
        maxTokens: 8000,
      });
      const parsed = extract.parseJsonResponse<ExtractedCallSheet>(raw);
      extractedData = parsed;

      // Build cross-check: compare extracted cast calls vs existing
      if (parsed.castCalls?.length && data.castCalls.length) {
        const existing = new Map(
          data.castCalls.map(p => [p.name.toLowerCase().trim(), p.callTime])
        );
        crossCheck = (parsed.castCalls ?? []).map(p => {
          const existingCall = existing.get(p.name.toLowerCase().trim()) ?? '';
          return {
            name: p.name,
            role: p.role,
            extractedCall: p.callTime,
            existingCall,
            match: !existingCall || existingCall === p.callTime,
          };
        });
      }

      pdfImportStatus = { type: 'ok', msg: `Extracted ${parsed.scenes?.length ?? 0} scenes, ${parsed.castCalls?.length ?? 0} cast, ${parsed.crewCalls?.length ?? 0} crew.` };
    } catch (e) {
      pdfImportStatus = { type: 'err', msg: `Extraction failed: ${e instanceof Error ? e.message.slice(0, 150) : String(e)}` };
    }
  }

  function applyExtracted() {
    if (!extractedData) return;
    if (extractedData.date) data.date = extractedData.date;
    if (extractedData.generalCall) data.generalCall = extractedData.generalCall;
    if (extractedData.location) data.location = extractedData.location;
    if (extractedData.scenes?.length) {
      data.scenes = extractedData.scenes.map(s => ({ ...NC.mkScene(data.nid++), ...s }));
    }
    if (extractedData.castCalls?.length) {
      data.castCalls = extractedData.castCalls.map(p => ({
        name: p.name, role: p.role, callTime: p.callTime, muTime: p.muTime ?? '',
        onSetTime: '', notes: '', source: 'cast' as const,
      }));
    }
    if (extractedData.crewCalls?.length) {
      data.crewCalls = extractedData.crewCalls.map(p => ({
        name: p.name, role: p.role, callTime: p.callTime, muTime: '',
        onSetTime: '', notes: '', source: 'crew' as const,
      }));
    }
    data = data;
    void save();
    pdfImportOpen = false;
    extractedData = null;
    crossCheck = [];
    pdfImportStatus = null;
  }

  function onPdfFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void handlePdfImport(file);
    input.value = '';
  }

  async function clearAll() {
    if (!confirm('Clear next day call? This cannot be undone.')) return;
    data = NC.loadNextCall();
    data.scenes = [];
    data.castCalls = [];
    data.crewCalls = [];
    data.specialInstructions = '';
    data.advance = '';
    data.notes = '';
    await save();
  }
</script>

<div class="ndc-tab">
  <!-- TOOLBAR -->
  <div class="toolbar">
    <h2>Next Day Call</h2>
    <span class="date-badge">{data.date}</span>
    <div class="toolbar-actions">
      <button class="tb-btn" class:active={view === 'edit'} onclick={() => view = 'edit'}>Edit</button>
      <button class="tb-btn" class:active={view === 'preview'} onclick={showPreview}>Preview</button>
      <button class="tb-btn" onclick={importCastCrew} title="Import cast/crew from today's trackers">Import C/C</button>
      <button class="tb-btn" class:active={pdfImportOpen} onclick={() => { pdfImportOpen = !pdfImportOpen; }} title="Extract call sheet data from a PDF">📄 Import PDF</button>
      <button class="tb-btn danger" onclick={clearAll}>Clear</button>
    </div>
  </div>

  {#if view === 'edit'}
    <div class="edit-scroll">

      <!-- PDF IMPORT PANEL -->
      {#if pdfImportOpen}
        <section class="section pdf-import-section">
          <div class="sec-header">
            <h3 class="sec-title">Import from Call Sheet PDF</h3>
            <button class="tb-btn" onclick={() => { pdfImportOpen = false; extractedData = null; pdfImportStatus = null; }}>Close ✕</button>
          </div>
          <p class="pdf-import-desc">Upload a preliminary or final call sheet PDF. AI will extract scenes, cast calls, and crew calls and let you review before importing.</p>
          <div
            class="pdf-drop-zone"
            role="button"
            tabindex="0"
            ondragover={(e) => e.preventDefault()}
            ondrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f?.type === 'application/pdf') void handlePdfImport(f); }}
            onclick={() => pdfFileInput?.click()}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pdfFileInput?.click(); } }}
          >
            <input bind:this={pdfFileInput} type="file" accept=".pdf" onchange={onPdfFileChange} style="display:none" />
            <span class="pdf-drop-icon">📄</span>
            <span class="pdf-drop-text">Drop call sheet PDF or click to browse</span>
          </div>
          {#if pdfImportStatus}
            <div class="pdf-status {pdfImportStatus.type}">
              {#if pdfImportStatus.type === 'loading'}<span class="spinner"></span>{/if}
              {pdfImportStatus.msg}
            </div>
          {/if}

          {#if extractedData}
            <div class="extracted-preview">
              {#if extractedData.date || extractedData.generalCall || extractedData.location}
                <div class="ep-row"><strong>Date:</strong> {extractedData.date || '—'} · <strong>General Call:</strong> {extractedData.generalCall || '—'} · <strong>Location:</strong> {extractedData.location || '—'}</div>
              {/if}
              {#if extractedData.scenes?.length}
                <div class="ep-group">
                  <div class="ep-label">{extractedData.scenes.length} Scenes</div>
                  {#each extractedData.scenes as s}
                    <div class="ep-item">{s.sceneNum} — {s.setLocation} {s.pages ? `(${s.pages}p)` : ''} {s.description ? `· ${s.description}` : ''}</div>
                  {/each}
                </div>
              {/if}
              {#if crossCheck.length > 0}
                <div class="ep-group">
                  <div class="ep-label">Cast Call Cross-Check</div>
                  <div class="crosscheck-grid">
                    <div class="cc-hdr"><span>Name</span><span>Role</span><span>Extracted</span><span>Current</span><span>Status</span></div>
                    {#each crossCheck as cc}
                      <div class="cc-row" class:mismatch={!cc.match && cc.existingCall}>
                        <span>{cc.name}</span>
                        <span>{cc.role}</span>
                        <span class="mono">{cc.extractedCall}</span>
                        <span class="mono">{cc.existingCall || '—'}</span>
                        <span class="cc-status" class:ok={cc.match || !cc.existingCall} class:diff={!cc.match && cc.existingCall}>
                          {cc.match || !cc.existingCall ? '✓' : '⚠ Diff'}
                        </span>
                      </div>
                    {/each}
                  </div>
                </div>
              {:else if extractedData.castCalls?.length}
                <div class="ep-group">
                  <div class="ep-label">{extractedData.castCalls.length} Cast calls extracted</div>
                  {#each extractedData.castCalls as p}
                    <div class="ep-item">{p.name} ({p.role}) — Call: {p.callTime}{p.muTime ? ` / MU: ${p.muTime}` : ''}</div>
                  {/each}
                </div>
              {/if}
              <div class="ep-actions">
                <button class="action-btn" onclick={applyExtracted}>Apply All to Next Day Call</button>
                <button class="action-btn ghost" onclick={() => { extractedData = null; pdfImportStatus = null; }}>Cancel</button>
              </div>
            </div>
          {/if}
        </section>
      {/if}

      <!-- HEADER FIELDS -->
      <section class="section">
        <h3 class="sec-title">Production Info</h3>
        <div class="field-grid">
          <label>
            <span class="fld-label">Date</span>
            <input bind:value={data.date} class="fld-input" onblur={onFieldBlur} />
          </label>
          <label>
            <span class="fld-label">General Call</span>
            <input bind:value={data.generalCall} class="fld-input mono" placeholder="07:00" onblur={onFieldBlur} />
          </label>
          <label>
            <span class="fld-label">First Shot</span>
            <input bind:value={data.firstShot} class="fld-input mono" placeholder="09:00" onblur={onFieldBlur} />
          </label>
          <label>
            <span class="fld-label">Location</span>
            <input bind:value={data.location} class="fld-input" placeholder="Stage 5, Lot A" onblur={onFieldBlur} />
          </label>
        </div>
      </section>

      <!-- SCENES -->
      <section class="section">
        <div class="sec-header">
          <h3 class="sec-title">Shooting Schedule</h3>
          <button class="tb-btn" onclick={addScene}>+ Scene</button>
        </div>
        {#if data.scenes.length === 0}
          <p class="empty-note">No scenes added. Click <strong>+ Scene</strong> to build tomorrow's schedule.</p>
        {:else}
          <div class="scene-list">
            {#each data.scenes as scene, i (scene.id)}
              <div class="scene-card">
                <div class="scene-row">
                  <span class="scene-idx">{i + 1}</span>
                  <input bind:value={scene.sceneNum} class="fld-sm" placeholder="Sc #" onblur={onFieldBlur} />
                  <input bind:value={scene.setLocation} class="fld-med" placeholder="INT/EXT. SET" onblur={onFieldBlur} />
                  <input bind:value={scene.estTime} class="fld-sm mono" placeholder="HH:MM" onblur={onFieldBlur} />
                  <input bind:value={scene.pages} class="fld-xs" placeholder="Pgs" onblur={onFieldBlur} />
                  <button class="del-x" onclick={() => void removeScene(scene.id)}>x</button>
                </div>
                <div class="scene-row sub">
                  <input bind:value={scene.description} class="fld-flex" placeholder="Description" onblur={onFieldBlur} />
                  <input bind:value={scene.cast} class="fld-flex" placeholder="Cast involved" onblur={onFieldBlur} />
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- CAST CALLS -->
      <section class="section">
        <div class="sec-header">
          <h3 class="sec-title">Cast Calls</h3>
          <button class="tb-btn" onclick={() => void addPerson('cast')}>+ Cast</button>
        </div>
        {#if data.castCalls.length === 0}
          <p class="empty-note">No cast calls. Click <strong>Import C/C</strong> to pull from today's tracker, or <strong>+ Cast</strong> to add manually.</p>
        {:else}
          <div class="person-grid">
            <div class="pg-header">
              <span>Name</span><span>Role</span><span>Call</span><span>MU</span><span>Notes</span><span></span>
            </div>
            {#each data.castCalls as p, i}
              <div class="pg-row">
                <input bind:value={p.name} class="pg-input" placeholder="Name" onblur={onFieldBlur} />
                <input bind:value={p.role} class="pg-input" placeholder="Character" onblur={onFieldBlur} />
                <input bind:value={p.callTime} class="pg-input mono" placeholder="HH:MM" onblur={onFieldBlur} />
                <input bind:value={p.muTime} class="pg-input mono" placeholder="MU" onblur={onFieldBlur} />
                <input bind:value={p.notes} class="pg-input" placeholder="Notes" onblur={onFieldBlur} />
                <button class="del-x" onclick={() => void removePerson('cast', i)}>x</button>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- CREW CALLS -->
      <section class="section">
        <div class="sec-header">
          <h3 class="sec-title">Crew Calls</h3>
          <button class="tb-btn" onclick={() => void addPerson('crew')}>+ Crew</button>
        </div>
        {#if data.crewCalls.length === 0}
          <p class="empty-note">No crew calls set.</p>
        {:else}
          <div class="person-grid crew">
            <div class="pg-header">
              <span>Name</span><span>Dept / Role</span><span>Call</span><span>On Set</span><span>Notes</span><span></span>
            </div>
            {#each data.crewCalls as p, i}
              <div class="pg-row">
                <input bind:value={p.name} class="pg-input" placeholder="Name" onblur={onFieldBlur} />
                <input bind:value={p.role} class="pg-input" placeholder="Role / Dept" onblur={onFieldBlur} />
                <input bind:value={p.callTime} class="pg-input mono" placeholder="HH:MM" onblur={onFieldBlur} />
                <input bind:value={p.onSetTime} class="pg-input mono" placeholder="On Set" onblur={onFieldBlur} />
                <input bind:value={p.notes} class="pg-input" placeholder="Notes" onblur={onFieldBlur} />
                <button class="del-x" onclick={() => void removePerson('crew', i)}>x</button>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- SPECIAL INSTRUCTIONS + ADVANCE -->
      <section class="section">
        <h3 class="sec-title">Special Instructions</h3>
        <textarea
          bind:value={data.specialInstructions}
          class="fld-textarea"
          placeholder="Parking changes, stunts, nudity riders, weather contingency..."
          rows="3"
          onblur={onFieldBlur}
        ></textarea>
      </section>

      <section class="section">
        <h3 class="sec-title">Advance Schedule</h3>
        <textarea
          bind:value={data.advance}
          class="fld-textarea"
          placeholder="Scenes advancing for the following day..."
          rows="2"
          onblur={onFieldBlur}
        ></textarea>
      </section>
    </div>

  {:else}
    <!-- PREVIEW -->
    <div class="preview-scroll">
      <div class="preview-actions">
        <button class="tb-btn" onclick={copyPreview}>Copy to Clipboard</button>
        {#if copyMsg}<span class="copy-msg">{copyMsg}</span>{/if}
      </div>
      <pre class="preview-text">{previewText}</pre>
    </div>
  {/if}
</div>

<style>
  .ndc-tab {
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
  .date-badge {
    font-family: var(--mono);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(167, 139, 250, 0.1);
    color: var(--accent);
    border: 1px solid rgba(167, 139, 250, 0.25);
  }
  .toolbar-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
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
  .tb-btn.active { background: rgba(167, 139, 250, 0.13); color: var(--accent); border-color: var(--accent); }
  .tb-btn.danger:hover { border-color: var(--danger); color: var(--danger); }

  /* ─── Edit scroll ─── */
  .edit-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .section {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
  }
  .sec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .sec-title {
    font-family: var(--cond);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent);
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  .sec-header .sec-title { margin-bottom: 0; }

  .empty-note {
    font-size: 12px;
    color: var(--text3);
    line-height: 1.5;
  }

  /* ─── Fields ─── */
  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
  }
  .fld-label {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
    margin-bottom: 3px;
    display: block;
  }
  .fld-input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--text);
    font-family: var(--font);
  }
  .fld-input:focus { border-color: var(--accent); outline: none; }
  .fld-input.mono { font-family: var(--mono); }
  .fld-textarea {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 8px;
    font-size: 12px;
    color: var(--text);
    font-family: var(--font);
    resize: vertical;
    line-height: 1.5;
  }
  .fld-textarea:focus { border-color: var(--accent); outline: none; }

  /* ─── Scene list ─── */
  .scene-list { display: flex; flex-direction: column; gap: 6px; }
  .scene-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
  }
  .scene-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .scene-row.sub { margin-top: 4px; }
  .scene-idx {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    width: 18px;
    text-align: center;
    flex-shrink: 0;
  }
  .fld-sm {
    width: 60px;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 4px 6px;
    font-size: 11px;
    color: var(--text);
    font-family: var(--font);
  }
  .fld-sm.mono { font-family: var(--mono); }
  .fld-sm:focus, .fld-med:focus, .fld-xs:focus, .fld-flex:focus { border-color: var(--accent); outline: none; }
  .fld-med {
    width: 180px;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 4px 6px;
    font-size: 11px;
    color: var(--text);
  }
  .fld-xs {
    width: 40px;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 4px 6px;
    font-size: 11px;
    color: var(--text);
    font-family: var(--mono);
  }
  .fld-flex {
    flex: 1;
    min-width: 0;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 4px 6px;
    font-size: 11px;
    color: var(--text);
    margin-left: 24px;
  }
  .del-x {
    background: none;
    border: none;
    color: var(--text3);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 6px;
    opacity: 0.4;
    transition: all 0.1s;
    font-family: var(--mono);
  }
  .del-x:hover { color: var(--danger); opacity: 1; }

  /* ─── Person grid ─── */
  .person-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 70px 60px 1fr 28px;
    gap: 4px;
    align-items: center;
  }
  .person-grid.crew {
    grid-template-columns: 1fr 1fr 70px 70px 1fr 28px;
  }
  .pg-header {
    display: contents;
  }
  .pg-header span {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
    padding: 0 2px 4px;
  }
  .pg-row { display: contents; }
  .pg-input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 5px 6px;
    font-size: 11px;
    color: var(--text);
    font-family: var(--font);
    min-width: 0;
  }
  .pg-input.mono { font-family: var(--mono); }
  .pg-input:focus { border-color: var(--accent); outline: none; }

  /* ─── Preview ─── */
  .preview-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }
  .preview-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .copy-msg {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--success);
  }
  .preview-text {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text);
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-x: auto;
  }

  /* ─── PDF Import panel ─── */
  .pdf-import-section { border-color: rgba(167, 139, 250, 0.35); }
  .pdf-import-desc { font-size: 12px; color: var(--text2); line-height: 1.5; margin-bottom: 10px; }
  .pdf-drop-zone {
    border: 1.5px dashed var(--border2);
    border-radius: 6px;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
    margin-bottom: 8px;
  }
  .pdf-drop-zone:hover { border-color: var(--accent); background: rgba(167, 139, 250, 0.04); }
  .pdf-drop-icon { font-size: 20px; }
  .pdf-drop-text { font-family: var(--mono); font-size: 11px; color: var(--text3); }
  .pdf-status {
    font-family: var(--mono);
    font-size: 11px;
    padding: 6px 10px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 8px;
  }
  .pdf-status.loading { background: var(--bg3); color: var(--text2); }
  .pdf-status.ok { background: rgba(52, 211, 153, 0.1); color: var(--success); border: 1px solid rgba(52, 211, 153, 0.2); }
  .pdf-status.err { background: rgba(224, 90, 90, 0.1); color: var(--danger); border: 1px solid rgba(224, 90, 90, 0.2); }
  .spinner {
    width: 11px; height: 11px;
    border: 2px solid var(--border2); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .extracted-preview {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ep-row { font-size: 12px; color: var(--text2); }
  .ep-row strong { color: var(--text3); font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .ep-group { display: flex; flex-direction: column; gap: 3px; }
  .ep-label {
    font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--accent); margin-bottom: 3px;
  }
  .ep-item { font-size: 11px; color: var(--text2); padding-left: 8px; }
  .ep-actions { display: flex; gap: 8px; }
  .action-btn {
    padding: 7px 14px; border-radius: 5px; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.12s; border: 1px solid var(--accent);
    background: var(--accent); color: var(--bg); font-family: var(--font);
  }
  .action-btn:hover { background: var(--accent2); border-color: var(--accent2); }
  .action-btn.ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .action-btn.ghost:hover { border-color: var(--accent); color: var(--accent); }

  /* Cross-check grid */
  .crosscheck-grid { font-size: 11px; }
  .cc-hdr, .cc-row { display: grid; grid-template-columns: 1fr 1fr 70px 70px 60px; gap: 4px; align-items: center; }
  .cc-hdr {
    font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--text3); padding: 3px 0; border-bottom: 1px solid var(--border); margin-bottom: 3px;
  }
  .cc-row { padding: 2px 0; border-bottom: 1px solid var(--border); }
  .cc-row.mismatch { background: rgba(224, 90, 90, 0.05); }
  .cc-status { font-family: var(--mono); font-size: 10px; }
  .cc-status.ok { color: var(--success); }
  .cc-status.diff { color: var(--danger); font-weight: 600; }
  .mono { font-family: var(--mono); }

  @media (max-width: 640px) {
    .edit-scroll { padding: 10px 12px; }
    .field-grid { grid-template-columns: 1fr 1fr; }
    .person-grid, .person-grid.crew { grid-template-columns: 1fr; }
    .pg-header { display: none; }
  }
</style>
