<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from './lib/sync';
  import DailyBriefing from './components/DailyBriefing.svelte';
  import GlobalResources from './components/GlobalResources.svelte';
  import CastBible from './components/CastBible.svelte';
  import Contacts from './components/Contacts.svelte';
  import Notes from './components/Notes.svelte';
  import Issues from './components/Issues.svelte';
  import ConflictReview from './components/ConflictReview.svelte';
  import DeptStatus from './components/DeptStatus.svelte';
  import UniversalHeader from './components/UniversalHeader.svelte';
  import TrackerTab from './components/TrackerTab.svelte';
  import * as issuesLib from './lib/issues';
  import * as contactsLib from './lib/contacts';
  import * as csLib from './lib/conflictStatus';
  import * as deptLib from './lib/deptStatus';
  import { type Tab, isTab, onTabRequest } from './lib/nav';

  let hasWorkspace = $state(false);
  let workspaceCode = $state<string | null>(null);
  let joining = $state(false);
  let creating = $state(false);
  let err = $state<string | null>(null);
  let tab = $state<Tab>('tomorrow');
  let issueOpenCount = $state(0);
  let conflictUnreviewedCount = $state(0);
  let deptBlockedCount = $state(0);

  // Restore last-active tab from sessionStorage (per-tab, not synced)
  onMount(async () => {
    const saved = sessionStorage.getItem('st_app_tab');
    if (isTab(saved)) tab = saved;
    // Allow deep-linking to a tab via the URL hash
    const h = location.hash.replace('#', '');
    if (isTab(h)) tab = h;
    try {
      const s = await sync.init();
      hasWorkspace = s.hasWorkspace;
      workspaceCode = s.workspaceCode;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    refreshIssueCount();
    refreshConflictCount();
    refreshDeptCount();
    sync.subscribe((keys) => {
      if (keys.includes('settools_issues')) { refreshIssueCount(); refreshDeptCount(); }
      if (keys.includes('settools_dept_status')) refreshDeptCount();
      if (keys.some((k) =>
        /^(settools_(cast|crew|cast_bible|conflict_status)|ST_nextday)$/.test(k)
      )) refreshConflictCount();
    });
    // Cross-component navigation (e.g. dept card → Issues tab)
    onTabRequest((t) => { tab = t; });
    // Hash changes after first load (e.g. user clicks an in-app anchor)
    window.addEventListener('hashchange', () => {
      const h2 = location.hash.replace('#', '');
      if (isTab(h2)) tab = h2;
    });
  });

  function refreshIssueCount() {
    const c = issuesLib.counts();
    issueOpenCount = c.open + c.in_progress;
  }
  function refreshConflictCount() {
    const rows = csLib.listConflicts(contactsLib.loadAllContacts());
    conflictUnreviewedCount = rows.filter((r) => r.review.status === 'unreviewed').length;
  }
  function refreshDeptCount() {
    deptBlockedCount = deptLib.blockedCount();
  }

  $effect(() => { sessionStorage.setItem('st_app_tab', tab); });

  async function create() {
    const name = prompt('Workspace name (e.g. production title):', 'My Production');
    if (name === null) return;
    creating = true; err = null;
    try {
      const code = await sync.createWorkspace(name);
      workspaceCode = code;
      hasWorkspace = true;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally { creating = false; }
  }

  async function join() {
    const code = prompt('Enter 6-character workspace code:');
    if (!code) return;
    joining = true; err = null;
    try {
      await sync.joinWorkspace(code);
      workspaceCode = code.toUpperCase().trim();
      hasWorkspace = true;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally { joining = false; }
  }
</script>

{#if !hasWorkspace}
  <div class="onboard">
    <h1>Set Tools — DA Workstation</h1>
    <p>Join your production workspace to access tomorrow's briefing, dept status, contacts, conflicts, notes, issues, cast bible, and global resources.</p>
    {#if err}<div class="err">{err}</div>{/if}
    <div class="actions">
      <button onclick={create} disabled={creating}>{creating ? 'Creating…' : 'Create New Workspace'}</button>
      <button onclick={join} disabled={joining} class="ghost">{joining ? 'Joining…' : 'Join with Code'}</button>
    </div>
    <p class="hint">If you already created a workspace on the main machine, click <strong>Join</strong> and enter that 6-character code.</p>
  </div>
{:else}
  <header class="topnav" role="navigation">
    <div class="topnav-inner">
      <div class="brand">Set Tools <span class="ws">· {workspaceCode}</span></div>
      <div class="tabs">
        <button class:active={tab === 'tomorrow'} onclick={() => tab = 'tomorrow'}>🌅 Tomorrow</button>
        <button class:active={tab === 'cast-timer'} onclick={() => tab = 'cast-timer'}>🎭 Cast</button>
        <button class:active={tab === 'crew-timer'} onclick={() => tab = 'crew-timer'}>👥 Crew</button>
        <button class:active={tab === 'depts'} onclick={() => tab = 'depts'}>
          🎬 Depts{#if deptBlockedCount > 0}<span class="badge danger">{deptBlockedCount}</span>{/if}
        </button>
        <button class:active={tab === 'contacts'} onclick={() => tab = 'contacts'}>📞 Contacts</button>
        <button class:active={tab === 'conflicts'} onclick={() => tab = 'conflicts'}>
          🔍 Conflicts{#if conflictUnreviewedCount > 0}<span class="badge">{conflictUnreviewedCount}</span>{/if}
        </button>
        <button class:active={tab === 'notes'} onclick={() => tab = 'notes'}>📝 Notes</button>
        <button class:active={tab === 'issues'} onclick={() => tab = 'issues'}>
          ⚠ Issues{#if issueOpenCount > 0}<span class="badge">{issueOpenCount}</span>{/if}
        </button>
        <button class:active={tab === 'cast-bible'} onclick={() => tab = 'cast-bible'}>🎭 Cast Bible</button>
        <button class:active={tab === 'resources'} onclick={() => tab = 'resources'}>📁 Resources</button>
      </div>
      <a class="home-link" href="/index.html">← Set Tools home</a>
    </div>
  </header>

  <UniversalHeader />

  {#if tab === 'tomorrow'}
    <DailyBriefing />
  {:else if tab === 'cast-timer'}
    <TrackerTab mode="cast" />
  {:else if tab === 'crew-timer'}
    <TrackerTab mode="crew" />
  {:else if tab === 'depts'}
    <DeptStatus />
  {:else if tab === 'contacts'}
    <Contacts />
  {:else if tab === 'conflicts'}
    <ConflictReview />
  {:else if tab === 'notes'}
    <Notes />
  {:else if tab === 'issues'}
    <Issues />
  {:else if tab === 'cast-bible'}
    <CastBible />
  {:else}
    <GlobalResources />
  {/if}
{/if}

<style>
  .onboard { max-width: 520px; margin: 80px auto; padding: 40px 32px; background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; text-align: center; }
  .onboard h1 { font-family: var(--cond); font-size: 28px; font-weight: 700; color: var(--accent); letter-spacing: 0.04em; margin-bottom: 12px; }
  .onboard p { color: var(--text2); font-size: 14px; line-height: 1.5; margin-bottom: 8px; }
  .onboard p.hint { font-size: 12px; color: var(--text3); margin-top: 18px; }
  .actions { display: flex; gap: 10px; justify-content: center; margin: 24px 0 0; flex-wrap: wrap; }
  .actions button { font-family: var(--font); font-size: 14px; font-weight: 600; padding: 10px 18px; border-radius: 8px; cursor: pointer; transition: all 0.12s; background: var(--accent); color: var(--bg); border: 1px solid var(--accent); }
  .actions button:hover:not(:disabled) { background: var(--accent2); border-color: var(--accent2); }
  .actions button.ghost { background: transparent; color: var(--text2); border: 1px solid var(--border); }
  .actions button.ghost:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  .actions button:disabled { opacity: 0.5; cursor: not-allowed; }
  .err { background: rgba(224, 90, 90, 0.12); color: var(--danger); padding: 10px 14px; border-radius: 6px; font-family: var(--mono); font-size: 12px; margin: 12px 0; }

  /* Top nav */
  .topnav { position: sticky; top: 0; z-index: 100; background: var(--bg2); border-bottom: 1px solid var(--border); }
  .topnav-inner { max-width: 1200px; margin: 0 auto; padding: 0 20px; display: flex; align-items: center; gap: 14px; height: 52px; }
  .brand { font-family: var(--cond); font-size: 16px; font-weight: 700; letter-spacing: 0.06em; color: var(--accent); text-transform: uppercase; }
  .brand .ws { font-family: var(--mono); font-size: 11px; color: var(--text3); margin-left: 6px; letter-spacing: 0.05em; font-weight: 500; }
  .tabs { display: flex; gap: 4px; margin-left: 20px; flex: 1; }
  .tabs button { background: none; border: 1px solid transparent; color: var(--text2); font-family: var(--font); font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 6px; cursor: pointer; transition: all .12s; }
  .tabs button:hover { color: var(--text); background: var(--bg3); }
  .tabs button.active { color: var(--accent); background: rgba(167, 139, 250, 0.13); border-color: rgba(167, 139, 250, 0.35); }
  .tabs .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    background: var(--warn);
    color: var(--bg);
    border-radius: 8px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    min-width: 16px;
    text-align: center;
  }
  .tabs .badge.danger { background: var(--danger); }
  .home-link { font-family: var(--mono); font-size: 11px; color: var(--text2); text-decoration: none; padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; transition: all .12s; white-space: nowrap; }
  .home-link:hover { color: var(--accent); border-color: var(--accent); }

  @media (max-width: 640px) {
    .topnav-inner { flex-wrap: wrap; height: auto; padding: 8px 14px; }
    .tabs { margin-left: 0; }
    .home-link { font-size: 10px; padding: 4px 8px; }
  }
</style>
