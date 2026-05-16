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
  import SignIn from './components/SignIn.svelte';
  import SceneTracker from './components/SceneTracker.svelte';
  import TimerDashboard from './components/TimerDashboard.svelte';
  import DOODViewer from './components/DOODViewer.svelte';
  import NextDayCall from './components/NextDayCall.svelte';
  import Distribution from './components/Distribution.svelte';
  import WrapReportView from './components/WrapReport.svelte';
  import CommLog from './components/CommLog.svelte';
  import ProjectSettingsView from './components/ProjectSettings.svelte';
  import WalkieChart from './components/WalkieChart.svelte';
  import BGTracker from './components/BGTracker.svelte';
  import TimeSheetView from './components/TimeSheet.svelte';
  import Sides from './components/Sides.svelte';
  import * as issuesLib from './lib/issues';
  import * as contactsLib from './lib/contacts';
  import * as csLib from './lib/conflictStatus';
  import * as deptLib from './lib/deptStatus';
  import { type Tab, isTab, onTabRequest } from './lib/nav';

  // Kiosk mode: ?mode=kiosk strips to sign-in only
  const kioskMode = new URLSearchParams(location.search).get('mode') === 'kiosk';

  let hasWorkspace = $state(false);
  let workspaceCode = $state<string | null>(null);
  let joining = $state(false);
  let creating = $state(false);
  let err = $state<string | null>(null);
  let tab = $state<Tab>(kioskMode ? 'sign-in' : 'tomorrow');
  let issueOpenCount = $state(0);
  let conflictUnreviewedCount = $state(0);
  let deptBlockedCount = $state(0);

  // Restore last-active tab from sessionStorage (per-tab, not synced)
  onMount(async () => {
    if (!kioskMode) {
      const saved = sessionStorage.getItem('st_app_tab');
      if (isTab(saved)) tab = saved;
      // Allow deep-linking to a tab via the URL hash
      const h = location.hash.replace('#', '');
      if (isTab(h)) tab = h;
    }
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
{:else if kioskMode}
  <!-- Kiosk mode: sign-in only, no nav/header, full viewport -->
  <div class="kiosk-shell">
    <SignIn kiosk />
    <a class="kiosk-exit" href="?">Exit Kiosk</a>
  </div>
{:else}
  <div class="app-layout">
    <!-- TOP BAR: brand + Universal Header inline -->
    <header class="topbar">
      <div class="brand">ST <span class="ws">{workspaceCode}</span></div>
      <div class="uh-slot"><UniversalHeader /></div>
      <a class="home-link" href="/index.html" title="Set Tools home">Home</a>
    </header>

    <!-- LEFT SIDEBAR -->
    <nav class="sidebar" aria-label="Main navigation">
      <div class="nav-group">
        <span class="nav-label">Set Day</span>
        <button class:active={tab === 'tomorrow'} onclick={() => tab = 'tomorrow'}><span class="ico">🌅</span><span class="lbl">Tomorrow</span></button>
        <button class:active={tab === 'cast-timer'} onclick={() => tab = 'cast-timer'}><span class="ico">🎭</span><span class="lbl">Cast</span></button>
        <button class:active={tab === 'crew-timer'} onclick={() => tab = 'crew-timer'}><span class="ico">👥</span><span class="lbl">Crew</span></button>
        <button class:active={tab === 'sign-in'} onclick={() => tab = 'sign-in'}><span class="ico">✍</span><span class="lbl">Sign-In</span></button>
        <button class:active={tab === 'scenes'} onclick={() => tab = 'scenes'}><span class="ico">🎞</span><span class="lbl">Scenes</span></button>
        <button class:active={tab === 'bg'} onclick={() => tab = 'bg'}><span class="ico">👤</span><span class="lbl">BG</span></button>
        <button class:active={tab === 'dashboard'} onclick={() => tab = 'dashboard'}><span class="ico">⏱</span><span class="lbl">Timers</span></button>
        <button class:active={tab === 'next-call'} onclick={() => tab = 'next-call'}><span class="ico">📋</span><span class="lbl">Next Day</span></button>
        <button class:active={tab === 'sides'} onclick={() => tab = 'sides'}><span class="ico">📄</span><span class="lbl">Sides</span></button>
      </div>

      <div class="nav-group">
        <span class="nav-label">Coordination</span>
        <button class:active={tab === 'depts'} onclick={() => tab = 'depts'}>
          <span class="ico">🎬</span><span class="lbl">Depts</span>
          {#if deptBlockedCount > 0}<span class="badge danger">{deptBlockedCount}</span>{/if}
        </button>
        <button class:active={tab === 'contacts'} onclick={() => tab = 'contacts'}><span class="ico">📞</span><span class="lbl">Contacts</span></button>
        <button class:active={tab === 'distro'} onclick={() => tab = 'distro'}><span class="ico">✉</span><span class="lbl">Distro</span></button>
        <button class:active={tab === 'walkie'} onclick={() => tab = 'walkie'}><span class="ico">📻</span><span class="lbl">Walkie</span></button>
        <button class:active={tab === 'conflicts'} onclick={() => tab = 'conflicts'}>
          <span class="ico">🔍</span><span class="lbl">Conflicts</span>
          {#if conflictUnreviewedCount > 0}<span class="badge">{conflictUnreviewedCount}</span>{/if}
        </button>
      </div>

      <div class="nav-group">
        <span class="nav-label">Records</span>
        <button class:active={tab === 'notes'} onclick={() => tab = 'notes'}><span class="ico">📝</span><span class="lbl">Notes</span></button>
        <button class:active={tab === 'issues'} onclick={() => tab = 'issues'}>
          <span class="ico">⚠</span><span class="lbl">Issues</span>
          {#if issueOpenCount > 0}<span class="badge">{issueOpenCount}</span>{/if}
        </button>
        <button class:active={tab === 'dood'} onclick={() => tab = 'dood'}><span class="ico">📊</span><span class="lbl">DOOD</span></button>
        <button class:active={tab === 'wrap'} onclick={() => tab = 'wrap'}><span class="ico">📄</span><span class="lbl">Wrap</span></button>
        <button class:active={tab === 'time-sheet'} onclick={() => tab = 'time-sheet'}><span class="ico">⏰</span><span class="lbl">Times</span></button>
        <button class:active={tab === 'comm-log'} onclick={() => tab = 'comm-log'}><span class="ico">📡</span><span class="lbl">Comms</span></button>
        <button class:active={tab === 'cast-bible'} onclick={() => tab = 'cast-bible'}><span class="ico">🎭</span><span class="lbl">Bible</span></button>
        <button class:active={tab === 'resources'} onclick={() => tab = 'resources'}><span class="ico">📁</span><span class="lbl">Resources</span></button>
      </div>

      <div class="nav-spacer"></div>
      <button class="nav-settings" class:active={tab === 'settings'} onclick={() => tab = 'settings'}><span class="ico">⚙</span><span class="lbl">Settings</span></button>
    </nav>

    <!-- MAIN CONTENT -->
    <main class="main">
      {#if tab === 'tomorrow'}
        <DailyBriefing />
      {:else if tab === 'cast-timer'}
        <TrackerTab mode="cast" />
      {:else if tab === 'crew-timer'}
        <TrackerTab mode="crew" />
      {:else if tab === 'sign-in'}
        <SignIn />
      {:else if tab === 'scenes'}
        <SceneTracker />
      {:else if tab === 'bg'}
        <BGTracker />
      {:else if tab === 'dashboard'}
        <TimerDashboard />
      {:else if tab === 'depts'}
        <DeptStatus />
      {:else if tab === 'contacts'}
        <Contacts />
      {:else if tab === 'conflicts'}
        <ConflictReview />
      {:else if tab === 'distro'}
        <Distribution />
      {:else if tab === 'notes'}
        <Notes />
      {:else if tab === 'issues'}
        <Issues />
      {:else if tab === 'next-call'}
        <NextDayCall />
      {:else if tab === 'dood'}
        <DOODViewer />
      {:else if tab === 'wrap'}
        <WrapReportView />
      {:else if tab === 'time-sheet'}
        <TimeSheetView />
      {:else if tab === 'comm-log'}
        <CommLog />
      {:else if tab === 'cast-bible'}
        <CastBible />
      {:else if tab === 'walkie'}
        <WalkieChart />
      {:else if tab === 'sides'}
        <Sides />
      {:else if tab === 'settings'}
        <ProjectSettingsView />
      {:else}
        <GlobalResources />
      {/if}
    </main>
  </div>
{/if}

<style>
  /* ─── Onboarding ─── */
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

  /* ─── App layout (L-shaped: top bar + left sidebar + main) ─── */
  .app-layout {
    display: grid;
    grid-template-columns: 56px 1fr;
    grid-template-rows: auto 1fr;
    height: 100vh;
    overflow: hidden;
  }

  /* ─── Top bar ─── */
  .topbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 0;
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    height: 36px;
    z-index: 100;
    padding: 0 12px 0 0;
  }
  .brand {
    width: 56px;
    flex-shrink: 0;
    text-align: center;
    font-family: var(--cond);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent);
    text-transform: uppercase;
    line-height: 36px;
  }
  .brand .ws {
    display: block;
    font-family: var(--mono);
    font-size: 8px;
    color: var(--text3);
    letter-spacing: 0.05em;
    font-weight: 500;
    line-height: 1;
    margin-top: -6px;
  }
  .uh-slot { flex: 1; min-width: 0; }
  /* Override UH internal styles so it sits flush in the topbar */
  .uh-slot :global(.uh-bar) {
    border-bottom: none;
    height: 36px;
    padding: 0 12px;
  }

  .home-link {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    text-decoration: none;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    transition: all .12s;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .home-link:hover { color: var(--accent); border-color: var(--accent); }

  /* ─── Left sidebar ─── */
  .sidebar {
    grid-row: 2;
    grid-column: 1;
    width: 56px;
    background: var(--bg2);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    transition: width 0.18s ease;
    z-index: 90;
  }
  .sidebar::-webkit-scrollbar { display: none; }
  .sidebar:hover { width: 150px; }

  .nav-group {
    display: flex;
    flex-direction: column;
    padding: 6px 0;
  }
  .nav-group + .nav-group { border-top: 1px solid var(--border); }

  .nav-label {
    font-family: var(--mono);
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text3);
    padding: 4px 8px 2px;
    white-space: nowrap;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .sidebar:hover .nav-label { opacity: 1; }

  .sidebar button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    padding: 7px 0 7px 15px;
    cursor: pointer;
    transition: all 0.1s;
    position: relative;
    white-space: nowrap;
    color: var(--text2);
    font-family: var(--font);
    font-size: 12px;
    font-weight: 600;
  }
  .sidebar button:hover {
    color: var(--text);
    background: var(--bg3);
  }
  .sidebar button.active {
    color: var(--accent);
    background: rgba(167, 139, 250, 0.1);
  }
  .sidebar button.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 3px;
    background: var(--accent);
    border-radius: 0 3px 3px 0;
  }

  .ico {
    width: 24px;
    text-align: center;
    font-size: 14px;
    flex-shrink: 0;
    line-height: 1;
  }
  .lbl {
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .sidebar:hover .lbl { opacity: 1; }

  .nav-spacer { flex: 1; }
  .nav-settings {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    width: 100%;
    border: none;
    background: none;
    color: var(--text3);
    font-family: var(--mono);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.12s;
    position: relative;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .nav-settings:hover { color: var(--text); background: var(--bg3); }
  .nav-settings.active { color: var(--accent); background: rgba(167, 139, 250, 0.1); }

  .badge {
    display: inline-block;
    margin-left: auto;
    margin-right: 10px;
    padding: 1px 5px;
    background: var(--warn);
    color: var(--bg);
    border-radius: 8px;
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 700;
    min-width: 14px;
    text-align: center;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .sidebar:hover .badge { opacity: 1; }
  .badge.danger { background: var(--danger); }

  /* When sidebar is collapsed, show a dot indicator for badges */
  .sidebar:not(:hover) button .badge {
    opacity: 0;
    width: 0;
    padding: 0;
    margin: 0;
  }
  .sidebar:not(:hover) button:has(.badge) .ico::after {
    content: '';
    position: absolute;
    top: 5px;
    right: 10px;
    width: 6px;
    height: 6px;
    background: var(--warn);
    border-radius: 50%;
  }
  .sidebar:not(:hover) button:has(.badge.danger) .ico::after {
    background: var(--danger);
  }

  /* ─── Main content ─── */
  .main {
    grid-row: 2;
    grid-column: 2;
    overflow: hidden;
    position: relative;
  }

  /* ─── Kiosk shell ─── */
  .kiosk-shell { position: relative; height: 100vh; overflow: hidden; }
  .kiosk-exit {
    position: fixed;
    bottom: 8px;
    right: 12px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    text-decoration: none;
    opacity: 0.4;
    z-index: 200;
    padding: 4px 8px;
    border-radius: 4px;
    transition: opacity 0.15s;
  }
  .kiosk-exit:hover { opacity: 1; color: var(--accent); }

  /* ─── Mobile: sidebar collapses to bottom bar ─── */
  @media (max-width: 768px) {
    .app-layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr auto;
    }
    .sidebar {
      grid-row: 3;
      grid-column: 1;
      width: 100%;
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      border-right: none;
      border-top: 1px solid var(--border);
      height: 48px;
    }
    .sidebar:hover { width: 100%; }
    .nav-group { flex-direction: row; padding: 0; }
    .nav-group + .nav-group { border-top: none; border-left: 1px solid var(--border); }
    .nav-label { display: none; }
    .sidebar button { padding: 8px 12px; flex-direction: column; gap: 2px; }
    .lbl { opacity: 1; font-size: 9px; }
    .sidebar:hover .lbl { opacity: 1; }
    .badge { display: none; }
    .ico { font-size: 16px; }
    .main { overflow: auto; }
  }
</style>
