<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as CL from '../lib/commLog';

  // ─── State ──────────────────────────────────────────────────────────
  let entries = $state<CL.CommEntry[]>([]);
  let filter = $state<CL.CommType | 'all' | 'flagged'>('all');
  let showForm = $state(false);

  // Form fields
  let fType = $state<CL.CommType>('call');
  let fDir = $state<CL.CommDirection>('outbound');
  let fContact = $state('');
  let fSubject = $state('');
  let fNotes = $state('');

  // Edit state
  let editId = $state<string | null>(null);
  let copyMsg = $state('');

  // ─── Derived ────────────────────────────────────────────────────────
  let filtered = $derived.by(() => {
    if (filter === 'all') return entries;
    if (filter === 'flagged') return entries.filter((e) => e.flagged && !e.resolved);
    return entries.filter((e) => e.type === filter);
  });

  let totalCount = $derived(entries.length);
  let flaggedCount = $derived(entries.filter((e) => e.flagged && !e.resolved).length);

  // ─── Load ──────────────────────────────────────────────────────────
  function load() {
    entries = CL.loadLog().entries;
  }

  onMount(() => {
    load();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(CL.STORAGE_KEY)) load();
    });
    return () => unsub();
  });

  // ─── Actions ──────────────────────────────────────────────────────
  function resetForm() {
    fType = 'call';
    fDir = 'outbound';
    fContact = '';
    fSubject = '';
    fNotes = '';
    editId = null;
    showForm = false;
  }

  async function submitForm() {
    if (!fContact.trim()) return;

    if (editId) {
      await CL.updateEntry(editId, {
        type: fType,
        direction: fDir,
        contact: fContact.trim(),
        subject: fSubject.trim(),
        notes: fNotes.trim(),
      });
    } else {
      await CL.addEntry({
        type: fType,
        direction: fDir,
        contact: fContact.trim(),
        subject: fSubject.trim(),
        notes: fNotes.trim(),
      });
    }
    load();
    resetForm();
  }

  function startEdit(e: CL.CommEntry) {
    editId = e.id;
    fType = e.type;
    fDir = e.direction;
    fContact = e.contact;
    fSubject = e.subject;
    fNotes = e.notes;
    showForm = true;
  }

  async function toggleFlag(id: string) {
    await CL.toggleFlag(id);
    load();
  }

  async function toggleResolved(id: string) {
    await CL.toggleResolved(id);
    load();
  }

  async function deleteEntry(id: string) {
    await CL.deleteEntry(id);
    load();
    if (editId === id) resetForm();
  }

  async function copyLog() {
    const text = CL.formatLogText(filtered);
    try {
      await navigator.clipboard.writeText(text);
      copyMsg = 'Copied!';
      setTimeout(() => copyMsg = '', 2000);
    } catch { copyMsg = 'Failed'; }
  }

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function handleFormKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') resetForm();
  }
</script>

<div class="comm-tab">
  <div class="toolbar">
    <h2>Comm Log</h2>
    <span class="count-badge">{totalCount} entries</span>
    {#if flaggedCount > 0}
      <span class="flag-badge">{flaggedCount} flagged</span>
    {/if}
    <div class="toolbar-actions">
      <button class="tb-btn accent" onclick={() => { resetForm(); showForm = !showForm; }}>
        {showForm ? 'Cancel' : '+ Log'}
      </button>
      <button class="tb-btn" onclick={copyLog}>Copy</button>
    </div>
    {#if copyMsg}<span class="copy-msg">{copyMsg}</span>{/if}
  </div>

  <!-- Filter bar -->
  <div class="filter-bar">
    <button class="fb-btn" class:active={filter === 'all'} onclick={() => filter = 'all'}>All</button>
    {#each CL.ALL_TYPES as t (t)}
      <button class="fb-btn" class:active={filter === t} onclick={() => filter = t}>
        {CL.TYPE_LABELS[t].icon} {CL.TYPE_LABELS[t].label}
      </button>
    {/each}
    <button class="fb-btn" class:active={filter === 'flagged'} onclick={() => filter = 'flagged'}>
      Flagged
      {#if flaggedCount > 0}<span class="fb-count">{flaggedCount}</span>{/if}
    </button>
  </div>

  <!-- Quick-add form -->
  {#if showForm}
    <form class="form-panel" onsubmit={(e) => { e.preventDefault(); void submitForm(); }}>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="cl-type">Type</label>
          <select id="cl-type" bind:value={fType} class="form-select">
            {#each CL.ALL_TYPES as t (t)}
              <option value={t}>{CL.TYPE_LABELS[t].icon} {CL.TYPE_LABELS[t].label}</option>
            {/each}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="cl-dir">Direction</label>
          <select id="cl-dir" bind:value={fDir} class="form-select">
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
        </div>
        <div class="form-group grow">
          <label class="form-label" for="cl-contact">Contact</label>
          <input id="cl-contact" bind:value={fContact} class="form-input" placeholder="Name, dept, or number" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group grow">
          <label class="form-label" for="cl-subject">Subject</label>
          <input id="cl-subject" bind:value={fSubject} class="form-input" placeholder="Topic or subject line" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group grow">
          <label class="form-label" for="cl-notes">Notes</label>
          <textarea id="cl-notes" bind:value={fNotes} class="form-ta" rows="2" placeholder="Details, outcome, action items..."></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button class="action-btn" type="submit" disabled={!fContact.trim()}>
          {editId ? 'Update' : 'Log Entry'}
        </button>
        <button class="action-btn ghost" type="button" onclick={resetForm}>Cancel</button>
      </div>
    </form>
  {/if}

  <!-- Entries list -->
  <div class="entries-scroll">
    {#if filtered.length === 0}
      <div class="empty">
        <p>No communications logged{filter !== 'all' ? ` for this filter` : ''}.</p>
        <p>Click <strong>+ Log</strong> to record a call, email, text, or radio communication.</p>
      </div>
    {:else}
      {#each filtered as entry (entry.id)}
        {@const isToday = entry.timestamp.startsWith(new Date().toISOString().slice(0, 10))}
        <div class="entry-card" class:flagged={entry.flagged} class:resolved={entry.resolved}>
          <div class="ec-left">
            <span class="ec-icon" title={CL.TYPE_LABELS[entry.type].label}>{CL.TYPE_LABELS[entry.type].icon}</span>
            <span class="ec-dir" class:inbound={entry.direction === 'inbound'}>
              {entry.direction === 'inbound' ? '←' : '→'}
            </span>
          </div>
          <div class="ec-body">
            <div class="ec-top">
              <span class="ec-contact">{entry.contact}</span>
              {#if entry.subject}<span class="ec-subject">{entry.subject}</span>{/if}
              <span class="ec-time">{isToday ? fmtTime(entry.timestamp) : `${fmtDate(entry.timestamp)} ${fmtTime(entry.timestamp)}`}</span>
            </div>
            {#if entry.notes}
              <div class="ec-notes">{entry.notes}</div>
            {/if}
          </div>
          <div class="ec-actions">
            <button
              class="icon-btn"
              class:active={entry.flagged}
              title={entry.flagged ? 'Unflag' : 'Flag for follow-up'}
              onclick={() => void toggleFlag(entry.id)}
            >★</button>
            <button
              class="icon-btn check"
              class:active={entry.resolved}
              title={entry.resolved ? 'Mark unresolved' : 'Mark resolved'}
              onclick={() => void toggleResolved(entry.id)}
            >✓</button>
            <button class="icon-btn" title="Edit" onclick={() => startEdit(entry)}>✎</button>
            <button class="icon-btn danger" title="Delete" onclick={() => void deleteEntry(entry.id)}>✕</button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .comm-tab {
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
  .flag-badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(251, 191, 36, 0.1);
    color: var(--warn);
    border: 1px solid rgba(251, 191, 36, 0.2);
  }
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
  .tb-btn.accent { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; }
  .tb-btn.accent:hover { background: var(--accent2); border-color: var(--accent2); }
  .copy-msg { font-family: var(--mono); font-size: 11px; color: var(--success); }

  /* ─── Filter bar ─── */
  .filter-bar {
    display: flex;
    gap: 4px;
    padding: 6px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .fb-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 3px 8px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    cursor: pointer;
    transition: all 0.12s;
  }
  .fb-btn:hover { color: var(--text); border-color: var(--border); }
  .fb-btn.active { color: var(--accent); border-color: var(--accent); background: rgba(167, 139, 250, 0.08); }
  .fb-count {
    font-size: 9px;
    background: rgba(251, 191, 36, 0.2);
    color: var(--warn);
    padding: 0 4px;
    border-radius: 6px;
    margin-left: 3px;
  }

  /* ─── Form panel ─── */
  .form-panel {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 12px 16px;
    flex-shrink: 0;
  }
  .form-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .form-group { display: flex; flex-direction: column; gap: 3px; }
  .form-group.grow { flex: 1; }
  .form-label {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
  }
  .form-select, .form-input {
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--text);
    font-family: var(--font);
  }
  .form-select:focus, .form-input:focus { border-color: var(--accent); outline: none; }
  .form-ta {
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--text);
    font-family: var(--font);
    resize: vertical;
    line-height: 1.4;
  }
  .form-ta:focus { border-color: var(--accent); outline: none; }
  .form-actions { display: flex; gap: 6px; }
  .action-btn {
    padding: 6px 14px;
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
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .action-btn.ghost {
    background: transparent;
    color: var(--text2);
    border-color: var(--border);
  }
  .action-btn.ghost:hover { border-color: var(--accent); color: var(--accent); }

  /* ─── Entries ─── */
  .entries-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 16px;
  }
  .empty { padding: 40px; text-align: center; }
  .empty p { font-size: 14px; color: var(--text2); line-height: 1.6; margin-bottom: 8px; }

  .entry-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 6px;
    transition: border-color 0.12s;
  }
  .entry-card:hover { border-color: var(--accent); }
  .entry-card.flagged { border-left: 3px solid var(--warn); }
  .entry-card.resolved { opacity: 0.55; }

  .ec-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 28px;
    padding-top: 2px;
  }
  .ec-icon { font-size: 16px; }
  .ec-dir {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
  }
  .ec-dir.inbound { color: var(--success); }

  .ec-body { flex: 1; min-width: 0; }
  .ec-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 2px;
  }
  .ec-contact { font-weight: 600; font-size: 13px; color: var(--text); }
  .ec-subject { font-size: 12px; color: var(--text2); }
  .ec-time {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    margin-left: auto;
    white-space: nowrap;
  }
  .ec-notes {
    font-size: 12px;
    color: var(--text2);
    line-height: 1.4;
    margin-top: 3px;
  }

  .ec-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    opacity: 0.3;
    transition: opacity 0.12s;
  }
  .entry-card:hover .ec-actions { opacity: 1; }
  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--text3);
    padding: 2px 4px;
    border-radius: 3px;
    transition: all 0.1s;
    line-height: 1;
  }
  .icon-btn:hover { color: var(--text); background: var(--bg2); }
  .icon-btn.active { color: var(--warn); }
  .icon-btn.check.active { color: var(--success); }
  .icon-btn.danger:hover { color: var(--danger); }

  @media (max-width: 640px) {
    .filter-bar { padding: 4px 10px; }
    .entries-scroll { padding: 6px 10px; }
    .entry-card { padding: 8px; gap: 6px; }
    .form-row { flex-direction: column; }
    .ec-time { margin-left: 0; }
  }
</style>
