<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as NC from '../lib/nextCall';

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
      <button class="tb-btn danger" onclick={clearAll}>Clear</button>
    </div>
  </div>

  {#if view === 'edit'}
    <div class="edit-scroll">
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

  @media (max-width: 640px) {
    .edit-scroll { padding: 10px 12px; }
    .field-grid { grid-template-columns: 1fr 1fr; }
    .person-grid, .person-grid.crew { grid-template-columns: 1fr; }
    .pg-header { display: none; }
  }
</style>
