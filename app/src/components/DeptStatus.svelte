<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as deptStatus from '../lib/deptStatus';
  import type { DeptSummary } from '../lib/deptStatus';
  import type { DeptStatus } from '../lib/types';
  import { requestTab } from '../lib/nav';

  let summaries = $state<DeptSummary[]>([]);
  let filter = $state<'all' | DeptStatus | 'unset'>('all');
  let editingDept = $state<string | null>(null);
  let noteDraft = $state('');
  let addingDept = $state(false);
  let newDeptName = $state('');

  function refresh() {
    summaries = deptStatus.buildSummaries();
  }

  onMount(() => {
    refresh();
    const unsub = sync.subscribe((keys) => {
      if (keys.some((k) =>
        /^(settools_(dept_status|issues|cast|crew|cast_bible|dood)|ST_nextday)$/.test(k),
      )) refresh();
    });
    return () => unsub();
  });

  // ── Counts for the toolbar filters ─────────────────────────────────────────
  let counts = $derived.by(() => {
    let blocked = 0, working = 0, ready = 0, wrapped = 0, unset = 0;
    for (const s of summaries) {
      const st = s.status?.status;
      if (st === 'blocked') blocked++;
      else if (st === 'working') working++;
      else if (st === 'ready') ready++;
      else if (st === 'wrapped') wrapped++;
      else unset++;
    }
    return { blocked, working, ready, wrapped, unset, total: summaries.length };
  });

  // Filter + sort: blocked first, then working, then ready, then unset, then wrapped.
  let visible = $derived.by(() => {
    let list = summaries.slice();
    if (filter !== 'all') {
      list = list.filter((s) => {
        if (filter === 'unset') return !s.status;
        return s.status?.status === filter;
      });
    }
    const rank: Record<string, number> = { blocked: 0, working: 1, ready: 2, unset: 3, wrapped: 4 };
    list.sort((a, b) => {
      const ar = rank[a.status?.status ?? 'unset'] ?? 99;
      const br = rank[b.status?.status ?? 'unset'] ?? 99;
      if (ar !== br) return ar - br;
      // Secondary: open-issue count (more first)
      if (a.openIssues.length !== b.openIssues.length) return b.openIssues.length - a.openIssues.length;
      return a.dept.localeCompare(b.dept);
    });
    return list;
  });

  // ── Status actions ────────────────────────────────────────────────────────
  async function pickStatus(dept: string, status: DeptStatus) {
    const existing = summaries.find((s) => s.dept === dept)?.status;
    await deptStatus.setStatus(dept, status, existing?.note);
    refresh();
  }

  function openNote(dept: string) {
    const existing = summaries.find((s) => s.dept === dept)?.status;
    editingDept = dept;
    noteDraft = existing?.note ?? '';
    setTimeout(() => document.getElementById('dept-note-input')?.focus(), 30);
  }
  async function saveNote() {
    if (!editingDept) return;
    const existing = summaries.find((s) => s.dept === editingDept)?.status;
    const status = existing?.status ?? 'ready';
    await deptStatus.setStatus(editingDept, status, noteDraft);
    editingDept = null;
    noteDraft = '';
    refresh();
  }
  function cancelNote() { editingDept = null; noteDraft = ''; }

  async function clearStatus(dept: string) {
    if (!confirm(`Clear status for ${dept}?`)) return;
    await deptStatus.clearStatus(dept);
    refresh();
  }

  async function hideDept(dept: string) {
    if (!confirm(`Hide ${dept} from the board?\n\nYou can add it back from the "+ Add Dept" button.`)) return;
    await deptStatus.hideDept(dept);
    refresh();
  }

  async function addDept() {
    const name = newDeptName.trim();
    if (!name) return;
    await deptStatus.addCustomDept(name);
    newDeptName = '';
    addingDept = false;
    refresh();
  }

  async function resetAll() {
    if (!confirm(`Clear all department statuses?\n\nThis resets the board but keeps your custom dept list. Useful at the start of a new shoot day.`)) return;
    await deptStatus.resetAllStatuses();
    refresh();
  }

  const STATUS_BUTTONS: DeptStatus[] = ['ready', 'working', 'blocked', 'wrapped'];
</script>

<section class="board">
  <header class="hdr">
    <div class="hdr-eyebrow">DEPARTMENT STATUS</div>
    <h1>Status Board</h1>
    <div class="hdr-meta">
      {#if counts.blocked > 0}<span class="meta-blocked">{counts.blocked} blocked</span> · {/if}
      <span class="meta-working">{counts.working} rolling</span>
      · <span class="meta-ready">{counts.ready} ready</span>
      · {counts.wrapped} wrapped
      · {counts.unset} unset
    </div>
  </header>

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="filters">
      <button class:active={filter === 'all'}     onclick={() => filter = 'all'}>All ({counts.total})</button>
      {#if counts.blocked > 0}
        <button class="blocked" class:active={filter === 'blocked'} onclick={() => filter = 'blocked'}>🛑 Blocked ({counts.blocked})</button>
      {/if}
      <button class:active={filter === 'working'} onclick={() => filter = 'working'}>🎬 Rolling ({counts.working})</button>
      <button class:active={filter === 'ready'}   onclick={() => filter = 'ready'}>🟢 Ready ({counts.ready})</button>
      <button class:active={filter === 'unset'}   onclick={() => filter = 'unset'}>○ Unset ({counts.unset})</button>
      <button class:active={filter === 'wrapped'} onclick={() => filter = 'wrapped'}>✅ Wrapped ({counts.wrapped})</button>
    </div>
    <div class="toolbar-actions">
      <button class="ghost-btn" onclick={() => { addingDept = true; setTimeout(() => document.getElementById('new-dept-input')?.focus(), 30); }}>+ Add Dept</button>
      <button class="ghost-btn danger" onclick={resetAll}>Reset All</button>
    </div>
  </div>

  {#if addingDept}
    <form class="add-dept" onsubmit={(e) => { e.preventDefault(); addDept(); }}>
      <input id="new-dept-input" type="text" placeholder="Dept name (e.g. 2nd Unit, Drone, Animals)" bind:value={newDeptName} />
      <button type="submit" class="btn primary" disabled={!newDeptName.trim()}>Add</button>
      <button type="button" class="btn ghost" onclick={() => { addingDept = false; newDeptName = ''; }}>Cancel</button>
    </form>
  {/if}

  <!-- Cards -->
  <div class="grid">
    {#each visible as s (s.dept)}
      {@const meta = s.status ? deptStatus.STATUS_META[s.status.status] : null}
      <article class="card status-{s.status?.status ?? 'unset'}">
        <div class="card-head">
          <h3 class="dept-name">{s.dept}</h3>
          <button class="hide-btn" onclick={() => hideDept(s.dept)} title="Hide this dept from the board">✕</button>
        </div>

        {#if s.status}
          <div class="current-status">
            <span class="status-pill" style="color: {meta?.color}; border-color: {meta?.color}">
              {meta?.icon} {meta?.label}
            </span>
            <span class="when" title={new Date(s.status.updated_at).toLocaleString()}>
              {deptStatus.relativeTime(s.status.updated_at)}
            </span>
          </div>
          {#if s.status.note}
            <p class="note">{s.status.note}</p>
          {/if}
        {:else}
          <div class="current-status muted">
            <span class="status-pill muted">○ No status</span>
          </div>
        {/if}

        <!-- Auto-aggregated badges from existing tabs -->
        {#if s.openIssues.length || s.contacts.length || s.doodToday.length}
          <div class="badges">
            {#if s.openIssues.length}
              <button class="badge issues" onclick={() => requestTab('issues')} title="Open issues tagged to this dept — click to jump to Issues tab">
                ⚠ {s.openIssues.length} open {s.openIssues.length === 1 ? 'issue' : 'issues'}
              </button>
            {/if}
            {#if s.contacts.length}
              <span class="badge contacts" title="People in this dept (from contacts)">
                👥 {s.contacts.length}
              </span>
            {/if}
            {#if s.doodToday.length}
              <span class="badge dood" title="People with DOOD appearances tagged to this dept">
                📋 {s.doodToday.length} on DOOD
              </span>
            {/if}
          </div>
        {/if}

        <!-- Quick status pin buttons -->
        <div class="actions">
          {#each STATUS_BUTTONS as st (st)}
            {@const m = deptStatus.STATUS_META[st]}
            <button
              class="pin-btn"
              class:active={s.status?.status === st}
              onclick={() => pickStatus(s.dept, st)}
              title="Mark as {m.label}"
            >
              {m.icon} {m.label}
            </button>
          {/each}
        </div>

        <div class="card-foot">
          <button class="link-btn" onclick={() => openNote(s.dept)}>
            {s.status?.note ? '✎ Edit note' : '+ Add note'}
          </button>
          {#if s.status}
            <button class="link-btn danger" onclick={() => clearStatus(s.dept)}>Clear</button>
          {/if}
        </div>
      </article>
    {/each}

    {#if !visible.length}
      <div class="empty">No departments match this filter.</div>
    {/if}
  </div>

  <!-- Note editor modal -->
  {#if editingDept}
    <div class="modal-bg" onclick={cancelNote} role="presentation">
      <div
        class="modal"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => { if (e.key === 'Escape') cancelNote(); }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-title"
        tabindex="-1"
      >
        <h3 id="note-title">{editingDept} — Note</h3>
        <p class="modal-hint">One-line context for the team. e.g. "Waiting on lens swap, ~5min." or "All lit, ready to roll."</p>
        <input
          id="dept-note-input"
          type="text"
          bind:value={noteDraft}
          placeholder="Short note..."
          onkeydown={(e) => { if (e.key === 'Enter') saveNote(); }}
        />
        <div class="modal-actions">
          <button class="btn ghost" onclick={cancelNote}>Cancel</button>
          <button class="btn primary" onclick={saveNote}>Save</button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .board { max-width: 1100px; margin: 0 auto; padding: 24px 20px 60px; }

  .hdr-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
  .hdr h1 { font-family: var(--cond); font-size: 32px; font-weight: 700; letter-spacing: 0.04em; color: var(--text); line-height: 1.05; }
  .hdr-meta { font-family: var(--mono); font-size: 12px; color: var(--text2); margin-top: 6px; }
  .meta-blocked { color: var(--danger); font-weight: 700; }
  .meta-working { color: var(--accent); font-weight: 700; }
  .meta-ready { color: var(--success); }

  /* Toolbar */
  .toolbar { display: flex; gap: 10px; margin: 18px 0 12px; flex-wrap: wrap; align-items: center; }
  .filters { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
  .filters button {
    font-family: var(--mono); font-size: 11px; padding: 6px 10px;
    background: var(--bg2); color: var(--text2); border: 1px solid var(--border);
    border-radius: 5px; cursor: pointer; transition: all .12s;
  }
  .filters button:hover { color: var(--text); }
  .filters button.active { background: rgba(167,139,250,0.15); color: var(--accent); border-color: rgba(167,139,250,0.4); }
  .filters button.blocked.active { background: rgba(224,90,90,0.13); color: var(--danger); border-color: rgba(224,90,90,0.4); }
  .toolbar-actions { display: flex; gap: 6px; }
  .ghost-btn {
    font-family: var(--mono); font-size: 11px; padding: 6px 10px;
    background: transparent; color: var(--text2); border: 1px solid var(--border);
    border-radius: 5px; cursor: pointer; transition: all .12s;
  }
  .ghost-btn:hover { color: var(--accent); border-color: var(--accent); }
  .ghost-btn.danger:hover { color: var(--danger); border-color: var(--danger); }

  /* Add-dept inline form */
  .add-dept { display: flex; gap: 6px; margin-bottom: 14px; padding: 10px; background: var(--bg2); border: 1px solid var(--accent); border-radius: 8px; }
  .add-dept input {
    flex: 1; font-family: var(--font); font-size: 13px; padding: 7px 10px;
    background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 5px;
  }
  .add-dept input:focus { outline: none; border-color: var(--accent); }

  .btn { font-family: var(--font); font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 6px; cursor: pointer; transition: all .12s; border: 1px solid; }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .btn.primary:hover:not(:disabled) { background: var(--accent2); border-color: var(--accent2); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .btn.ghost:hover { color: var(--accent); border-color: var(--accent); }

  /* Card grid */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .card {
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 10px; padding: 12px 14px;
    display: flex; flex-direction: column; gap: 8px;
    transition: border-color .12s, transform .12s;
    border-left-width: 4px;
  }
  .card.status-blocked { border-left-color: var(--danger); background: rgba(224,90,90,0.04); }
  .card.status-working { border-left-color: var(--accent); background: rgba(167,139,250,0.04); }
  .card.status-ready   { border-left-color: var(--success); }
  .card.status-wrapped { border-left-color: var(--text3); opacity: 0.7; }
  .card.status-unset   { border-left-color: var(--border); }

  .card-head { display: flex; align-items: center; justify-content: space-between; }
  .dept-name { font-family: var(--cond); font-size: 17px; font-weight: 700; color: var(--text); letter-spacing: 0.03em; }
  .hide-btn { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 14px; padding: 2px 6px; transition: color .12s; }
  .hide-btn:hover { color: var(--danger); }

  .current-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .current-status.muted { opacity: 0.55; }
  .status-pill {
    font-family: var(--mono); font-size: 11px; font-weight: 700;
    padding: 3px 8px; border-radius: 4px; border: 1px solid currentColor;
    letter-spacing: 0.04em;
  }
  .status-pill.muted { color: var(--text3); border-color: var(--border); }
  .when { font-family: var(--mono); font-size: 10px; color: var(--text3); }

  .note { font-size: 13px; line-height: 1.45; color: var(--text); margin: 0; padding: 6px 10px; background: var(--bg); border-radius: 5px; border-left: 2px solid var(--accent); }

  .badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .badge {
    font-family: var(--mono); font-size: 10px; padding: 3px 7px;
    background: var(--bg3); color: var(--text2);
    border: 1px solid var(--border); border-radius: 3px;
    text-decoration: none; transition: all .12s;
  }
  /* When .badge is rendered as a <button> (e.g. dept → Issues nav), reset button chrome */
  button.badge { cursor: pointer; font: inherit; font-family: var(--mono); font-size: 10px; line-height: 1.4; }
  .badge.issues { color: var(--warn); border-color: rgba(234,179,8,0.3); }
  .badge.issues:hover { color: var(--text); background: rgba(234,179,8,0.1); border-color: var(--warn); }
  .badge.contacts { color: var(--text2); }
  .badge.dood { color: var(--accent); border-color: rgba(167,139,250,0.3); }

  /* Status pin buttons */
  .actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .pin-btn {
    font-family: var(--mono); font-size: 10px; padding: 6px 4px;
    background: var(--bg3); color: var(--text2);
    border: 1px solid var(--border); border-radius: 5px;
    cursor: pointer; transition: all .12s;
    text-align: center;
    line-height: 1.2;
  }
  .pin-btn:hover { color: var(--text); border-color: var(--text2); }
  .pin-btn.active { background: rgba(167,139,250,0.15); color: var(--accent); border-color: var(--accent); font-weight: 700; }

  .card-foot { display: flex; justify-content: space-between; gap: 6px; margin-top: 2px; }
  .link-btn { background: none; border: none; color: var(--text2); font-family: var(--mono); font-size: 11px; cursor: pointer; padding: 2px 4px; transition: color .12s; }
  .link-btn:hover { color: var(--accent); }
  .link-btn.danger:hover { color: var(--danger); }

  .empty { grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: var(--text3); font-style: italic; }

  /* Modal */
  .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
  .modal { background: var(--bg2); border: 1px solid var(--accent); border-radius: 12px; width: min(500px, 100%); padding: 22px; box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
  .modal h3 { font-family: var(--cond); font-size: 18px; color: var(--accent); margin-bottom: 4px; }
  .modal-hint { font-size: 12px; color: var(--text2); margin-bottom: 12px; }
  .modal input { width: 100%; font-family: var(--font); font-size: 14px; padding: 10px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; }
  .modal input:focus { outline: none; border-color: var(--accent); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }

  @media (max-width: 480px) {
    .grid { grid-template-columns: 1fr; }
    .actions { grid-template-columns: repeat(2, 1fr); }
  }
</style>
