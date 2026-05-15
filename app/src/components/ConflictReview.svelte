<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as contacts from '../lib/contacts';
  import * as cs from '../lib/conflictStatus';
  import * as data from '../lib/data';
  import type { ConflictReviewStatus, UnifiedContact } from '../lib/types';

  type Filter = 'all' | 'unreviewed' | 'acknowledged' | 'to_fix';

  let people = $state<UnifiedContact[]>([]);
  let filter = $state<Filter>('unreviewed');
  let search = $state('');
  let editingNote = $state<string | null>(null);
  let noteText = $state('');
  let toast = $state('');

  function refresh() {
    people = contacts.loadAllContacts();
  }

  onMount(() => {
    refresh();
    const unsub = sync.subscribe((keys) => {
      if (keys.some((k) =>
        /^(settools_(cast|crew|cast_bible|dood|conflict_status)|ST_nextday)$/.test(k)
      )) refresh();
    });
    // Prune stale entries on load (conflicts that no longer exist)
    setTimeout(() => {
      const rows = cs.listConflicts(contacts.loadAllContacts());
      cs.pruneStaleStatuses(new Set(rows.map((r) => r.id)));
    }, 100);
    return () => unsub();
  });

  let rows = $derived(cs.listConflicts(people));
  let counts = $derived(cs.countByStatus(rows));

  let filteredRows = $derived.by(() => {
    const q = search.trim().toLowerCase();
    let list = rows.slice();
    if (filter !== 'all') list = list.filter((r) => r.review.status === filter);
    if (q) list = list.filter((r) =>
      r.contactName.toLowerCase().includes(q) ||
      r.conflict.field.toLowerCase().includes(q) ||
      r.conflict.values.some((v) => v.value.toLowerCase().includes(q)) ||
      (r.review.note ?? '').toLowerCase().includes(q),
    );
    // Order: unreviewed first, then to_fix, then acknowledged.
    const order: Record<ConflictReviewStatus, number> = { unreviewed: 0, to_fix: 1, acknowledged: 2 };
    list.sort((a, b) => order[a.review.status] - order[b.review.status]);
    return list;
  });

  async function mark(id: string, status: ConflictReviewStatus, note?: string) {
    await cs.setStatus(id, status, note);
    refresh();
  }

  async function markAllAcknowledged() {
    if (!confirm(`Mark all ${counts.unreviewed} unreviewed conflicts as Acknowledged (non-issues)?\n\nYou can still re-mark any of them as "Fix in Bible" individually.`)) return;
    for (const r of rows) {
      if (r.review.status === 'unreviewed') {
        await cs.setStatus(r.id, 'acknowledged');
      }
    }
    refresh();
  }

  function startEditNote(id: string, currentNote: string | undefined) {
    editingNote = id;
    noteText = currentNote ?? '';
  }
  async function saveNote(id: string) {
    const current = rows.find((r) => r.id === id);
    if (!current) { editingNote = null; return; }
    await cs.setStatus(id, current.review.status === 'unreviewed' ? 'to_fix' : current.review.status, noteText);
    editingNote = null; noteText = '';
    refresh();
  }
  function cancelNote() { editingNote = null; noteText = ''; }

  function exportPdf() {
    const proj = data.activeProject();
    cs.exportToFixPdf(rows, { productionName: proj?.name });
    toast = 'Opening print dialog…';
    setTimeout(() => { toast = ''; }, 2200);
  }

  async function clearAllStatuses() {
    if (!confirm('Reset ALL conflict review statuses?\n\nEvery acknowledged / to-fix mark becomes "unreviewed" again. Cannot be undone.')) return;
    await cs.clearAll();
    refresh();
  }
</script>

<section class="review">
  <header class="hdr">
    <div class="hdr-l">
      <div class="hdr-eyebrow">CONFLICT REVIEW</div>
      <h1>Cross-Source Triage</h1>
      <div class="hdr-meta">
        <strong>{counts.total}</strong> conflicts ·
        <span class="m-un">{counts.unreviewed} unreviewed</span> ·
        <span class="m-ack">{counts.acknowledged} acknowledged</span> ·
        <span class="m-fix">{counts.to_fix} to fix in bible</span>
      </div>
    </div>
    <div class="hdr-r">
      <button class="btn primary" disabled={!counts.to_fix} onclick={exportPdf}>
        ⬇ Export Fix List (PDF) — {counts.to_fix}
      </button>
    </div>
  </header>

  <p class="lede">
    Cross-source mismatches detected automatically. For each one: read the values from each source, then either
    <strong class="m-ack">Acknowledge</strong> (it's a non-issue — different formatting, ambiguous, etc.) or
    <strong class="m-fix">Fix in Bible</strong> (the bible has the wrong value, manual update needed).
    When you're done triaging, export the Fix List to PDF and update the bible offline.
  </p>

  {#if !rows.length}
    <div class="empty">
      <h3>No conflicts detected ✓</h3>
      <p>Every field with multiple sources has consistent values. Either your data is well-aligned, or you haven't loaded multiple sources yet.</p>
    </div>
  {:else}
    <div class="toolbar">
      <input class="search" type="search" placeholder="Search by name, field, value, or note…" bind:value={search} />
      <div class="filters">
        <button class:active={filter === 'unreviewed'}  onclick={() => filter = 'unreviewed'}>Unreviewed ({counts.unreviewed})</button>
        <button class:active={filter === 'to_fix'}      onclick={() => filter = 'to_fix'}>⚠ Fix in Bible ({counts.to_fix})</button>
        <button class:active={filter === 'acknowledged'} onclick={() => filter = 'acknowledged'}>✓ Acknowledged ({counts.acknowledged})</button>
        <button class:active={filter === 'all'}         onclick={() => filter = 'all'}>All ({counts.total})</button>
      </div>
      {#if counts.unreviewed > 0}
        <button class="btn ghost small" onclick={markAllAcknowledged}>Mark all unreviewed → Acknowledged</button>
      {/if}
      <button class="btn ghost small danger" onclick={clearAllStatuses}>Reset all</button>
    </div>

    <div class="list">
      {#each filteredRows as row (row.id)}
        <article class="conflict status-{row.review.status}">
          <div class="c-head">
            <div class="c-title">
              <span class="c-person">{row.contactName}</span>
              <span class="c-field">{contacts.fieldLabel(row.conflict.field)}</span>
            </div>
            <div class="c-status">
              {#if row.review.status === 'acknowledged'}<span class="badge ack">✓ Acknowledged</span>{/if}
              {#if row.review.status === 'to_fix'}<span class="badge fix">⚠ Fix in Bible</span>{/if}
            </div>
          </div>

          <div class="c-values">
            {#each row.conflict.values as v (v.source + v.value)}
              <div class="c-value">
                <span class="cv-source">{contacts.sourceLabel(v.source)}</span>
                <span class="cv-value">{v.value}</span>
              </div>
            {/each}
          </div>

          {#if editingNote === row.id}
            <div class="note-edit">
              <textarea
                rows="2"
                placeholder="e.g. 'Use call sheet number — bible is from last week'"
                bind:value={noteText}
              ></textarea>
              <div class="note-actions">
                <button class="btn ghost small" onclick={cancelNote}>Cancel</button>
                <button class="btn primary small" onclick={() => saveNote(row.id)}>Save Note</button>
              </div>
            </div>
          {:else if row.review.note}
            <div class="note-display">
              <strong>Note:</strong> {row.review.note}
              <button class="link-btn" onclick={() => startEditNote(row.id, row.review.note)}>edit</button>
            </div>
          {/if}

          <div class="c-actions">
            <button
              class="action ack"
              class:on={row.review.status === 'acknowledged'}
              onclick={() => mark(row.id, row.review.status === 'acknowledged' ? 'unreviewed' : 'acknowledged')}
            >✓ Acknowledge</button>
            <button
              class="action fix"
              class:on={row.review.status === 'to_fix'}
              onclick={() => mark(row.id, row.review.status === 'to_fix' ? 'unreviewed' : 'to_fix', row.review.note)}
            >⚠ Fix in Bible</button>
            {#if editingNote !== row.id && !row.review.note}
              <button class="action note-btn" onclick={() => startEditNote(row.id, '')}>+ Note</button>
            {/if}
          </div>
        </article>
      {/each}
      {#if !filteredRows.length}
        <div class="empty-row">No conflicts match the current filter / search.</div>
      {/if}
    </div>
  {/if}

  {#if toast}<div class="toast">{toast}</div>{/if}
</section>

<style>
  .review { max-width: 1000px; margin: 0 auto; padding: 24px 20px 60px; position: relative; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 14px; flex-wrap: wrap; }
  .hdr-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
  .hdr h1 { font-family: var(--cond); font-size: 32px; font-weight: 700; letter-spacing: 0.04em; color: var(--text); line-height: 1.05; }
  .hdr-meta { font-family: var(--mono); font-size: 12px; color: var(--text2); margin-top: 6px; }
  .hdr-meta strong { color: var(--accent); }
  .m-un { color: var(--warn); }
  .m-ack { color: var(--success); }
  .m-fix { color: var(--danger); font-weight: 600; }

  .lede { color: var(--text2); font-size: 13px; line-height: 1.6; margin-bottom: 18px; max-width: 800px; }
  .lede strong { font-weight: 600; }

  .empty { text-align: center; padding: 60px 20px; color: var(--text2); }
  .empty h3 { color: var(--success); font-size: 20px; margin-bottom: 8px; }
  .empty-row { text-align: center; padding: 30px; color: var(--text3); font-style: italic; }

  /* Buttons */
  .btn { font-family: var(--font); font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 6px; cursor: pointer; transition: all .12s; border: 1px solid; }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .btn.primary:hover:not(:disabled) { background: var(--accent2); border-color: var(--accent2); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .btn.ghost:hover { color: var(--accent); border-color: var(--accent); }
  .btn.ghost.danger:hover { color: var(--danger); border-color: var(--danger); }
  .btn.small { padding: 6px 10px; font-size: 11px; }

  /* Toolbar */
  .toolbar { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
  .search { flex: 1; min-width: 200px; font-family: var(--font); font-size: 13px; padding: 8px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; }
  .search:focus { outline: none; border-color: var(--accent); }
  .filters { display: flex; gap: 4px; flex-wrap: wrap; }
  .filters button { font-family: var(--mono); font-size: 11px; padding: 6px 10px; background: var(--bg2); color: var(--text2); border: 1px solid var(--border); border-radius: 5px; cursor: pointer; transition: all .12s; }
  .filters button:hover { color: var(--text); }
  .filters button.active { background: rgba(167,139,250,0.15); color: var(--accent); border-color: rgba(167,139,250,0.4); }

  /* Conflict cards */
  .list { display: flex; flex-direction: column; gap: 10px; }
  .conflict { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; transition: all .12s; }
  .conflict.status-unreviewed { border-left: 3px solid var(--warn); }
  .conflict.status-acknowledged { border-left: 3px solid var(--success); opacity: 0.7; }
  .conflict.status-to_fix { border-left: 3px solid var(--danger); background: rgba(224,90,90,0.05); }

  .c-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .c-title { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .c-person { font-size: 16px; font-weight: 700; color: var(--text); }
  .c-field {
    font-family: var(--mono); font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--warn); padding: 3px 8px;
    background: rgba(240,160,64,0.13); border: 1px solid rgba(240,160,64,0.3);
    border-radius: 3px;
  }
  .badge {
    font-family: var(--mono); font-size: 10px; font-weight: 700;
    padding: 3px 9px; border-radius: 3px; letter-spacing: 0.05em;
  }
  .badge.ack { background: rgba(52,211,153,0.15); color: var(--success); border: 1px solid rgba(52,211,153,0.4); }
  .badge.fix { background: rgba(224,90,90,0.15); color: var(--danger); border: 1px solid rgba(224,90,90,0.4); }

  .c-values { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .c-value { display: flex; gap: 12px; align-items: baseline; }
  .cv-source {
    font-family: var(--mono); font-size: 10px; color: var(--text3);
    text-transform: uppercase; letter-spacing: 0.06em;
    min-width: 100px; flex-shrink: 0;
  }
  .cv-value { font-size: 13.5px; color: var(--text); }

  .note-display { font-size: 12px; color: var(--success); margin: 6px 0; font-style: italic; padding: 6px 10px; background: rgba(52,211,153,0.07); border: 1px solid rgba(52,211,153,0.2); border-radius: 4px; }
  .note-display strong { font-style: normal; }
  .link-btn { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 11px; text-decoration: underline; margin-left: 8px; }
  .link-btn:hover { color: var(--accent); }

  .note-edit { margin: 6px 0; }
  .note-edit textarea {
    width: 100%; resize: vertical; min-height: 50px;
    font-family: var(--font); font-size: 13px; padding: 8px 10px;
    background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px;
  }
  .note-edit textarea:focus { outline: none; border-color: var(--accent); }
  .note-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }

  .c-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  .action {
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    padding: 6px 12px; border-radius: 5px; cursor: pointer; transition: all .12s;
    background: var(--bg3); color: var(--text2); border: 1px solid var(--border);
  }
  .action:hover { background: var(--bg4); color: var(--text); }
  .action.ack.on { background: rgba(52,211,153,0.15); color: var(--success); border-color: rgba(52,211,153,0.4); }
  .action.fix.on { background: rgba(224,90,90,0.15); color: var(--danger); border-color: rgba(224,90,90,0.4); }
  .action.ack:hover { color: var(--success); border-color: var(--success); }
  .action.fix:hover { color: var(--danger); border-color: var(--danger); }
  .action.note-btn:hover { color: var(--accent); border-color: var(--accent); }

  .toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--bg3); color: var(--accent); border: 1px solid var(--accent);
    padding: 10px 18px; border-radius: 8px; font-family: var(--mono); font-size: 12px;
    z-index: 1000; box-shadow: 0 4px 14px rgba(0,0,0,0.4);
  }
</style>
