<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as issues from '../lib/issues';
  import * as contacts from '../lib/contacts';
  import type { IssueEntry, IssueType, IssueStatus, UnifiedContact } from '../lib/types';

  let state = $state(issues.loadIssues());
  let people = $state<UnifiedContact[]>([]);

  // Quick-create state
  let composeOpen = $state(false);
  let inputType    = $state<IssueType>('talent_late');
  let inputDesc    = $state('');
  let inputPerson  = $state('');
  let inputDept    = $state('');
  let inputScene   = $state('');

  let filter = $state<IssueStatus | 'all' | 'unresolved'>('unresolved');
  let search = $state('');

  // Resolution dialog
  let resolvingId = $state<string | null>(null);
  let resolveNote = $state('');

  function refresh() {
    state = issues.loadIssues();
    people = contacts.loadAllContacts();
  }

  onMount(() => {
    refresh();
    const unsub = sync.subscribe((keys) => {
      if (keys.some((k) => k === 'settools_issues' || /^(settools_(cast|crew|cast_bible)|ST_nextday)$/.test(k))) refresh();
    });
    return () => unsub();
  });

  async function quickCreate(type: IssueType) {
    composeOpen = true;
    inputType = type;
    setTimeout(() => document.getElementById('issue-desc')?.focus(), 30);
  }

  async function submit(e: Event) {
    e.preventDefault();
    const desc = inputDesc.trim();
    if (!desc) return;
    await issues.addIssue({
      type: inputType,
      description: desc,
      person: inputPerson.trim() || undefined,
      department: inputDept.trim() || undefined,
      scene: inputScene.trim() || undefined,
    });
    inputDesc = ''; inputPerson = ''; inputDept = ''; inputScene = '';
    composeOpen = false;
    refresh();
  }

  function cancelCompose() {
    composeOpen = false;
    inputDesc = ''; inputPerson = ''; inputDept = ''; inputScene = '';
  }

  async function startResolve(id: string) {
    resolvingId = id;
    resolveNote = '';
  }
  async function confirmResolve() {
    if (!resolvingId) return;
    await issues.resolveIssue(resolvingId, resolveNote.trim() || undefined);
    resolvingId = null; resolveNote = '';
    refresh();
  }
  function cancelResolve() { resolvingId = null; resolveNote = ''; }

  async function reopen(id: string) { await issues.reopenIssue(id); refresh(); }
  async function setProgress(id: string) { await issues.updateIssue(id, { status: 'in_progress' }); refresh(); }
  async function remove(id: string) {
    if (!confirm('Delete this issue permanently?')) return;
    await issues.deleteIssue(id); refresh();
  }

  let counts = $derived.by(() => {
    let open = 0, in_progress = 0, resolved = 0;
    for (const i of state.issues) {
      if (i.status === 'open') open++;
      else if (i.status === 'in_progress') in_progress++;
      else resolved++;
    }
    return { open, in_progress, resolved, total: state.issues.length };
  });

  let filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    let list = state.issues.slice();
    if (filter === 'unresolved') list = list.filter((i) => i.status !== 'resolved');
    else if (filter !== 'all') list = list.filter((i) => i.status === filter);
    if (q) list = list.filter((i) =>
      i.description.toLowerCase().includes(q) ||
      (i.person ?? '').toLowerCase().includes(q) ||
      (i.department ?? '').toLowerCase().includes(q) ||
      (i.scene ?? '').toLowerCase().includes(q),
    );
    // Open first, then in_progress, then resolved; within each newest first.
    const order = { open: 0, in_progress: 1, resolved: 2 } as const;
    list.sort((a, b) => {
      const r = order[a.status] - order[b.status];
      if (r !== 0) return r;
      return b.created_at.localeCompare(a.created_at);
    });
    return list;
  });

  const QUICK_TYPES: IssueType[] = ['talent_late', 'equipment', 'wardrobe', 'makeup_hair', 'location', 'safety'];
</script>

<section class="issues">
  <header class="hdr">
    <div class="hdr-eyebrow">ISSUE TRACKER</div>
    <h1>On-Set Issues</h1>
    <div class="hdr-meta">
      <span class="meta-open">{counts.open} open</span>
      {#if counts.in_progress > 0} · <span class="meta-progress">{counts.in_progress} in progress</span>{/if}
      · {counts.resolved} resolved
    </div>
  </header>

  <!-- Quick-create buttons -->
  {#if !composeOpen}
    <div class="quick-grid">
      {#each QUICK_TYPES as t (t)}
        <button class="quick-btn" onclick={() => quickCreate(t)}>
          <span class="qb-icon">{issues.TYPE_LABELS[t].icon}</span>
          <span class="qb-label">{issues.TYPE_LABELS[t].label}</span>
        </button>
      {/each}
      <button class="quick-btn other" onclick={() => quickCreate('other')}>
        <span class="qb-icon">+</span>
        <span class="qb-label">Other…</span>
      </button>
    </div>
  {:else}
    <form class="compose" onsubmit={submit}>
      <div class="compose-head">
        <select bind:value={inputType}>
          {#each Object.entries(issues.TYPE_LABELS) as [k, v] (k)}
            <option value={k}>{v.icon} {v.label}</option>
          {/each}
        </select>
        <button type="button" class="cancel-btn" onclick={cancelCompose} title="Cancel">✕</button>
      </div>
      <textarea
        id="issue-desc"
        class="compose-text"
        placeholder="What happened? (e.g. 'Lead is 20 min behind, said in Uber 5 min ago')"
        bind:value={inputDesc}
        rows="2"
      ></textarea>
      <div class="compose-row">
        <input type="text" placeholder="Person (autocompletes)" bind:value={inputPerson} list="issue-contacts" />
        <input type="text" placeholder="Department" bind:value={inputDept} />
        <input type="text" placeholder="Scene" bind:value={inputScene} class="small-input" />
        <datalist id="issue-contacts">
          {#each people as p (p.name)}<option value={p.name}></option>{/each}
        </datalist>
        <button type="submit" class="btn primary" disabled={!inputDesc.trim()}>Log Issue</button>
      </div>
    </form>
  {/if}

  <!-- Filter toolbar -->
  <div class="toolbar">
    <input class="search" type="search" placeholder="Search issues..." bind:value={search} />
    <div class="filters">
      <button class:active={filter === 'unresolved'} onclick={() => filter = 'unresolved'}>Active ({counts.open + counts.in_progress})</button>
      <button class:active={filter === 'open'}       onclick={() => filter = 'open'}>Open ({counts.open})</button>
      <button class:active={filter === 'in_progress'} onclick={() => filter = 'in_progress'}>In Progress ({counts.in_progress})</button>
      <button class:active={filter === 'resolved'}   onclick={() => filter = 'resolved'}>Resolved ({counts.resolved})</button>
      <button class:active={filter === 'all'}        onclick={() => filter = 'all'}>All ({counts.total})</button>
    </div>
  </div>

  <!-- Issues list -->
  <div class="list">
    {#each filtered as i (i.id)}
      <article class="issue status-{i.status}">
        <div class="issue-head">
          <span class="type-icon">{issues.TYPE_LABELS[i.type].icon}</span>
          <span class="type-label">{issues.TYPE_LABELS[i.type].label}</span>
          {#if i.scene}<span class="tag">Scene {i.scene}</span>{/if}
          {#if i.person}<span class="tag person">{i.person}</span>{/if}
          {#if i.department}<span class="tag dept">{i.department}</span>{/if}
          <span class="when">{issues.relativeTime(i.created_at)}</span>
        </div>
        <div class="body">{i.description}</div>
        {#if i.resolution_note}
          <div class="resolution">✓ <strong>Resolved:</strong> {i.resolution_note}</div>
        {/if}
        <div class="actions">
          {#if i.status === 'open'}
            <button class="action" onclick={() => setProgress(i.id)}>Mark In Progress</button>
            <button class="action ok" onclick={() => startResolve(i.id)}>Resolve</button>
          {:else if i.status === 'in_progress'}
            <button class="action ok" onclick={() => startResolve(i.id)}>Resolve</button>
          {:else}
            <button class="action" onclick={() => reopen(i.id)}>Reopen</button>
          {/if}
          <button class="action danger" onclick={() => remove(i.id)}>Delete</button>
        </div>
      </article>
    {/each}
    {#if !filtered.length}
      <div class="empty">{state.issues.length ? 'No issues match the current filter.' : 'No issues logged. Tap a button above to start.'}</div>
    {/if}
  </div>

  {#if resolvingId}
    <div class="modal-bg" onclick={cancelResolve} role="presentation">
      <div
        class="modal"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => { if (e.key === 'Escape') cancelResolve(); }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resolve-title"
        tabindex="-1"
      >
        <h3 id="resolve-title">Resolve issue</h3>
        <p class="modal-hint">Add an optional resolution note. Useful for the end-of-day report.</p>
        <textarea bind:value={resolveNote} rows="3" placeholder="e.g. 'Lead arrived at 7:25, only 25min late. Picked up scene 2.'"></textarea>
        <div class="modal-actions">
          <button class="btn ghost" onclick={cancelResolve}>Cancel</button>
          <button class="btn primary" onclick={confirmResolve}>Mark Resolved</button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .issues { max-width: 900px; margin: 0 auto; padding: 24px 20px 60px; }
  .hdr-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
  .hdr h1 { font-family: var(--cond); font-size: 32px; font-weight: 700; letter-spacing: 0.04em; color: var(--text); line-height: 1.05; }
  .hdr-meta { font-family: var(--mono); font-size: 12px; color: var(--text2); margin-top: 6px; }
  .meta-open { color: var(--warn); font-weight: 700; }
  .meta-progress { color: var(--accent); font-weight: 700; }

  /* Quick-create button grid */
  .quick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin: 16px 0 14px; }
  .quick-btn {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    background: var(--bg2); color: var(--text); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 10px; cursor: pointer; transition: all .12s;
    font-family: var(--font);
  }
  .quick-btn:hover { border-color: var(--accent); background: rgba(167,139,250,0.07); }
  .quick-btn.other { border-style: dashed; color: var(--text2); }
  .qb-icon { font-size: 22px; line-height: 1; }
  .qb-label { font-size: 12px; font-weight: 600; }

  /* Compose form */
  .compose { background: var(--bg2); border: 1px solid var(--accent); border-radius: 12px; padding: 14px; margin: 16px 0 14px; }
  .compose-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .compose-head select { font-family: var(--font); font-size: 14px; font-weight: 600; padding: 8px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; }
  .cancel-btn { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 16px; padding: 4px 8px; }
  .cancel-btn:hover { color: var(--danger); }
  .compose-text {
    width: 100%; resize: vertical; min-height: 50px;
    font-family: var(--font); font-size: 14px; line-height: 1.5;
    background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px;
  }
  .compose-text:focus { outline: none; border-color: var(--accent); }
  .compose-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
  .compose-row input {
    font-family: var(--font); font-size: 13px; padding: 8px 10px;
    background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px;
    flex: 1; min-width: 130px;
  }
  .compose-row input.small-input { flex: 0 0 80px; min-width: 80px; }
  .compose-row input:focus { outline: none; border-color: var(--accent); }

  .btn { font-family: var(--font); font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 6px; cursor: pointer; transition: all .12s; border: 1px solid; }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .btn.primary:hover:not(:disabled) { background: var(--accent2); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .btn.ghost:hover { color: var(--accent); border-color: var(--accent); }

  /* Toolbar */
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
  .search { flex: 1; min-width: 180px; font-family: var(--font); font-size: 13px; padding: 8px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; }
  .search:focus { outline: none; border-color: var(--accent); }
  .filters { display: flex; gap: 4px; flex-wrap: wrap; }
  .filters button { font-family: var(--mono); font-size: 11px; padding: 6px 10px; background: var(--bg2); color: var(--text2); border: 1px solid var(--border); border-radius: 5px; cursor: pointer; transition: all .12s; }
  .filters button:hover { color: var(--text); }
  .filters button.active { background: rgba(167,139,250,0.15); color: var(--accent); border-color: rgba(167,139,250,0.4); }

  /* Issue cards */
  .list { display: flex; flex-direction: column; gap: 8px; }
  .issue { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; transition: border-color .12s; }
  .issue.status-open        { border-left: 3px solid var(--warn); }
  .issue.status-in_progress { border-left: 3px solid var(--accent); }
  .issue.status-resolved    { border-left: 3px solid var(--success); opacity: 0.7; }
  .issue-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .type-icon { font-size: 16px; }
  .type-label { font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: var(--text); }
  .tag { font-family: var(--mono); font-size: 10px; padding: 2px 7px; background: var(--bg3); color: var(--text2); border: 1px solid var(--border); border-radius: 3px; }
  .tag.person { color: var(--success); border-color: rgba(52,211,153,0.3); }
  .tag.dept   { color: var(--accent); border-color: rgba(167,139,250,0.3); }
  .when { font-family: var(--mono); font-size: 10px; color: var(--text3); margin-left: auto; }
  .body { font-size: 14px; line-height: 1.55; color: var(--text); white-space: pre-wrap; word-break: break-word; }
  .resolution { font-size: 12px; color: var(--success); margin-top: 6px; font-style: italic; }
  .resolution strong { font-style: normal; }

  .actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  .action { font-family: var(--mono); font-size: 11px; padding: 5px 10px; background: var(--bg3); color: var(--text2); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; transition: all .12s; }
  .action:hover { color: var(--accent); border-color: var(--accent); }
  .action.ok:hover { color: var(--success); border-color: var(--success); }
  .action.danger:hover { color: var(--danger); border-color: var(--danger); }

  .empty { text-align: center; padding: 40px 20px; color: var(--text3); font-style: italic; }

  /* Resolution modal */
  .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
  .modal { background: var(--bg2); border: 1px solid var(--accent); border-radius: 12px; width: min(500px, 100%); padding: 22px; box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
  .modal h3 { font-family: var(--cond); font-size: 18px; color: var(--accent); margin-bottom: 4px; }
  .modal-hint { font-size: 12px; color: var(--text2); margin-bottom: 12px; }
  .modal textarea { width: 100%; resize: vertical; font-family: var(--font); font-size: 13px; padding: 10px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; }
  .modal textarea:focus { outline: none; border-color: var(--accent); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
</style>
