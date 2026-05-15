<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as WK from '../lib/walkieChannels';

  // ─── State ──────────────────────────────────────────────────────────
  let data = $state<WK.WalkieState>(WK.load());
  let copyMsg = $state('');

  // ─── Load / Save ───────────────────────────────────────────────────
  function reload() { data = WK.load(); }

  async function save() { await WK.save(data); }

  onMount(() => {
    reload();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(WK.STORAGE_KEY)) reload();
    });
    return () => unsub();
  });

  // ─── Actions ──────────────────────────────────────────────────────
  function addRow() {
    WK.addChannel(data);
    data = data;
    void save();
  }

  function removeRow(id: number) {
    WK.removeChannel(data, id);
    data = data;
    void save();
  }

  function moveUp(idx: number) {
    WK.moveUp(data, idx);
    data = data;
    void save();
  }

  function moveDown(idx: number) {
    WK.moveDown(data, idx);
    data = data;
    void save();
  }

  function resetDefaults() {
    WK.resetDefaults(data);
    data = data;
    void save();
  }

  async function copyChart() {
    const text = WK.formatText(data.channels);
    try {
      await navigator.clipboard.writeText(text);
      copyMsg = 'Copied!';
      setTimeout(() => copyMsg = '', 2000);
    } catch { copyMsg = 'Failed'; }
  }

  function onBlur() { void save(); }
</script>

<div class="walkie-tab">
  <div class="toolbar">
    <h2>Walkie Channels</h2>
    <span class="count-badge">{data.channels.length} channels</span>
    <div class="toolbar-actions">
      <button class="tb-btn" onclick={addRow}>+ Add</button>
      <button class="tb-btn" onclick={copyChart}>Copy</button>
      <button class="tb-btn" onclick={resetDefaults}>Reset Defaults</button>
      {#if copyMsg}<span class="copy-msg">{copyMsg}</span>{/if}
    </div>
  </div>

  <div class="chart-scroll">
    {#if data.channels.length === 0}
      <div class="empty">
        <p>No channels configured. Click <strong>+ Add</strong> or <strong>Reset Defaults</strong> to get started.</p>
      </div>
    {:else}
      <div class="chart-grid">
        <div class="cg-header">
          <span class="h-ch">Ch</span>
          <span class="h-dept">Department</span>
          <span class="h-notes">Notes</span>
          <span class="h-act"></span>
        </div>
        {#each data.channels as ch, idx (ch.id)}
          <div class="cg-row">
            <input
              class="cell cell-ch"
              bind:value={ch.channel}
              placeholder="#"
              onblur={onBlur}
            />
            <input
              class="cell cell-dept"
              bind:value={ch.department}
              placeholder="Department"
              onblur={onBlur}
            />
            <input
              class="cell cell-notes"
              bind:value={ch.notes}
              placeholder="Notes"
              onblur={onBlur}
            />
            <div class="cell-actions">
              <button class="mini-btn" title="Move up" onclick={() => moveUp(idx)} disabled={idx === 0}>▲</button>
              <button class="mini-btn" title="Move down" onclick={() => moveDown(idx)} disabled={idx === data.channels.length - 1}>▼</button>
              <button class="mini-btn danger" title="Remove" onclick={() => removeRow(ch.id)}>✕</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Quick-reference card view (read-only, always visible below editor) -->
    <div class="qr-section">
      <h3 class="qr-title">Quick Reference</h3>
      <div class="qr-grid">
        {#each data.channels as ch (ch.id)}
          <div class="qr-card">
            <span class="qr-ch">Ch {ch.channel}</span>
            <span class="qr-dept">{ch.department}</span>
            {#if ch.notes}<span class="qr-notes">{ch.notes}</span>{/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .walkie-tab {
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
  .count-badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(167, 139, 250, 0.1);
    color: var(--accent);
    border: 1px solid rgba(167, 139, 250, 0.2);
  }
  .toolbar-actions { display: flex; gap: 6px; margin-left: auto; align-items: center; }
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
  .copy-msg { font-family: var(--mono); font-size: 11px; color: var(--success); }

  /* ─── Chart editor ─── */
  .chart-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .empty { padding: 40px; text-align: center; }
  .empty p { font-size: 14px; color: var(--text2); line-height: 1.6; }

  .chart-grid { margin-bottom: 24px; }

  .cg-header {
    display: grid;
    grid-template-columns: 60px 1fr 1fr 80px;
    gap: 0;
  }
  .cg-header span {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
    padding: 6px 8px;
    border-bottom: 2px solid var(--border);
    background: var(--bg2);
  }

  .cg-row {
    display: grid;
    grid-template-columns: 60px 1fr 1fr 80px;
    gap: 0;
    border-bottom: 1px solid var(--border);
  }
  .cg-row:hover { background: var(--bg2); }

  .cell {
    background: transparent;
    border: none;
    padding: 8px;
    font-size: 13px;
    color: var(--text);
    font-family: var(--font);
    outline: none;
  }
  .cell:focus { background: rgba(167, 139, 250, 0.05); }
  .cell-ch {
    font-family: var(--mono);
    font-weight: 700;
    font-size: 14px;
    text-align: center;
    color: var(--accent);
  }
  .cell-dept { font-weight: 600; }
  .cell-notes { font-size: 12px; color: var(--text2); }

  .cell-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    opacity: 0.3;
    transition: opacity 0.12s;
  }
  .cg-row:hover .cell-actions { opacity: 1; }

  .mini-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 10px;
    color: var(--text3);
    padding: 2px 4px;
    border-radius: 3px;
    line-height: 1;
  }
  .mini-btn:hover { color: var(--text); background: var(--bg3); }
  .mini-btn:disabled { opacity: 0.2; cursor: not-allowed; }
  .mini-btn.danger:hover { color: var(--danger); }

  /* ─── Quick Reference ─── */
  .qr-section {
    border-top: 1px solid var(--border);
    padding-top: 16px;
  }
  .qr-title {
    font-family: var(--cond);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
    margin-bottom: 10px;
  }
  .qr-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 8px;
  }
  .qr-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .qr-ch {
    font-family: var(--mono);
    font-size: 16px;
    font-weight: 700;
    color: var(--accent);
  }
  .qr-dept {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .qr-notes {
    font-size: 10px;
    color: var(--text3);
  }

  @media (max-width: 640px) {
    .chart-scroll { padding: 10px 12px; }
    .cg-header, .cg-row { grid-template-columns: 50px 1fr 80px; }
    .h-notes, .cell-notes { display: none; }
    .qr-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  }
</style>
